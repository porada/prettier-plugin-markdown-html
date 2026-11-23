import type { AST } from '../types/index.d.ts';

/**
 * Removes an HTML node that a correction empties from its parent’s children,
 * in a new array so a snapshot of the previous children stays intact.
 */
export default function removeHTMLNode(node: AST.Node, parent: AST.Node): void {
	parent.children = parent.children?.filter((child) => child !== node);
}
