import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import isLooseList from '../is-loose-list/index.ts';
import { reportUnsupportedMarkdown } from '../report-error/index.ts';
import sliceMarkdownSource from '../slice-markdown-source/index.ts';

type RenderOptions = {
	filepath?: string | undefined;
	parserName?: 'markdown' | 'remark';
	// The original Markdown source, used to recover the reference renderer’s
	// interpretation of syntax specific to Prettier
	source?: string | undefined;
};

type Reading = {
	// The construct’s name, with an article where needed
	description: string;
	isInline: boolean;
	neutralize: (source: string) => string;
};

type RenderState = {
	context: AST.DocumentContext;
	definitions: Set<string>;
	// The block quotes and list items around the current node, outermost first
	enclosingContainers: AST.Node[];
	// Whether these nodes come from reparsing a construct under the reference
	// profile
	isReading: boolean;
	isSingleLine: boolean;
	length: number;
	options: RenderOptions;
	output: string[];
	substitutes: Map<AST.Node, AST.HTMLNode>;
};

// Syntax outside the reference profile, with source adjustments that make
// Prettier parse it according to that profile
export const READINGS: Readonly<Record<string, Reading>> = {
	footnoteDefinition: {
		description: 'a footnote definition',
		isInline: false,
		neutralize: (source) => source.replace(/^\[\^/, String.raw`[\^`),
	},
	frontMatter: {
		description: 'frontmatter',
		isInline: false,
		neutralize: (source) => `\n${source}`,
	},
	inlineMath: {
		description: 'math',
		isInline: true,
		neutralize: (source) => source.replaceAll('$', String.raw`\$`),
	},
	liquidNode: {
		description: 'a Liquid tag',
		isInline: true,
		neutralize: (source) =>
			source.replaceAll(/\{(?=[%{])/g, String.raw`\{`),
	},
	math: {
		description: 'math',
		isInline: false,
		neutralize: (source) => source.replaceAll('$', String.raw`\$`),
	},
	wikiLink: {
		description: 'a wiki link',
		isInline: true,
		neutralize: (source) => source.replace(/^\[\[/, String.raw`\[[`),
	},
};

/**
 * Renders a Markdown syntax tree as the HTML document the reference renderer
 * produces, recording where each raw HTML fragment and generated element
 * appears.
 */
export default function renderDocumentContext(
	root: AST.RootNode,
	options: RenderOptions = {}
): AST.DocumentContext {
	const context: AST.DocumentContext = {
		containers: new Map(),
		enclosingContainers: new Map(),
		end: root.position?.end,
		fragments: [],
		generatedElements: [],
		html: '',
		readings: [],
		source: options.source,
	};
	const state: RenderState = {
		context,
		definitions: collectDefinitions(root),
		enclosingContainers: [],
		isReading: false,
		isSingleLine: false,
		length: 0,
		options,
		output: [],
		substitutes: new Map(),
	};

	renderChildren(root, state, false);
	context.html = state.output.join('');

	return context;
}

/**
 * Renders a node’s children.
 */
function renderChildren(
	node: AST.Node,
	state: RenderState,
	isTight: boolean
): void {
	for (const child of node.children ?? []) {
		renderNode(child, node, state, isTight);
	}
}

/**
 * Renders one node and records its HTML context.
 */
function renderNode(
	node: AST.Node,
	parent: AST.Node,
	state: RenderState,
	isTight: boolean
): void {
	switch (node.type) {
		case 'blockquote':
			renderContainer(node, 'blockquote', '', state, () => {
				state.enclosingContainers.push(node);
				renderChildren(node, state, false);
				state.enclosingContainers.pop();
			});
			break;

		case 'break':
			write(state, '<br />\n');
			break;

		case 'code': {
			const language = (node as { lang?: string }).lang;
			const attribute = language
				? ` class="language-${escapeHTML(language.split(/\s/, 1)[0]!)}"`
				: '';
			startLine(state);
			renderElement(node, 'pre', '', state, () => {
				write(state, `<code${attribute}>`);
				write(state, escapeHTML(appendNewline(node.value ?? '')));
				write(state, '</code>');
			});
			write(state, '\n');
			break;
		}

		case 'definition':
			break;

		case 'delete':
			renderElement(node, 'del', '', state, () => {
				renderChildren(node, state, isTight);
			});
			break;

		case 'emphasis':
			renderElement(node, 'em', '', state, () => {
				renderChildren(node, state, isTight);
			});
			break;

		case 'heading': {
			const depth = (node as { depth?: number }).depth ?? 1;
			startLine(state);
			renderElement(node, `h${depth}`, '', state, () => {
				renderSingleLine(node, state);
			});
			write(state, '\n');
			break;
		}

		case 'html':
			renderFragment(node as AST.HTMLNode, parent, state);
			break;

		case 'image':

		case 'imageReference': {
			const { alt, url } = node as { alt?: string; url?: string };
			write(
				state,
				`<img src="${escapeHTML(url ?? '')}" alt="${escapeHTML(alt ?? '')}" />`
			);
			break;
		}

		case 'inlineCode':
			renderElement(node, 'code', '', state, () => {
				write(state, escapeHTML(node.value ?? ''));
			});
			break;

		case 'link': {
			const { url } = node as { url?: string };
			renderElement(
				node,
				'a',
				` href="${escapeHTML(url ?? '')}"`,
				state,
				() => {
					renderChildren(node, state, isTight);
				}
			);
			break;
		}

		case 'linkReference': {
			const { identifier } = node as { identifier?: string };

			if (identifier && state.definitions.has(identifier.toLowerCase())) {
				renderElement(node, 'a', ' href=""', state, () => {
					renderChildren(node, state, isTight);
				});
			} else {
				write(state, '[');
				renderChildren(node, state, isTight);
				write(state, ']');
			}
			break;
		}

		case 'list': {
			const { ordered, start } = node as {
				ordered?: boolean;
				start?: unknown;
			};
			const tagName = ordered ? 'ol' : 'ul';
			const attributes =
				ordered && typeof start === 'number' && start !== 1
					? ` start="${start}"`
					: '';
			const isTightList = !isLooseList(node, state.options.source);

			renderContainer(node, tagName, attributes, state, () => {
				for (const item of node.children ?? []) {
					renderListItem(item, state, isTightList);
				}
			});
			break;
		}

		case 'paragraph':
			// Paragraphs in tight lists render without their own element or
			// line
			if (isTight) {
				renderChildren(node, state, true);
				break;
			}

			startLine(state);
			renderElement(node, 'p', '', state, () => {
				renderChildren(node, state, false);
			});
			write(state, '\n');
			break;

		case 'strong':
			renderElement(node, 'strong', '', state, () => {
				renderChildren(node, state, isTight);
			});
			break;

		case 'table':
			renderTable(node, state);
			break;

		case 'thematicBreak':
			startLine(state);
			write(state, '<hr />\n');
			break;

		default:
			if (node.type && Object.hasOwn(READINGS, node.type)) {
				renderReferenceReading(
					node,
					READINGS[node.type]!,
					state,
					isTight
				);
				break;
			}

			if (node.children) {
				renderChildren(node, state, isTight);
				break;
			}

			write(state, escapeHTML(node.value ?? ''));
	}
}

/**
 * Renders a list item, including the checkbox of a task list item.
 */
function renderListItem(
	item: AST.Node,
	state: RenderState,
	isTight: boolean
): void {
	const { checked } = item as { checked?: unknown };

	renderContainer(item, 'li', '', state, () => {
		// The reference renderer leaves task list markers in block quotes as
		// text
		const isInBlockquote = state.enclosingContainers.some(
			({ type }) => type === 'blockquote'
		);

		if (typeof checked === 'boolean' && isInBlockquote) {
			write(state, checked ? '[x] ' : '[ ] ');
		} else if (typeof checked === 'boolean') {
			write(
				state,
				checked
					? '<input type="checkbox" checked="" disabled="" /> '
					: '<input type="checkbox" disabled="" /> '
			);
		}

		state.enclosingContainers.push(item);
		renderChildren(item, state, isTight);
		state.enclosingContainers.pop();
	});
}

/**
 * Renders a GFM table with its header row and body rows.
 */
function renderTable(table: AST.Node, state: RenderState): void {
	const { align = [] } = table as { align?: unknown[] };
	const [headerRow, ...bodyRows] = table.children ?? [];

	renderContainer(table, 'table', '', state, () => {
		if (headerRow) {
			startLine(state);
			write(state, '<thead>\n');
			renderTableRow(headerRow, 'th', align, state);
			write(state, '</thead>\n');
		}

		if (bodyRows.length > 0) {
			write(state, '<tbody>\n');

			for (const row of bodyRows) {
				renderTableRow(row, 'td', align, state);
			}

			write(state, '</tbody>\n');
		}
	});
}

/**
 * Renders a table row and its cells.
 */
function renderTableRow(
	row: AST.Node,
	cellTagName: 'td' | 'th',
	align: unknown[],
	state: RenderState
): void {
	renderContainer(row, 'tr', '', state, () => {
		for (const [index, cell] of (row.children ?? []).entries()) {
			const cellAlign = align[index];
			const attributes =
				typeof cellAlign === 'string' ? ` align="${cellAlign}"` : '';

			startLine(state);
			renderContainer(
				cell,
				cellTagName,
				attributes,
				state,
				() => {
					renderSingleLine(cell, state);
				},
				false
			);
		}
	});
}

/**
 * Renders the content of a heading or table cell, whose Markdown syntax
 * requires a single physical line.
 */
function renderSingleLine(node: AST.Node, state: RenderState): void {
	const { isSingleLine } = state;
	state.isSingleLine = true;
	renderChildren(node, state, false);
	state.isSingleLine = isSingleLine;
}

/**
 * Renders a generated container element, recording its tag boundaries so its
 * contents can be formatted as their own scope.
 */
function renderContainer(
	node: AST.Node,
	tagName: string,
	attributes: string,
	state: RenderState,
	renderContent: () => void,
	isBlock = true
): void {
	if (isBlock) {
		startLine(state);
	}

	const element = renderElement(node, tagName, attributes, state, () => {
		renderContent();

		if (isBlock && tagName !== 'li') {
			startLine(state);
		}
	});
	write(state, '\n');

	state.context.containers.set(node, element);
}

/**
 * Starts a new line unless the rendered document already ends with one, as the
 * reference renderer does before each block.
 */
function startLine(state: RenderState): void {
	if (state.length > 0 && !state.output.at(-1)!.endsWith('\n')) {
		write(state, '\n');
	}
}

/**
 * Renders a generated element and records its tag boundaries.
 */
function renderElement(
	node: AST.Node,
	tagName: string,
	attributes: string,
	state: RenderState,
	renderContent: () => void
): AST.GeneratedElement {
	const openStart = state.length;
	write(state, `<${tagName}${attributes}>`);
	const openEnd = state.length;
	state.context.enclosingContainers.set(node, [...state.enclosingContainers]);

	renderContent();

	const closeStart = state.length;
	write(state, `</${tagName}>`);

	const element: AST.GeneratedElement = {
		closeEnd: state.length,
		closeStart,
		node,
		openEnd,
		openStart,
		tagName,
	};

	state.context.generatedElements.push(element);

	return element;
}

/**
 * Renders a raw HTML node as a fragment of the document context.
 */
function renderFragment(
	node: AST.HTMLNode,
	parent: AST.Node,
	state: RenderState
): void {
	const isInTableCell = parent.type === 'tableCell';
	const isBlock = isBlockContainer(parent);
	const html = getFragmentSource(node, isBlock, isInTableCell);

	if (isBlock) {
		startLine(state);
	}

	const start = state.length;
	const original = state.isReading ? state.substitutes.get(node) : node;

	write(state, html);

	if (original) {
		state.context.fragments.push({
			end: state.length,
			isBlock,
			isInTableCell,
			isSingleLine: state.isSingleLine,
			node: original,
			parent,
			start,
		});
	}

	if (isBlock) {
		write(state, '\n');
	}
}

/**
 * Returns the HTML of a fragment as the reference renderer emits it.
 */
function getFragmentSource(
	node: AST.HTMLNode,
	isBlock: boolean,
	isInTableCell: boolean
): string {
	if (isInTableCell) {
		// The reference table parser processes `\|` before HTML interpretation
		return node.value.replaceAll(String.raw`\|`, '|');
	}

	return isBlock ? getBlockSource(node) : node.value;
}

/**
 * Returns the lines of an HTML block. The line break that ends an unclosed raw
 * block at the end of a container isn’t part of its content.
 */
export function getBlockSource(node: AST.HTMLNode): string {
	return node.value.replace(/\r?\n$/, '');
}

/**
 * Renders syntax that only Prettier’s Markdown parser recognizes as the
 * reference renderer reads its source. Raw HTML in that reading has to match
 * inline HTML in Prettier’s syntax tree, which happens only in footnote
 * definitions, so the plugin can format and validate it.
 */
function renderReferenceReading(
	node: AST.Node,
	reading: Reading,
	state: RenderState,
	isTight: boolean
): void {
	const { parserName = 'markdown', source } = state.options;
	const sliced =
		source === undefined
			? undefined
			: sliceMarkdownSource(source, node, state.enclosingContainers);

	if (source === undefined || !sliced) {
		renderUnreadable(node, reading, state);
		return;
	}

	const text = reading.neutralize(sliced.text);
	const root = pluginMarkdown.parsers[parserName].parse(text, {
		originalText: text,
	} as ParserOptions) as AST.RootNode;
	const originalHTMLNodes = findHTMLNodes(node).map(({ html }) => html);
	const insertions = mapInsertions(sliced.text, text);

	relocate(root, (offset) => sliced.offsets[insertions[offset]!]!, source);
	state.context.readings.push(node);
	state.context.enclosingContainers.set(node, [...state.enclosingContainers]);

	for (const { html, parent } of findHTMLNodes(root)) {
		const index = originalHTMLNodes.findIndex(
			({ value }) => value === html.value
		);

		if (index === -1 || isBlockContainer(parent)) {
			reportUnsupportedMarkdown({
				filepath: state.options.filepath,
				position: node.position?.start,
				reason: `Prettier’s Markdown parser reads this as ${reading.description}, but GitHub Flavored Markdown recognizes raw HTML within it`,
			});
		}

		state.substitutes.set(html, originalHTMLNodes.splice(index, 1)[0]!);
	}

	// An inline construct reads as the content of a paragraph
	const [onlyChild] = root.children;
	const content =
		reading.isInline &&
		root.children.length === 1 &&
		onlyChild?.type === 'paragraph'
			? onlyChild
			: root;

	const { isReading } = state;
	state.isReading = true;
	renderChildren(content, state, isTight);
	state.isReading = isReading;
}

/**
 * Renders the reference reading of a construct that only Prettier’s Markdown
 * parser recognizes.
 */
export function renderReading(
	type: string,
	source: string,
	parserName: 'markdown' | 'remark'
): string {
	const text = READINGS[type]!.neutralize(source);
	const root = pluginMarkdown.parsers[parserName].parse(text, {
		originalText: text,
	} as ParserOptions) as AST.RootNode;

	return renderDocumentContext(root, { parserName, source: text }).html;
}

/**
 * Maps each offset in text with inserted characters to the corresponding offset
 * in the original.
 */
function mapInsertions(original: string, text: string): number[] {
	const offsets: number[] = [];
	let originalOffset = 0;

	for (let offset = 0; offset <= text.length; offset += 1) {
		offsets.push(originalOffset);

		if (text[offset] === original[originalOffset]) {
			originalOffset += 1;
		}
	}

	return offsets;
}

/**
 * Moves the positions of a reparsed syntax tree to where its source appears in
 * the document.
 */
function relocate(
	node: AST.Node,
	toSourceOffset: (offset: number) => number,
	source: string
): void {
	const { position } = node;

	if (
		position?.start.offset !== undefined &&
		position.end.offset !== undefined
	) {
		node.position = {
			end: toPoint(source, toSourceOffset(position.end.offset)),
			start: toPoint(source, toSourceOffset(position.start.offset)),
		};
	}

	for (const child of node.children ?? []) {
		relocate(child, toSourceOffset, source);
	}
}

/**
 * Converts an offset in the source into a one-based line and column.
 */
function toPoint(source: string, offset: number): AST.Point {
	const before = source.slice(0, offset);
	const lineStart = before.lastIndexOf('\n') + 1;

	return {
		column: offset - lineStart + 1,
		line: before.split('\n').length,
		offset,
	};
}

/**
 * Lists raw HTML nodes with their parents, in document order.
 */
function findHTMLNodes(
	node: AST.Node
): Array<{ html: AST.HTMLNode; parent: AST.Node }> {
	return (node.children ?? []).flatMap((child) =>
		child.type === 'html'
			? [{ html: child as AST.HTMLNode, parent: node }]
			: findHTMLNodes(child)
	);
}

/**
 * Renders a construct as text when its source is unavailable. Its raw HTML
 * stays unformatted because the reference renderer’s interpretation can’t be
 * recovered.
 */
function renderUnreadable(
	node: AST.Node,
	reading: Reading,
	state: RenderState
): void {
	if (!reading.isInline) {
		startLine(state);
	}

	writeText(node, state);

	if (!reading.isInline) {
		write(state, '\n');
	}
}

/**
 * Writes the escaped text of a node and its descendants.
 */
function writeText(node: AST.Node, state: RenderState): void {
	if (typeof node.value === 'string') {
		write(state, escapeHTML(node.value));
	}

	for (const child of node.children ?? []) {
		writeText(child, state);
	}
}

/**
 * Appends text to the rendered document.
 */
function write(state: RenderState, text: string): void {
	state.output.push(text);
	state.length += text.length;
}

/**
 * Collects the identifiers of link reference definitions.
 */
function collectDefinitions(root: AST.Node): Set<string> {
	const definitions = new Set<string>();
	const pending = [root];

	while (pending.length > 0) {
		const node = pending.pop()!;

		if (node.type === 'definition') {
			const { identifier } = node as { identifier?: string };

			if (identifier) {
				definitions.add(identifier.toLowerCase());
			}
		}

		pending.push(...(node.children ?? []));
	}

	return definitions;
}

/**
 * Checks whether a parent holds HTML blocks rather than inline HTML.
 */
export function isBlockContainer(parent: AST.Node): boolean {
	return (
		parent.type === 'root' ||
		parent.type === 'blockquote' ||
		parent.type === 'listItem'
	);
}

/**
 * Escapes text the way the reference renderer does.
 */
function escapeHTML(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/**
 * Ends text with a newline, as the reference renderer does for code blocks.
 */
function appendNewline(text: string): string {
	return text.endsWith('\n') || text === '' ? text : `${text}\n`;
}
