export default function extractLeadingClosingTags(html: string): {
	closingTags: string;
	html: string;
} {
	const closingTagPattern =
		/\s*(<\/[a-z][a-z0-9-]*\b(?:[^<>"']|"[^"]*"|'[^']*')*>)/iy;

	let index = 0;

	while (true) {
		closingTagPattern.lastIndex = index;
		const match = closingTagPattern.exec(html);

		if (!match || match.index !== index) {
			break;
		}

		index = closingTagPattern.lastIndex;
	}

	if (index === 0) {
		return { closingTags: '', html };
	}

	const remainingHTML = html.slice(index).trimStart();

	return {
		closingTags: html
			.slice(0, html.length - remainingHTML.length)
			.trimStart(),
		html: remainingHTML,
	};
}
