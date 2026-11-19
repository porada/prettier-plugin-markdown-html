import type { AST } from '../types/index.d.ts';
import findTagEnd from '../find-tag-end/index.ts';
import isRawTextTag from '../is-raw-text-tag/index.ts';
import isVoidTag from '../is-void-tag/index.ts';
import {
	describeGeneratedElement,
	withArticle,
} from '../report-error/index.ts';

type Diagnosis = {
	offset: number;
	reason: string;
};

type HTMLToken = {
	description: string;
	end: number | undefined;
	// Where the token’s opening delimiter or tag begins
	opening: number;
	start: number;
};

type Tag = {
	end: number;
	isClosing: boolean;
	name: string;
	start: number;
};

// Start and end delimiters of tokens that Prettier’s parser doesn’t read as
// tags. Prettier ends processing instructions and declarations at the first `>`
const TOKEN_DELIMITERS: ReadonlyArray<
	readonly [start: string, end: string, description: string]
> = [
	['<!--', '-->', 'comment'],
	['<![CDATA[', ']]>', 'CDATA section'],
	['<?', '>', 'processing instruction'],
	['<!', '>', 'declaration'],
];

// Opening tags that close an open paragraph in Prettier’s HTML parser
const PARAGRAPH_CLOSING_TAG_NAMES = new Set([
	'address',
	'article',
	'aside',
	'blockquote',
	'div',
	'dl',
	'fieldset',
	'footer',
	'form',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'header',
	'hgroup',
	'hr',
	'main',
	'nav',
	'ol',
	'p',
	'pre',
	'section',
	'table',
	'ul',
]);

/**
 * Explains why Prettier’s HTML parser rejects a document context in terms of
 * the Markdown source. Returns `undefined` when Prettier’s own message is the
 * clearest explanation.
 */
export default function diagnoseInvalidHTML(
	context: AST.DocumentContext,
	errorOffset: number | undefined
): Diagnosis | undefined {
	const tokens = scanTokens(context.html);
	const unclosedToken = tokens.find(({ end }) => end === undefined);

	if (
		unclosedToken &&
		(errorOffset === undefined || errorOffset >= context.html.length)
	) {
		let reason = `This ${unclosedToken.description} isn’t closed before the end of the document`;

		if (
			unclosedToken.description === 'comment' &&
			context.html.includes('--&gt;', unclosedToken.start)
		) {
			reason +=
				'. A `-->` in Markdown text doesn’t close it, because Markdown escapes the `>`';
		} else if (
			unclosedToken.description.endsWith(' tag') &&
			context.html.includes('&quot;', unclosedToken.start)
		) {
			reason +=
				'. A double quotation mark in Markdown text becomes `&quot;`, so it doesn’t end the attribute value';
		}

		return { offset: unclosedToken.opening, reason };
	}

	const splitConstruct = findSplitConstruct(context, tokens);

	if (splitConstruct) {
		return splitConstruct;
	}

	if (errorOffset === undefined) {
		return undefined;
	}

	const generated = context.generatedElements.find(
		({ closeStart }) => closeStart === errorOffset
	);

	return generated
		? diagnoseClosedConstruct(context, generated)
		: diagnoseClosingTag(context, errorOffset);
}

/**
 * Explains an unexpected raw closing tag: either a different element is still
 * open, or Markdown content closed the element implicitly.
 */
function diagnoseClosingTag(
	context: AST.DocumentContext,
	offset: number
): Diagnosis | undefined {
	const closingTag = /^<\/([a-z][a-z0-9-]*)/i.exec(
		context.html.slice(offset)
	)?.[1];

	if (!closingTag) {
		return undefined;
	}

	const name = closingTag.toLowerCase();
	const openTags = readOpenTags(scanTags(context.html, 0, offset));
	const opener = openTags.findLast((tag) => tag.name === name);
	const closingParagraph =
		name === 'p' && opener
			? context.generatedElements.find(
					({ openStart, tagName }) =>
						openStart > opener.start &&
						openStart < offset &&
						PARAGRAPH_CLOSING_TAG_NAMES.has(tagName)
				)
			: undefined;

	if (closingParagraph) {
		return {
			offset: closingParagraph.openStart,
			reason: `The HTML generated for this ${describeGeneratedElement(closingParagraph.tagName)} can’t be inside a \`<p>\` element, so it closes that element before its \`</p>\` tag`,
		};
	}

	// The closing tag is inside an element generated from Markdown, so it can’t
	// close the surrounding raw HTML element
	const construct = opener
		? context.generatedElements
				.filter(
					({ closeStart, openStart }) =>
						opener.start < openStart &&
						openStart < offset &&
						offset < closeStart
				)
				.toSorted((first, second) => second.openStart - first.openStart)
				.at(0)
		: undefined;

	if (construct) {
		return {
			offset,
			reason: `This \`</${name}>\` tag is inside ${withArticle(describeGeneratedElement(construct.tagName))}, so it can’t close the \`<${name}>\` element outside it`,
		};
	}

	const openTag = openTags.at(-1);

	if (!openTag || openTag.name === name || !isRawTag(context, openTag)) {
		return undefined;
	}

	return {
		offset,
		reason: `This \`</${name}>\` tag doesn’t match the \`<${openTag.name}>\` element that is still open`,
	};
}

