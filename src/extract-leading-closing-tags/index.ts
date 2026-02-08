export default function extractLeadingClosingTags(html: string): {
	closingTags: string;
	html: string;
} {
	const closingTags: string[] = [];
	const closingTagPattern =
		/\s*(<\/[a-z][a-z0-9-]*\b(?:[^<>"']+|"[^"]*"|'[^']*')*>)/iy;

	let index = 0;

	while (true) {
		closingTagPattern.lastIndex = index;
		const match = closingTagPattern.exec(html);

		if (!match || match.index !== index) {
			break;
		}

		closingTags.push(match[1]!);
		index = closingTagPattern.lastIndex;
	}

	if (closingTags.length === 0) {
		return { closingTags: '', html };
	}

	return {
		closingTags: closingTags.join('\n'),
		html: html.slice(index).trim(),
	};
}
