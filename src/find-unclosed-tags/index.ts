import isVoidTag from '../is-void-tag/index.ts';

export default function findUnclosedTags(html: string): string[] {
	const unclosedTags: string[] = [];
	const tagPattern =
		/<\/?([a-z][a-z0-9-]*)\b(?:[^<>"']+|"[^"]*"|'[^']*')*>/iy;

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
		const tagName = match[1]?.toLowerCase();

		/* v8 ignore if -- @preserve */
		if (!tagName) {
			index = tagStartIndex + 1;
			continue;
		}

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

		unclosedTags.push(tagName);
	}

	return unclosedTags;
}
