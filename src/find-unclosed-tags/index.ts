import isRawTextTag from '../is-raw-text-tag/index.ts';
import isVoidTag from '../is-void-tag/index.ts';

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

		if (isVoidTag(tagName) || token.endsWith('/>')) {
			continue;
		}

		if (token.startsWith('</')) {
			if (unclosedTags.at(-1) === tagName) {
				unclosedTags.pop();
			}
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
