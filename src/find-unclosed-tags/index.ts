import isVoidTag from '../is-void-tag/index.ts';

export default function findUnclosedTags(html: string): string[] {
	const unclosedTags: string[] = [];

	for (const [token] of html.matchAll(
		/<!--[\s\S]*?-->|<\/?[a-z][a-z0-9-]*\b[^>]*?>/gi
	)) {
		if (token.startsWith('<!--')) {
			continue;
		}

		const tagName = token
			.match(/^<\/?\s*([a-z][a-z0-9-]*)/i)?.[1]
			?.toLowerCase();

		/* v8 ignore if -- @preserve */
		if (!tagName) {
			continue;
		}

		if (token.startsWith('</')) {
			if (unclosedTags.at(-1) === tagName) {
				unclosedTags.pop();
			}
			continue;
		}

		if (token.endsWith('/>') || isVoidTag(tagName)) {
			continue;
		}

		unclosedTags.push(tagName);
	}

	return unclosedTags;
}
