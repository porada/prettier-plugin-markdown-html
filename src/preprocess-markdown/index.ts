import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import extractLeadingClosingTags from '../extract-leading-closing-tags/index.ts';
import findUnclosedTags from '../find-unclosed-tags/index.ts';
import formatHTML from '../format-html/index.ts';
import isBlockTag from '../is-block-tag/index.ts';
import isRawTextTag from '../is-raw-text-tag/index.ts';
import stripTrailingClosingTags from '../strip-trailing-closing-tags/index.ts';

export default async function preprocessMarkdown(
	root: AST.Node,
	options: ParserOptions
): Promise<AST.Node> {
	if (!isRootNode(root)) {
		return root;
	}

	await formatHTMLInParent(root, options, 'block');

	return root;
}

async function formatHTMLInParent(
	parent: AST.ParentNode,
	options: ParserOptions,
	inheritedMode: AST.HTMLFormatMode
): Promise<void> {
	const mode = getChildFormatMode(parent, inheritedMode);

	parent.children = await formatHTMLChildren(parent.children, options, mode);

	for (const child of parent.children) {
		if (isParentNode(child)) {
			await formatHTMLInParent(child, options, mode);
		}
	}
}

async function formatHTMLChildren(
	children: AST.Node[],
	options: ParserOptions,
	mode: AST.HTMLFormatMode
): Promise<AST.Node[]> {
	const nodes: AST.Node[] = [];

	const { originalText } = options;
	const formattingOptions = getFormattingOptions(options, mode);

	let index = 0;

	while (index < children.length) {
		const child = children[index]!;

		if (!isHTMLNode(child)) {
			nodes.push(child);
			index += 1;
			continue;
		}

		if (mode === 'inline') {
			preventMarkdownBlockTagLineStart(nodes, child, options);
		}

		const group =
			mode === 'block'
				? collectHTMLGroup(children, index, originalText)
				: { value: child.value.trim(), children: [child] };

		const rawTextTag =
			mode === 'block'
				? undefined
				: findCompletableRawTextTag(children, index, child);

		const groupNodes = await formatHTMLGroup(
			group,
			formattingOptions,
			rawTextTag
		);

		nodes.push(...groupNodes);
		index += group.children.length;
	}

	return nodes;
}

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

function collectHTMLGroup(
	children: AST.Node[],
	childIndex: number,
	originalText: string
): AST.HTMLGroup {
	const nodes: AST.HTMLNode[] = [];

	let html = '';

	for (let index = childIndex; index < children.length; index += 1) {
		const child = children[index]!;

		if (!isHTMLNode(child)) {
			break;
		}

		if (
			nodes.length > 0 &&
			hasBlankLineBetweenNodes(nodes.at(-1)!, child, originalText) &&
			findUnclosedTags(html).length === 0
		) {
			break;
		}

		html = html ? `${html}\n${child.value}` : child.value;
		nodes.push(child);
	}

	return { value: html.trim(), children: nodes };
}

async function formatHTMLGroup(
	group: AST.HTMLGroup,
	options: ParserOptions,
	rawTextTag?: string
): Promise<AST.Node[]> {
	const node = group.children[0]!;

	const { closingTags, html } = extractLeadingClosingTags(group.value);

	if (!html) {
		node.value = closingTags;
		return [node];
	}

	// Prettier’s HTML parser requires raw-text elements to have an end tag,
	// while the Markdown syntax tree represents inline opening and closing
	// tags as separate nodes
	const parseableHTML = rawTextTag ? `${html}</${rawTextTag}>` : html;
	const unclosedTags = findUnclosedTags(html);
	const formattedHTML = stripTrailingClosingTags(
		await formatHTML(parseableHTML, options),
		unclosedTags
	);

	if (!formattedHTML) {
		return group.children;
	}

	node.value = closingTags
		? `${closingTags}\n\n${formattedHTML}`
		: formattedHTML;

	return [node];
}

function findCompletableRawTextTag(
	children: AST.Node[],
	childIndex: number,
	child: AST.HTMLNode
): string | undefined {
	const tagName = findUnclosedTags(child.value).at(-1);

	if (!tagName || !isRawTextTag(tagName)) {
		return undefined;
	}

	const closingTagPattern = new RegExp(`^\\s*</${tagName}\\s*>`, 'i');

	for (let index = childIndex + 1; index < children.length; index += 1) {
		const sibling = children[index];

		if (isHTMLNode(sibling) && closingTagPattern.test(sibling.value)) {
			return tagName;
		}
	}

	return undefined;
}

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

function isMarkdownBlockTag(html: string): boolean {
	const tagName = /^<\/?([a-z][a-z0-9-]*)(?=[\t\n\f\r />])/i.exec(html)?.[1];
	return tagName ? isBlockTag(tagName) : false;
}

function getLastDescendant(node: AST.Node): AST.Node {
	let descendant = node;

	while (descendant.children?.length) {
		descendant = descendant.children.at(-1)!;
	}

	return descendant;
}

function hasBlankLineBetweenNodes(
	previousNode: AST.Node,
	nextNode: AST.Node,
	originalText: string
): boolean {
	const { end } = previousNode.position ?? {};
	const { start } = nextNode.position ?? {};

	if (start && end && start.line > end.line + 1) {
		return true;
	}

	if (
		start?.offset === undefined ||
		end?.offset === undefined ||
		end.offset >= start.offset
	) {
		return false;
	}

	return /\r?\n[ \t]*\r?\n/.test(
		originalText.slice(end.offset, start.offset)
	);
}

function isHTMLNode(node: AST.Node | undefined): node is AST.HTMLNode {
	return node?.type === 'html' && typeof node.value === 'string';
}

function isParentNode(node: AST.Node | undefined): node is AST.ParentNode {
	return Array.isArray(node?.children);
}

function isRootNode(node: AST.Node | undefined): node is AST.RootNode {
	return node?.type === 'root' && Array.isArray(node.children);
}
