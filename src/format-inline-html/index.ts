import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import formatHTML from '../format-html/index.ts';
import isBlockTag from '../is-block-tag/index.ts';
import {
	canInterruptParagraph,
	startsHTMLBlock,
} from '../is-html-block-sequence/index.ts';
import isVoidTag from '../is-void-tag/index.ts';
import { reportUnsafeLayout } from '../report-error/index.ts';

const CLOSING_TAG_PATTERN = /^<\/([a-z][a-z0-9-]*)\s*>$/i;
const OPENING_TAG_PATTERN = /^<([a-z][a-z0-9-]*)(?=[\t\n\f\r />])/i;

/**
 * Formats one inline HTML tag in its paragraph, heading, or table cell without
 * changing its relationship with the surrounding Markdown.
 */
export default async function formatInlineHTML(
	fragment: AST.Fragment,
	isProtected: boolean,
	options: ParserOptions,
	formattedNodes: WeakSet<AST.Node>
): Promise<void> {
	const { node } = fragment;
	const html = fragment.isInTableCell
		? node.value.replaceAll(String.raw`\|`, '|')
		: node.value;

	if (!fragment.isSingleLine) {
		keepOffLineStart(fragment, options);
		keepContentAfterLeadingTag(fragment, options);
	}

	// Protected content keeps its source text, though its position in the
	// Markdown line still matters
	if (isProtected) {
		return;
	}

	const formatted = await formatTag(
		html,
		getInlineOptions(options, fragment.isSingleLine),
		node.position?.start
	);

	if (formatted === undefined) {
		return;
	}

	// Escaped pipes keep the tag inside its table cell
	node.value = fragment.isInTableCell
		? formatted.replaceAll('|', String.raw`\|`)
		: formatted;
	formattedNodes.add(node);
}

/**
 * Formats an opening or closing tag. Returns `undefined` for other HTML tokens,
 * which keep their source text.
 */
async function formatTag(
	html: string,
	options: ParserOptions,
	position: AST.Point | undefined
): Promise<string | undefined> {
	const closingTagName = CLOSING_TAG_PATTERN.exec(html)?.[1];

	if (closingTagName) {
		return formatClosingTag(closingTagName, options, position);
	}

	const tagName = OPENING_TAG_PATTERN.exec(html)?.[1];

	if (!tagName) {
		return undefined;
	}

	if (isVoidTag(tagName) || html.endsWith('/>')) {
		return formatHTML(html, options, position);
	}

	// An explicit closing tag lets Prettier format a complete element. The
	// closing tag check ignores case because Prettier may lowercase tag names.
	// Only the opening tag is kept
	const closingTag = `</${tagName}>`;
	const formatted = await formatHTML(
		`${html}${closingTag}`,
		options,
		position
	);

	return formatted.toLowerCase().endsWith(closingTag.toLowerCase())
		? formatted.slice(0, -closingTag.length).trimEnd()
		: undefined;
}

/**
 * Formats a closing tag with the name that Prettier prints for its element.
 * Prettier lowercases known HTML element names but keeps the case of others,
 * such as custom elements and SVG names.
 */
async function formatClosingTag(
	tagName: string,
	options: ParserOptions,
	position: AST.Point | undefined
): Promise<string> {
	const formatted = await formatHTML(
		`<${tagName}></${tagName}>`,
		options,
		position
	);

	return formatted.slice(formatted.lastIndexOf('</')).trimEnd();
}

/**
 * Adjusts formatting options to keep a tag valid in its Markdown line.
 */
function getInlineOptions(
	options: ParserOptions,
	isSingleLine: boolean
): ParserOptions {
	const inlineOptions = {
		...options,
		// Markdown reparses a line-leading `>` as a block quote marker, so the
		// bracket must stay on the final attribute line
		bracketSameLine: true,
		htmlFragmentBracketSameLine: true,
	};

	if (!isSingleLine) {
		return inlineOptions;
	}

	// A line break would end an ATX heading or a GFM table row
	return {
		...inlineOptions,
		htmlFragmentPrintWidth: Number.POSITIVE_INFINITY,
		htmlFragmentSingleAttributePerLine: false,
		printWidth: Number.POSITIVE_INFINITY,
		singleAttributePerLine: false,
	};
}

/**
 * Keeps inline HTML from wrapping to a line start where Prettier or the
 * reference renderer would start an HTML block.
 */
function keepOffLineStart(
	fragment: AST.Fragment,
	options: ParserOptions
): void {
	const { value } = fragment.node;
	const tagName =
		OPENING_TAG_PATTERN.exec(value)?.[1] ??
		CLOSING_TAG_PATTERN.exec(value)?.[1];

	if (!(canInterruptParagraph(value) || (tagName && isBlockTag(tagName)))) {
		return;
	}

	const siblings = fragment.parent.children ?? [];
	const previousNode = siblings[siblings.indexOf(fragment.node) - 1];
	const previousEnd = previousNode?.position?.end.offset;
	const separatorNode = previousNode && getLastDescendant(previousNode);

	const start = fragment.node.position?.start.offset;
	const separator = separatorNode?.value ?? '';
	const separatorEnd = separatorNode?.position?.end.offset ?? previousEnd;

	// Only container prefixes and indentation can separate the separator from
	// the HTML. Prettier’s words and spaces have no positions of their own, so
	// the end of their sentence stands in
	const isAdjacent =
		separatorEnd !== undefined &&
		start !== undefined &&
		/^[\t\n >]*$/.test(
			options.originalText?.slice(separatorEnd, start) ?? ''
		);

	// A hard line break has to stay, and Prettier prints the next line without
	// the indentation that keeps the HTML inline
	if (separatorNode?.type === 'break' && isAdjacent) {
		reportUnsafeLayout({
			filepath: options.filepath,
			position: fragment.node.position?.start,
			reason: 'Formatting would put this HTML at the start of a line after the hard line break, where Prettier or GitHub Flavored Markdown would read it as an HTML block',
		});
	}

	// A soft line break can leave the HTML at a line start, and a space can
	// wrap there when Prettier wraps prose
	if (
		separatorNode?.type === 'whitespace' &&
		isAdjacent &&
		(separator.includes('\n') ||
			(options.proseWrap === 'always' && /^[\t ]+$/.test(separator)))
	) {
		separatorNode.value = ' ';
		// Prettier’s Markdown printer may render a `whitespace` node as a line
		// break. Treating this separator as text preserves the tag’s inline
		// context
		separatorNode.type = 'text';
	}
}

/**
 * Prevents a line break immediately after a paragraph’s leading tag when
 * Prettier wraps prose. Alone on the paragraph’s first line, the tag would
 * start an HTML block.
 */
function keepContentAfterLeadingTag(
	fragment: AST.Fragment,
	options: ParserOptions
): void {
	const siblings = fragment.parent.children ?? [];
	const separatorNode = siblings[1] && getFirstDescendant(siblings[1]);

	if (
		options.proseWrap === 'always' &&
		fragment.parent.type === 'paragraph' &&
		siblings[0] === fragment.node &&
		startsHTMLBlock(fragment.node.value) &&
		separatorNode?.type === 'whitespace' &&
		/^[\t ]+$/.test(separatorNode.value ?? '')
	) {
		separatorNode.value = ' ';
		// A `text` node keeps the space from becoming a line break
		separatorNode.type = 'text';
	}
}

/**
 * Returns a node’s deepest first descendant.
 */
function getFirstDescendant(node: AST.Node): AST.Node {
	let descendant = node;

	while (descendant.children?.length) {
		descendant = descendant.children[0]!;
	}

	return descendant;
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
