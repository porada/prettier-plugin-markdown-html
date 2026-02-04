export default function extractLeadingClosingTags(html: string): {
	closingTags: string;
	html: string;
} {
	const leadingTags = html.match(/^\s*(?:<\/[a-z][a-z0-9-]*\s*>\s*)+/i)?.[0];

	if (!leadingTags) {
		return { closingTags: '', html };
	}

	const closingTags = leadingTags.match(/<\/[a-z][a-z0-9-]*\s*>/gi);

	/* v8 ignore if -- @preserve */
	if (!closingTags || closingTags.length === 0) {
		return { closingTags: '', html };
	}

	return {
		closingTags: closingTags.join('\n'),
		html: html.slice(leadingTags.length).trim(),
	};
}
