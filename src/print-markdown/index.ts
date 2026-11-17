import type { AstPath, ParserOptions, Printer } from 'prettier';
import type { AST } from '../types/index.d.ts';
import { doc } from 'prettier';
import { printers as markdownPrinters } from 'prettier/plugins/markdown';
import { stripContainerPrefixes } from '../slice-markdown-source/index.ts';

// Markdown nodes whose children are blocks
const CONTAINER_TYPES = new Set<string | undefined>([
	'blockquote',
	'list',
	'listItem',
]);

// Labels protected source whose last line ends with whitespace
const TRAILING_WHITESPACE_LABEL = Symbol('protected trailing whitespace');

// Formatting operations that print protected source with trailing whitespace
const protectedTrailingWhitespace = new WeakSet<ParserOptions>();

/**
 * Prints Markdown as Prettier does, while aligning HTML in task list items and
 * preserving trailing whitespace in protected source.
 */
const printMarkdown: Printer<AST.Node>['print'] = (
	path,
	options,
	print,
	args
) => {
	const printed = alignTaskListHTML(
		path,
		markdownPrinters.mdast.print(path, options, print, args)
	);

	if (
		path.node.type !== 'root' ||
		!protectedTrailingWhitespace.has(options)
	) {
		return printed;
	}

	// A hard line trims the trailing whitespace before it. A literal line at
	// the same indentation keeps the protected source’s whitespace
	return doc.utils.mapDoc(printed, (part) =>
		Array.isArray(part)
			? part.map((item, index) =>
					isHardline(item) &&
					endsWithTrailingWhitespace(part[index - 1])
						? doc.builders.markAsRoot(doc.builders.literalline)
						: item
				)
			: part
	);
};

export default printMarkdown;

/**
 * Prints the source of a node that a Markdown ignore directive protects. For
 * raw HTML in block quotes and list items, and nodes that contain it, the
 * printer’s new prefixes replace the original ones.
 */
export const printPrettierIgnored: NonNullable<
	Printer<AST.Node>['printPrettierIgnored']
> = (path, options, ...rest) => {
	const { node } = path;
	const containers = path.ancestors
		.filter(({ type }) => type === 'blockquote' || type === 'listItem')
		.toReversed();
	// For nodes other than HTML blocks, end at the last block to avoid extra
	// separation from trailing empty lines. Keep inline closing syntax
	const end =
		node.type === 'html' ? node.position?.end : findContentEnd(node);
	// The reference profile has no footnotes, so a footnote definition’s
	// indentation isn’t a container prefix
	const source =
		containsHTML(node) &&
		end &&
		!path.ancestors.some(({ type }) => type === 'footnoteDefinition')
			? stripContainerPrefixes(
					options.originalText,
					{ ...node, position: { ...node.position!, end } },
					containers,
					// Prettier moves other nodes to their own indentation,
					// while an HTML block’s lines stay relative to the
					// containers’ content
					node.type !== 'html'
				)
			: undefined;

	if (source === undefined) {
		return markdownPrinters.mdast.printPrettierIgnored!(
			path,
			options,
			...rest
		);
	}

	// A final newline in HTML at the end of the document would duplicate the
	// one Prettier adds
	const lines = (
		end?.offset === options.originalText.length
			? source.replace(/\n$/, '')
			: source
	).split('\n');

	// Empty lines would otherwise receive the containers’ padding
	const printed = alignTaskListHTML(
		path,
		doc.builders.join(
			doc.builders.markAsRoot(doc.builders.literalline),
			lines.map((line) => (line === '' ? doc.builders.trim : line))
		)
	);

	if (!/[\t ]$/.test(lines.at(-1)!)) {
		return printed;
	}

	protectedTrailingWhitespace.add(options);
	return doc.builders.label(TRAILING_WHITESPACE_LABEL, printed);
};

/**
 * Finds the end of the last block, descending only through block quotes, lists,
 * and list items so inline closing syntax stays intact.
 */
function findContentEnd(node: AST.Node): AST.Point | undefined {
	const lastChild = node.children?.at(-1);

	return lastChild && CONTAINER_TYPES.has(node.type)
		? findContentEnd(lastChild)
		: node.position?.end;
}

/**
 * Checks whether a node is raw HTML or contains it.
 */
function containsHTML(node: AST.Node): boolean {
	return node.type === 'html' || (node.children ?? []).some(containsHTML);
}

/**
 * Checks whether a doc is a hard line, which trims the whitespace before it.
 */
function isHardline(part: doc.builders.Doc | undefined): boolean {
	const [line] = Array.isArray(part) ? part : [];

	return (
		typeof line === 'object' &&
		!Array.isArray(line) &&
		line.type === 'line' &&
		line.hard === true &&
		line.literal !== true
	);
}

/**
 * Checks whether a doc ends with protected source whose last line ends with
 * whitespace.
 */
function endsWithTrailingWhitespace(
	part: doc.builders.Doc | undefined
): boolean {
	if (Array.isArray(part)) {
		return endsWithTrailingWhitespace(part.at(-1));
	}

	if (typeof part !== 'object') {
		return false;
	}

	if (part.type === 'label' && part.label === TRAILING_WHITESPACE_LABEL) {
		return true;
	}

	// Prettier wraps list item and block quote contents in alignment docs
	return 'contents' in part && endsWithTrailingWhitespace(part.contents);
}

/**
 * Dedents an HTML block in a task list item. Prettier aligns that block with
 * the text after the checkbox, which would indent its later lines past the
 * item’s content edge.
 */
function alignTaskListHTML(
	path: AstPath<AST.Node>,
	printed: doc.builders.Doc
): doc.builders.Doc {
	const { node, parent } = path;

	return node.type === 'html' &&
		parent?.type === 'listItem' &&
		typeof (parent as { checked?: unknown }).checked === 'boolean'
		? doc.builders.dedent(printed)
		: printed;
}

/**
 * Keeps the HTML blocks of list items aligned with their content. Prettier
 * drops an item’s alignment when it has exactly two children, the second is
 * HTML, and their start columns differ, as when the first child’s text follows
 * a task list checkbox.
 */
export function alignListItemHTML(node: AST.Node): void {
	const [first, second] = node.children ?? [];

	if (
		node.type === 'listItem' &&
		node.children?.length === 2 &&
		second?.type === 'html' &&
		first?.position &&
		second.position
	) {
		second.position = {
			...second.position,
			start: {
				...second.position.start,
				column: first.position.start.column,
			},
		};
	}

	for (const child of node.children ?? []) {
		alignListItemHTML(child);
	}
}
