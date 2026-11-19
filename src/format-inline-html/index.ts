import type { ParserOptions } from 'prettier';
import type { MarkdownSource } from '../slice-markdown-source/index.ts';
import type { AST } from '../types/index.d.ts';
import { format, util } from 'prettier';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import findTagEnd from '../find-tag-end/index.ts';
import formatHTML from '../format-html/index.ts';
import isBlockTag from '../is-block-tag/index.ts';
import {
	canInterruptParagraph,
	startsHTMLBlock,
} from '../is-html-block-sequence/index.ts';
import isVoidTag from '../is-void-tag/index.ts';
import { hasDelimiterRowSyntax } from '../render-document-context/index.ts';
import { reportUnsafeLayout } from '../report-error/index.ts';
import sliceMarkdownSource from '../slice-markdown-source/index.ts';

// Prettier’s Markdown layout of a paragraph, with the HTML it contains
type Measurement = {
	formatted: string;
	formattedNodes: AST.HTMLNode[];
	htmlNodes: AST.HTMLNode[];
	// The width of the mark added before the paragraph, if any
	prefixWidth: number;
	// The character that stands in for spaces the Markdown printer can’t break
	unbreakableSpace: string;
};

// A paragraph as Prettier’s Markdown printer prints it
type PrintedParagraph = {
	// Whether the paragraph no longer reads as one paragraph once Prettier
	// prints it, where measuring it outside its container can show that
	changesReading: boolean;
	// The layout if the printed paragraph reads as one paragraph with the same
	// HTML
	measurement: Measurement | undefined;
};

type TagPosition = {
	// Columns before the tag on its line, from the paragraph’s content edge
	column: number;
	// Text that stands in for the content after the tag, through Prettier’s
	// next break opportunity
	following: string;
};

const CLOSING_TAG_PATTERN = /^<\/([a-z][a-z0-9-]*)\s*>$/i;