/**
 * Checks whether a tag comes from a raw HTML fragment.
 */
function isRawTag(context: AST.DocumentContext, tag: Tag): boolean {
	return context.fragments.some(
		({ end, start }) => start <= tag.start && tag.start < end
	);
}

/**
 * Checks whether a tag starts a paragraph and more content follows it on its
 * line, which keeps that line from starting an HTML block.
 */
function startsParagraphLine(
	html: string,
	paragraph: AST.GeneratedElement,
	tag: Tag
): boolean {
	return (
		paragraph.tagName === 'p' &&
		tag.start === paragraph.openEnd &&
		/^[^\n]*\S/.test(html.slice(tag.end, paragraph.closeStart))
	);
}

/**
 * Finds the first closing tag without an opening tag earlier in the same
 * sequence.
 */
function findStrayClosingTag(tags: Tag[]): Tag | undefined {
	const openTags: Tag[] = [];

	for (const tag of tags) {
		if (!tag.isClosing) {
			openTags.push(tag);
			continue;
		}

		const index = openTags.findLastIndex(({ name }) => name === tag.name);

		if (index === -1) {
			return tag;
		}

		openTags.length = index;
	}

	return undefined;
}

/**
 * Lists the elements that remain open after a sequence of tags, matching each
 * closing tag with the most recent opening tag of the same name.
 */
function readOpenTags(tags: Tag[]): Tag[] {
	const openTags: Tag[] = [];

	for (const tag of tags) {
		if (!tag.isClosing) {
			openTags.push(tag);
			continue;
		}

		const index = openTags.findLastIndex(({ name }) => name === tag.name);

		if (index !== -1) {
			openTags.length = index;
		}
	}

	return openTags;
}

/**
 * Finds a Markdown construct with one generated boundary inside an opaque HTML
 * token and the other outside that token.
 */
function findSplitConstruct(
	context: AST.DocumentContext,
	tokens: HTMLToken[]
): Diagnosis | undefined {
	for (const generated of context.generatedElements) {
		const openToken = findToken(tokens, generated.openStart);
		const closeToken = findToken(tokens, generated.closeStart);

		if (openToken !== closeToken) {
			return {
				offset: (openToken ?? closeToken)!.opening,
				reason: describeSplitConstruct(
					describeGeneratedElement(generated.tagName),
					openToken,
					closeToken
				),
			};
		}
	}

	return undefined;
}

/**
 * Explains how HTML tokens split a construct generated from Markdown.
 */
export function describeSplitConstruct(
	construct: string,
	openToken: { description: string } | undefined,
	closeToken: { description: string } | undefined
): string {
	if (openToken && closeToken) {
		return `This ${construct} starts inside one HTML token (${openToken.description}) and ends inside another (${closeToken.description})`;
	}

	if (openToken) {
		return `This ${openToken.description} contains the start of the ${construct} but not its end`;
	}

	return `This ${closeToken!.description} starts inside the ${construct} and continues past its end`;
}

/**
 * Explains why the closing tag of a construct generated from Markdown is
 * unexpected: raw HTML inside it either stays open or closes it early.
 */
function diagnoseClosedConstruct(
	context: AST.DocumentContext,
	generated: AST.GeneratedElement
): Diagnosis | undefined {
	const construct = describeGeneratedElement(generated.tagName);
	// One scan of the content reads each token once, even when it continues
	// into a later fragment. Tags generated from Markdown are left out, so
	// they can’t pair with raw tags of the same name
	const tags = scanTags(
		context.html,
		generated.openEnd,
		generated.closeStart
	).filter((tag) => isRawTag(context, tag));
	const blockTag =
		generated.tagName === 'p'
			? tags.find(
					({ isClosing, name }) =>
						!isClosing && PARAGRAPH_CLOSING_TAG_NAMES.has(name)
				)
			: undefined;

	if (blockTag) {
		return {
			offset: blockTag.start,
			reason: `This \`<${blockTag.name}>\` element can’t be inside a paragraph, so it ends the paragraph before its Markdown content ends`,
		};
	}

	const strayTag = findStrayClosingTag(tags);

	if (strayTag) {
		let reason = `This \`</${strayTag.name}>\` tag is inside ${withArticle(construct)}, so it can’t close the \`<${strayTag.name}>\` element outside it`;

		if (startsParagraphLine(context.html, generated, strayTag)) {
			reason += `. GitHub Flavored Markdown reads this line as a paragraph because more content follows \`</${strayTag.name}>\` on the same line`;
		}

		return { offset: strayTag.start, reason };
	}

	const openTags = readOpenTags(tags);
	const unclosedTag = openTags.at(-1);

	return unclosedTag
		? {
				offset: unclosedTag.start,
				reason: `This \`<${unclosedTag.name}>\` element is still open when the surrounding ${construct} ends`,
			}
		: undefined;
}

