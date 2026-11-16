const HTML_VOID_TAG_NAMES = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr',
]);

/**
 * Checks whether an element has no contents or closing tag.
 */
export default function isVoidTag(tagName: string): boolean {
	return HTML_VOID_TAG_NAMES.has(tagName.toLowerCase());
}
