import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import collectHTMLGroup from '../collect-html-group/index.ts';
import extractLeadingClosingTags from '../extract-leading-closing-tags/index.ts';
import formatHTML from '../format-html/index.ts';
import isBlockTag from '../is-block-tag/index.ts';
import isRawTextTag from '../is-raw-text-tag/index.ts';
import stripTrailingClosingTags from '../strip-trailing-closing-tags/index.ts';
import TagScanner from '../tag-scanner/index.ts';

type RawTextState = {
	tagName: string | undefined;
};

const HTML_ATTRIBUTE_PATTERN = String.raw`[\t ]+[a-z_:][\w.:-]*(?:[\t ]*=[\t ]*(?:[^\t "'<=>\x60]+|'[^']*'|"[^"]*"))?`;

const HTML_TAG_LINE_PATTERN = new RegExp(
	String.raw`^(?:<[a-z][a-z0-9-]*(?:${HTML_ATTRIBUTE_PATTERN})*[\t ]*\/?>|<\/[a-z][a-z0-9-]*[\t ]*>)[\t ]*$`,
	'i'
);

export const formattedHTMLNodes = new WeakSet<AST.Node>();

/**
 * Formats raw HTML throughout a Markdown syntax tree.
 */
export default async function preprocessMarkdown(
	root: AST.Node,
	options: ParserOptions
): Promise<AST.Node> {
	if (!isRootNode(root)) {
		return root;
	}

	await formatHTMLInParent(root, options, 'block', { tagName: undefined });

	return root;
}

/**
 * Formats raw HTML among a parent’s children in the mode the parent allows.
 */
async function formatHTMLInParent(
	parent: AST.ParentNode,
	options: ParserOptions,
	inheritedMode: AST.HTMLFormatMode,
	rawText: RawTextState
): Promise<void> {
	const mode = getChildFormatMode(parent, inheritedMode);

	parent.children = await formatHTMLChildren(
		parent.children,
		options,
		mode,
		rawText
	);
}

/**
 * Formats HTML nodes among siblings and recurses into siblings with children.
 */
async function formatHTMLChildren(
	children: AST.Node[],
	options: ParserOptions,
	mode: AST.HTMLFormatMode,
	rawText: RawTextState
): Promise<AST.Node[]> {
	const nodes: AST.Node[] = [];

	const { originalText } = options;
	const formattingOptions = getFormattingOptions(options, mode);

	let index = 0;

	while (index < children.length) {
		const child = children[index]!;

		if (!isHTMLNode(child)) {
			if (isParentNode(child)) {
				await formatHTMLInParent(child, options, mode, rawText);
			}

			nodes.push(child);
			index += 1;
			continue;
		}

		if (mode === 'inline') {
			preventMarkdownBlockTagLineStart(nodes, child, options);
		}

		// Raw text can cross Markdown parents. Do not format HTML-looking
		// tokens in its contents as independent HTML fragments
		if (rawText.tagName) {
			const group =
				mode === 'block'
					? collectHTMLGroup(
							children,
							index,
							originalText,
							rawText.tagName
						)
					: { value: child.value, children: [child] };

			rawText.tagName = getUnclosedRawTextTag(
				`<${rawText.tagName}>${group.value}`
			);

			nodes.push(...group.children);
			index += group.children.length;
			continue;
		}

		const group =
			mode === 'block'
				? collectHTMLGroup(children, index, originalText)
				: { value: child.value.trim(), children: [child] };

		rawText.tagName = getUnclosedRawTextTag(group.value);

		const previousNode = children[index - 1];
		const isIgnored =
			(isHTMLNode(previousNode) &&
				/^<!--\s*prettier-ignore\s*-->$/.test(previousNode.value)) ||
			/^<!--\s*prettier-ignore\s*-->/.test(group.value);

		// CommonMark starts an HTML block with a non-block tag only when
		// the complete tag fills its first line. Retry without wrapping
		// before keeping the source unchanged
		const tagLineFallbackOptions =
			mode === 'block' && startsWithNonBlockTag(group.value)
				? getFormattingOptions(options, 'compact')
				: undefined;

		// Keep ignored nodes and incomplete block raw text intact. Coalescing
		// ignored nodes would discard source spans used by Markdown’s printer
		const groupNodes =
			isIgnored || (mode === 'block' && rawText.tagName)
				? group.children
				: await formatHTMLGroup(
						group,
						formattingOptions,
						rawText.tagName,
						tagLineFallbackOptions
					);

		nodes.push(...groupNodes);
		index += group.children.length;
	}

	return nodes;
}

/**
 * Selects how HTML may wrap inside a parent without breaking its
 * Markdown context.
 */
function getChildFormatMode(
	parent: AST.ParentNode,
	inheritedMode: AST.HTMLFormatMode
): AST.HTMLFormatMode {
	if (inheritedMode !== 'block') {
		return inheritedMode;
	}

	if (parent.type === 'paragraph') {
		return 'inline';
	}

	if (parent.type === 'heading' || parent.type === 'tableCell') {
		return 'compact';
	}

	return 'block';
}

/**
 * Adjusts formatting options to keep HTML valid in its Markdown context.
 */
