import type { ScanState } from '../scan-raw-html/index.ts';
import type { AST, Regions } from '../types/index.d.ts';
import { IGNORE_COMMENT_PATTERN } from '../constants/index.ts';
import scanRawHTML from '../scan-raw-html/index.ts';
import { recordHTMLBlockText } from '../slice-markdown-source/index.ts';

// The blocks whose inline HTML forms one region
const INLINE_BLOCK_TYPES: ReadonlySet<string | undefined> = new Set([
	'heading',
	'paragraph',
	'tableCell',
]);

// Line start offsets for document source and fragment HTML
const lineStarts = new WeakMap<Regions.Document | Regions.Fragment, number[]>();

type ReadState = {
	document: Regions.Document;
	protections: Map<AST.Node, Regions.Protection>;
};

/**
 * Reads the Markdown containers of a syntax tree and the raw HTML fragments in
 * them, with the tokens of each fragment located in the source. Raw HTML in
 * footnote definitions stays outside the fragments.
 */
export default function readRawHTML(
	root: AST.RootNode,
	source: string
): Regions.Document {
	const protections = new Map<AST.Node, Regions.Protection>();
	const document: Regions.Document = {
		fragments: [],
		protections,
		root: undefined as never,
		source,
	};

	collectProtections(root, undefined, protections);
	document.root = readContainer(root, 'root', undefined, undefined, {
		document,
		protections,
	});

	return document;
}

/**
 * Converts an offset in a fragment’s HTML to a point in the original Markdown.
 * Block quote and list item prefixes are missing from the HTML of later lines,
 * so those lines are matched from their ends.
 */
export function locateFragmentOffset(
	document: Regions.Document,
	fragment: Regions.Fragment,
	offset: number
): AST.Point {
	const { node } = fragment;
	const start = node.position?.start.offset;

	// A syntax tree from another plugin can omit positions, which then all
	// count as the start of the document
	if (start === undefined) {
		return { column: 1, line: 1, offset: 0 };
	}

	const valueStarts = getLineStarts(fragment, node.value);
	const valueLine = findLine(valueStarts, offset);
	const starts = getLineStarts(document, document.source);
	const lineIndex = findLine(starts, start) + valueLine;
	const isLastLine = valueLine === valueStarts.length - 1;
	const remaining =
		(isLastLine ? node.value.length : valueStarts[valueLine + 1]! - 1) -
		offset;
	const sourceLineEnd = isLastLine
		? node.position!.end.offset!
		: starts[lineIndex + 1]! - 1;

	// A tab before the first line’s HTML can leave spaces in the value that the
	// source lacks after the node’s start, so that line also matches from its
	// end once its value outgrows the source
	if (valueLine === 0) {
		return locateOffset(
			document,
			sourceLineEnd - start < remaining + offset
				? Math.max(start, sourceLineEnd - remaining)
				: start + offset
		);
	}

	return locateOffset(
		document,
		Math.max(starts[lineIndex]!, sourceLineEnd - remaining)
	);
}

/**
 * Converts an offset in the original Markdown to a point.
 */
export function locateOffset(
	document: Regions.Document,
	offset: number
): AST.Point {
	const starts = getLineStarts(document, document.source);
	const line = findLine(starts, offset);

	return { column: offset - starts[line]! + 1, line: line + 1, offset };
}

/**
 * Returns the start offset of each line of a document’s source or a fragment’s
 * HTML, reading the text once.
 */
function getLineStarts(
	key: Regions.Document | Regions.Fragment,
	text: string
): number[] {
	let starts = lineStarts.get(key);

	if (!starts) {
		starts = [0];

		for (
			let index = text.indexOf('\n');
			index !== -1;
			index = text.indexOf('\n', index + 1)
		) {
			starts.push(index + 1);
		}

		lineStarts.set(key, starts);
	}

	return starts;
}

/**
 * Finds the index of the line that contains an offset.
 */
function findLine(starts: ReadonlyArray<number>, offset: number): number {
	let low = 0;
	let high = starts.length - 1;

	while (low < high) {
		const middle = Math.ceil((low + high) / 2);

		if (starts[middle]! <= offset) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}

	return low;
}

/**
 * Records the outermost Markdown ignore directive or range protecting each
 * node. Only closed ranges at the document root count.
 */
function collectProtections(
	node: AST.Node,
	protection: Regions.Protection | undefined,
	protections: Map<AST.Node, Regions.Protection>
): void {
	const children = node.children ?? [];
	const ranges = new Map<AST.Node, Regions.Protection>();

	if (node.type === 'root') {
		let rangeStart: number | undefined;

		for (const [index, child] of children.entries()) {
			const kind = getIgnoreCommentKind(child);

			if (rangeStart === undefined && kind === 'start') {
				rangeStart = index;
			} else if (rangeStart !== undefined && kind === 'end') {
				const range: Regions.Protection = {
					kind: 'range',
					nodes: children.slice(rangeStart, index + 1),
				};

				for (const ignored of range.nodes) {
					ranges.set(ignored, range);
				}

				rangeStart = undefined;
			}
		}
	}

	for (const [index, child] of children.entries()) {
		const previous = children[index - 1];
		const childProtection =
			protection ??
			ranges.get(child) ??
			(previous && getIgnoreCommentKind(previous) === 'next'
				? { kind: 'next', nodes: [child] }
				: undefined);

		if (childProtection) {
			protections.set(child, childProtection);
		}

		collectProtections(child, childProtection, protections);
	}
}