/**
 * Reads the tags that start in a range of the document, skipping opaque tokens,
 * complete raw text elements, void elements, and self-closing tags.
 */
function scanTags(html: string, start: number, end: number): Tag[] {
	const tags: Tag[] = [];
	let offset = html.indexOf('<', start);

	while (offset !== -1 && offset < end) {
		const tagEnd = findTokenEnd(html, offset);

		if (tagEnd === undefined) {
			break;
		}

		const match = /^<(\/?)([a-z][a-z0-9-]*)/i.exec(
			html.slice(offset, tagEnd)
		);
		const name = match?.[2]?.toLowerCase();
		const isClosing = match?.[1] === '/';

		// The token of a raw text element’s opening tag includes the element’s
		// content and closing tag
		if (
			name &&
			!isVoidTag(name) &&
			!(isRawTextTag(name) && !isClosing) &&
			!html.slice(offset, tagEnd).endsWith('/>')
		) {
			tags.push({ end: tagEnd, isClosing, name, start: offset });
		}

		offset = html.indexOf('<', Math.max(tagEnd, offset + 1));
	}

	return tags;
}

/**
 * Reads the opaque HTML tokens of a document, including the content of raw text
 * elements. A token that the document leaves unfinished has no end.
 */
function scanTokens(html: string): HTMLToken[] {
	const tokens: HTMLToken[] = [];
	let offset = html.indexOf('<');

	while (offset !== -1) {
		const end = findTokenEnd(html, offset);
		const delimiter = findDelimiter(html, offset);
		const tagName = /^<([a-z][a-z0-9-]*)/i.exec(html.slice(offset))?.[1];

		if (delimiter) {
			tokens.push({
				description: delimiter[2],
				end,
				opening: offset,
				start: offset,
			});
		} else if (tagName && (end === undefined || isRawTextTag(tagName))) {
			const tagEnd = findTagEnd(html, offset);
			tokens.push({
				description:
					tagEnd === undefined
						? `\`<${tagName}>\` tag`
						: `\`<${tagName.toLowerCase()}>\` element`,
				end,
				opening: offset,
				start: tagEnd ?? offset,
			});
		}

		if (end === undefined) {
			break;
		}

		offset = html.indexOf('<', end);
	}

	return tokens;
}

/**
 * Finds where the HTML token that starts at an offset ends, or `undefined` when
 * the document ends first.
 */
function findTokenEnd(html: string, offset: number): number | undefined {
	const delimiter = findDelimiter(html, offset);

	if (delimiter) {
		const end = html.indexOf(delimiter[1], offset + delimiter[0].length);
		return end === -1 ? undefined : end + delimiter[1].length;
	}

	if (!/^<\/?[a-z]/i.test(html.slice(offset, offset + 3))) {
		return offset + 1;
	}

	const tagEnd = findTagEnd(html, offset);
	const tagName = /^<([a-z][a-z0-9-]*)/i.exec(html.slice(offset))?.[1];

	if (tagEnd === undefined || !tagName || !isRawTextTag(tagName)) {
		return tagEnd;
	}

	const closingTag = new RegExp(String.raw`</${tagName}[\t\n\f\r />]`, 'gi');
	closingTag.lastIndex = tagEnd;

	return closingTag.test(html) ? closingTag.lastIndex : undefined;
}

/**
 * Finds the delimiters of the opaque token that starts at an offset.
 */
function findDelimiter(
	html: string,
	offset: number
): (typeof TOKEN_DELIMITERS)[number] | undefined {
	return TOKEN_DELIMITERS.find(([start]) => html.startsWith(start, offset));
}

/**
 * Finds the token that contains an offset.
 */
function findToken(tokens: HTMLToken[], offset: number): HTMLToken | undefined {
	return tokens.find(
		({ end, start }) =>
			start <= offset && offset < (end ?? Number.POSITIVE_INFINITY)
	);
}
