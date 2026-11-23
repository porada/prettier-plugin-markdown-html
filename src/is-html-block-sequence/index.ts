import isBlockTag from '../is-block-tag/index.ts';

type HTMLBlockStart = {
	// The end condition of a block that continues across blank lines
	end?: RegExp;
	interruptsParagraph: boolean;
};

const HTML_ATTRIBUTE_PATTERN = String.raw`[\t ]+[a-z_:][\w.:-]*(?:[\t ]*=[\t ]*(?:[^\t "'<=>\x60]+|'[^']*'|"[^"]*"))?`;

const HTML_COMPLETE_TAG_LINE_PATTERN = new RegExp(
	String.raw`^(?:<[a-z][a-z0-9-]*(?:${HTML_ATTRIBUTE_PATTERN})*[\t ]*\/?>|<\/[a-z][a-z0-9-]*[\t ]*>)[\t ]*$`,
	'i'
);

// Tags that Prettier and the reference renderer classify differently at block
// starts unless the complete tag is alone on its line
const HTML_DISPUTED_BLOCK_TAG_NAMES = new Set([
	'hgroup',
	'meta',
	'search',
	'source',
]);

// A closing tag at the start of HTML
const HTML_CLOSING_TAG_PATTERN = /^<\/([a-z][a-z0-9-]*)\s*>/i;

// A declaration, such as a doctype in any letter case
const HTML_DECLARATION_PATTERN = /^<![A-Za-z]/;

// An opening tag’s name at the start of HTML
const HTML_OPENING_TAG_PATTERN = /^<([a-z][a-z0-9-]*)(?=[\t\n\f\r />])/i;

// The reference renderer treats these tags as block tags, unlike Prettier’s
// Markdown parser
const HTML_REFERENCE_ONLY_BLOCK_TAG_NAMES = new Set(['source']);

// Opening tags of these elements start blocks that continue across blank lines,
// including `<pre />`. Closing tags and forms such as `<pre/>` need a complete
// tag on its own line
const HTML_RAW_BLOCK_START_PATTERN =
	/^<(?:pre|script|style|textarea)(?=[\t\n\f\r >]|$)/i;

const HTML_RAW_BLOCK_TAG_NAMES = new Set([
	'pre',
	'script',
	'style',
	'textarea',
]);

const HTML_TAG_NAME_PATTERN = /^<\/?([a-z][a-z0-9-]*)(?=[\t\n\f\r >]|\/>|$)/i;

// Start conditions of blocks that continue across blank lines until their end
// condition: raw text elements, comments, processing instructions, CDATA
// sections, and declarations. The reference renderer starts a declaration only
// with an uppercase letter after `<!`
const HTML_CONTINUING_BLOCK_CONDITIONS: ReadonlyArray<{
	end: RegExp;
	start: RegExp;
}> = [
	{
		end: /<\/(?:pre|script|style|textarea)>/i,
		start: HTML_RAW_BLOCK_START_PATTERN,
	},
	{ end: /-->/, start: /^<!--/ },
	{ end: /\?>/, start: /^<\?/ },
	{ end: /\]\]>/, start: /^<!\[CDATA\[/ },
	{ end: />/, start: /^<![A-Z]/ },
];

/**
 * Checks conservatively whether text consists of HTML blocks and blank lines
 * under both the reference renderer and Prettier’s Markdown parser. A block
 * that continues across blank lines may stay open at the end only if the source
 * HTML leaves a block with the same end condition open.
 */
export default function isHTMLBlockSequence(
	text: string,
	sourceHTML = ''
): boolean {
	const reading = readHTMLBlocks(text);
	const sourceReading = readHTMLBlocks(sourceHTML);

	// A block left open takes in the Markdown after it, which is safe only if
	// the source already does the same
	return (
		reading.nonBlockLine === undefined &&
		(reading.openEnd === undefined ||
			(sourceReading.nonBlockLine === undefined &&
				reading.openEnd === sourceReading.openEnd))
	);
}

/**
 * Checks whether a line can interrupt a paragraph with an HTML block in the
 * reference renderer.
 */
export function canInterruptParagraph(line: string): boolean {
	return readHTMLBlockStart(line, false)?.interruptsParagraph === true;
}

/**
 * Checks whether HTML at the start of a line interrupts a paragraph under
 * either GitHub Flavored Markdown or Prettier’s Markdown parser.
 */
export function startsBlockInParagraph(html: string): boolean {
	const openingName = HTML_OPENING_TAG_PATTERN.exec(html)?.[1];
	const closingName = HTML_CLOSING_TAG_PATTERN.exec(html)?.[1];

	return (
		canInterruptParagraph(html) ||
		HTML_DECLARATION_PATTERN.test(html) ||
		(openingName !== undefined && isBlockTag(openingName)) ||
		(closingName !== undefined && isBlockTag(closingName, true))
	);
}

/**
 * Checks for an HTML block start outside a paragraph, using the reference
 * renderer’s rules and Prettier’s additional block tags.
 */
export function startsHTMLBlock(line: string): boolean {
	// Only spaces and tabs indent a line
	const tagName = HTML_TAG_NAME_PATTERN.exec(
		line.replace(/^[\t ]+/, '')
	)?.[1];

	return (
		readHTMLBlockStart(line, false) !== undefined ||
		(tagName !== undefined && isBlockTag(tagName))
	);
}

