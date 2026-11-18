import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import {
	canInterruptParagraph,
	containsRawHTML,
	endsInContinuingBlock,
	startsHTMLBlock,
} from '../is-html-block-sequence/index.ts';
import isLooseList from '../is-loose-list/index.ts';
import { reportUnsupportedMarkdown } from '../report-error/index.ts';
import sliceMarkdownSource, {
	isParagraphBreak,
} from '../slice-markdown-source/index.ts';

// Indentation and block quote and list item markers at the start of a line
const CONTAINER_PREFIX_PATTERN =
	/^(?:[\t >]|[*+-](?=[\t ])|\d{1,9}[).](?=[\t ]))*/;

// Block quote and list item markers that can start a container, including
// some that the reference renderer reads as text
const CONTAINER_START_PATTERN =
	/^ {0,3}(?:>|[*+-](?:[\t ]|$)|\d{1,9}[).](?:[\t ]|$))/;

// A possible fence opening after up to three spaces. A backtick fence’s info
// string can’t contain a backtick
export const FENCE_OPENING_PATTERN = /^ {0,3}(?:(`{3,})(?![^`]*`)|(~{3,}))/;

// Constructs that Prettier reads as literal content, where the reference
// renderer can open a code fence that stays open past their end. Inline math
// that spans lines can end partway through a line that starts like a fence,
// before text that keeps the line from opening one, and wrapping can move that
// text to the next line
const FENCE_READING_TYPES: ReadonlySet<string> = new Set([
	'frontMatter',
	'inlineMath',
	'math',
]);

// This pattern matches inline declarations recognized by the reference
// renderer: `<!`, an uppercase name, ASCII whitespace, and the rest up to `>`
const GFM_DECLARATION_PATTERN = /^<![A-Z]+[\t\n\v\f\r ][^>]*>$/;

// Delimiters of math, Liquid tags, and footnote references, which Prettier’s
// Markdown parser can recognize anywhere in a paragraph, including link and
// image text. A backslash before each one makes Prettier read it as text
const INLINE_SYNTAX_PATTERN = /\$|\{(?=[%{])|(?<=\[)\^/g;

// The first bracket of a wiki link opener. A zero-width space after it keeps
// Prettier from reading a wiki link without changing how brackets pair
const WIKI_LINK_PATTERN = /\[(?=\[)/g;

type RenderOptions = {
	// Whether to compare raw HTML in blocks with math, Liquid tags, wiki links,
	// or footnote references against their reference reading, which a reading
	// of a single construct skips. When frontmatter or a footnote definition
	// hides a link reference definition, any block with a bracket counts
	checksInlineSyntax?: boolean;
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
	// The paragraph, heading, or table cell whose inline content is being
	// rendered
	block: AST.Node | undefined;
	// Where the reference reading of the current block finds raw HTML, as
	// source ranges, when the block contains inline syntax only Prettier reads
	blockHTML: ReadonlySet<string> | undefined;
	context: AST.DocumentContext;
	definitions: Set<string>;
	// The source of each link reference definition in the document, and
	// whether any of them is hidden from Prettier in frontmatter or a footnote
	// definition
	definitionSources: { hasHidden: boolean; sources: string[] };
	// The block quotes and list items around the current node, outermost first
	enclosingContainers: AST.Node[];
	// Whether these nodes come from a footnote definition’s reading
	isInFootnote: boolean;
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
		// Escaped dollar signs keep Prettier from reading math inside the
		// reading, which could hide a fence
		neutralize: (source) => `\n${source.replaceAll('$', String.raw`\$`)}`,
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
		markdownTexts: [],
		readings: [],
		source: options.source,
	};
	const state: RenderState = {
		block: undefined,
		blockHTML: undefined,
		context,
		definitions: collectDefinitions(root),
		definitionSources: collectDefinitionSources(
			root,
			options.checksInlineSyntax === false ? undefined : options.source,
			options.parserName
		),
		enclosingContainers: [],
		isInFootnote: false,
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
			if (
				isMarkdownText(node as AST.HTMLNode, parent) &&
				(state.isReading ||
					!isBlockContainer(parent) ||
					canLeaveToPrettier(
						node as AST.HTMLNode,
						parent,
						state.options.source,
						state.enclosingContainers
					))
			) {
				renderMarkdownText(
					node as AST.HTMLNode,
					parent,
					state,
					isTight
				);
			} else {
				checkInlineDeclaration(node as AST.HTMLNode, parent, state);
				renderFragment(node as AST.HTMLNode, parent, state);
			}
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
				state.context.enclosingContainers.set(node, [
					...state.enclosingContainers,
				]);
				renderInline(node, state, () => {
					renderChildren(node, state, true);
				});
				break;
			}

			startLine(state);
			renderElement(node, 'p', '', state, () => {
				renderInline(node, state, () => {
					renderChildren(node, state, false);
				});
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
	renderInline(node, state, () => {
		renderChildren(node, state, false);
	});
	state.isSingleLine = isSingleLine;
}

/**
 * Renders the inline content of a paragraph, heading, or table cell.
 */
function renderInline(
	node: AST.Node,
	state: RenderState,
	renderContent: () => void
): void {
	const { block, blockHTML } = state;
	const reading =
		(!state.isReading || state.isInFootnote) &&
		state.options.checksInlineSyntax !== false
			? readInlineSyntax(node, state)
			: undefined;
	state.block = node;
	state.blockHTML = reading && new Set(reading.referenceHTML);
	renderContent();
	state.block = block;
	state.blockHTML = blockHTML;

	// Disagreements within a construct have their own, earlier report
	if (
		reading &&
		reading.referenceHTML.join(' ') !== reading.prettierHTML.join(' ')
	) {
		reportCrossingSyntax(node, reading.readings, state);
	}
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
			block: isBlock ? undefined : state.block,
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
 * Checks whether the reference renderer reads HTML from Prettier’s Markdown
 * parser as Markdown text, such as a lowercase `<!doctype html>` block or an
 * inline `<!DOCTYPE>`. Formatting leaves such HTML to Prettier.
 */
function isMarkdownText(node: AST.HTMLNode, parent: AST.Node): boolean {
	// The reference renderer reads an inline declaration only with an uppercase
	// name and whitespace after it
	if (!isBlockContainer(parent)) {
		return (
			/^<![A-Za-z]/.test(node.value) &&
			!GFM_DECLARATION_PATTERN.test(node.value) &&
			!containsRawHTML(node.value.slice(2))
		);
	}

	const source = getBlockSource(node);
	const [firstLine = '', ...lines] = source.split('\n');

	return (
		!startsHTMLBlock(firstLine) &&
		!lines.some((line) => canInterruptParagraph(line)) &&
		!containsRawHTML(source)
	);
}

/**
 * Checks whether Prettier can format a block of Markdown text that it reads as
 * HTML without moving raw HTML. Surrounding paragraph lines must be free of raw
 * HTML. Blank lines, a container start, a preceding HTML block that has ended,
 * or a following HTML block that interrupts the paragraph bound this check.
 * As a conservative bound, the check extends to the end of the document when
 * the block immediately follows a block quote or list, or when
 * `findReachedLines` finds that a multi-line block can reach later lines.
 */
function canLeaveToPrettier(
	node: AST.HTMLNode,
	parent: AST.Node,
	source: string | undefined,
	containers: ReadonlyArray<AST.Node>
): boolean {
	const start = node.position?.start.line;
	const end = node.position?.end.line;

	if (source === undefined || start === undefined || end === undefined) {
		return false;
	}

	const sourceLines = source.split('\n');
	const isBreak = createBreakCheck(source, containers);
	const siblings = parent.children ?? [];
	const index = siblings.indexOf(node);
	const previous = siblings[index - 1];
	const next = siblings[index + 1];
	const isAfterBlock =
		index === 0 ||
		(previous?.type === 'html' &&
			isOnNextLine(previous, node) &&
			!endsInContinuingBlock(getBlockSource(previous as AST.HTMLNode)));
	const isBeforeBlock =
		next?.type === 'html' &&
		isOnNextLine(node, next) &&
		canInterruptParagraph(
			getBlockSource(next as AST.HTMLNode).split('\n', 1)[0]!
		);

	const before = isAfterBlock
		? []
		: findParagraphLines(sourceLines, start - 2, -1, isBreak).toReversed();

	// The reference renderer can continue a paragraph that ends a preceding
	// block quote or list item through this block, so that container can take
	// in later lines. As a conservative bound, this applies whatever block
	// Prettier reads at the end of the container
	const continuesContainer =
		(previous?.type === 'blockquote' || previous?.type === 'list') &&
		isOnNextLine(previous, node);
	const after = continuesContainer
		? sourceLines.slice(end)
		: ((start === end
				? undefined
				: findReachedLines(node, sourceLines, end)) ??
			(isBeforeBlock
				? []
				: findParagraphLines(sourceLines, end, 1, isBreak)));

	return !hasRawHTML([...before, ...after]);
}

/**
 * Returns all lines after a multi-line block as a conservative bound when its
 * later lines match `CONTAINER_START_PATTERN` outside a fence or leave a fence
 * open. Containers can continue past blank lines, and Prettier can read a
 * closing fence beyond the block as an opening. Returns `undefined` otherwise
 * so the caller uses the normal paragraph check.
 */
function findReachedLines(
	node: AST.HTMLNode,
	sourceLines: ReadonlyArray<string>,
	end: number
): string[] | undefined {
	let fence: string | undefined;

	for (const line of getBlockSource(node).split('\n').slice(1)) {
		if (fence) {
			fence = isClosingFence(line, fence) ? undefined : fence;
		} else if (CONTAINER_START_PATTERN.test(line)) {
			return sourceLines.slice(end);
		} else {
			const opening = FENCE_OPENING_PATTERN.exec(line);
			fence = opening?.[1] ?? opening?.[2];
		}
	}

	return fence === undefined ? undefined : sourceLines.slice(end);
}

/**
 * Checks whether a line closes a fence that opened with the given marker.
 */
function isClosingFence(line: string, fence: string): boolean {
	const marker = /^ {0,3}(`+|~+)[\t ]*$/.exec(line)?.[1];

	return (
		marker !== undefined &&
		marker.startsWith(fence[0]!) &&
		marker.length >= fence.length
	);
}

