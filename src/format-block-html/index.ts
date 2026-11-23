import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import * as pluginHTML from 'prettier/plugins/html';
import { IGNORE_COMMENT_PATTERN } from '../constants/index.ts';
import findTagEnd from '../find-tag-end/index.ts';
import formatHTML, { checkFormattedHTML } from '../format-html/index.ts';
import isHTMLBlockSequence, {
	endsInContinuingBlock,
	findBlockStartLines,
	findNonBlockLine,
	needsCompleteTagLine,
	readTakenInHTML,
} from '../is-html-block-sequence/index.ts';
import isRawTextTag from '../is-raw-text-tag/index.ts';
import { reportUnsafeLayout } from '../report-error/index.ts';
import { readHTMLBlockText } from '../slice-markdown-source/index.ts';

// A line containing only closing tags, as Prettier prints for elements whose
// closing tags were omitted
const CLOSING_TAGS_LINE_PATTERN =
	/^[\t ]*(?:<\/[a-z][^\s/<>]*[\t ]*>[\t ]*)+$/i;

const TAKEN_IN_CONSEQUENCES: Record<TakenInContent, string> = {
	'html': 'end partway through an HTML block that follows',
	'ignore-comment':
		'include the Prettier ignore comment that follows, preventing Prettier’s Markdown printer from honoring it',
	'markdown': 'include the Markdown that follows',
};

type HTMLElement = {
	children?: HTMLElement[];
	kind: string;
	name?: string;
	sourceSpan: { start: { offset: number } };
};

type FragmentPiece = {
	end: number;
	kind: 'fragment';
	node: AST.HTMLNode;
	start: number;
	text: string;
};

type MarkerPiece = {
	end: number;
	id: number;
	// Whether the marker separates adjacent fragments without Markdown
	isSeparator: boolean;
	kind: 'marker';
	// The Markdown block that the marker stands for
	node?: AST.Node;
	start: number;
	text: string;
};

type SkeletonPiece = FragmentPiece | MarkerPiece;

type MarkupToken = {
	end: number;
	kind: 'comment' | 'markup' | 'preserved' | 'tag';
	start: number;
};

type Skeleton = {
	pieces: SkeletonPiece[];
	text: string;
};

// The start of a raw `p` element’s opening tag
const RAW_P_PATTERN = /<p(?=[\t\n\f\r />]|$)/i;

// Content after a fragment that a block left open would change
type TakenInContent = 'html' | 'ignore-comment' | 'markdown';

type ScopeLayout = {
	values: Map<AST.HTMLNode, string>;
};

/**
 * Formats the HTML blocks of one Markdown container together, so each
 * fragment’s layout reflects the raw HTML elements it shares with the others.
 * Returns the container’s children.
 */
export default async function formatBlockHTML(
	scope: AST.BlockScope,
	options: ParserOptions
): Promise<AST.Node[]> {
	const marker = createMarker(scope);
	const formattingOptions = getScopeOptions(scope, options);
	const fragments = scope.children.filter((child) =>
		isFragment(scope, child)
	);

	const layout = await layOutScope(scope, marker, formattingOptions);
	const children = [...scope.children];
	const values = new Map<AST.HTMLNode, string>();

	for (const node of fragments) {
		if (scope.ignoredNodes.has(node)) {
			continue;
		}

		values.set(
			node,
			await finishFragment(
				node,
				layout.values.get(node)!,
				formattingOptions
			)
		);
	}

	const finalValues = new Map<AST.HTMLNode, string>();

	for (const [node, aligned] of values) {
		const value = finishLayout(scope, node, aligned, values);

		checkIgnoreComment(scope, node, value);
		checkHTMLBlocks(
			node,
			value,
			scope.endsOpenBlocks && scope.children.at(-1) === node
		);
		finalValues.set(node, value);
	}

	for (const [node, value] of finalValues) {
		node.value = value;
		scope.formattedNodes.add(node);
	}

	if (needsNextPassCheck(scope, children, finalValues)) {
		await checkNextPass(scope, children, marker, formattingOptions);
	}

	return children;
}

/**
 * Formats a scope’s skeleton. Fragments whose first tag would share a line with
 * content use Prettier’s expanded layout.
 */
async function layOutScope(
	scope: AST.BlockScope,
	marker: Marker,
	options: ParserOptions
): Promise<ScopeLayout> {
	const brokenFragments = new Set<AST.HTMLNode>();
	const layout = await formatSkeleton(
		scope,
		marker,
		brokenFragments,
		options
	);

	for (const node of scope.children) {
		if (
			isFragment(scope, node) &&
			needsExpandedLayout(scope, node, layout.values.get(node)!)
		) {
			brokenFragments.add(node);
		}
	}

	return brokenFragments.size > 0
		? formatSkeleton(scope, marker, brokenFragments, options)
		: layout;
}

/**
 * Ends the HTML block that a fragment’s value leaves open where it would take
 * in the content after it.
 */
