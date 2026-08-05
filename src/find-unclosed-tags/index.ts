import isRawTextTag from '../is-raw-text-tag/index.ts';
import isVoidTag from '../is-void-tag/index.ts';

const HTML_OPTIONAL_END_TAG_FOLLOWERS: ReadonlyMap<
	string,
	ReadonlySet<string>
> = new Map([
	['caption', new Set(['colgroup', 'tbody', 'tfoot', 'thead'])],
	['colgroup', new Set(['colgroup', 'tbody', 'tfoot', 'thead'])],
	['dd', new Set(['dd', 'dt'])],
	['dt', new Set(['dd', 'dt'])],
	['head', new Set(['body'])],
	['li', new Set(['li'])],
	['optgroup', new Set(['hr', 'optgroup'])],
	['option', new Set(['hr', 'optgroup', 'option'])],
	[
		'p',
		new Set([
			'address',
			'article',
			'aside',
			'blockquote',
			'details',
			'dialog',
			'div',
			'dl',
			'fieldset',
			'figcaption',
			'figure',
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
			'menu',
			'nav',
			'ol',
			'p',
			'pre',
			'search',
			'section',
			'table',
			'ul',
		]),
	],
	['rp', new Set(['rp', 'rt'])],
	['rt', new Set(['rp', 'rt'])],
	['tbody', new Set(['tbody', 'tfoot'])],
	['td', new Set(['td', 'th'])],
	['th', new Set(['td', 'th'])],
	['thead', new Set(['tbody', 'tfoot'])],
	['tr', new Set(['tr'])],
]);

const HTML_OPTIONAL_END_TAGS_AT_PARENT_END = new Set([
	'body',
	'caption',
	'colgroup',
	'dd',
	'li',
	'optgroup',
	'option',
	'rp',
	'rt',
	'tbody',
	'td',
	'tfoot',
	'th',
	'tr',
]);

const HTML_PARAGRAPH_END_TAG_REQUIRED_PARENTS = new Set([
	'a',
	'audio',
	'del',
	'ins',
	'map',
	'noscript',
	'video',
]);

export default function findUnclosedTags(html: string): string[] {
	const unclosedTags: string[] = [];
	const tagPattern = /<\/?([a-z][a-z0-9-]*)\b(?:[^<>"']|"[^"]*"|'[^']*')*>/iy;

	let index = 0;

	while (true) {
		const tagStartIndex = html.indexOf('<', index);

		if (tagStartIndex === -1) {
			break;
		}

		if (html.startsWith('<!--', tagStartIndex)) {
			const commentEndIndex = html.indexOf('-->', tagStartIndex + 4);

			if (commentEndIndex === -1) {
				break;
			}

			index = commentEndIndex + 3;
			continue;
		}

		tagPattern.lastIndex = tagStartIndex;
		const match = tagPattern.exec(html);

		if (!match || match.index !== tagStartIndex) {
			index = tagStartIndex + 1;
			continue;
		}

		const [token] = match;
		const tagName = match[1]!.toLowerCase();

		index = tagPattern.lastIndex;

		if (token.startsWith('</')) {
			if (!isVoidTag(tagName)) {
				closeTag(unclosedTags, tagName);
			}
			continue;
		}

		closeOptionalEndTagsBeforeStartTag(unclosedTags, tagName);

		if (isVoidTag(tagName) || token.endsWith('/>')) {
			continue;
		}

		if (isRawTextTag(tagName)) {
			const closingTagEndIndex = findClosingTagEndIndex(
				html,
				tagName,
				index
			);

			if (closingTagEndIndex === -1) {
				unclosedTags.push(tagName);
				break;
			}

			index = closingTagEndIndex;
			continue;
		}

		unclosedTags.push(tagName);
	}

	return unclosedTags;
}

function closeOptionalEndTagsBeforeStartTag(
	unclosedTags: string[],
	tagName: string
): void {
	let openTagIndex = unclosedTags.length - 1;

	while (openTagIndex >= 0) {
		const openTagName = unclosedTags[openTagIndex]!;
		const followers = HTML_OPTIONAL_END_TAG_FOLLOWERS.get(openTagName);

		if (
			followers?.has(tagName) &&
			canOmitDescendantEndTags(unclosedTags, openTagIndex)
		) {
			unclosedTags.length = openTagIndex;
			openTagIndex = unclosedTags.length - 1;
			continue;
		}

		openTagIndex -= 1;
	}
}

function closeTag(unclosedTags: string[], tagName: string): void {
	const openTagIndex = unclosedTags.lastIndexOf(tagName);

	if (
		openTagIndex !== -1 &&
		canOmitDescendantEndTags(unclosedTags, openTagIndex)
	) {
		unclosedTags.length = openTagIndex;
	}
}

function canOmitDescendantEndTags(
	unclosedTags: string[],
	parentIndex: number
): boolean {
	for (let index = unclosedTags.length - 1; index > parentIndex; index -= 1) {
		if (
			!canOmitEndTagAtParentEnd(
				unclosedTags[index]!,
				unclosedTags[index - 1]!
			)
		) {
			return false;
		}
	}

	return true;
}

function canOmitEndTagAtParentEnd(
	tagName: string,
	parentTagName: string
): boolean {
	if (tagName === 'p') {
		return (
			!HTML_PARAGRAPH_END_TAG_REQUIRED_PARENTS.has(parentTagName) &&
			!parentTagName.includes('-')
		);
	}

	return HTML_OPTIONAL_END_TAGS_AT_PARENT_END.has(tagName);
}

function findClosingTagEndIndex(
	html: string,
	tagName: string,
	startIndex: number
): number {
	const closingTagPattern = new RegExp(`</${tagName}\\s*>`, 'gi');
	closingTagPattern.lastIndex = startIndex;

	const match = closingTagPattern.exec(html);
	return match ? closingTagPattern.lastIndex : -1;
}