/**
 * Checks whether a block fits on one line between blank lines or container
 * edges, so the reference renderer reads it as a paragraph of its own.
 */
function isIsolated(
	node: AST.HTMLNode,
	parent: AST.Node,
	source: string | undefined,
	containers: ReadonlyArray<AST.Node>
): boolean {
	const start = node.position?.start.line;
	const end = node.position?.end.line;

	if (source === undefined || start === undefined || start !== end) {
		return false;
	}

	const isBreak = createBreakCheck(source, containers);

	return (
		((parent.children ?? []).indexOf(node) === 0 || isBreak(start - 2)) &&
		isBreak(end)
	);
}

/**
 * Lists lines from an index in the given direction, stopping before the first
 * line that the supplied check identifies as a paragraph break.
 */
function findParagraphLines(
	lines: ReadonlyArray<string>,
	index: number,
	step: number,
	isBreak: (lineIndex: number) => boolean
): string[] {
	const paragraphLines: string[] = [];

	for (
		let lineIndex = index;
		lineIndex >= 0 && lineIndex < lines.length && !isBreak(lineIndex);
		lineIndex += step
	) {
		paragraphLines.push(lines[lineIndex]!);
	}

	return paragraphLines;
}

/**
 * Checks whether source lines can contain raw HTML, including tags that span
 * several lines, or start an HTML block. Tags count with or without the
 * container prefixes on their later lines.
 */
