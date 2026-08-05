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

type UnclosedTagStack = {
	nonOmittableTagIndices: number[];
	tagIndicesByName: Map<string, number[]>;
	tagNames: string[];
};

type HTMLQuote = "'" | '"';

type PendingMarkupStage =
	| 'after-closing-slash'
	| 'after-comment-bang'
	| 'after-comment-dash'
	| 'after-less-than'
	| 'tag-body'
	| 'tag-name';

type PendingMarkup = {
	chunks: string[];
	nameIncludesHyphen: boolean;
	quote: HTMLQuote | undefined;
	stage: PendingMarkupStage;
};

type PendingMarkupResult = {
	endIndex?: number;
	type: 'comment' | 'incomplete' | 'invalid' | 'tag';
};

export default class TagScanner {
	static scan(html: string): string[] {
		const scanner = new TagScanner();

		scanner.consumeHTML(html, false);
		return scanner.getUnclosedTags();
	}

	private inComment = false;
	private pendingHTML = '';
	private pendingMarkup: PendingMarkup | undefined;
	private readonly tagPattern =
		/<\/?([a-z][a-z0-9-]*)\b(?:[^<>"']|"[^"]*"|'[^']*')*>/iy;

	private readonly unclosedTags: UnclosedTagStack = {
		nonOmittableTagIndices: [],
		tagIndicesByName: new Map(),
		tagNames: [],
	};

	consume(html: string): void {
		this.consumeHTML(html, true);
	}

	private consumeHTML(html: string, preserveIncompleteMarkup: boolean): void {
		const source = this.pendingHTML + html;
		this.pendingHTML = '';

		let index = 0;

		if (this.pendingMarkup) {
			const { pendingMarkup } = this;
			const result = advancePendingMarkup(pendingMarkup, source);

			if (result.type === 'incomplete') {
				if (source) {
					pendingMarkup.chunks.push(source);
				}
				return;
			}

			this.pendingMarkup = undefined;

			if (result.type === 'invalid') {
				const replayHTML =
					pendingMarkup.chunks.join('').slice(1) + source;

				this.consumeHTML(replayHTML, preserveIncompleteMarkup);
				return;
			}

			index = result.endIndex!;

			if (result.type === 'comment') {
				this.inComment = true;
			} else {
				const token =
					pendingMarkup.chunks.join('') + source.slice(0, index);

				this.tagPattern.lastIndex = 0;
				const match = this.tagPattern.exec(token)!;

				this.processTag(match[0], match[1]!.toLowerCase());
			}
		}

		if (this.inComment) {
			const commentEndIndex = source.indexOf('-->', index);

			if (commentEndIndex === -1) {
				this.pendingHTML = findTrailingCommentEndPrefix(source, index);
				return;
			}

			this.inComment = false;
			index = commentEndIndex + 3;
		}

		const rawTextTag = this.unclosedTags.tagNames.at(-1);

		if (rawTextTag && isRawTextTag(rawTextTag)) {
			const closingTagEndIndex = findClosingTagEndIndex(
				source,
				rawTextTag,
				index
			);

			if (closingTagEndIndex === -1) {
				this.pendingHTML = findTrailingClosingTagPrefix(
					source,
					rawTextTag,
					index
				);
				return;
			}

			closeTag(this.unclosedTags, rawTextTag);
			index = closingTagEndIndex;
		}

		while (true) {
			const tagStartIndex = source.indexOf('<', index);

			if (tagStartIndex === -1) {
				return;
			}

			if (source.startsWith('<!--', tagStartIndex)) {
				const commentEndIndex = source.indexOf(
					'-->',
					tagStartIndex + 4
				);

				if (commentEndIndex === -1) {
					this.inComment = true;

					if (preserveIncompleteMarkup) {
						this.pendingHTML = findTrailingCommentEndPrefix(
							source,
							tagStartIndex + 4
						);
					}
					return;
				}

				index = commentEndIndex + 3;
				continue;
			}

			this.tagPattern.lastIndex = tagStartIndex;
			const match = this.tagPattern.exec(source);

			if (!match || match.index !== tagStartIndex) {
				if (preserveIncompleteMarkup) {
					const pendingMarkup = createPendingMarkup(
						source.slice(tagStartIndex)
					);

					if (pendingMarkup) {
						this.pendingMarkup = pendingMarkup;
						return;
					}
				}

				index = tagStartIndex + 1;
				continue;
			}

			const [token] = match;
			const tagName = match[1]!.toLowerCase();

			index = this.tagPattern.lastIndex;

			if (!this.processTag(token, tagName)) {
				continue;
			}

			const closingTagEndIndex = findClosingTagEndIndex(
				source,
				tagName,
				index
			);

			if (closingTagEndIndex === -1) {
				if (preserveIncompleteMarkup) {
					this.pendingHTML = findTrailingClosingTagPrefix(
						source,
						tagName,
						index
					);
				}
				return;
			}

			closeTag(this.unclosedTags, tagName);
			index = closingTagEndIndex;
		}
	}

	private processTag(token: string, tagName: string): boolean {
		if (token.startsWith('</')) {
			if (!isVoidTag(tagName)) {
				closeTag(this.unclosedTags, tagName);
			}
			return false;
		}

		closeOptionalEndTagsBeforeStartTag(this.unclosedTags, tagName);

		if (isVoidTag(tagName) || token.endsWith('/>')) {
			return false;
		}

		pushUnclosedTag(this.unclosedTags, tagName);
		return isRawTextTag(tagName);
	}

	getUnclosedTags(): string[] {
		return [...this.unclosedTags.tagNames];
	}

	hasUnclosedTags(): boolean {
		return (
			this.pendingMarkup !== undefined ||
			this.unclosedTags.tagNames.length > 0
		);
	}
}

function createPendingMarkup(markup: string): PendingMarkup | undefined {
	const pendingMarkup: PendingMarkup = {
		chunks: [markup],
		nameIncludesHyphen: false,
		quote: undefined,
		stage: 'after-less-than',
	};
	const result = advancePendingMarkup(pendingMarkup, markup, 1);

	return result.type === 'incomplete' ? pendingMarkup : undefined;
}

function advancePendingMarkup(
	pendingMarkup: PendingMarkup,
	html: string,
	startIndex = 0
): PendingMarkupResult {
	for (let index = startIndex; index < html.length; index += 1) {
		const character = html[index]!;

		if (pendingMarkup.stage === 'after-less-than') {
			if (character === '/') {
				pendingMarkup.stage = 'after-closing-slash';
			} else if (character === '!') {
				pendingMarkup.stage = 'after-comment-bang';
			} else if (/[a-z]/i.test(character)) {
				pendingMarkup.stage = 'tag-name';
			} else {
				return { endIndex: index, type: 'invalid' };
			}
			continue;
		}

		if (pendingMarkup.stage === 'after-closing-slash') {
			if (!/[a-z]/i.test(character)) {
				return { endIndex: index, type: 'invalid' };
			}

			pendingMarkup.stage = 'tag-name';
			continue;
		}

		if (pendingMarkup.stage === 'after-comment-bang') {
			if (character !== '-') {
				return { endIndex: index, type: 'invalid' };
			}

			pendingMarkup.stage = 'after-comment-dash';
			continue;
		}

		if (pendingMarkup.stage === 'after-comment-dash') {
			return character === '-'
				? { endIndex: index + 1, type: 'comment' }
				: { endIndex: index, type: 'invalid' };
		}

		if (pendingMarkup.stage === 'tag-name') {
			if (/[a-z0-9-]/i.test(character)) {
				pendingMarkup.nameIncludesHyphen ||= character === '-';
				continue;
			}

			if (character === '_' && !pendingMarkup.nameIncludesHyphen) {
				return { endIndex: index, type: 'invalid' };
			}

			pendingMarkup.stage = 'tag-body';
		}

		if (pendingMarkup.quote) {
			if (character === pendingMarkup.quote) {
				pendingMarkup.quote = undefined;
			}
			continue;
		}

		if (character === '"' || character === "'") {
			pendingMarkup.quote = character;
			continue;
		}

		if (character === '>') {
			return { endIndex: index + 1, type: 'tag' };
		}

		if (character === '<') {
			return { endIndex: index, type: 'invalid' };
		}
	}

	return { type: 'incomplete' };
}

function findTrailingCommentEndPrefix(
	html: string,
	startIndex: number
): string {
	if (html.length - startIndex >= 2 && html.endsWith('--')) {
		return '--';
	}

	if (html.length > startIndex && html.endsWith('-')) {
		return '-';
	}

	return '';
}

function findTrailingClosingTagPrefix(
	html: string,
	tagName: string,
	startIndex: number
): string {
	const tagStartIndex = html.lastIndexOf('<');

	if (tagStartIndex < startIndex) {
		return '';
	}

	const suffix = html.slice(tagStartIndex);
	const lowercaseSuffix = suffix.toLowerCase();
	const closingTag = `</${tagName}`;

	if (closingTag.startsWith(lowercaseSuffix)) {
		return suffix;
	}

	if (!lowercaseSuffix.startsWith(closingTag)) {
		return '';
	}

	return /^\s+$/.test(suffix.slice(closingTag.length)) ? closingTag : '';
}

function pushUnclosedTag(
	unclosedTags: UnclosedTagStack,
	tagName: string
): void {
	const tagIndex = unclosedTags.tagNames.length;
	const parentTagName = unclosedTags.tagNames.at(-1);

	unclosedTags.tagNames.push(tagName);

	let tagIndices = unclosedTags.tagIndicesByName.get(tagName);

	if (!tagIndices) {
		tagIndices = [];
		unclosedTags.tagIndicesByName.set(tagName, tagIndices);
	}

	tagIndices.push(tagIndex);

	if (parentTagName && !canOmitEndTagAtParentEnd(tagName, parentTagName)) {
		unclosedTags.nonOmittableTagIndices.push(tagIndex);
	}
}

function closeOptionalEndTagsBeforeStartTag(
	unclosedTags: UnclosedTagStack,
	tagName: string
): void {
	while (true) {
		const openTagIndex = findLastOptionalEndTagIndex(unclosedTags, tagName);

		if (
			openTagIndex === -1 ||
			!canOmitDescendantEndTags(unclosedTags, openTagIndex)
		) {
			return;
		}

		truncateUnclosedTags(unclosedTags, openTagIndex);
	}
}

function findLastOptionalEndTagIndex(
	unclosedTags: UnclosedTagStack,
	tagName: string
): number {
	let lastIndex = -1;

	for (const [openTagName, followers] of HTML_OPTIONAL_END_TAG_FOLLOWERS) {
		if (followers.has(tagName)) {
			lastIndex = Math.max(
				lastIndex,
				unclosedTags.tagIndicesByName.get(openTagName)?.at(-1) ?? -1
			);
		}
	}

	return lastIndex;
}

function closeTag(unclosedTags: UnclosedTagStack, tagName: string): void {
	const openTagIndex =
		unclosedTags.tagIndicesByName.get(tagName)?.at(-1) ?? -1;

	if (
		openTagIndex !== -1 &&
		canOmitDescendantEndTags(unclosedTags, openTagIndex)
	) {
		truncateUnclosedTags(unclosedTags, openTagIndex);
	}
}

function canOmitDescendantEndTags(
	unclosedTags: UnclosedTagStack,
	parentIndex: number
): boolean {
	return (unclosedTags.nonOmittableTagIndices.at(-1) ?? -1) <= parentIndex;
}

function truncateUnclosedTags(
	unclosedTags: UnclosedTagStack,
	length: number
): void {
	while (unclosedTags.tagNames.length > length) {
		const tagIndex = unclosedTags.tagNames.length - 1;
		const tagName = unclosedTags.tagNames.pop()!;
		const tagIndices = unclosedTags.tagIndicesByName.get(tagName)!;

		tagIndices.pop();

		if (tagIndices.length === 0) {
			unclosedTags.tagIndicesByName.delete(tagName);
		}

		if (unclosedTags.nonOmittableTagIndices.at(-1) === tagIndex) {
			unclosedTags.nonOmittableTagIndices.pop();
		}
	}
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