// Line starts that interrupt a paragraph or turn its lines into another
// construct: block quotes, ATX headings, fences, list items, thematic breaks,
// setext underlines, and table delimiter rows
const MARKDOWN_STRUCTURE_PATTERN =
	/^(?:>|#{1,6}(?:[\t ]|$)|`{3}|~{3}|[*+-](?:[\t ]|$)|\d{1,9}[).](?:[\t ]|$)|[*_](?:[\t ]*[*_]){2,}[\t ]*$|=+[\t ]*$|[\t :|-]*-[\t :|-]*$)/;

// Maximum rounds of paragraph layout before reporting that the tags’ layouts
// haven’t stabilized
const MAX_LAYOUT_ROUNDS = 8;

// Text that goes before a paragraph’s measurement: nothing, then a combining
// mark that Prettier measures as zero columns wide, which keeps the first line
// from starting other Markdown structure
const MEASUREMENT_PREFIXES = ['', '\u0301'];

const OPENING_TAG_PATTERN = /^<([a-z][a-z0-9-]*)(?=[\t\n\f\r />])/i;

const TAB_STOP = 4;

// The cache records whether Prettier breaks each tag at any width with content,
// but not without it
const brokenByContent = new WeakMap<AST.Node, boolean>();

// Inline HTML whose separator from the content before it can no longer break
const unbreakableBefore = new WeakSet<AST.Node>();

/**
 * Formats the inline HTML of one paragraph, heading, or table cell without
 * changing its relationship with the surrounding Markdown. Tags start from
 * their one-line forms. In a paragraph with a known layout, opening tags then
 * take Prettier’s HTML layout at their positions in the formatted lines.
 */
export default async function formatInlineHTML(
	fragments: ReadonlyArray<AST.Fragment>,
	layout: AST.InlineLayout | undefined,
	protectedNodes: ReadonlySet<AST.Node>,
	options: ParserOptions,
	formattedNodes: WeakSet<AST.Node>
): Promise<void> {
	const values = new Map<AST.HTMLNode, string>();

	for (const fragment of fragments) {
		const { node } = fragment;

		if (!fragment.isSingleLine) {
			keepOffLineStart(fragment, options);
		}

		// Protected content keeps its source text, though its position in the
		// Markdown line still matters
		const formatted = protectedNodes.has(node)
			? undefined
			: await formatTag(
					fragment.isInTableCell
						? node.value.replaceAll(String.raw`\|`, '|')
						: node.value,
					getSingleLineOptions(options),
					node.position?.start
				);

		if (formatted !== undefined) {
			values.set(node, formatted);
		}
	}

	if (layout) {
		await layOutParagraph(fragments, layout, values, options);
	}

	for (const fragment of fragments) {
		const { node } = fragment;
		const value = values.get(node);

		if (value !== undefined) {
			// Escaped pipes keep the tag inside its table cell
			node.value = fragment.isInTableCell
				? value.replaceAll('|', String.raw`\|`)
				: value;
			formattedNodes.add(node);
		}

		keepLeadingTagInParagraph(fragment, layout, node.value, options);
	}
}

/**
 * Lays out a paragraph’s opening tags with Prettier’s HTML layout at their
 * positions in the formatted lines. A tag’s layout can move the tags after it
 * and, when Prettier wraps prose, the tag itself, so layout repeats over the
 * paragraph until no tag changes. Each formatting pass starts from the same
 * one-line forms. The first round lays out every tag from one measurement of
 * the paragraph. Since a tag’s position depends on the tags before it, later
 * rounds lay out one tag at a time and measure again after each change. A tag
 * keeps its one-line form if its layout would start Markdown structure, as when
 * the paragraph no longer reparses as one paragraph, or if Prettier moves it.
 * Formatting reports an error if the paragraph reads as one paragraph on its
 * own but not once Prettier prints it.
 */
async function layOutParagraph(
	fragments: ReadonlyArray<AST.Fragment>,
	layout: AST.InlineLayout,
	values: Map<AST.HTMLNode, string>,
	options: ParserOptions
): Promise<void> {
	const tags = fragments.filter(
		({ node }) => values.has(node) && OPENING_TAG_PATTERN.test(node.value)
	);
	const singleLines = new Map(
		tags.map(({ node }) => [node, values.get(node)!])
	);
	const layouts = new Map<string, string | undefined>();
	let changedTag: AST.Fragment | undefined;
	let printed = await measureParagraph(layout, values, options);

	for (let round = 0; round < MAX_LAYOUT_ROUNDS; round += 1) {
		const updates = new Map<AST.HTMLNode, string>();
		const isSequential = round > 0;
		const roundPrinted = printed;

		changedTag = undefined;

		for (const [index, fragment] of tags.entries()) {
			const position = findTagPosition(
				fragment,
				layout,
				printed.measurement,
				options
			);
			const key =
				position && `${index}:${position.column}:${position.following}`;

			if (key && !layouts.has(key)) {
				layouts.set(
					key,
					await formatTagAt(
						fragment,
						singleLines.get(fragment.node)!,
						position,
						layout,
						options
					)
				);
			}

			const value =
				(key && layouts.get(key)) ?? singleLines.get(fragment.node)!;
			const previousValue = values.get(fragment.node)!;

			if (value === previousValue) {
				continue;
			}

			changedTag = fragment;

			if (!isSequential) {
				updates.set(fragment.node, value);
				continue;
			}

			const previousPrinted = printed;

			values.set(fragment.node, value);
			printed = await measureParagraph(layout, values, options);

			// A layout that keeps the paragraph from reading as one paragraph
			// would start Markdown structure
			if (previousPrinted.measurement && !printed.measurement) {
				layouts.set(key!, undefined);
				values.set(fragment.node, previousValue);
				printed = previousPrinted;
			}
		}

		if (!changedTag) {
			break;
		}

		if (!isSequential) {
			for (const [node, value] of updates) {
				values.set(node, value);
			}

			printed = await measureParagraph(layout, values, options);

			// Later rounds lay out one tag at a time to find any layout that starts
			// Markdown structure
			if (!printed.measurement) {
				for (const node of updates.keys()) {
					values.set(node, singleLines.get(node)!);
				}

				printed = roundPrinted;
			}
		}
	}

	/* v8 ignore next -- @preserve */
	if (changedTag) {
		reportUnsafeLayout({
			filepath: options.filepath,
			position: changedTag.node.position?.start,
			reason: 'Formatting couldn’t find a stable layout for this paragraph’s HTML tags',
		});
	}

	if (printed.changesReading) {
		reportUnsafeLayout({
			filepath: options.filepath,
			position: layout.paragraph.position?.start,
			reason: 'After formatting, this paragraph’s lines would no longer read as one paragraph, which would change the context of its HTML',
		});
	}
}

/**
 * Formats a paragraph with Prettier’s Markdown printer, using the current
 * values of its HTML, and reparses the result to locate that HTML. Prettier
 * reads the paragraph from its source, as it does in the document, and prints
 * the current values in place of the source HTML. Where the paragraph’s text
 * would start other Markdown structure on its own, such as an HTML block or a
 * heading after a task item’s checkbox, a combining mark that Prettier
 * measures as zero columns wide goes before it. The measurement is `undefined`
 * if neither result reparses as one paragraph with the same number of HTML
 * nodes.
 */
async function measureParagraph(
	layout: AST.InlineLayout,
	values: ReadonlyMap<AST.HTMLNode, string>,
	options: ParserOptions
): Promise<PrintedParagraph> {
	const htmlNodes = findHTMLNodes(layout.paragraph);
	const paragraph = buildParagraphText(layout, htmlNodes, values, options);

	if (paragraph === undefined) {
		return {
			changesReading: false,
			measurement: undefined,
		};
	}

	const { text, unbreakableSpace } = paragraph;

	// HTML lines after the first start at the paragraph’s content edge, but
	// their indentation counts from the container’s content edge
	const printedValues = htmlNodes.map((node) =>
		(values.get(node) ?? node.value).replaceAll(
			'\n',
			`\n${' '.repeat(layout.contentEdge - layout.containerEdge)}`
		)
	);
	// Prettier indents later lines from the paragraph’s content edge. Four
	// columns or more past the container’s content edge, those lines can’t start
	// Markdown structure, though the same lines measured on their own could
	const areLaterLinesIndented =
		layout.contentEdge - layout.containerEdge >= 4;
	let isComparable = false;

	for (const prefix of MEASUREMENT_PREFIXES) {
		const printed = await printParagraph(
			`${prefix}${text}`,
			printedValues,
			layout,
			options
		);

		if (!printed) {
			continue;
		}

		const { formatted, root } = printed;

		isComparable = true;

		if (isParagraph(root, htmlNodes.length)) {
			return {
				changesReading: false,
				measurement: {
					formatted,
					formattedNodes: findHTMLNodes(root),
					htmlNodes,
					prefixWidth: measureWidth(prefix, options),
					unbreakableSpace,
				},
			};
		}
	}

	// The source on its own shows how Prettier’s printing reads only if it
	// contains the same HTML
	return {
		changesReading: isComparable && !areLaterLinesIndented,
		measurement: undefined,
	};
}

/**
 * Prints Markdown with Prettier’s Markdown printer at a paragraph’s width and
 * reparses the result. Prettier reads the Markdown as written, but prints the
 * given values in place of its HTML. Other plugins’ hooks don’t run for this
 * print. Returns `undefined` if the Markdown doesn’t parse with as many HTML
 * nodes as there are values.
 */
async function printParagraph(
	markdown: string,
	printedValues: ReadonlyArray<string>,
	layout: AST.InlineLayout,
	options: ParserOptions
): Promise<{ formatted: string; root: AST.Node } | undefined> {
	let isPrintedWithValues = false;

	const formatted = await format(markdown, {
		endOfLine: 'lf',
		parser: 'markdown',
		plugins: [
			pluginMarkdown,
			{
				parsers: {
					markdown: {
						...pluginMarkdown.parsers.markdown,
						async parse(source, parserOptions) {
							const root =
								(await pluginMarkdown.parsers.markdown.parse(
									source,
									parserOptions
								)) as AST.Node;
							const nodes = findHTMLNodes(root);

							isPrintedWithValues =
								nodes.length === printedValues.length;

							if (isPrintedWithValues) {
								for (const [index, node] of nodes.entries()) {
									node.value = printedValues[index]!;
								}
							}

							return root;
						},
					},
				},
			},
		],
		printWidth: Math.max(options.printWidth - layout.contentEdge, 1),
		proseWrap: options.proseWrap,
	});

	if (!isPrintedWithValues) {
		return undefined;
	}

	const root = (await pluginMarkdown.parsers.markdown.parse(
		formatted,
		{} as ParserOptions
	)) as AST.Node;

	return { formatted, root };
}

/**
 * Checks whether a parsed Markdown root consists of one paragraph with the
 * given number of HTML nodes.
 */
function isParagraph(root: AST.Node, htmlCount: number): boolean {
	return (
		root.children?.length === 1 &&
		root.children[0]!.type === 'paragraph' &&
		findHTMLNodes(root).length === htmlCount
	);
}

/**
 * Finds where a tag starts in its formatted paragraph and what follows it
 * through the next break opportunity. A tag at the start of the paragraph’s
 * first line has column zero. Whitespace or a hard line break after it is a
 * break opportunity in Prettier’s HTML layout, even where the Markdown printer
 * can’t break it, though a backslash that ends the line stays attached. Returns
 * `undefined` without a measurement unless a leading tag is followed by
 * whitespace, a hard line break, or nothing.
 */
function findTagPosition(
	fragment: AST.Fragment,
	layout: AST.InlineLayout,
	measurement: Measurement | undefined,
	options: ParserOptions
): TagPosition | undefined {
	const separator = findSeparatorAfter(fragment.parent, fragment.node);

	if (
		isLeadingNode(fragment.node, layout) &&
		(separator === undefined ||
			separator.type === 'break' ||
			separator.type === 'whitespace')
	) {
		let following = separator ? ' x' : '';

		if (
			separator?.type === 'break' &&
			options.originalText.charAt(
				separator.position?.start.offset ?? -1
			) === '\\'
		) {
			following = 'x x';
		}

		return { column: 0, following };
	}

	if (!measurement) {
		return undefined;
	}

	const { formatted, formattedNodes, htmlNodes, prefixWidth } = measurement;

	const index = htmlNodes.indexOf(fragment.node);
	const start = formattedNodes[index]!.position!.start.offset!;
	const end = formattedNodes[index]!.position!.end.offset!;

	const attached = findAttachedContent(
		formatted,
		end,
		formattedNodes.slice(index + 1),
		`\t\n\f\r ${measurement.unbreakableSpace}`
	);
	const following = `${'x'.repeat(util.getStringWidth(attached.content))}${attached.following}`;

	const lineStart = formatted.lastIndexOf('\n', start - 1) + 1;

	// A line that continues earlier HTML carries the added indentation
	const isInHTML = formattedNodes.some(
		({ position }) =>
			position!.start.offset! < lineStart &&
			lineStart <= position!.end.offset!
	);
	const column =
		measureWidth(formatted.slice(lineStart, start), options) -
		(lineStart === 0 ? prefixWidth : 0) -
		(isInHTML ? layout.contentEdge - layout.containerEdge : 0);

	return {
		column: layout.paragraph.children?.[0] === fragment.node ? 0 : column,
		following,
	};
}

/**
 * Returns the text and HTML attached after a tag, stopping at whitespace in
 * text, whitespace before a later tag’s attributes, or an existing line break.
 * Other whitespace inside a comment or a tag without attributes stays attached.
 * The content ends earlier at a closing tag if no element opened in it remains
 * unclosed. Also indicates what follows the content: more content after a break
 * opportunity, only a space before the element’s closing tag, or nothing.
 */
function findAttachedContent(
	formatted: string,
	end: number,
	laterNodes: ReadonlyArray<AST.HTMLNode>,
	whitespace: string
): { content: string; following: string } {
	const textPattern = new RegExp(`^[^${whitespace}]*`);
	const contentPattern = new RegExp(`^[${whitespace}]+[^${whitespace}]`);
	let content = '';
	let offset = end;
	let depth = 0;

	for (const node of laterNodes) {
		const start = node.position!.start.offset!;
		const nodeEnd = node.position!.end.offset!;

		const [text] = textPattern.exec(formatted.slice(offset, start))!;
		const isClosingTag = CLOSING_TAG_PATTERN.test(node.value);

		content += text;

		// Only whitespace may stand between the content and the element’s own
		// closing tag
		if (offset + text.length < start) {
			const isBeforeOwnClosingTag =
				isClosingTag &&
				depth === 0 &&
				!new RegExp(`[^${whitespace}]`).test(
					formatted.slice(offset + text.length, start)
				);

			return { content, following: isBeforeOwnClosingTag ? ' ' : ' x' };
		}

		if (isClosingTag && depth === 0) {
			return { content, following: '' };
		}

		const tagStart =
			/^<[a-z][a-z0-9-]*(?=[\t\n\f\r ]+[^\t\n\f\r />])/i.exec(node.value);

		if (tagStart) {
			return { content: content + tagStart[0], following: ' x' };
		}

		const tagName = OPENING_TAG_PATTERN.exec(node.value)?.[1];
		const [firstLine] = node.value.split('\n');

		content += firstLine;

		if (firstLine!.length < node.value.length) {
			return { content, following: ' x' };
		}

		if (isClosingTag) {
			depth -= 1;
		} else if (
			tagName &&
			!isVoidTag(tagName) &&
			!node.value.endsWith('/>')
		) {
			depth += 1;
		}

		offset = nodeEnd;
	}

	const rest = formatted.slice(offset);
	const [text] = textPattern.exec(rest)!;

	return {
		content: content + text,
		following: contentPattern.test(rest.slice(text.length)) ? ' x' : '',
	};
}

/**
 * Measures text as Prettier does for its line width, counting each tab as one
 * indentation level.
 */
function measureWidth(text: string, options: ParserOptions): number {
	return util.getStringWidth(
		text.replaceAll('\t', ' '.repeat(options.tabWidth))
	);
}

/**
 * Returns a paragraph’s Markdown source without container prefixes or leading
 * whitespace. Separators that can no longer break become placeholders that the
 * Markdown printer can’t break, including whitespace that a leading tag’s
 * current value would join to its line. Line breaks outside the HTML can become
 * spaces, as Prettier prints soft line breaks unless `proseWrap` preserves them.
 * Without its container, a lazy continuation line could otherwise start Markdown
 * structure.
 */
function buildParagraphText(
	layout: AST.InlineLayout,
	htmlNodes: ReadonlyArray<AST.HTMLNode>,
	values: ReadonlyMap<AST.HTMLNode, string>,
	options: ParserOptions
): { text: string; unbreakableSpace: string } | undefined {
	const sliced = sliceMarkdownSource(
		options.originalText,
		layout.paragraph,
		layout.containers
	);
	const joinedNode = findJoinedLeadingNode(layout, values, options);

	if (!sliced) {
		return undefined;
	}

	// A private use character that the paragraph doesn’t contain stands in for
	// a space that the Markdown printer can’t break. The output prints an
	// ordinary space there, which Prettier’s HTML layout can break
	const contents = [sliced.text, ...values.values()].join('');
	let codePoint = '\uE000'.codePointAt(0)!;

	while (contents.includes(String.fromCodePoint(codePoint))) {
		codePoint += 1;
	}

	const unbreakableSpace = String.fromCodePoint(codePoint);

	let text = '';
	let offset = findCheckboxEnd(layout, sliced);
	let previous: AST.HTMLNode | undefined;

	for (const node of [...htmlNodes, undefined]) {
		const start = node
			? sliced.offsets.indexOf(node.position?.start.offset ?? -1)
			: sliced.text.length;
		const end = node
			? sliced.offsets.indexOf(node.position?.end.offset ?? -1)
			: sliced.text.length;

		if (start < offset || end < start) {
			return undefined;
		}

		let between = sliced.text.slice(offset, start);

		if (previous && previous === joinedNode) {
			between = between.replace(/^[\t\n ]+/, unbreakableSpace);
		}

		if (node && unbreakableBefore.has(node)) {
			between = between.replace(/[\t\n ]+$/, unbreakableSpace);
		}

		if (options.proseWrap !== 'preserve') {
			between = joinSoftLineBreaks(between);
		}

		text += between + sliced.text.slice(start, end);

		offset = end;
		previous = node;
	}

	// A lazy continuation line of equals signs stays paragraph text in GFM, but
	// would underline a heading without the paragraph’s container. Prettier
	// escapes such a line when it prints the paragraph
	return {
		text: text
			.replace(/^[\t ]+/, '')
			.replaceAll(/(?<=\n {0,3})(?==+[\t ]*(?:\n|$))/g, '\\'),
		unbreakableSpace,
	};
}

/**
 * Replaces soft line breaks in Markdown text with spaces. A hard line break
 * written as two or more trailing spaces or a backslash stays.
 */
function joinSoftLineBreaks(text: string): string {
	const lines = text.split('\n');
	let joined = lines[0]!;

	for (const line of lines.slice(1)) {
		joined = /(?: {2}|(?:^|[^\\])(?:\\\\)*\\)$/.test(joined)
			? `${joined}\n${line}`
			: // Prettier joins the lines at spaces and tabs only
				`${joined.replace(/[\t ]+$/, '')} ${line.replace(/^[\t ]+/, '')}`;
	}

	return joined;
}

/**
 * Returns a paragraph’s leading tag if its current value would stand alone on
 * the first line, so the whitespace after it joins the content to the line.
 */
function findJoinedLeadingNode(
	layout: AST.InlineLayout,
	values: ReadonlyMap<AST.HTMLNode, string>,
	options: ParserOptions
): AST.HTMLNode | undefined {
	const first = layout.paragraph.children?.[0] as AST.HTMLNode | undefined;
	const separator = first && findSeparatorAfter(layout.paragraph, first);

	return first?.type === 'html' &&
		isLeadingNode(first, layout) &&
		separator?.type === 'whitespace' &&
		isAloneOnLine(values.get(first) ?? first.value, separator, options)
		? first
		: undefined;
}

/**
 * Formats an opening tag from its one-line form as Prettier lays it out at a
 * position in its line, then adjusts line breaks that would start Markdown
 * structure. Returns `undefined` if Prettier moves the tag from that position,
 * or if another line would start Markdown structure.
 */
async function formatTagAt(
	fragment: AST.Fragment,
	html: string,
	position: TagPosition,
	layout: AST.InlineLayout,
	options: ParserOptions
): Promise<string | undefined> {
	const tagName = OPENING_TAG_PATTERN.exec(html)![1]!;

	// An unknown element with a name of the same length takes the layout of an
	// inline element
	const probeName = (await isBrokenByContent(fragment, html, options))
		? 'x'.repeat(tagName.length)
		: tagName;
	const prefix = 'x'.repeat(position.column);
	const printWidth =
		typeof options.htmlFragmentPrintWidth === 'number'
			? options.htmlFragmentPrintWidth
			: options.printWidth;
	const formatted = await formatProbe(
		fragment,
		`<${probeName}${html.slice(tagName.length + 1)}`,
		prefix,
		position.following,
		Math.max(printWidth - layout.contentEdge, 1),
		options
	);
	const end = formatted.startsWith(`${prefix}<`)
		? findTagEnd(formatted, prefix.length)
		: /* v8 ignore next -- @preserve */ undefined;
	const tag =
		end === undefined
			? /* v8 ignore next -- @preserve */ undefined
			: keepInParagraph(formatted.slice(prefix.length, end), layout);

	return tag?.replace(`<${probeName}`, `<${tagName}`);
}

/**
 * Checks whether Prettier breaks an opening tag at any width with content but
 * not without it, as it does for lists and `select`. The plugin can’t move the
 * following Markdown content, so it lays out these tags like those of inline
 * elements.
 */
async function isBrokenByContent(
	fragment: AST.Fragment,
	html: string,
	options: ParserOptions
): Promise<boolean> {
	let isBroken = brokenByContent.get(fragment.node);

	if (isBroken === undefined) {
		const withContent = await formatProbe(
			fragment,
			html,
			'',
			'x',
			Number.POSITIVE_INFINITY,
			options
		);
		const withoutContent = await formatProbe(
			fragment,
			html,
			'',
			'',
			Number.POSITIVE_INFINITY,
			options
		);

		isBroken =
			findTagLines(withContent) > 1 && findTagLines(withoutContent) === 1;
		brokenByContent.set(fragment.node, isBroken);
	}

	return isBroken;
}

/**
 * Formats an opening tag with the supplied surrounding text, adding a closing
 * tag when needed. Strict whitespace sensitivity keeps text attached as in
 * Markdown, allowing block elements to use an inline layout unless Prettier
 * forces breaks.
 */
async function formatProbe(
	fragment: AST.Fragment,
	html: string,
	before: string,
	after: string,
	printWidth: number,
	options: ParserOptions
): Promise<string> {
	const tagName = OPENING_TAG_PATTERN.exec(html)![1]!;
	const closingTag =
		isVoidTag(tagName) || html.endsWith('/>') ? '' : `</${tagName}>`;

	return formatHTML(
		`${before}${html}${after}${closingTag}`,
		{
			...options,
			htmlFragmentPrintWidth: printWidth,
			htmlFragmentWhitespaceSensitivity: 'strict',
		},
		fragment.node.position?.start
	);
}

/**
 * Counts the lines of the opening tag at the start of formatted HTML.
 */
function findTagLines(formatted: string): number {
	return formatted.slice(0, findTagEnd(formatted, 0)).split('\n').length;
}

/**
 * Keeps a formatted tag’s lines in its paragraph. A bracket whose line would
 * start Markdown structure rejoins the last attribute line. Returns `undefined`
 * if another line would start Markdown structure or, at any indentation, would
 * have the syntax of a table delimiter row, which formatting rejects in a
 * paragraph with raw HTML.
 */
function keepInParagraph(
	tag: string,
	layout: AST.InlineLayout
): string | undefined {
	const lines = tag.split('\n');
	const unsafeLine = lines.findIndex(
		(line, index) =>
			index > 0 &&
			(startsMarkdownStructure(line, layout) ||
				hasDelimiterRowSyntax(line))
	);

	if (unsafeLine === -1) {
		return tag;
	}

	return unsafeLine === lines.length - 1 && lines.at(-1)!.trim() === '>'
		? [...lines.slice(0, -2), `${lines.at(-2)!}>`].join('\n')
		: undefined;
}

/**
 * Checks whether a paragraph’s continuation line would start Markdown
 * structure. The line starts at the paragraph’s content edge, and its
 * indentation counts from the container’s content edge, where four columns or
 * more keep any non-blank line in the paragraph.
 */
function startsMarkdownStructure(
	line: string,
	layout: AST.InlineLayout
): boolean {
	const content = line.trimStart();
	let column = layout.contentEdge;

	for (const character of line.slice(0, line.length - content.length)) {
		column =
			character === '\t'
				? column + TAB_STOP - (column % TAB_STOP)
				: column + 1;
	}

	const tagName = /^<\/?([a-z][a-z0-9-]*)/i.exec(content)?.[1];

	// A blank line would end the paragraph
	return (
		content === '' ||
		(column - layout.containerEdge < 4 &&
			(MARKDOWN_STRUCTURE_PATTERN.test(content) ||
				canInterruptParagraph(content) ||
				(tagName !== undefined && isBlockTag(tagName))))
	);
}

/**
 * Lists the HTML nodes in a node, in document order.
 */
function findHTMLNodes(node: AST.Node): AST.HTMLNode[] {
	return node.type === 'html'
		? [node as AST.HTMLNode]
		: (node.children ?? []).flatMap(findHTMLNodes);
}

/**
 * Formats an opening or closing tag, or a declaration. Returns `undefined` for
 * other HTML tokens, which keep their source text.
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

	// Prettier normalizes whitespace and the `html` name in doctype
	// declarations
	if (/^<![A-Za-z]/.test(html)) {
		return formatHTML(html, options, position);
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
		: /* v8 ignore next -- @preserve */ undefined;
}