export function hasRawHTML(lines: ReadonlyArray<string>): boolean {
	const contents = lines.map((line) =>
		line.replace(CONTAINER_PREFIX_PATTERN, '')
	);

	return (
		containsRawHTML(lines.join('\n')) ||
		containsRawHTML(contents.join('\n')) ||
		contents.some((line) => startsHTMLBlock(line))
	);
}

/**
 * Creates a check for whether a line, by its index in the source, ends a
 * paragraph inside the containers around a node. Lines outside the source count
 * as breaks.
 */
function createBreakCheck(
	source: string,
	containers: ReadonlyArray<AST.Node>
): (lineIndex: number) => boolean {
	const lineStarts = [0];

	for (
		let offset = source.indexOf('\n');
		offset !== -1;
		offset = source.indexOf('\n', offset + 1)
	) {
		lineStarts.push(offset + 1);
	}

	return (lineIndex) =>
		lineIndex < 0 ||
		lineIndex >= lineStarts.length ||
		isParagraphBreak(source, lineStarts[lineIndex]!, containers);
}

/**
 * Reports an error for inline HTML that Prettier’s Markdown parser reads as a
 * declaration, while the reference renderer reads it as text containing raw
 * HTML.
 */
function checkInlineDeclaration(
	node: AST.HTMLNode,
	parent: AST.Node,
	state: RenderState
): void {
	if (
		!isBlockContainer(parent) &&
		/^<![A-Za-z]/.test(node.value) &&
		!GFM_DECLARATION_PATTERN.test(node.value)
	) {
		reportUnsupportedMarkdown({
			filepath: state.options.filepath,
			position: node.position?.start,
			reason: 'Prettier’s Markdown parser reads this as a declaration, but GitHub Flavored Markdown reads it as text with raw HTML inside',
		});
	}
}

