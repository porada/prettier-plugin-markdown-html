const HTML_BLOCK_TAG_NAMES = new Set([
	'address',
	'article',
	'aside',
	'base',
	'basefont',
	'blockquote',
	'body',
	'caption',
	'center',
	'col',
	'colgroup',
	'dd',
	'details',
	'dialog',
	'dir',
	'div',
	'dl',
	'dt',
	'fieldset',
	'figcaption',
	'figure',
	'footer',
	'form',
	'frame',
	'frameset',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'head',
	'header',
	'hgroup',
	'hr',
	'html',
	'iframe',
	'legend',
	'li',
	'link',
	'main',
	'menu',
	'menuitem',
	'meta',
	'nav',
	'noframes',
	'ol',
	'optgroup',
	'option',
	'p',
	'param',
	'pre',
	'script',
	'search',
	'section',
	'source',
	'style',
	'summary',
	'table',
	'tbody',
	'td',
	'textarea',
	'tfoot',
	'th',
	'thead',
	'title',
	'tr',
	'track',
	'ul',
]);

// Elements whose opening tag starts an HTML block that ends at their closing
// tag, which starts none
const RAW_BLOCK_TAG_NAMES = new Set(['pre', 'script', 'style', 'textarea']);

/**
 * Checks whether a tag can interrupt a paragraph with an HTML block in
 * CommonMark or Prettier’s Markdown parser. The closing tags of raw text and
 * preformatted elements can’t, under either parser.
 */
export default function isBlockTag(
	tagName: string,
	isClosingTag = false
): boolean {
	const name = tagName.toLowerCase();

	return (
		HTML_BLOCK_TAG_NAMES.has(name) &&
		!(isClosingTag && RAW_BLOCK_TAG_NAMES.has(name))
	);
}