/**
 * Returns the element name that formatting prints in an inline opening or
 * closing tag. Prettier normalizes the name without the element’s context, so
 * an SVG element’s name can differ from its spelling in a formatted HTML block.
 */
export async function formatInlineTagName(
	tagName: string,
	isClosingTag: boolean,
	options: ParserOptions,
	position: AST.Point | undefined
): Promise<string> {
	// Inline formatting preserves tags whose names don’t match this pattern
	if (!CLOSING_TAG_PATTERN.test(`</${tagName}>`)) {
		return tagName;
	}

	const singleLineOptions = getSingleLineOptions(options);

	if (isClosingTag) {
		/* v8 ignore next -- @preserve */
		return (
			CLOSING_TAG_PATTERN.exec(
				await formatClosingTag(tagName, singleLineOptions, position)
			)?.[1] ?? tagName
		);
	}

	const formatted = await formatHTML(
		isVoidTag(tagName) ? `<${tagName}>` : `<${tagName}></${tagName}>`,
		singleLineOptions,
		position
	);

	/* v8 ignore next -- @preserve */
	return OPENING_TAG_PATTERN.exec(formatted)?.[1] ?? tagName;
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
 * Adjusts formatting options to keep a tag on one physical line. A line break
 * inside an attribute value still splits the tag, so the bracket stays on the
 * last attribute line, where it can’t start a block quote.
 */
function getSingleLineOptions(options: ParserOptions): ParserOptions {
	return {
		...options,
		bracketSameLine: true,
		htmlFragmentBracketSameLine: true,
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

	const siblings = fragment.parent.children!;
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
		unbreakableBefore.add(fragment.node);
	}
}

/**
 * Keeps a paragraph’s leading tag from standing alone on the paragraph’s first
 * line, where Prettier or the reference renderer would read it as an HTML
 * block. Whitespace after the tag joins the content to the line. If the tag
 * stands alone before a hard line break written as trailing spaces or at the
 * paragraph’s end, formatting reports an error.
 */
function keepLeadingTagInParagraph(
	fragment: AST.Fragment,
	layout: AST.InlineLayout | undefined,
	value: string,
	options: ParserOptions
): void {
	const separator = findSeparatorAfter(fragment.parent, fragment.node);

	if (
		!isLeadingNode(fragment.node, layout) ||
		!isAloneOnLine(value, separator, options)
	) {
		return;
	}

	if (separator?.type === 'whitespace') {
		separator.value = ' ';
		// A `text` node keeps the space from becoming a line break
		separator.type = 'text';

		return;
	}

	reportUnsafeLayout({
		filepath: options.filepath,
		position: fragment.node.position?.start,
		reason: 'Formatting would leave this tag alone on the paragraph’s first line, where Prettier or GitHub Flavored Markdown would read it as an HTML block',
	});
}

/**
 * Checks whether an inline node starts its paragraph’s first line. A task list
 * item’s checkbox comes before its first paragraph on that line. Without a
 * known layout, the paragraph’s line isn’t known either.
 */
function isLeadingNode(
	node: AST.Node,
	layout: AST.InlineLayout | undefined
): boolean {
	return (
		layout !== undefined &&
		layout.paragraph.children?.[0] === node &&
		!isTaskParagraph(layout)
	);
}

/**
 * Checks whether a paragraph is the first child of a task list item.
 */
function isTaskParagraph(layout: AST.InlineLayout): boolean {
	const container = layout.containers.at(-1);

	return (
		container?.type === 'listItem' &&
		typeof (container as { checked?: unknown }).checked === 'boolean' &&
		container.children?.[0] === layout.paragraph
	);
}

/**
 * Returns the index after a task item’s checkbox and following whitespace in
 * its first paragraph’s sliced source. Prettier’s Markdown parser removes the
 * checkbox from the paragraph only when the paragraph starts with text. Returns
 * 0 if the source doesn’t start with the checkbox.
 */
function findCheckboxEnd(
	layout: AST.InlineLayout,
	sliced: MarkdownSource
): number {
	const start = layout.paragraph.children?.[0]?.position?.start.offset;
	const end = start === undefined ? -1 : sliced.offsets.indexOf(start);

	return isTaskParagraph(layout) &&
		end > 0 &&
		/^\[[ Xx]\][\t\n ]+$/.test(sliced.text.slice(0, end))
		? end
		: 0;
}

/**
 * Returns the node immediately after an inline node, using the first child of a
 * following `sentence` node.
 */
function findSeparatorAfter(
	parent: AST.Node,
	node: AST.Node
): AST.Node | undefined {
	const siblings = parent.children!;
	const next = siblings[siblings.indexOf(node) + 1];

	return next?.type === 'sentence' ? next.children?.[0] : next;
}

/**
 * Checks whether a tag with a given value would stand alone on its line as a
 * complete tag, so the line would start an HTML block. A hard line break
 * written as trailing spaces, the paragraph’s end, or whitespace that the
 * Markdown printer can break ends the line after the tag.
 */
function isAloneOnLine(
	value: string,
	separator: AST.Node | undefined,
	options: ParserOptions
): boolean {
	const isLineEnd =
		separator === undefined ||
		(separator.type === 'break' &&
			/^[\t ]/.test(
				options.originalText.charAt(
					separator.position?.start.offset ?? -1
				)
			)) ||
		(separator.type === 'whitespace' &&
			(options.proseWrap === 'always' ||
				(options.proseWrap === 'preserve' &&
					separator.value?.includes('\n') === true)));

	return isLineEnd && !value.includes('\n') && startsHTMLBlock(value);
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