function finishLayout(
	scope: AST.BlockScope,
	node: AST.HTMLNode,
	aligned: string,
	values: ReadonlyMap<AST.HTMLNode, string>
): string {
	const takenIn = findTakenInContent(scope, node, values);

	return takenIn ? endBlockOnLastLine(node, aligned, takenIn) : aligned;
}

/**
 * Formats a scope’s HTML and returns the formatted text for each fragment.
 */
async function formatSkeleton(
	scope: AST.BlockScope,
	marker: Marker,
	brokenFragments: ReadonlySet<AST.HTMLNode>,
	options: ParserOptions
): Promise<ScopeLayout> {
	const paragraphContent = await findParagraphContent(
		scope,
		marker,
		brokenFragments
	);
	const isInParagraph = (node: AST.Node): boolean =>
		paragraphContent.has(node);
	const skeleton = buildSkeleton(
		scope,
		marker,
		brokenFragments,
		isInParagraph
	);
	const position = scope.children.find(isHTMLNode)?.position?.start;
	const printed = await formatHTML(
		renderSkeleton(scope, skeleton),
		options,
		position
	);

	await checkFormattedHTML(printed, options, position);

	const formatted = marker.removeBreaks(printed);

	const markers = marker.find(formatted);
	const values = new Map<AST.HTMLNode, string>();

	let offset = 0;
	let markerIndex = 0;

	for (const [index, piece] of skeleton.pieces.entries()) {
		if (piece.kind === 'fragment') {
			const next = skeleton.pieces[index + 1];
			const end =
				next?.kind === 'fragment'
					? findCommentEnd(formatted, offset, piece.node.value)
					: markers[markerIndex]?.start;

			if (end === undefined) {
				reportMisplacedMarkdown(scope);
			}

			values.set(
				piece.node,
				removeAddedBlankLines(
					formatted.slice(offset, end).trim(),
					piece.node
				)
			);
			offset = end;
			continue;
		}

		const match = markers[markerIndex];

		if (match?.id !== piece.id) {
			reportMisplacedMarkdown(scope);
		}

		offset = match.end;
		markerIndex += 1;
	}

	return { values };
}

/**
 * Finds where a fragment that consists of one complete comment ends in
 * Prettier’s output, which keeps comments unchanged.
 */
function findCommentEnd(
	formatted: string,
	offset: number,
	comment: string
): number | undefined {
	const start = formatted.indexOf(comment.trim(), offset);

	return start === -1 || /\S/.test(formatted.slice(offset, start))
		? undefined
		: start + comment.trim().length;
}

/**
 * Joins a skeleton’s pieces into the HTML that Prettier formats, closing the raw
 * ancestors at the end.
 */
function renderSkeleton(scope: AST.BlockScope, skeleton: Skeleton): string {
	const lines = skeleton.pieces.map((piece) => piece.text);

	if (scope.ancestors.length > 0) {
		lines.unshift(
			scope.ancestors.map((name) => `<${getAncestorName(name)}>`).join('')
		);
	}

	lines.push(
		scope.ancestors
			.toReversed()
			.map((name) => `</${getAncestorName(name)}>`)
			.join('')
	);

	return lines.join('\n');
}

/**
 * Returns the tag name to use during layout. Substitutes `div` for an open `p`
 * so the container’s HTML blocks and Markdown cannot close it early.
 */
function getAncestorName(name: string): string {
	return name === 'p' ? 'div' : name;
}

/**
 * Finds Markdown blocks that need a comment marker inside a raw `p` element.
 */
async function findParagraphContent(
	scope: AST.BlockScope,
	marker: Marker,
	brokenFragments: ReadonlySet<AST.HTMLNode>
): Promise<Set<AST.Node>> {
	const content = new Set<AST.Node>();

	if (
		!scope.children.some(
			(child) =>
				isFragment(scope, child) && RAW_P_PATTERN.test(child.value)
		)
	) {
		return content;
	}

	const skeleton = buildSkeleton(scope, marker, brokenFragments, () => true);
	// Each fragment belongs to an accepted region, so Prettier can parse them
	const root = (await pluginHTML.parsers.html.parse(skeleton.text, {
		parser: 'html',
	} as ParserOptions)) as HTMLElement;
	const blocks = new Map(
		skeleton.pieces.flatMap((piece) =>
			piece.kind === 'marker' && piece.node
				? [[piece.start, piece.node]]
				: []
		)
	);

	const visit = (node: HTMLElement, isInParagraph: boolean): void => {
		const block = blocks.get(node.sourceSpan.start.offset);

		if (isInParagraph && node.kind === 'comment' && block) {
			content.add(block);
		}

		for (const child of node.children ?? []) {
			visit(
				child,
				isInParagraph || (node.kind === 'element' && node.name === 'p')
			);
		}
	};

	visit(root, false);

	return content;
}

/**
 * Builds the pieces of the HTML that Prettier formats for a scope: its HTML
 * fragments and markers in place of the Markdown between them. Offsets refer to
 * the skeleton with the raw ancestors opened before the pieces. Markdown blocks
 * in a raw `p` element take comment markers.
 */
