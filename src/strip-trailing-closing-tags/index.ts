export default function stripTrailingClosingTags(
	html: string,
	tagNames: string[]
): string | undefined {
	if (tagNames.length === 0) {
		return html;
	}

	for (const tagName of tagNames.toReversed()) {
		const closingTagPattern = new RegExp(`\\s*</${tagName}>\\s*$`, 'i');

		if (!closingTagPattern.test(html)) {
			return undefined;
		}

		/* oxlint-disable-next-line eslint/no-param-reassign */
		html = html.replace(closingTagPattern, '').trim();
	}

	return html;
}
