const HTML_RAW_TEXT_TAG_NAMES = new Set([
	/* prettier-ignore */
	'script',
	'style',
	'textarea',
	'title',
]);

/**
 * Checks whether an element’s contents are parsed as text rather than markup.
 */
export default function isRawTextTag(tagName: string): boolean {
	return HTML_RAW_TEXT_TAG_NAMES.has(tagName.toLowerCase());
}
