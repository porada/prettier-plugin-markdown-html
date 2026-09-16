import type { AST } from '../types/index.d.ts';
import TagScanner from '../tag-scanner/index.ts';

/**
 * Collects adjacent HTML nodes without splitting open tags across blank lines.
 */
export default function collectHTMLGroup(
	children: AST.Node[],
	childIndex: number,
	originalText: string,
	rawTextTag?: string
): AST.HTMLGroup {
	const htmlParts: string[] = [];
	const nodes: AST.HTMLNode[] = [];
	const scanner = new TagScanner();

	if (rawTextTag) {
		scanner.consume(`<${rawTextTag}>`);
	}

	for (let index = childIndex; index < children.length; index += 1) {
		const child = children[index]!;

		if (!isHTMLNode(child)) {
			break;
		}

		const previousNode = nodes.at(-1);
		const separator = previousNode
			? getHTMLSeparator(previousNode, child, originalText)
			: '';

		if (/\n[\t ]*\n/.test(separator) && !scanner.hasUnclosedTags()) {
			break;
		}

		const html = separator + child.value;

		scanner.consume(html);
		htmlParts.push(html);
		nodes.push(child);
	}

	return { value: htmlParts.join('').trim(), children: nodes };
}

/**
 * Recovers source separators without Markdown container prefixes, falling back
 * to line positions when source offsets are unavailable or overlap.
 */
function getHTMLSeparator(
	previousNode: AST.Node,
	nextNode: AST.Node,
	originalText: string
): string {
	const { end } = previousNode.position ?? {};
	const { start } = nextNode.position ?? {};

	if (
		start?.offset !== undefined &&
		end?.offset !== undefined &&
		end.offset <= start.offset
	) {
		// Block quote prefixes may vary in width between source lines. Strip
		// their markers before removing any remaining list indentation
		const prefix = originalText.slice(
			start.offset - start.column + 1,
			start.offset
		);
		const quoteCount = prefix.match(/>/g)?.length ?? 0;
		const quotePattern = new RegExp(
			`^(?:[\\t ]*>[\\t ]?){0,${quoteCount}}`
		);
		const indentation = prefix.replace(quotePattern, '').length;

		return originalText
			.slice(end.offset, start.offset)
			.replaceAll(/\r\n?/g, '\n')
			.split('\n')
			.map((line, index) =>
				index === 0
					? line
					: line.replace(quotePattern, '').slice(indentation)
			)
			.join('\n');
	}

	return '\n'.repeat(Math.max(1, (start?.line ?? 1) - (end?.line ?? 1)));
}

/**
 * Recognizes HTML nodes with source text that can be collected.
 */
function isHTMLNode(node: AST.Node | undefined): node is AST.HTMLNode {
	return node?.type === 'html' && typeof node.value === 'string';
}
