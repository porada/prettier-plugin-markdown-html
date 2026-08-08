export default function stripTrailingClosingTags(
	html: string,
	tagNames: string[]
): string | undefined {
	if (tagNames.length === 0) {
		return html;
	}

	let strippedHTML = html;

	for (const tagName of tagNames.toReversed()) {
		const closingTagPattern = new RegExp(`\\s*</${tagName}>\\s*$`, 'i');

		if (!closingTagPattern.test(strippedHTML)) {
			return undefined;
		}

		strippedHTML = strippedHTML.replace(closingTagPattern, '').trim();
	}

	return strippedHTML;
}
