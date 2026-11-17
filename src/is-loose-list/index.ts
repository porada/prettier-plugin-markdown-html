import type { AST } from '../types/index.d.ts';

/**
 * Checks whether a list renders loosely, with paragraphs in its items. The
 * reference renderer treats a list as loose when a blank line separates a child
 * of an item from the next child or item. Prettier’s Markdown tree misses some
 * of those blank lines and adds others, so the source decides when it’s
 * available.
 */
export default function isLooseList(list: AST.Node, source?: string): boolean {
	const items = list.children ?? [];
	const isSeparated = items.some((item, index) =>
		isSeparatedFromNext(item, items[index + 1], source)
	);

	return source === undefined
		? isSeparated ||
				(list as { spread?: boolean }).spread === true ||
				items.some(
					(item) => (item as { spread?: boolean }).spread === true
				)
		: isSeparated;
}

/**
 * Checks whether the reference renderer reads a blank line between a child of a
 * list item and the next child or item.
 */
export function isSeparatedFromNext(
	item: AST.Node,
	nextItem: AST.Node | undefined,
	source: string | undefined
): boolean {
	return findSeparatedChildren(item, nextItem, source).some(Boolean);
}

/**
 * Returns one entry per child of a list item, using the item itself when it’s
 * empty. Each entry is the node at the end of that child or item if a blank
 * line separates it from the next child or item. Otherwise, the entry is
 * `undefined`.
 */
function findSeparatedChildren(
	item: AST.Node,
	nextItem: AST.Node | undefined,
	source: string | undefined
): Array<AST.Node | undefined> {
	const children = item.children?.length ? item.children : [item];

	return children.map((child, index) => {
		// The reference renderer removes link reference definitions from the
		// item. A blank line after a definition counts toward looseness only
		// when the definition is the item’s last child and another item follows
		if (child.type === 'definition' && index < children.length - 1) {
			return undefined;
		}

		const next = children[index + 1] ?? nextItem;
		const leaf = findLastLeaf(child);

		return next && isFollowedByBlankLine(leaf, next, source)
			? leaf
			: undefined;
	});
}

/**
 * Finds the node whose end is used to check for a trailing blank line,
 * descending into lists and list items as the reference renderer does.
 * Prettier’s positions for a nested list can extend past its last item.
 */
function findLastLeaf(node: AST.Node): AST.Node {
	const lastChild = node.children?.at(-1);

	return (node.type === 'list' || node.type === 'listItem') && lastChild
		? findLastLeaf(lastChild)
		: node;
}

/**
 * Checks whether a blank line separates a node from the node after it. An HTML
 * block left open includes its final line break, and possibly blank lines, in
 * its value and position.
 */
function isFollowedByBlankLine(
	node: AST.Node,
	next: AST.Node,
	source: string | undefined
): boolean {
	const end = node.position?.end.offset;
	const nextStart = next.position?.start.offset;

	// The reference renderer ignores a blank line after a thematic break
	if (node.type === 'thematicBreak') {
		return false;
	}

	if (isOpenBlock(node) && /\n[\t ]*\n[\t ]*$/.test(node.value!)) {
		return true;
	}

	if (source === undefined || end === undefined || nextStart === undefined) {
		return false;
	}

	const lineBreakCount = source.slice(end, nextStart).split('\n').length - 1;
	return lineBreakCount > (isOpenBlock(node) ? 0 : 1);
}

/**
 * Checks whether a node is an HTML block left open across the end of its last
 * line.
 */
function isOpenBlock(node: AST.Node): boolean {
	return node.type === 'html' && node.value?.endsWith('\n') === true;
}
