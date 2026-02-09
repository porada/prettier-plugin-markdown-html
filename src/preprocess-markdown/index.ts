import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import extractLeadingClosingTags from '../extract-leading-closing-tags/index.ts';
import findUnclosedTags from '../find-unclosed-tags/index.ts';
import formatHTML from '../format-html/index.ts';
import stripTrailingClosingTags from '../strip-trailing-closing-tags/index.ts';

export default async function preprocessMarkdown(
	root: AST.Node,
	options: ParserOptions
): Promise<AST.Node> {
	if (!isRootNode(root)) {
		return root;
	}

	const nodes: AST.Node[] = [];

	const { children } = root;
	const { originalText } = options;

	let index = 0;

	while (index < children.length) {
		const child = children[index]!;

		if (!isHTMLNode(child)) {
			nodes.push(child);
			index += 1;
			continue;
		}

		const group = collectHTMLGroup(children, index, originalText);
		const groupNodes = await formatHTMLGroup(group, options);

		nodes.push(...groupNodes);
		index += group.children.length;
	}

	root.children = nodes;
	return root;
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
	options: ParserOptions
): Promise<AST.Node[]> {
	const node = group.children[0]!;

	const { closingTags, html } = extractLeadingClosingTags(group.value);

	if (!html) {
		node.value = closingTags;
		return [node];
	}

	const formattedHTML = stripTrailingClosingTags(
		await formatHTML(html, options),
		findUnclosedTags(html)
	);

	if (!formattedHTML) {
		return group.children;
	}

	node.value = closingTags
		? `${closingTags}\n\n${formattedHTML}`
		: formattedHTML;

	return [node];
}

function hasBlankLineBetweenNodes(
	previousNode: AST.Node,
	nextNode: AST.Node,
	originalText: string
): boolean {
	const { end } = previousNode.position ?? {};
	const { start } = nextNode.position ?? {};

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

function isRootNode(node: AST.Node | undefined): node is AST.RootNode {
	return node?.type === 'root' && Array.isArray(node.children);
}
