const HTML_RAW_TEXT_TAG_NAMES = new Set([
	/* prettier-ignore */
	'script',
	'style',
	'textarea',
	'title',
]);

export default function isRawTextTag(tagName: string): boolean {
	return HTML_RAW_TEXT_TAG_NAMES.has(tagName);
}
