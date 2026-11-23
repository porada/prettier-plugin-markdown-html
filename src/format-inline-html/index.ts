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
	startsBlockInParagraph,
	startsHTMLBlock,
} from '../is-html-block-sequence/index.ts';
import isVoidTag from '../is-void-tag/index.ts';
import removeHTMLNode from '../remove-html-node/index.ts';
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
	// The layout when the print still reads as one paragraph containing the
	// original HTML
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

// The syntax of a table delimiter row after its indentation: cells of hyphens
// with optional colons, separated by pipes, with optional pipes at both ends
const DELIMITER_ROW_PATTERN =
	/^\|?[\t\v\f ]*:?-+:?[\t\v\f ]*(?:\|[\t\v\f ]*:?-+:?[\t\v\f ]*)*\|?[\t\v\f ]*$/;

// Line starts that interrupt a paragraph or turn its lines into another
// construct: block quotes, ATX headings, fences, list items, thematic breaks,
// setext underlines, and table delimiter rows
const MARKDOWN_STRUCTURE_PATTERN =
	/^(?:>|#{1,6}(?:[\t ]|$)|`{3}|~{3}|[*+-](?:[\t ]|$)|\d{1,9}[).](?:[\t ]|$)|[*_](?:[\t ]*[*_]){2,}[\t ]*$|=+[\t ]*$|[\t :|-]*-[\t :|-]*$)/;

// Maximum rounds of paragraph layout before reporting that the tags’ layouts
// haven’t stabilized
const MAX_LAYOUT_ROUNDS = 8;

// The syntax tree format whose printer updates and removes HTML before printing
const MEASURED_AST_FORMAT = 'markdown-html-measured';

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

// Those separators as they were, so a paragraph can take them back
const unbrokenSeparators = new WeakMap<
	AST.Node,
	{ node: AST.Node; type: string | undefined; value: string | undefined }
>();

/**
 * Formats the inline HTML of one paragraph, heading, or table cell without
 * changing its relationship with the surrounding Markdown. Tags start from
 * their one-line forms. In a paragraph with a known layout, opening tags then
 * take Prettier’s HTML layout at their positions in the formatted lines.
 */
export default async function formatInlineHTML(
	fragments: ReadonlyArray<AST.Fragment>,
	layout: AST.InlineLayout | undefined,
	options: ParserOptions,
	formattedNodes: WeakSet<AST.Node>
): Promise<void> {
	const values = new Map<AST.HTMLNode, string>();

	for (const fragment of fragments) {
		if (!fragment.isSingleLine) {
			keepOffLineStart(fragment, layout, options);
		}
	}

	await releaseParagraphJoins(fragments, layout, options);

	for (const fragment of fragments) {
		const { node } = fragment;
		const formatted = await formatTag(
			fragment,
			node.value,
			getSingleLineOptions(options)
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
			node.value = value;
			formattedNodes.add(node);
		}

		keepLeadingTagInParagraph(fragment, layout, node.value, options);
	}
}

/**
 * Restores ordinary Markdown line breaks before inline HTML when keeping the
 * joins would change how the paragraph parses.
 */
async function releaseParagraphJoins(
	fragments: ReadonlyArray<AST.Fragment>,
	layout: AST.InlineLayout | undefined,
	options: ParserOptions
): Promise<void> {
	const joined = fragments
		.map(({ node }) => node)
		.filter((node) => unbrokenSeparators.has(node));

	if (
		layout !== undefined &&
		joined.length > 0 &&
		!(await printsAsOneParagraph(layout, options))
	) {
		releaseUnbroken(joined);
	}
}

/**
 * Checks whether inline joins preserve the paragraph. An inconclusive trial
 * counts as a match so the caller keeps the joins.
 */
async function printsAsOneParagraph(
	layout: AST.InlineLayout,
	options: ParserOptions
): Promise<boolean> {
	const literals = findParagraphLiterals(layout.paragraph);
	const values = literals.filter(isHTMLNode).map(({ value }) => value);
	const paragraph = buildParagraphText(
		layout,
		literals,
		new Map(),
		options,
		true
	);
	const printed =
		paragraph &&
		(await printParagraph(paragraph.text, values, layout, options));

	if (!printed) {
		return true;
	}

	// The placeholder for each join prints as a space
	const root = (await pluginMarkdown.parsers.markdown.parse(
		printed.formatted.replaceAll(paragraph.unbreakableSpace, ' '),
		{} as ParserOptions
	)) as AST.Node;

	return isParagraph(root, values.length);
}

/**
 * Lays out opening tags at their printed positions and keeps them on one line
 * when wrapping would change the Markdown. Reports an unsafe paragraph layout.
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

			// Later rounds lay out one tag at a time to find any layout that
			// starts Markdown structure
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
			position: changedTag.node.position?.start,
			reason: 'Formatting couldn’t find a stable layout for this paragraph’s HTML tags.',
		});
	}

	if (printed.changesReading) {
		reportUnsafeLayout({
			position: layout.paragraph.position?.start,
			reason: 'The formatted text wouldn’t read as a single Markdown paragraph with inline HTML. Check for a tag or Markdown block marker at the start of a line.',
		});
	}
}

/**
 * Keeps a whitespace separator from breaking its line.
 */
function keepUnbroken(separator: AST.Node, before: AST.Node): void {
	unbrokenSeparators.set(before, {
		node: separator,
		type: separator.type,
		value: separator.value,
	});
	unbreakableBefore.add(before);
	separator.value = ' ';
	// Prettier’s Markdown printer may render a `whitespace` node as a line
	// break, but never a `text` node
	separator.type = 'text';
}

/**
 * Restores the separators kept unbroken before some inline HTML, so the HTML
 * takes plain Prettier’s line breaks again.
 */
function releaseUnbroken(nodes: ReadonlyArray<AST.Node>): void {
	for (const node of nodes) {
		const separator = unbrokenSeparators.get(node)!;

		separator.node.type = separator.type;
		separator.node.value = separator.value;
		unbrokenSeparators.delete(node);
		unbreakableBefore.delete(node);
	}
}

/**
 * Measures inline HTML positions in the printed paragraph. The `measurement`
 * field is `undefined` unless the result parses as one paragraph with the
 * original number of HTML nodes.
 */
async function measureParagraph(
	layout: AST.InlineLayout,
	values: ReadonlyMap<AST.HTMLNode, string>,
	options: ParserOptions
): Promise<PrintedParagraph> {
	const literals = findParagraphLiterals(layout.paragraph);
	const htmlNodes = literals.filter(isHTMLNode);
	const removedNodes = layout.removedNodes ?? [];
	const removedSet = new Set<AST.Node>(removedNodes);
	const allLiterals =
		removedNodes.length > 0
			? [...literals, ...removedNodes].toSorted(
					(a, b) =>
						/* v8 ignore start -- @preserve */
						(a.position?.start.offset ?? 0) -
						(b.position?.start.offset ?? 0)
					/* v8 ignore stop -- @preserve */
				)
			: literals;
	const allHTMLNodes = allLiterals.filter(isHTMLNode);
	const paragraph = buildParagraphText(layout, allLiterals, values, options);

	if (paragraph === undefined) {
		return { changesReading: false, measurement: undefined };
	}

	const { text, unbreakableSpace } = paragraph;

	const printedValues = allHTMLNodes.map((node) =>
		removedSet.has(node) ? undefined : (values.get(node) ?? node.value)
	);
	const joinedNode =
		removedNodes.length > 0
			? findJoinedLeadingNode(layout, values, options)
			: undefined;
	const locks =
		removedNodes.length > 0
			? {
					joinedIndex: joinedNode
						? htmlNodes.indexOf(joinedNode)
						: -1,
					unbreakableIndexes: new Set(
						htmlNodes.flatMap((node, index) =>
							unbreakableBefore.has(node) ? [index] : []
						)
					),
					unbreakableSpace,
				}
			: undefined;
	const areLaterLinesIndented =
		layout.contentEdge - layout.containerEdge >= 4;
	let isComparable = false;

	for (const prefix of MEASUREMENT_PREFIXES) {
		const printed = await printParagraph(
			`${prefix}${text}`,
			printedValues,
			layout,
			options,
			locks
		);

		if (!printed) {
			continue;
		}

		const { formatted, root } = printed;

		isComparable = true;

		// After a checkbox and on later lines four columns past the container’s
		// content edge, HTML starts no block
		if (
			isParagraph(root, htmlNodes.length) &&
			(areLaterLinesIndented ||
				!hasInterruptingLine(formatted.slice(prefix.length)))
		) {
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

type SeparatorLocks = {
	joinedIndex: number;
	unbreakableIndexes: ReadonlySet<number>;
	unbreakableSpace: string;
};

/**
 * Prints and reparses the paragraph at its available width. Returns `undefined`
 * if its prepared HTML nodes cannot be paired with the supplied values.
 */
async function printParagraph(
	markdown: string,
	printedValues: ReadonlyArray<string | undefined>,
	layout: AST.InlineLayout,
	options: ParserOptions,
	locks?: SeparatorLocks
): Promise<{ formatted: string; root: AST.Node } | undefined> {
	let isPrintedWithValues = false;
	const { mdast } = pluginMarkdown.printers;

	const formatted = await format(markdown, {
		endOfLine: 'lf',
		parser: 'markdown',
		plugins: [
			pluginMarkdown,
			{
				parsers: {
					markdown: {
						...pluginMarkdown.parsers.markdown,
						astFormat: MEASURED_AST_FORMAT,
					},
				},
				printers: {
					[MEASURED_AST_FORMAT]: {
						...mdast,
						async preprocess(ast, printOptions) {
							const prepared = (await mdast.preprocess!(
								ast,
								printOptions
							)) as AST.Node;
							const nodes = findHTMLNodes(prepared);

							isPrintedWithValues =
								nodes.length === printedValues.length;

							if (isPrintedWithValues) {
								if (printedValues.includes(undefined)) {
									applyParagraphHTMLValues(
										prepared,
										new Map(
											nodes.map((node, index) => [
												node,
												printedValues[index],
											])
										)
									);
								} else {
									for (const [
										index,
										node,
									] of nodes.entries()) {
										node.value = printedValues[index]!;
									}
								}

								if (locks) {
									applySeparatorLocks(prepared, locks);
								}
							}

							return prepared;
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

	// Restore the paragraph’s continuation indent before reparsing. In a task
	// item it keeps a list marker after a hard break inside the paragraph.
	const indent = layout.contentEdge - layout.containerEdge;
	const text = indent
		? formatted.replaceAll('\n', `\n${' '.repeat(indent)}`)
		: formatted;
	const root = (await pluginMarkdown.parsers.markdown.parse(
		text,
		{} as ParserOptions
	)) as AST.Node;

	return { formatted: text, root };
}

/**
 * Replaces or removes HTML nodes in a prepared paragraph tree, matching how
 * `applyClosingTagCorrections` updates the document tree.
 */
function applyParagraphHTMLValues(
	node: AST.Node,
	replacements: ReadonlyMap<AST.HTMLNode, string | undefined>
): void {
	for (const child of (node.children ?? []).toReversed()) {
		if (isHTMLNode(child) && replacements.has(child)) {
			const value = replacements.get(child);

			if (value === undefined) {
				removeHTMLNode(child, node);
			} else {
				child.value = value;
			}
		} else {
			applyParagraphHTMLValues(child, replacements);
		}
	}
}

/**
 * Keeps selected spaces around surviving inline HTML on the same line.
 */
function applySeparatorLocks(root: AST.Node, locks: SeparatorLocks): void {
	const paragraph = root.children![0]!;
	const surviving = findHTMLNodes(paragraph);

	if (locks.joinedIndex >= 0) {
		const joined = surviving[locks.joinedIndex];
		const separator =
			joined &&
			paragraph.children?.[0] === joined &&
			findSeparatorAfter(paragraph, joined);

		/* v8 ignore else -- @preserve */
		if (separator && separator.type === 'whitespace') {
			separator.value = locks.unbreakableSpace;
			separator.type = 'text';
		}
	}

	if (locks.unbreakableIndexes.size === 0) {
		return;
	}

	const targets = new Set(
		[...locks.unbreakableIndexes]
			.map((index) => surviving[index])
			.filter((node): node is AST.HTMLNode => node !== undefined)
	);

	const lockBefore = (node: AST.Node): void => {
		const children = node.children ?? [];

		for (const [index, child] of children.entries()) {
			if (isHTMLNode(child) && targets.has(child)) {
				const previous = children[index - 1];
				const separator = previous && getLastDescendant(previous);

				/* v8 ignore else -- @preserve */
				if (separator?.type === 'whitespace') {
					separator.value = locks.unbreakableSpace;
					separator.type = 'text';
				}
			} else {
				lockBefore(child);
			}
		}
	};

	lockBefore(paragraph);
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
 * Checks for printed lines that interrupt a GFM paragraph with an HTML block.
 */
function hasInterruptingLine(formatted: string): boolean {
	return formatted.split('\n').some((line) => canInterruptParagraph(line));
}

/**
 * Finds the tag’s printed column and builds stand-in text for what follows.
 * Without a measurement, only a leading tag at a line break, whitespace, or the
 * end of the paragraph can be located.
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

	// The reparse includes the continuation indentation relative to the
	// container. The HTML formatter measures from the paragraph’s content edge.
	const column =
		measureWidth(formatted.slice(lineStart, start), options) -
		(lineStart === 0
			? prefixWidth
			: layout.contentEdge - layout.containerEdge);

	return {
		column: layout.paragraph.children?.[0] === fragment.node ? 0 : column,
		following,
	};
}

/**
 * Finds the text and HTML attached to a tag before the next break. Describes
 * what follows so the caller can distinguish more content, a space before the
 * closing tag, and the end of the content.
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
 * Measures the printed width of text, counting each tab as `tabWidth` spaces.
 */
function measureWidth(text: string, options: ParserOptions): number {
	return util.getStringWidth(
		text.replaceAll('\t', ' '.repeat(options.tabWidth))
	);
}

/**
 * Builds Markdown for measuring a paragraph outside its container. Preserves
 * the breaks inside HTML and code and marks spaces that must stay together.
 */
function buildParagraphText(
	layout: AST.InlineLayout,
	literals: ReadonlyArray<AST.Node>,
	values: ReadonlyMap<AST.HTMLNode, string>,
	options: ParserOptions,
	isRejected = false
): { text: string; unbreakableSpace: string } | undefined {
	const sliced = sliceMarkdownSource(
		options.originalText,
		layout.paragraph,
		layout.containers
	);
	const hasRemovals = !isRejected && (layout.removedNodes?.length ?? 0) > 0;
	const joinedNode = hasRemovals
		? undefined
		: findJoinedLeadingNode(layout, values, options);

	if (!sliced) {
		return undefined;
	}

	// Represent spaces the Markdown printer must keep with a private use
	// character absent from the paragraph. The HTML printer can wrap the spaces
	// restored in the output
	const contents = [sliced.text, ...values.values()].join('');
	let codePoint = '\uE000'.codePointAt(0)!;

	while (contents.includes(String.fromCodePoint(codePoint))) {
		codePoint += 1;
	}

	const unbreakableSpace = String.fromCodePoint(codePoint);

	let text = '';
	let offset = findCheckboxEnd(layout, sliced, literals);
	let previous: AST.Node | undefined;

	for (const node of [...literals, undefined]) {
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

		if (!hasRemovals && node && unbreakableBefore.has(node)) {
			between = between.replace(/[\t\n ]+$/, unbreakableSpace);
		}

		if (options.proseWrap !== 'preserve') {
			between = joinSoftLineBreaks(between);
		}

		// A later line of prose in a task item can start with a list marker
		// without leaving this paragraph. Keep that context in its first parse.
		if (layout.contentEdge - layout.containerEdge >= 4) {
			between = between.replaceAll(/\n(?! {4})/g, '\n    ');
		}

		text += between + sliced.text.slice(start, end);

		offset = end;
		previous = node;
	}

	// A lazy continuation line of equals signs stays paragraph text in GFM, but
	// would underline a heading without the paragraph’s container. Prettier
	// escapes such a line when it prints the paragraph, except after a hard
	// line break
	return {
		text: text
			.replace(/^[\t ]+/, '')
			.replaceAll(
				/(?<!(?: {2}|(?:^|[^\\])(?:\\\\)*\\)\n {0,3})(?<=\n {0,3})(?==+[\t ]*(?:\n|$))/g,
				'\\'
			),
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
 * Finds a leading HTML tag that would stand alone and needs the following
 * whitespace to keep it inline.
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
 * Formats an opening tag from its one-line form at its position on the printed
 * line, then adjusts line breaks that would start Markdown structure. Returns
 * `undefined` if Prettier moves the tag from that position, or if another line
 * would start Markdown structure.
 */
async function formatTagAt(
	fragment: AST.Fragment,
	html: string,
	position: TagPosition,
	layout: AST.InlineLayout,
	options: ParserOptions
): Promise<string | undefined> {
	const tagName = OPENING_TAG_PATTERN.exec(html)![1]!;

	// An unknown tag name of the same length gives the probe inline layout
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
	const end = formatted?.startsWith(`${prefix}<`)
		? findTagEnd(formatted, prefix.length)
		: /* v8 ignore next -- @preserve */ undefined;
	const tag =
		end === undefined
			? /* v8 ignore next -- @preserve */ undefined
			: keepInParagraph(formatted!.slice(prefix.length, end), layout);

	return tag?.replace(`<${probeName}`, `<${tagName}`);
}

/**
 * Checks whether Prettier breaks an opening tag at any width with content but
 * not without it, as it does for lists and `select`. The plugin can’t move the
 * following Markdown content, so these tags use inline layout.
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
			withContent !== undefined &&
			withoutContent !== undefined &&
			findTagLines(withContent) > 1 &&
			findTagLines(withoutContent) === 1;
		brokenByContent.set(fragment.node, isBroken);
	}

	return isBroken;
}

/**
 * Formats an opening tag with the supplied text and width. Strict whitespace
 * sensitivity keeps the surrounding text attached to the tag.
 */
async function formatProbe(
	fragment: AST.Fragment,
	html: string,
	before: string,
	after: string,
	printWidth: number,
	options: ParserOptions
): Promise<string | undefined> {
	const tagName = OPENING_TAG_PATTERN.exec(html)![1]!;
	const probeOptions = {
		...options,
		htmlFragmentPrintWidth: printWidth,
		htmlFragmentWhitespaceSensitivity: 'strict',
	};

	const closingTag =
		isVoidTag(tagName) || html.endsWith('/>') ? '' : `</${tagName}>`;

	return formatHTML(
		`${before}${html}${after}${closingTag}`,
		probeOptions,
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
 * have the syntax of a table delimiter row, which cannot be formatted alongside
 * raw HTML in the same paragraph.
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
				DELIMITER_ROW_PATTERN.test(line.replace(/^[\t ]+/, '')))
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
 * Lists the spans whose line breaks belong to HTML or code instead of prose.
 */
function findParagraphLiterals(node: AST.Node): AST.Node[] {
	return node.type === 'html' || node.type === 'inlineCode'
		? [node]
		: (node.children ?? []).flatMap(findParagraphLiterals);
}

/**
 * Lists the HTML nodes in a paragraph tree in source order.
 */
function findHTMLNodes(root: AST.Node): AST.HTMLNode[] {
	return findParagraphLiterals(root).filter(isHTMLNode);
}

/**
 * Checks whether a Markdown node has the `html` type.
 */
function isHTMLNode(node: AST.Node): node is AST.HTMLNode {
	return node.type === 'html';
}

/**
 * Formats an opening or closing tag. Returns `undefined` for other HTML tokens,
 * which keep their source text.
 */
async function formatTag(
	fragment: AST.Fragment,
	html: string,
	options: ParserOptions
): Promise<string | undefined> {
	const position = fragment.node.position?.start;
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
		: /* v8 ignore next -- @preserve */ undefined;
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
	layout: AST.InlineLayout | undefined,
	options: ParserOptions
): void {
	// Continuation lines indented four columns or more past the container’s
	// content edge, as after a task item’s checkbox, stay in the paragraph in
	// both Prettier and the reference renderer
	if (
		layout !== undefined &&
		layout.contentEdge - layout.containerEdge >= 4
	) {
		return;
	}

	if (!startsBlockInParagraph(fragment.node.value)) {
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
			(options.originalText ?? '').slice(separatorEnd, start)
		);

	// A hard line break has to stay, and Prettier prints the next line without
	// the indentation that keeps the HTML inline
	if (separatorNode?.type === 'break' && isAdjacent) {
		reportUnsafeLayout({
			position: fragment.node.position?.start,
			reason: 'Formatting would put this HTML at the start of a line after the hard line break, where Prettier or GitHub Flavored Markdown would read it as an HTML block.',
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
		keepUnbroken(separatorNode, fragment.node);
	}
}

/**
 * Keeps a leading tag inline when it would otherwise start an HTML block, or
 * reports a layout error if the tag cannot join the content after it.
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
		position: fragment.node.position?.start,
		reason: 'Formatting would leave this tag alone on the paragraph’s first line, where Prettier or GitHub Flavored Markdown would read it as an HTML block.',
	});
}

/**
 * Checks whether an inline node starts its paragraph’s first line. A task list
 * item’s checkbox comes before its first paragraph on that line. The
 * paragraph’s line is unknown until its layout is known.
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
function isTaskParagraph(
	layout: Pick<AST.InlineLayout, 'containers' | 'paragraph'>
): boolean {
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
	sliced: MarkdownSource,
	literals: ReadonlyArray<AST.Node>
): number {
	const childStart = layout.paragraph.children?.[0]?.position?.start.offset;
	const literalStart = literals[0]?.position?.start.offset;
	const start =
		childStart !== undefined && literalStart !== undefined
			? Math.min(childStart, literalStart)
			: (childStart ?? literalStart);
	const end =
		start === undefined
			? /* v8 ignore next -- @preserve */ -1
			: sliced.offsets.indexOf(start);

	return isTaskParagraph(layout) &&
		end > 0 &&
		/^\[[ Xx]\][\t\n ]+$/.test(sliced.text.slice(0, end))
		? end
		: 0;
}

/**
 * Returns the next inline node, looking inside a following `sentence` node.
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
 * Checks whether a tag with a given value would appear complete and alone on
 * its line, starting an HTML block. A hard line break written as trailing
 * spaces, the paragraph’s end, or whitespace that the Markdown printer can
 * break ends the line after the tag.
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
 * Returns the last leaf below a node, or the node itself if it is a leaf.
 */
function getLastDescendant(node: AST.Node): AST.Node {
	let descendant = node;

	while (descendant.children?.length) {
		descendant = descendant.children.at(-1)!;
	}

	return descendant;
}