/**
 * Checks whether consecutive nodes have no blank line between them.
 */
function isOnNextLine(
	node: AST.Node | undefined,
	next: AST.Node | undefined
): boolean {
	const end = node?.position?.end.line;
	const start = next?.position?.start.line;

	return end !== undefined && start !== undefined && start <= end + 1;
}

/**
 * Renders escaped Markdown text that only Prettier reads as HTML, adding a
 * paragraph wrapper to a block outside tight lists.
 */
function renderMarkdownText(
	node: AST.HTMLNode,
	parent: AST.Node,
	state: RenderState,
	isTight: boolean
): void {
	const text = escapeHTML(getBlockSource(node));

	if (!isBlockContainer(parent)) {
		write(state, text);
		return;
	}

	const markdownText = {
		isIsolated: isIsolated(
			node,
			parent,
			state.options.source,
			state.enclosingContainers
		),
		node,
	};

	if (isTight) {
		state.context.markdownTexts.push({
			...markdownText,
			start: state.length,
		});
		write(state, text);
		return;
	}

	startLine(state);
	renderElement(node, 'p', '', state, () => {
		state.context.markdownTexts.push({
			...markdownText,
			start: state.length,
		});
		write(state, text);
	});
	write(state, '\n');
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

	const neutralized = reading.neutralize(sliced.text);
	// An inline construct can end partway through a line that starts like a
	// fence, where the rest of the line keeps it from opening one
	const opened =
		reading.isInline && getRestOfLine(source, node)
			? escapeFenceOpening(neutralized)
			: neutralized;
	// Markup that the reference reading of the whole block doesn’t read as raw
	// HTML, as inside a code span that crosses the construct, stays text
	const text =
		reading.isInline && state.blockHTML && !hasHTMLWithin(node, state)
			? escapeUnescaped(opened, /</g)
			: opened;
	const root = pluginMarkdown.parsers[parserName].parse(text, {
		originalText: text,
	} as ParserOptions) as AST.RootNode;
	const originalHTMLNodes = findHTMLNodes(node).map(({ html }) => html);
	const insertions = mapInsertions(sliced.text, text);
	const blockStarts = new Set(
		findHTMLNodes(root)
			.filter(({ html }) => startsReferenceBlock(html, text))
			.map(({ html }) => html)
	);

	relocate(root, (offset) => sliced.offsets[insertions[offset]!]!, source);

	const htmlNodes = findHTMLNodes(root).filter(
		({ html, parent }) => !isMarkdownText(html, parent)
	);

	state.context.enclosingContainers.set(node, [...state.enclosingContainers]);

	for (const { html, parent } of htmlNodes) {
		const index = originalHTMLNodes.findIndex(
			({ value }) => value === html.value
		);

		if (index === -1 || isBlockContainer(parent) || blockStarts.has(html)) {
			reportUnsupportedMarkdown({
				filepath: state.options.filepath,
				position: node.position?.start,
				reason: `Prettier’s Markdown parser reads this as ${reading.description}, but GitHub Flavored Markdown recognizes raw HTML within it`,
			});
		}

		state.substitutes.set(html, originalHTMLNodes.splice(index, 1)[0]!);
	}

	if (
		leavesFenceOpenBeforeHTML(
			node,
			`${sliced.text}${getRestOfLine(source, node)}`,
			source,
			parserName
		)
	) {
		reportUnsupportedMarkdown({
			filepath: state.options.filepath,
			position: node.position?.start,
			reason: `Prettier’s Markdown parser reads this as ${reading.description}, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code`,
		});
	}

	// An inline construct reads as the content of a paragraph
	const [onlyChild] = root.children;
	const content =
		reading.isInline &&
		root.children.length === 1 &&
		onlyChild?.type === 'paragraph'
			? onlyChild
			: root;

	const { isInFootnote, isReading } = state;
	const start = state.length;
	state.isReading = true;
	state.isInFootnote = isInFootnote || node.type === 'footnoteDefinition';
	renderChildren(content, state, isTight);
	state.isReading = isReading;
	state.isInFootnote = isInFootnote;
	state.context.readings.push({
		end: state.length,
		hasRawHTML: htmlNodes.length > 0,
		node,
		start,
	});
}