/**
 * Checks whether a block’s first tag needs a complete tag on its own line to
 * start an HTML block under both parsers.
 */
export function needsCompleteTagLine(html: string): boolean {
	// Only spaces and tabs indent a line
	const content = html.replace(/^[\t ]+/, '');
	const tagName = HTML_TAG_NAME_PATTERN.exec(content)?.[1]?.toLowerCase();

	if (!tagName) {
		return false;
	}

	return !(
		HTML_RAW_BLOCK_START_PATTERN.test(content) || isSharedBlockTag(tagName)
	);
}

/**
 * Finds the first non-blank line that neither continues an HTML block nor
 * starts one, reading as `isHTMLBlockSequence` does. Returns `undefined` if
 * every line reads as part of an HTML block or as a blank line.
 */
export function findNonBlockLine(text: string): number | undefined {
	return readHTMLBlocks(text).nonBlockLine;
}

/**
 * Checks whether text ends inside an HTML block that continues until a blank
 * line, which would take in a line of Markdown right after it.
 */
export function endsInContinuingBlock(text: string): boolean {
	return readHTMLBlocks(text).isInBlock;
}

/**
 * Checks how far an open HTML block extends into the HTML that follows. Returns
 * `continues` if there is no blank line, `splits` if the first blank line
 * interrupts another HTML block, or `ends` otherwise.
 */
export function readTakenInHTML(html: string): 'continues' | 'ends' | 'splits' {
	const lines = html.split('\n');
	const blankLine = lines.findIndex((line) => /^[\t ]*$/.test(line));

	if (blankLine === -1) {
		return 'continues';
	}

	return readHTMLBlocks(lines.slice(0, blankLine).join('\n')).openEnd
		? 'splits'
		: 'ends';
}

/**
 * Lists the zero-based indices of lines that start HTML blocks, reading as
 * `isHTMLBlockSequence` does. Stops at the first non-blank line that neither
 * starts nor continues an HTML block.
 */
export function findBlockStartLines(text: string): number[] {
	return readHTMLBlocks(text).blockStartLines;
}

/**
 * Reads text as HTML blocks and blank lines, noting the first line that doesn’t
 * read that way.
 */
function readHTMLBlocks(text: string): {
	blockStartLines: number[];
	isInBlock: boolean;
	nonBlockLine: number | undefined;
	openEnd: RegExp | undefined;
} {
	const blockStartLines: number[] = [];
	let isInBlock = false;
	let openEnd: RegExp | undefined;

	for (const [index, line] of text.split('\n').entries()) {
		if (openEnd) {
			if (openEnd.test(line)) {
				openEnd = undefined;
			}
			continue;
		}

		if (/^[\t ]*$/.test(line)) {
			isInBlock = false;
			continue;
		}

		if (isInBlock) {
			continue;
		}

		const start = readHTMLBlockStart(line, true);

		if (!start) {
			return { blockStartLines, isInBlock, nonBlockLine: index, openEnd };
		}

		blockStartLines.push(index);

		if (start.end && !start.end.test(line)) {
			openEnd = start.end;
			continue;
		}

		isInBlock = !start.end;
	}

	return { blockStartLines, isInBlock, nonBlockLine: undefined, openEnd };
}

/**
 * Reads the HTML block that a line starts. A line indented four columns or more
 * starts indented code instead. When both parsers must agree, a tag that only
 * one of them reads as a block tag needs a complete tag line.
 */
function readHTMLBlockStart(
	line: string,
	isSharedReading: boolean
): HTMLBlockStart | undefined {
	const content = line.replace(/^ {0,3}/, '');

	if (/^[\t ]/.test(content)) {
		return undefined;
	}

	const condition = HTML_CONTINUING_BLOCK_CONDITIONS.find(({ start }) =>
		start.test(content)
	);

	if (condition) {
		return { end: condition.end, interruptsParagraph: true };
	}

	const tagName = HTML_TAG_NAME_PATTERN.exec(content)?.[1]?.toLowerCase();

	if (
		tagName &&
		(isSharedReading
			? isSharedBlockTag(tagName)
			: isReferenceBlockTag(tagName))
	) {
		return { interruptsParagraph: true };
	}

	return HTML_COMPLETE_TAG_LINE_PATTERN.test(content)
		? { interruptsParagraph: false }
		: undefined;
}

/**
 * Checks whether the reference renderer starts an HTML block with a tag
 * regardless of what follows it on its line.
 */
function isReferenceBlockTag(tagName: string): boolean {
	return (
		HTML_REFERENCE_ONLY_BLOCK_TAG_NAMES.has(tagName) ||
		(isBlockTag(tagName) &&
			!HTML_RAW_BLOCK_TAG_NAMES.has(tagName) &&
			!HTML_DISPUTED_BLOCK_TAG_NAMES.has(tagName))
	);
}

/**
 * Checks whether both parsers start an HTML block with a tag regardless of what
 * follows it on its line.
 */
function isSharedBlockTag(tagName: string): boolean {
	return (
		isReferenceBlockTag(tagName) &&
		!HTML_DISPUTED_BLOCK_TAG_NAMES.has(tagName)
	);
}