/**
 * Returns the kind of Prettier ignore comment that a node holds, if any.
 */
function getIgnoreCommentKind(
	node: AST.Node
): 'end' | 'next' | 'start' | undefined {
	const match =
		node.type === 'html'
			? IGNORE_COMMENT_PATTERN.exec((node as AST.HTMLNode).value)
			: null;

	return match
		? ((match[1] as 'end' | 'start' | undefined) ?? 'next')
		: undefined;
}

/**
 * Reads a Markdown container’s HTML blocks, inline HTML, and nested containers.
 */
function readContainer(
	node: AST.ParentNode,
	kind: Regions.Container['kind'],
	parent: Regions.Container | undefined,
	index: number | undefined,
	state: ReadState
): Regions.Container {
	const container: Regions.Container = {
		blocks: [],
		containers: [],
		index,
		inlines: [],
		kind,
		node,
		parent,
	};
	let scanState: ScanState | undefined;

	for (const [childIndex, child] of (node.children ?? []).entries()) {
		if (child.type === 'html') {
			const fragment = readFragment(
				child as AST.HTMLNode,
				container,
				childIndex,
				undefined,
				scanState,
				state
			);
			scanState = fragment.state;
			container.blocks.push(fragment.fragment);
		} else {
			readBlock(child, container, childIndex, state);
		}
	}

	return container;
}

/**
 * Reads the raw HTML in a block other than an HTML block, at any depth.
 */
function readBlock(
	node: AST.Node,
	container: Regions.Container,
	index: number,
	state: ReadState
): void {
	if (node.type === 'footnoteDefinition') {
		return;
	}

	if (node.type === 'blockquote' || node.type === 'listItem') {
		container.containers.push(
			readContainer(
				node as AST.ParentNode,
				node.type,
				container,
				index,
				state
			)
		);
		return;
	}

	// HTML inside other syntax, such as a plugin’s, forms an inline region with
	// the node that holds it
	if (
		!INLINE_BLOCK_TYPES.has(node.type) &&
		!node.children?.some(({ type }) => type === 'html')
	) {
		for (const child of node.children ?? []) {
			readBlock(child, container, index, state);
		}

		return;
	}

	const inline: Regions.InlineBlock = {
		container,
		fragments: [],
		index,
		node,
	};
	let scanState: ScanState | undefined;

	for (const html of findHTMLNodes(node)) {
		const fragment = readFragment(
			html,
			container,
			index,
			node,
			scanState,
			state
		);
		scanState = fragment.state;
		inline.fragments.push(fragment.fragment);
	}

	if (inline.fragments.length > 0) {
		container.inlines.push(inline);
	}
}

/**
 * Lists the HTML nodes inside a node, in source order.
 */
function findHTMLNodes(node: AST.Node): AST.HTMLNode[] {
	return (node.children ?? []).flatMap((child) =>
		child.type === 'html' ? [child as AST.HTMLNode] : findHTMLNodes(child)
	);
}

/**
 * Lists the block quotes and list items around a container and the container
 * itself, outermost first.
 */
function listContainerNodes(container: Regions.Container): AST.Node[] {
	const nodes: AST.Node[] = [];

	for (
		let current: Regions.Container | undefined = container;
		current && current.kind !== 'root';
		current = current.parent
	) {
		nodes.unshift(current.node);
	}

	return nodes;
}

/**
 * Reads one fragment and its tokens, continuing any raw text or opaque
 * construct that an earlier fragment left unfinished.
 */
function readFragment(
	node: AST.HTMLNode,
	container: Regions.Container,
	index: number,
	block: AST.Node | undefined,
	scanState: ScanState | undefined,
	state: ReadState
): { fragment: Regions.Fragment; state: ScanState | undefined } {
	const fragment: Regions.Fragment = {
		block,
		container,
		index,
		isBlock: block === undefined,
		node,
		protection: state.protections.get(node),
		tokens: [],
	};
	const scanned = scanRawHTML(node.value, scanState);

	if (fragment.isBlock) {
		recordHTMLBlockText(
			state.document.source,
			node,
			listContainerNodes(container)
		);
	}

	fragment.tokens = scanned.tokens.map((token) => ({
		...token,
		fragment,
		position: locateFragmentOffset(state.document, fragment, token.start),
	}));
	state.document.fragments.push(fragment);

	return { fragment, state: scanned.state };
}