function buildSkeleton(
	scope: AST.BlockScope,
	marker: Marker,
	brokenFragments: ReadonlySet<AST.HTMLNode>,
	isInParagraph: (node: AST.Node) => boolean
): Skeleton {
	const pieces: SkeletonPiece[] = [];
	let text = scope.ancestors
		.map((name) => `<${getAncestorName(name)}>`)
		.join('');

	/**
	 * Adds a piece on a line of its own.
	 */
	function addLine(line: string): number {
		text += text ? '\n' : '';
		const start = text.length;
		text += line;
		return start;
	}

	/**
	 * Adds a marker for Markdown content or a fragment boundary.
	 */
	function addMarker(
		form: MarkerForm,
		isSeparator: boolean,
		node?: AST.Node
	): void {
		const id = pieces.length;
		const markerText = marker.create(id, form);
		const start = addLine(markerText);
		pieces.push({
			end: text.length,
			id,
			isSeparator,
			kind: 'marker',
			node,
			start,
			text: markerText,
		});
	}

	if (scope.ancestors.length > 0) {
		addMarker('comment', false);
	}

	let previous: AST.Node | undefined;

	/**
	 * Keeps closing tags outside an ignored fragment’s formatted slice, which
	 * is discarded in favor of its source.
	 */
	function addSeparatorAfterIgnored(): void {
		if (isFragment(scope, previous) && scope.ignoredNodes.has(previous)) {
			addMarker('comment', true);
		}
	}

	for (const child of scope.children) {
		if (isFragment(scope, child)) {
			// A complete comment needs no separator unless it matches an ignore
			// directive after trimming. The separator keeps Prettier’s HTML
			// printer from applying a directive beyond its own HTML block
			const isSeparated =
				isFragment(scope, previous) &&
				(!isComment(previous.value) ||
					IGNORE_COMMENT_PATTERN.test(previous.value.trim()) ||
					isHTMLIgnoreDirective(previous.value.trim()));

			if (isSeparated) {
				addMarker('comment', true);
			}

			const source = getBlockSource(child);
			const line = brokenFragments.has(child)
				? marker.insertBreak(source)
				: source;

			const start = addLine(line);

			pieces.push({
				end: text.length,
				kind: 'fragment',
				node: child,
				start,
				text: line,
			});
		} else {
			addSeparatorAfterIgnored();
			addMarker(
				isInParagraph(child)
					? 'comment'
					: (getGeneratedTagName(child) ?? 'comment'),
				false,
				child
			);
		}

		previous = child;
	}

	addSeparatorAfterIgnored();
	addMarker('comment', false);

	return { pieces, text };
}

/**
 * Checks whether HTML consists of one complete comment that Prettier prints as
 * written. Prettier formats the contents and conditions of conditional
 * comments, which start with `<!--[if` or `<!--<!`.
 */
