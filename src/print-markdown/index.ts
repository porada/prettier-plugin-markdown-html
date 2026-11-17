import type { Printer } from 'prettier';
import type { AST } from '../types/index.d.ts';
import { doc } from 'prettier';
import { printers as markdownPrinters } from 'prettier/plugins/markdown';

/**
 * Prints a Markdown node as Prettier does, except for an HTML block in a task
 * list item. Prettier aligns that block with the text after the checkbox, which
 * would indent its later lines past the item’s content edge.
 */
const printMarkdown: Printer<AST.Node>['print'] = (
	path,
	options,
	print,
	args
) => {
	const printed = markdownPrinters.mdast.print(path, options, print, args);
	const { node, parent } = path;

	return node.type === 'html' &&
		parent?.type === 'listItem' &&
		typeof (parent as { checked?: unknown }).checked === 'boolean'
		? doc.builders.dedent(printed)
		: printed;
};

export default printMarkdown;

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