function getFormattingOptions(
	options: ParserOptions,
	mode: AST.HTMLFormatMode
): ParserOptions {
	if (mode === 'block') {
		return options;
	}

	const inlineOptions = {
		...options,
		// Paragraph HTML may wrap, but Markdown reparses a line-leading `>` as
		// a block quote marker, so `>` must stay on the final attribute line
		bracketSameLine: true,
		htmlFragmentBracketSameLine: true,
	};

	if (mode === 'inline') {
		return inlineOptions;
	}

	// Wrapping HTML can terminate an ATX heading or GFM table row, so compact
	// mode disables attribute-per-line formatting and print-width wrapping
	return {
		...inlineOptions,
		htmlFragmentPrintWidth: Number.POSITIVE_INFINITY,
		htmlFragmentSingleAttributePerLine: false,
		printWidth: Number.POSITIVE_INFINITY,
		singleAttributePerLine: false,
	};
}

/**
 * Formats adjacent HTML nodes as a single fragment, keeping the source nodes
 * when the result can’t replace them safely.
 */
async function formatHTMLGroup(
	group: AST.HTMLGroup,
	options: ParserOptions,
	rawTextTag?: string,
	tagLineFallbackOptions?: ParserOptions
): Promise<AST.Node[]> {
	const node = group.children[0]!;

	const { closingTags, html } = extractLeadingClosingTags(group.value);

	if (!html) {
		node.value = closingTags;
		return [node];
	}

	// Prettier’s HTML parser requires raw text elements to have a closing tag,
	// while the Markdown syntax tree represents inline opening and closing
	// tags as separate nodes
	const parseableHTML = rawTextTag ? `${html}</${rawTextTag}>` : html;
	const unclosedTags = TagScanner.scan(html);
	const formattingAttempts = tagLineFallbackOptions
		? [options, tagLineFallbackOptions]
		: [options];

	for (const formattingOptions of formattingAttempts) {
		const formattedHTML = stripTrailingClosingTags(
			await formatHTML(parseableHTML, formattingOptions),
			unclosedTags
		);

		if (!formattedHTML) {
			return group.children;
		}

		const value = closingTags + formattedHTML;

		if (tagLineFallbackOptions && !startsWithTagLine(value)) {
			continue;
		}

		node.value = value;
		formattedHTMLNodes.add(node);

		return [node];
	}

	return group.children;
}

/**
 * Finds a raw text element left open at the end of the HTML.
 */
function getUnclosedRawTextTag(html: string): string | undefined {
	const tagName = TagScanner.scan(html).at(-1);

	return tagName && isRawTextTag(tagName) ? tagName : undefined;
}

/**
 * Keeps an inline block tag from wrapping to the start of a line, where
 * Markdown would start an HTML block.
 */
function preventMarkdownBlockTagLineStart(
	formattedNodes: AST.Node[],
	htmlNode: AST.HTMLNode,
	options: ParserOptions
): void {
	if (options.proseWrap !== 'always' || !isMarkdownBlockTag(htmlNode.value)) {
		return;
	}

	const previousNode = formattedNodes.at(-1);

	if (
		previousNode?.position?.end.offset === undefined ||
		htmlNode.position?.start.offset === undefined ||
		previousNode.position.end.offset !== htmlNode.position.start.offset
	) {
		return;
	}

	const separatorNode = getLastDescendant(previousNode);

	if (
		separatorNode.type === 'whitespace' &&
		/^[\t ]+$/.test(separatorNode.value ?? '')
	) {
		// Prettier’s Markdown printer may render a `whitespace` node as
		// a line break. Treating this separator as text preserves the tag’s
		// inline context
		separatorNode.type = 'text';
	}
}

/**
 * Checks whether HTML begins with a tag that can interrupt a
 * Markdown paragraph.
 */
function isMarkdownBlockTag(html: string): boolean {
	const tagName = getLeadingTagName(html);
	return tagName ? isBlockTag(tagName) : false;
}

/**
 * Checks whether HTML begins with a tag that starts an HTML block only when the
 * complete tag fills its first line.
 */
function startsWithNonBlockTag(html: string): boolean {
	const tagName = getLeadingTagName(html);
	return tagName ? !isBlockTag(tagName) : false;
}

/**
 * Checks whether the first line contains only a complete tag.
 */
function startsWithTagLine(html: string): boolean {
	return HTML_TAG_LINE_PATTERN.test(html.split('\n', 1)[0]!);
}

/**
 * Returns the name of the tag at the start of the HTML.
 */
function getLeadingTagName(html: string): string | undefined {
	return /^<\/?([a-z][a-z0-9-]*)(?=[\t\n\f\r />])/i.exec(html)?.[1];
}

/**
 * Returns a node’s deepest last descendant.
 */
function getLastDescendant(node: AST.Node): AST.Node {
	let descendant = node;

	while (descendant.children?.length) {
		descendant = descendant.children.at(-1)!;
	}

	return descendant;
}

/**
 * Recognizes HTML nodes with source text that can be formatted.
 */
function isHTMLNode(node: AST.Node | undefined): node is AST.HTMLNode {
	return node?.type === 'html' && typeof node.value === 'string';
}

/**
 * Recognizes nodes with children.
 */
function isParentNode(node: AST.Node | undefined): node is AST.ParentNode {
	return Array.isArray(node?.children);
}

/**
 * Recognizes Markdown root nodes.
 */
function isRootNode(node: AST.Node | undefined): node is AST.RootNode {
	return node?.type === 'root' && Array.isArray(node.children);
}