function isComment(html: string): boolean {
	const comment = html.trim();
	return (
		comment.startsWith('<!--') &&
		!/^<!--(?:\[if|<!)/.test(comment) &&
		comment.indexOf('-->', 4) === comment.length - 3
	);
}

type MarkerForm = 'comment' | (string & {});

type Marker = {
	create: (id: number, form: MarkerForm) => string;
	find: (text: string) => Array<{ end: number; id: number; start: number }>;
	insertBreak: (html: string) => string;
	removeBreaks: (text: string) => string;
};

/**
 * Creates markers with an attribute name that doesn’t occur in the scope.
 */
function createMarker(scope: AST.BlockScope): Marker {
	const sourceText = scope.children
		.filter(isHTMLNode)
		.map(({ value }) => value)
		.join('\n');
	let name = 'data-prettier-markdown-html';

	while (sourceText.includes(name)) {
		name += '-';
	}

	// Markers contain no quotes, so they can stand inside a quoted attribute
	// value that spans several fragments. Prettier may break a marker’s tags
	// across lines when the print width is narrow
	const markerPattern = new RegExp(
		String.raw`<([a-z][a-z0-9]*)\s+${name}-(\d+)\s*>(?:\s*<\/\1\s*>)?|<!--${name}-(\d+)-->`,
		'g'
	);
	const breakPattern = new RegExp(
		String.raw`\n[\t ]*<div\s+${name}-break\s*>\s*<\/div\s*>(?=\n)|<div\s+${name}-break\s*>\s*<\/div\s*>`,
		'g'
	);

	return {
		create(id, form) {
			if (form === 'comment') {
				return `<!--${name}-${id}-->`;
			}

			return `<${form} ${name}-${id}></${form}>`;
		},
		find(text) {
			return [...text.matchAll(markerPattern)].map((match) => ({
				end: match.index + match[0].length,
				id: Number(match[2] ?? match[3]),
				start: match.index,
			}));
		},
		insertBreak(html) {
			const tagEnd = findTagEnd(html, html.search(/\S/));

			/* v8 ignore next -- @preserve */
			if (tagEnd === undefined) {
				return html;
			}

			// Keep the source’s line structure so Prettier preserves no extra
			// blank line around the break
			const rest = html.slice(tagEnd);
			return `${html.slice(0, tagEnd)}\n<div ${name}-break></div>${/^[\t ]*\n/.test(rest) ? '' : '\n'}${rest}`;
		},
		removeBreaks(text) {
			return text.replaceAll(breakPattern, '');
		},
	};
}

/**
 * Uses `p` to model how a Markdown block closes an open paragraph in HTML.
 * Definitions and front matter have no element marker.
 */
function getGeneratedTagName(node: AST.Node): string | undefined {
	return node.type === 'definition' || node.type === 'frontMatter'
		? undefined
		: 'p';
}

/**
 * Narrows the formatting width by the Markdown container prefixes that precede
 * each line of the scope.
 */
export function getScopeOptions(
	scope: Pick<AST.BlockScope, 'prefixWidth'>,
	options: ParserOptions
): ParserOptions {
	const { htmlFragmentPrintWidth, printWidth } = options;
	const width =
		typeof htmlFragmentPrintWidth === 'number'
			? htmlFragmentPrintWidth
			: printWidth;

	return {
		...options,
		htmlFragmentPrintWidth: undefined,
		printWidth: Math.max(width - scope.prefixWidth, 0),
	};
}

/**
 * Removes new blank lines that would end the block, except in raw text and
 * preformatted content. Throws if removing a blank line would change markup.
 */
function removeAddedBlankLines(value: string, node: AST.HTMLNode): string {
	if (/\n[\t ]*\n/.test(node.value)) {
		return value;
	}

	const tokens = scanMarkup(value).filter(({ kind }) => kind !== 'tag');

	return value.replaceAll(
		/\n(?:[\t ]*\n)+/g,
		(blankLines, offset: number) => {
			const token = tokens.find(
				({ end, start }) => start <= offset && offset < end
			);

			if (token && token.kind !== 'preserved') {
				reportUnsafeLayout({
					position: node.position?.start,
					reason: 'Removing the blank line that Prettier’s HTML formatter adds would change a comment or other markup.',
				});
			}

			return token ? blankLines : /* v8 ignore next -- @preserve */ '\n';
		}
	);
}

/**
 * Scans HTML for comments, opening tags, other markup, and preserved raw text
 * and preformatted content, in source order. Quoted attribute values stay
 * within their tags. Ordinary text is skipped.
 */
function scanMarkup(html: string): MarkupToken[] {
	const tokens: MarkupToken[] = [];
	const tagNamePattern = /<([a-z][^\s/>]*)/iy;

	for (let index = html.indexOf('<'); index !== -1;) {
		tagNamePattern.lastIndex = index;
		const name = tagNamePattern.exec(html)?.[1];
		let next: number;

		if (html.startsWith('<!--', index)) {
			const commentEnd = html.indexOf('-->', index + 4);
			next =
				commentEnd === -1
					? /* v8 ignore next -- @preserve */ html.length
					: commentEnd + 3;
			tokens.push({ end: next, kind: 'comment', start: index });
		} else if (name) {
			/* v8 ignore start -- @preserve */
			next = findTagEnd(html, index) ?? html.length;
			/* v8 ignore stop -- @preserve */
			tokens.push({ end: next, kind: 'tag', start: index });
		} else if (/^<[!/?]/.test(html.slice(index, index + 2))) {
			// Declarations, processing instructions, and closing tags end at
			// the first `>`, regardless of quotes
			const markupEnd = html.indexOf('>', index);
			next =
				markupEnd === -1
					? /* v8 ignore next -- @preserve */ html.length
					: markupEnd + 1;
			tokens.push({ end: next, kind: 'markup', start: index });
		} else {
			next = index + 1;
		}

		// Prettier’s parser closes self-closing tags of any element
		if (
			name &&
			(isRawTextTag(name) || name.toLowerCase() === 'pre') &&
			!html.slice(index, next).endsWith('/>')
		) {
			const closingTagPattern = new RegExp(
				String.raw`<\/${name}(?=[\s/>])`,
				'gi'
			);
			closingTagPattern.lastIndex = next;
			/* v8 ignore start -- @preserve */
			const end = closingTagPattern.exec(html)?.index ?? html.length;
			/* v8 ignore stop -- @preserve */

			tokens.push({ end, kind: 'preserved', start: next });
			next = end;
		}

		index = html.indexOf('<', next);
	}

	return tokens;
}

/**
 * Checks whether a fragment needs Prettier’s expanded layout because its first
 * tag shares a line with content, which would turn the block into a paragraph.
 */
function needsExpandedLayout(
	scope: AST.BlockScope,
	node: AST.HTMLNode,
	value: string
): boolean {
	if (scope.ignoredNodes.has(node) || !needsCompleteTagLine(value)) {
		return false;
	}

	const tagEnd = findTagEnd(value, 0);
	const firstLineEnd = value.indexOf('\n');

	return (
		tagEnd !== undefined &&
		/\S/.test(
			value.slice(tagEnd, firstLineEnd === -1 ? undefined : firstLineEnd)
		)
	);
}

/**
 * Checks whether the next node starts no later than the line after this node
 * ends, so no blank line separates them.
 */
function isAdjacent(node: AST.Node, next: AST.Node): boolean {
	const end = node.position?.end.line;
	const start = next.position?.start.line;

	return end !== undefined && start !== undefined && start <= end + 1;
}

/**
 * Identifies content that would change meaning if the formatted fragment’s HTML
 * block absorbed it. Distinguishes Markdown, ignore comments, and HTML split
 * across blocks. Returns `undefined` when their reading is preserved.
 */
function findTakenInContent(
	scope: AST.BlockScope,
	node: AST.HTMLNode,
	values: ReadonlyMap<AST.HTMLNode, string>
): TakenInContent | undefined {
	// If the source fragment already ends in such a block, nothing follows it
	// on the next line
	if (
		!endsInContinuingBlock(values.get(node)!) ||
		endsInContinuingBlock(readHTMLBlockText(node))
	) {
		return undefined;
	}

	return findTakenInSiblings(scope, node, values);
}

/**
 * Keeps surrounding whitespace on a standalone ignore comment so Prettier’s
 * Markdown printer doesn’t treat it as a directive during this pass.
 */
function keepIgnoreCommentWhitespace(
	node: AST.HTMLNode,
	value: string
): string {
	const comment = node.value.trim();

	// With closing tags after it, the comment shares their HTML block and
	// cannot act as a directive
	return !IGNORE_COMMENT_PATTERN.test(node.value) &&
		IGNORE_COMMENT_PATTERN.test(comment) &&
		value === comment
		? node.value
		: value;
}

/**
 * Identifies the kind of content an open HTML block would absorb incorrectly.
 */
function findTakenInSiblings(
	scope: AST.BlockScope,
	node: AST.HTMLNode,
	values: ReadonlyMap<AST.HTMLNode, string>
): TakenInContent | undefined {
	let previous = node;

	for (const next of scope.children.slice(scope.children.indexOf(node) + 1)) {
		if (!isPrintedOnNextLine(scope, previous, next)) {
			return undefined;
		}

		if (!isFragment(scope, next)) {
			return 'markdown';
		}

		// Prettier’s Markdown printer honors an ignore comment only when it
		// occupies a separate HTML block, so taking one in would let Prettier
		// format the content it protects
		/* v8 ignore start -- @preserve */
		if (scope.activeIgnoreComments.has(next)) {
			return 'ignore-comment';
		}

		const reading = readTakenInHTML(
			values.get(next) ?? readHTMLBlockText(next)
		);
		/* v8 ignore stop -- @preserve */

		if (reading !== 'continues') {
			return reading === 'splits'
				? /* v8 ignore next -- @preserve */ 'html'
				: undefined;
		}

		previous = next;
	}

	return undefined;
}

/**
 * Reports an error when formatting would add HTML to the block of an ignore
 * comment that Prettier honors. Prettier recognizes the comment only as an HTML
 * block of its own.
 */
function checkIgnoreComment(
	scope: AST.BlockScope,
	node: AST.HTMLNode,
	value: string
): void {
	/* v8 ignore next -- @preserve */
	if (value !== node.value && scope.activeIgnoreComments.has(node)) {
		reportUnsafeLayout({
			position: node.position?.start,
			reason: 'After formatting, this Prettier ignore comment would share its HTML block with other HTML, so Prettier would no longer recognize it.',
		});
	}
}

/**
 * Adjusts a fragment’s formatted value so it keeps reading as HTML blocks.
 */
async function finishFragment(
	node: AST.HTMLNode,
	formatted: string,
	options: ParserOptions
): Promise<string> {
	const joined = rejoinBrackets(await joinFirstTag(formatted, options));

	return keepIgnoreCommentWhitespace(node, alignBlockStarts(joined));
}

/**
 * Checks whether a comment is an ignore or attribute ignore directive that
 * Prettier’s HTML printer honors.
 */
function isHTMLIgnoreDirective(comment: string): boolean {
	const value = comment.slice(4, -3).trim();

	return (
		value === 'prettier-ignore' ||
		/^prettier-ignore-attribute(?:\s+.+)?$/s.test(value)
	);
}

/**
 * Lists the comments in HTML, outside preserved content, in source order.
 */
function listComments(html: string): MarkupToken[] {
	return scanMarkup(html).filter(({ kind }) => kind === 'comment');
}

/**
 * Checks whether formatting moved HTML that an HTML ignore directive protects
 * to the start of another HTML block, separating it from the directive.
 */
function hasSeparatedDirective(value: string): boolean {
	const lines = value.split('\n');
	const comments = listComments(value);

	return findBlockStartLines(value).some((start) => {
		const end = lines.slice(0, start).join('\n').trimEnd().length;
		const comment = comments.find((token) => token.end === end);

		return (
			comment !== undefined &&
			isHTMLIgnoreDirective(value.slice(comment.start, comment.end))
		);
	});
}

/**
 * Checks whether formatting a scope’s HTML blocks could cause the next pass to
 * split a block or combine it with an adjacent HTML block.
 */
function needsNextPassCheck(
	scope: AST.BlockScope,
	children: ReadonlyArray<AST.Node>,
	finalValues: ReadonlyMap<AST.HTMLNode, string>
): boolean {
	for (const [index, child] of children.entries()) {
		if (!isHTMLNode(child)) {
			continue;
		}

		const value = finalValues.get(child);

		if (value === undefined) {
			continue;
		}

		const next = children[index + 1];

		if (
			findBlockStartLines(value).length > 1 ||
			(isHTMLNode(next) &&
				endsInContinuingBlock(value) &&
				isNextHTMLOnNextLine(scope, child, next))
		) {
			return true;
		}
	}

	return false;
}

/**
 * Checks whether Prettier prints an HTML node on the line right after another
 * HTML node, without a blank line between them.
 */
function isNextHTMLOnNextLine(
	scope: AST.BlockScope,
	node: AST.HTMLNode,
	next: AST.HTMLNode
): boolean {
	return scope.isPrintedTight || isAdjacent(node, next);
}

/**
 * Checks whether an HTML block stays open after absorbing the next sibling.
 */
function continuesAfterAbsorbing(next: string): boolean {
	const lines = next.split('\n');
	const blankLine = lines.findIndex((line) => /^[\t ]*$/.test(line));

	return (
		blankLine === -1 ||
		endsInContinuingBlock(lines.slice(blankLine + 1).join('\n'))
	);
}

/**
 * Splits printed HTML block text into the HTML blocks that the next pass
 * parses, preserving any blank-line separator between consecutive blocks.
 */
function splitHTMLBlocks(
	text: string
): Array<{ separator: string; value: string }> {
	const starts = findBlockStartLines(text);

	if (starts.length <= 1) {
		return [{ separator: '', value: text }];
	}

	const lines = text.split('\n');
	const blockStarts = [0, ...starts.slice(1)];

	return blockStarts.map((start, index) => {
		const nextStart = blockStarts[index + 1] ?? lines.length;
		let end = nextStart;

		if (index + 1 < blockStarts.length) {
			while (end > start && /^[\t ]*$/.test(lines[end - 1]!)) {
				end -= 1;
			}
		}

		return {
			separator:
				index + 1 < blockStarts.length
					? ['', ...lines.slice(end, nextStart), ''].join('\n')
					: '',
			value: lines.slice(start, end).join('\n'),
		};
	});
}

/**
 * Rejects layouts that would change when Markdown splits or joins the printed
 * HTML blocks on the next pass.
 */
async function checkNextPass(
	scope: AST.BlockScope,
	children: ReadonlyArray<AST.Node>,
	marker: Marker,
	options: ParserOptions
): Promise<void> {
	const runs: Array<{
		blocks: Array<{ node: AST.HTMLNode; separator: string }>;
		joined: string;
		nodes: AST.HTMLNode[];
	}> = [];
	const nextChildren: AST.Node[] = [];
	const blockFragments = new Set<AST.Node>(scope.blockFragments);
	const ignoredNodes = new Set(scope.ignoredNodes);
	let isIgnoringNext = false;

	for (let index = 0; index < children.length; index += 1) {
		const child = children[index]!;

		// Ignored fragments already keep their source, and the next pass
		// formats other nodes outside the skeleton
		if (!isHTMLNode(child) || !scope.formattedNodes.has(child)) {
			isIgnoringNext =
				isHTMLNode(child) &&
				/* v8 ignore start -- @preserve */
				/^<!--\s*prettier-ignore\s*-->$/.test(child.value);
			/* v8 ignore stop -- @preserve */
			nextChildren.push(child);
			continue;
		}

		const firstText = getBlockSource(child);
		const runNodes: AST.HTMLNode[] = [child];
		const runTexts = [firstText];
		let isContinuing = endsInContinuingBlock(firstText);

		while (isContinuing && index + 1 < children.length) {
			const next = children[index + 1]!;

			if (
				!isHTMLNode(next) ||
				!isNextHTMLOnNextLine(scope, runNodes.at(-1)!, next)
			) {
				break;
			}

			const nextText = getBlockSource(next);

			runNodes.push(next);
			runTexts.push(nextText);
			isContinuing = continuesAfterAbsorbing(nextText);
			index += 1;
		}

		const joined = runTexts.join('\n');
		const firstPosition = runNodes[0]!.position;
		const lastPosition = runNodes.at(-1)!.position;
		const runPosition =
			firstPosition && lastPosition
				? { end: lastPosition.end, start: firstPosition.start }
				: /* v8 ignore next -- @preserve */ firstPosition;
		const runBlocks = splitHTMLBlocks(joined).map(
			({ separator, value }) => ({
				node: {
					position: runPosition,
					type: 'html',
					value,
				} satisfies AST.HTMLNode,
				separator,
			})
		);

		for (const { node: block } of runBlocks) {
			blockFragments.add(block);

			if (isIgnoringNext) {
				ignoredNodes.add(block);
			}

			isIgnoringNext = /^<!--\s*prettier-ignore\s*-->$/.test(block.value);
			nextChildren.push(block);
		}

		runs.push({ blocks: runBlocks, joined, nodes: runNodes });
	}

	const next: AST.BlockScope = {
		...scope,
		blockFragments,
		children: nextChildren,
		formattedNodes: new WeakSet(),
		ignoredNodes,
	};
	const layout = await layOutScope(next, marker, options);
	const values = new Map<AST.HTMLNode, string>();

	for (const { blocks } of runs) {
		for (const { node: block } of blocks) {
			if (!ignoredNodes.has(block)) {
				values.set(
					block,
					await finishFragment(
						block,
						layout.values.get(block)!,
						options
					)
				);
			}
		}
	}

	const changedRun = runs.find(
		({ blocks, joined }) =>
			blocks
				.map(
					({ node: block, separator }) =>
						`${
							ignoredNodes.has(block)
								? block.value
								: finishLayout(
										next,
										block,
										values.get(block)!,
										values
									)
						}${separator}`
				)
				.join('') !== joined
	);

	if (changedRun !== undefined) {
		const culprit = changedRun.nodes[0]!;
		let reason =
			'After formatting, this HTML block would split into separate HTML blocks, so formatting the result again would change it.';

		/* v8 ignore start -- @preserve */
		if (hasSeparatedDirective(culprit.value)) {
			reason =
				'After formatting, the HTML that an ignore directive in this HTML block protects would start an HTML block of its own, so formatting the result again would change it.';
		} else if (changedRun.nodes.length > 1) {
			/* v8 ignore stop -- @preserve */
			reason =
				'After formatting, this HTML block would combine with the HTML block after it, so formatting the result again would change it.';
		}

		reportUnsafeLayout({
			position: culprit.position?.start,
			reason,
		});
	}
}

/**
 * Checks whether Prettier’s Markdown printer always puts a sibling on the line
 * right after an HTML node: in an item it prints tight, or as an HTML block on
 * the next line. The role check finds other Markdown printed there.
 */
function isPrintedOnNextLine(
	scope: AST.BlockScope,
	node: AST.HTMLNode,
	next: AST.Node
): boolean {
	return (
		scope.isPrintedTight || (next.type === 'html' && isAdjacent(node, next))
	);
}

/**
 * Joins trailing lines of closing tags so an open HTML block ends before the
 * following Markdown. Other lines can contain text, code, or attribute values
 * that must keep their line breaks.
 */
function endBlockOnLastLine(
	node: AST.HTMLNode,
	value: string,
	takenIn: TakenInContent
): string {
	const lines = value.split('\n');
	const start = findBlockStartLines(value).at(-1)!;
	const previousLine = lines[start - 1];

	// After a blank line, the joined line would still start a block
	/* v8 ignore else -- @preserve */
	if (
		previousLine === undefined ||
		/^[\t ]*$/.test(previousLine) ||
		!lines
			.slice(start)
			.every((line) => CLOSING_TAGS_LINE_PATTERN.test(line))
	) {
		reportUnsafeLayout({
			position: node.position?.start,
			reason: `After formatting, this HTML block would remain open in GitHub Flavored Markdown and ${TAKEN_IN_CONSEQUENCES[takenIn]}.`,
		});
	}

	/* v8 ignore start -- @preserve */
	return [
		...lines.slice(0, start - 1),
		[previousLine, ...lines.slice(start).map((line) => line.trim())].join(
			' '
		),
	].join('\n');
	/* v8 ignore stop -- @preserve */
}

/**
 * Moves the later lines that start HTML blocks within a fragment to the content
 * edge, as for the first line of a fragment. A comment or similar token can end
 * its block on its first line, so the next line starts another block.
 */
function alignBlockStarts(value: string): string {
	const lines = value.split('\n');
	let index = findNonBlockLine(value);

	// Four columns of indentation would make this line a code block
	while (index !== undefined && index > 0) {
		const line = lines[index]!.trimStart();

		if (line === lines[index]) {
			break;
		}

		lines[index] = line;
		index = findNonBlockLine(lines.join('\n'));
	}

	for (const start of findBlockStartLines(lines.join('\n'))) {
		if (start > 0) {
			lines[start] = lines[start]!.trimStart();
		}
	}

	return lines.join('\n');
}

/**
 * Rejoins brackets that Prettier puts on lines of their own to the ends of
 * their tags where the HTML would otherwise stop reading as HTML blocks. A lone
 * `>` after a comment that ends its block can start a block quote.
 */
function rejoinBrackets(value: string): string {
	const lines = value.split('\n');
	let index = findNonBlockLine(value);

	while (index !== undefined && index > 0) {
		const bracket = /^[\t ]*(\/?>)$/.exec(lines[index]!)?.[1];

		if (!bracket) {
			break;
		}

		lines.splice(
			index - 1,
			2,
			lines[index - 1] +
				(bracket === '/>'
					? /* v8 ignore next -- @preserve */ ' />'
					: '>')
		);
		index = findNonBlockLine(lines.join('\n'));
	}

	return lines.join('\n');
}

/**
 * Keeps the first tag of a block on one physical line when GFM recognizes the
 * block only by a complete tag on its first line.
 */
async function joinFirstTag(
	value: string,
	options: ParserOptions
): Promise<string> {
	if (!needsCompleteTagLine(value)) {
		return value;
	}

	const tagEnd = findTagEnd(value, 0);
	const firstLineEnd = value.indexOf('\n');

	if (tagEnd === undefined || firstLineEnd === -1 || tagEnd <= firstLineEnd) {
		return value;
	}

	let joined = joinTagLines(value.slice(0, tagEnd));

	// Prettier can break a formatted attribute value, such as a style, across
	// lines. It prints that value on one line when the tag fits. A line break
	// that remains belongs to the value, and the block check rejects the tag
	if (joined.includes('\n')) {
		const formatted = await formatHTML(value.slice(0, tagEnd), {
			...options,
			printWidth: Number.MAX_SAFE_INTEGER,
		});

		joined = joinTagLines(formatted.slice(0, findTagEnd(formatted, 0)));
	}

	return joined.replace(/ (?=>$)/, '') + value.slice(tagEnd);
}

/**
 * Collapses runs of whitespace outside quoted attribute values to one space.
 */
function joinTagLines(tag: string): string {
	let joined = '';
	let quote: string | undefined;

	for (const character of tag) {
		if (quote) {
			joined += character;
			quote = character === quote ? undefined : quote;
		} else if (/\s/.test(character)) {
			joined += joined.endsWith(' ') ? '' : ' ';
		} else {
			joined += character;
			quote =
				character === '"' || character === "'" ? character : undefined;
		}
	}

	return joined;
}

/**
 * Reports an error unless the source and formatted HTML both form blocks in
 * GitHub Flavored Markdown. An open block must keep its end condition unless
 * its container ends it.
 */
function checkHTMLBlocks(
	node: AST.HTMLNode,
	value: string,
	canStayOpen: boolean
): void {
	const source = readHTMLBlockText(node);

	// Prettier’s parser reads some HTML as a block that GitHub Flavored
	// Markdown reads as paragraph text
	if (!isHTMLBlockSequence(source, source)) {
		reportUnsafeLayout({
			position: node.position?.start,
			reason: 'GitHub Flavored Markdown reads this HTML as paragraph text. To start a block, put the first tag on its own line, separated from any preceding paragraph by a blank line.',
		});
	}

	// At the end of the document or block quote, an open HTML block has no more
	// Markdown to absorb. In a list item it can still change how the item reads
	const isOnlyLeftOpen = isHTMLBlockSequence(value, value);

	if (
		!isHTMLBlockSequence(value, source) &&
		/* v8 ignore start -- @preserve */
		!(isOnlyLeftOpen && canStayOpen)
		/* v8 ignore stop -- @preserve */
	) {
		reportUnsafeLayout({
			position: node.position?.start,
			// The formatted HTML still forms blocks, but one has a different
			// end condition
			reason: isOnlyLeftOpen
				? /* v8 ignore next -- @preserve */ 'After formatting, this HTML block would remain open in GitHub Flavored Markdown and include the Markdown that follows.'
				: 'After formatting, GitHub Flavored Markdown would no longer recognize this as an HTML block, and some of its content would be interpreted as Markdown.',
		});
	}
}

/**
 * Reports an error when Prettier’s HTML output loses the place of the Markdown
 * between a scope’s HTML blocks.
 */
function reportMisplacedMarkdown(scope: AST.BlockScope): never {
	reportUnsafeLayout({
		position: scope.children.find(isHTMLNode)?.position?.start,
		reason: 'The plugin can’t restore the Markdown between these HTML blocks to its original place after Prettier formats the HTML.',
	});
}

/**
 * Checks whether an HTML node is an HTML block of an accepted region. Prettier’s
 * other HTML blocks are left to its Markdown formatter.
 */
function isFragment(
	scope: Pick<AST.BlockScope, 'blockFragments'>,
	node: AST.Node | undefined
): node is AST.HTMLNode {
	return isHTMLNode(node) && scope.blockFragments.has(node);
}

/**
 * Returns an HTML block’s source without the line break that ends it.
 */
function getBlockSource(node: AST.HTMLNode): string {
	return node.value.replace(/\r?\n$/, '');
}

/**
 * Recognizes HTML nodes with source text that can be formatted.
 */
function isHTMLNode(node: AST.Node | undefined): node is AST.HTMLNode {
	return node?.type === 'html' && typeof node.value === 'string';
}