type InlineSyntaxReading = {
	// Where Prettier’s Markdown parser finds raw HTML, as source ranges
	prettierHTML: string[];
	readings: AST.Node[];
	// Where the reference reading finds raw HTML, as source ranges
	referenceHTML: string[];
};

/**
 * Reads a paragraph, heading, or table cell under the reference profile when
 * it contains raw HTML syntax with math, Liquid tags, or wiki links. The
 * reference profile reads these constructs as text, so a backtick or markup in
 * one can pair with syntax outside it. The reading escapes their delimiters
 * in the block’s source and appends the document’s link reference definitions,
 * escaped the same way.
 */
function readInlineSyntax(
	block: AST.Node,
	state: RenderState
): InlineSyntaxReading | undefined {
	const { parserName = 'markdown', source } = state.options;
	const start = block.position?.start.offset;
	const end = block.position?.end.offset;

	if (source === undefined || start === undefined || end === undefined) {
		return undefined;
	}

	const blockSource = source.slice(start, end);
	const sliced = sliceMarkdownSource(
		source,
		block,
		state.enclosingContainers
	);

	if (
		!sliced ||
		!blockSource.includes('<') ||
		!(
			/\$|\{[%{]|\[[[^]/.test(blockSource) ||
			(state.definitionSources.hasHidden && blockSource.includes('['))
		)
	) {
		return undefined;
	}

	const text = neutralizeInlineSyntax(sliced.text);
	const insertions = mapInsertions(sliced.text, text);
	const definitions = state.definitionSources.sources.map((definition) =>
		neutralizeInlineSyntax(definition)
	);
	const parsed = [text, definitions.join('\n')].filter(Boolean).join('\n\n');
	const root = pluginMarkdown.parsers[parserName].parse(parsed, {
		originalText: parsed,
	} as ParserOptions) as AST.RootNode;
	const toSource = (offset: number | undefined): number | undefined =>
		sliced.offsets[insertions[offset ?? -1] ?? -1];

	return {
		prettierHTML: findRawHTML(block).map(
			({ position }) =>
				`${position?.start.offset}:${position?.end.offset}`
		),
		readings: findInlineReadings(block),
		referenceHTML: findRawHTML(root)
			.filter(
				({ position }) => (position?.start.offset ?? 0) < text.length
			)
			.map(
				({ position }) =>
					`${toSource(position?.start.offset)}:${toSource(position?.end.offset)}`
			),
	};
}

/**
 * Reports a disagreement on raw HTML in a block caused by inline syntax that
 * only Prettier reads. The report names the first construct with an unpaired
 * backtick or markup, which most likely supplies the syntax that pairs across
 * it, or the block when no construct has either.
 */
function reportCrossingSyntax(
	block: AST.Node,
	readings: ReadonlyArray<AST.Node>,
	state: RenderState
): never {
	const source = state.options.source ?? '';
	const construct = readings.find(({ position }) => {
		const text = source.slice(position?.start.offset, position?.end.offset);

		return text.includes('<') || hasUnpairedBacktick(text);
	});

	return reportUnsupportedMarkdown({
		filepath: state.options.filepath,
		position: (construct ?? block).position?.start,
		reason: construct
			? `Prettier’s Markdown parser reads this as ${READINGS[construct.type!]!.description}, but GitHub Flavored Markdown can read a backtick or markup in it as part of syntax outside it, which changes what is raw HTML nearby`
			: 'Prettier’s Markdown parser and GitHub Flavored Markdown disagree on what is raw HTML here, because GitHub Flavored Markdown reads math, Liquid tags, wiki links, footnotes, or frontmatter as Markdown text',
	});
}

/**
 * Checks whether the reference reading of the current block finds raw HTML
 * within a construct.
 */
function hasHTMLWithin(node: AST.Node, state: RenderState): boolean {
	const start = node.position?.start.offset ?? 0;
	const end = node.position?.end.offset ?? 0;

	return [...(state.blockHTML ?? [])].some((range) => {
		const [htmlStart = 0, htmlEnd = 0] = range.split(':').map(Number);

		return htmlStart < end && start < htmlEnd;
	});
}

/**
 * Checks whether a backtick run in the text has no run of the same length to
 * pair with.
 */
function hasUnpairedBacktick(text: string): boolean {
	const counts = new Map<number, number>();

	for (const { 0: run, index } of text.matchAll(/`+/g)) {
		// A backslash escapes the first backtick of a run
		const length = run.length - (isEscaped(text, index) ? 1 : 0);

		if (length > 0) {
			counts.set(length, (counts.get(length) ?? 0) + 1);
		}
	}

	return [...counts.values()].some((count) => count % 2 === 1);
}

/**
 * Makes Prettier read math, Liquid tags, footnote references, and wiki links in
 * the text as the reference profile does.
 */
function neutralizeInlineSyntax(text: string): string {
	return insertUnescaped(
		escapeUnescaped(text, INLINE_SYNTAX_PATTERN),
		WIKI_LINK_PATTERN,
		(match) => `${match}\u200B`
	);
}

/**
 * Escapes each match of a pattern that an odd number of backslashes doesn’t
 * already escape.
 */
function escapeUnescaped(text: string, pattern: RegExp): string {
	return insertUnescaped(text, pattern, (match) => `\\${match}`);
}

/**
 * Replaces each match of a pattern that an odd number of backslashes doesn’t
 * already escape.
 */
function insertUnescaped(
	text: string,
	pattern: RegExp,
	replace: (match: string) => string
): string {
	return text.replaceAll(pattern, (match, offset: number) =>
		isEscaped(text, offset) ? match : replace(match)
	);
}

/**
 * Checks whether an odd number of backslashes precedes an offset.
 */
function isEscaped(text: string, offset: number): boolean {
	return /(?:^|[^\\])(?:\\\\)*\\$/.test(text.slice(0, offset));
}

/**
 * Finds the raw HTML that Prettier’s Markdown parser reads in a node.
 */
function findRawHTML(node: AST.Node): AST.HTMLNode[] {
	return findHTMLNodes(node)
		.filter(({ html, parent }) => !isMarkdownText(html, parent))
		.map(({ html }) => html);
}

/**
 * Finds the inline constructs within a block that only Prettier recognizes, in
 * source order.
 */
function findInlineReadings(node: AST.Node): AST.Node[] {
	return (node.children ?? []).flatMap((child) =>
		READINGS[child.type ?? '']?.isInline
			? [child]
			: findInlineReadings(child)
	);
}

/**
 * Checks whether frontmatter or math leaves a fence open in the reference
 * reading of the given text, while raw HTML syntax appears later in the
 * document. The text is the construct’s source or formatted text, followed by
 * whatever stays on its last line. The check parses the neutralized text
 * followed by a probe line with the container prefixes of its last line, where
 * list item markers become spaces of the same width. That line continues each
 * block quote and list item open after the last line, so it falls inside fenced
 * code exactly when a fence stays open at the construct’s end. A closing
 * delimiter can’t close a fence, but a construct that Prettier ends without one
 * can end on a line that closes or opens a fence. As a conservative bound,
 * later syntax counts even past a closing fence or where an escape, code span,
 * or code block would make it literal.
 */
export function leavesFenceOpenBeforeHTML(
	node: AST.Node,
	text: string,
	source: string,
	parserName: 'markdown' | 'remark'
): boolean {
	const end = node.position?.end.offset;

	if (!FENCE_READING_TYPES.has(node.type ?? '') || end === undefined) {
		return false;
	}

	const reading = READINGS[node.type!]!.neutralize(text.trimEnd());
	const lastLine = reading.slice(reading.lastIndexOf('\n') + 1);
	const [prefix] = CONTAINER_PREFIX_PATTERN.exec(lastLine)!;
	let probe = `${reading}\n${prefix.replaceAll(/[^\t >]/g, ' ')}x`;
	let offset = reading.length + 1;
	let root = parseProbe(probe, parserName);

	// Prettier reads some Markdown text as an HTML block that can hide a fence
	// from its parse. An escaped opening bracket makes that text Markdown
	for (
		let markdownText = findMarkdownText(root);
		markdownText;
		markdownText = findMarkdownText(root)
	) {
		const index = probe.indexOf('<', markdownText.position!.start.offset);
		probe = `${probe.slice(0, index)}\\${probe.slice(index)}`;
		offset += 1;
		root = parseProbe(probe, parserName);
	}

	return (
		reachesIntoFence(root, probe, offset) &&
		hasRawHTML(source.slice(end).split('\n'))
	);
}

/**
 * Returns the text that follows a construct on its last line, which decides
 * whether that line opens a fence.
 */
export function getRestOfLine(source: string, node: AST.Node): string {
	const end = node.position?.end.offset ?? source.length;
	const lineEnd = source.indexOf('\n', end);

	return source.slice(end, lineEnd === -1 ? source.length : lineEnd);
}

/**
 * Escapes a fence opening at the start of the last line of the given text.
 */
function escapeFenceOpening(text: string): string {
	const lineStart = text.lastIndexOf('\n') + 1;
	const opening = FENCE_OPENING_PATTERN.exec(text.slice(lineStart));

	if (!opening) {
		return text;
	}

	const index = text.indexOf(opening[1] ?? opening[2]!, lineStart);

	return `${text.slice(0, index)}\\${text.slice(index)}`;
}

/**
 * Parses a fence probe with Prettier’s Markdown parser.
 */
function parseProbe(
	probe: string,
	parserName: 'markdown' | 'remark'
): AST.RootNode {
	return pluginMarkdown.parsers[parserName].parse(probe, {
		originalText: probe,
	} as ParserOptions) as AST.RootNode;
}

/**
 * Finds the first HTML block from Prettier’s Markdown parser that the
 * reference renderer reads as Markdown text.
 */
function findMarkdownText(root: AST.Node): AST.HTMLNode | undefined {
	return findHTMLNodes(root).find(
		({ html, parent }) =>
			isBlockContainer(parent) && isMarkdownText(html, parent)
	)?.html;
}

/**
 * Checks whether fenced code that starts before an offset in parsed text
 * extends past it. Indented code starts with its indentation instead of a
 * fence.
 */
function reachesIntoFence(
	node: AST.Node,
	text: string,
	offset: number
): boolean {
	const start = node.position?.start.offset;
	const end = node.position?.end.offset;

	return (
		(node.type === 'code' &&
			start !== undefined &&
			end !== undefined &&
			start < offset &&
			end > offset &&
			FENCE_OPENING_PATTERN.test(text.slice(start).split('\n', 1)[0]!)) ||
		(node.children ?? []).some((child) =>
			reachesIntoFence(child, text, offset)
		)
	);
}

/**
 * Checks whether inline HTML from Prettier’s Markdown parser starts a line
 * where the reference renderer starts an HTML block that can interrupt a
 * paragraph, as with tags that only the reference renderer treats as block
 * tags.
 */
function startsReferenceBlock(html: AST.HTMLNode, text: string): boolean {
	const offset = html.position?.start.offset;

	if (offset === undefined) {
		return false;
	}

	const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
	const lineEnd = text.indexOf('\n', offset);

	return (
		/^[\t ]*$/.test(text.slice(lineStart, offset)) &&
		canInterruptParagraph(
			text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
		)
	);
}

/**
 * Renders the reference reading of a construct that only Prettier’s Markdown
 * parser recognizes.
 */
export function renderReading(
	type: string,
	source: string,
	parserName: 'markdown' | 'remark'
): AST.DocumentContext {
	const text = READINGS[type]!.neutralize(source);
	const root = pluginMarkdown.parsers[parserName].parse(text, {
		originalText: text,
	} as ParserOptions) as AST.RootNode;

	return renderDocumentContext(root, {
		checksInlineSyntax: false,
		parserName,
		source: text,
	});
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
export function toPoint(source: string, offset: number): AST.Point {
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
 * Collects the source of each link reference definition, without container
 * prefixes. The reference profile reads Markdown where Prettier reads
 * frontmatter or a footnote definition. It reads frontmatter after a thematic
 * break, and a footnote definition’s first paragraph as written in the
 * source, including lines that Prettier reads as a separate paragraph, while
 * its indented content is code. Definitions read there are hidden from
 * Prettier, apart from those with footnote labels.
 */
function collectDefinitionSources(
	root: AST.Node,
	source: string | undefined,
	parserName: 'markdown' | 'remark' = 'markdown'
): { hasHidden: boolean; sources: string[] } {
	const sources: string[] = [];
	let hasHidden = false;

	if (source === undefined) {
		return { hasHidden, sources };
	}

	const pending: Array<{ containers: AST.Node[]; node: AST.Node }> = [
		{ containers: [], node: root },
	];

	while (pending.length > 0) {
		const { containers, node } = pending.pop()!;

		if (node.type === 'definition') {
			sources.push(
				sliceMarkdownSource(source, node, containers)?.text ?? ''
			);
		}

		if (node.type === 'footnoteDefinition' || node.type === 'frontMatter') {
			// A leading line break keeps Prettier from reading frontmatter again,
			// and escaped carets keep it from reading footnotes
			const text = neutralizeInlineSyntax(
				node.type === 'frontMatter'
					? `\n${sliceMarkdownSource(source, node, containers)?.text ?? ''}`
					: readParagraphLines(
							source,
							node.position?.start.offset ?? 0
						).join('\n')
			);
			const read = collectDefinitionSources(
				pluginMarkdown.parsers[parserName].parse(text, {
					originalText: text,
				} as ParserOptions) as AST.RootNode,
				text,
				parserName
			).sources;

			hasHidden ||= read.some(
				(definition) => !/^ {0,3}\[\\\^/.test(definition)
			);
			sources.push(...read);
			continue;
		}

		const innerContainers =
			node.type === 'blockquote' || node.type === 'listItem'
				? [...containers, node]
				: containers;

		for (const child of node.children ?? []) {
			pending.push({ containers: innerContainers, node: child });
		}
	}

	return { hasHidden, sources };
}

/**
 * Reads the lines of the paragraph that the reference profile reads from an
 * offset, up to a line that is blank apart from container prefixes. Later
 * lines lose their container prefixes and indentation, including lazy lines
 * without prefixes.
 */
function readParagraphLines(source: string, start: number): string[] {
	const [first = '', ...rest] = source.slice(start).split('\n');
	const lines = [first];

	for (const line of rest) {
		const content = line.replace(/^[\t >]*/, '');

		if (content === '') {
			break;
		}

		lines.push(content);
	}

	return lines;
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
