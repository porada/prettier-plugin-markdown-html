import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import analyzeDocumentContext from '../analyze-document-context/index.ts';
import checkProtectedMarkdown from '../check-protected-markdown/index.ts';
import checkReferenceReadings from '../check-reference-readings/index.ts';
import formatBlockHTML from '../format-block-html/index.ts';
import formatInlineHTML from '../format-inline-html/index.ts';
import isLooseList, { isSeparatedFromNext } from '../is-loose-list/index.ts';
import renderDocumentContext from '../render-document-context/index.ts';
import { reportUnsafeLayout } from '../report-error/index.ts';

type ScopeLayout = Pick<
	AST.BlockScope,
	| 'ancestors'
	| 'endsOpenBlocks'
	| 'isListItem'
	| 'isPrintedTight'
	| 'isTight'
	| 'prefixWidth'
>;

type ScopeState = {
	activeIgnoreComments: Set<AST.Node>;
	analysis: AST.DocumentAnalysis;
	blockFragments: Set<AST.HTMLNode>;
	fragments: Set<AST.HTMLNode>;
	ignoredNodes: Set<AST.Node>;
	options: ParserOptions;
};

const IGNORE_COMMENT_PATTERN =
	/^<!--\s*prettier-ignore(?:-(end|start))?\s*-->$/;

// Prettier prints no list item number above this one
const MAX_LIST_NUMBER = 999_999_999;

export const formattedHTMLNodes = new WeakSet<AST.Node>();

/**
 * Formats raw HTML throughout a Markdown syntax tree, reporting an error when
 * the HTML is rejected in its document context or can’t be laid out without
 * changing the document’s interpretation.
 */
export default async function preprocessMarkdown(
	root: AST.Node,
	options: ParserOptions
): Promise<AST.Node> {
	if (!isRootNode(root)) {
		return root;
	}

	const context = renderDocumentContext(root, {
		filepath: options.filepath,
		parserName: options.parser === 'remark' ? 'remark' : 'markdown',
		source: options.originalText,
	});

	const { activeIgnoreComments, ignoredNodes } = collectIgnoredNodes(root);
	const isIgnored = createIgnoreCheck(ignoredNodes);

	await checkReferenceReadings(context, isIgnored, options);

	if (context.fragments.length === 0) {
		return root;
	}

	const analysis = await analyzeDocumentContext(context, options);
	await checkProtectedMarkdown(
		analysis.protectedMarkdown,
		isIgnored,
		options
	);
	const state: ScopeState = {
		activeIgnoreComments,
		analysis,
		blockFragments: new Set(
			context.fragments
				.filter(({ isBlock }) => isBlock)
				.map(({ node }) => node)
		),
		fragments: new Set(context.fragments.map(({ node }) => node)),
		ignoredNodes,
		options,
	};

	await formatScopes(
		root,
		{
			ancestors: [],
			endsOpenBlocks: true,
			isListItem: false,
			isPrintedTight: false,
			isTight: false,
			prefixWidth: 0,
		},
		state
	);

	for (const fragment of context.fragments) {
		if (!fragment.isBlock && !ignoredNodes.has(fragment.node)) {
			await formatInlineHTML(
				fragment,
				analysis.protectedStarts.has(fragment.node),
				options,
				formattedHTMLNodes
			);
		}
	}

	return root;
}

/**
 * Formats the HTML blocks of a container and of the containers nested in it.
 */
async function formatScopes(
	container: AST.ParentNode,
	layout: ScopeLayout,
	state: ScopeState,
	nestingIndentation = 0
): Promise<void> {
	const {
		activeIgnoreComments,
		analysis,
		blockFragments,
		ignoredNodes,
		options,
	} = state;

	for (const [index, child] of container.children.entries()) {
		// Tags rendered inside opaque HTML tokens belong to the token’s content
		// and aren’t formatted separately
		if (!isParentNode(child) || analysis.opaqueContainers.has(child)) {
			continue;
		}

		if (child.type === 'blockquote') {
			await formatScopes(
				child,
				{
					ancestors:
						analysis.rawAncestorsByContainer.get(child) ?? [],
					endsOpenBlocks: layout.endsOpenBlocks,
					isListItem: false,
					isPrintedTight: false,
					isTight: false,
					prefixWidth:
						layout.prefixWidth +
						(index > 0 ? nestingIndentation : 0) +
						2,
				},
				state
			);
		} else if (child.type === 'list') {
			await formatListScopes(
				child,
				layout.prefixWidth + nestingIndentation,
				state
			);
		}
	}

	const hasFragments = container.children.some(
		(child) =>
			child.type === 'html' && blockFragments.has(child as AST.HTMLNode)
	);

	if (!hasFragments) {
		return;
	}

	container.children = await formatBlockHTML(
		{
			...layout,
			activeIgnoreComments,
			children: container.children,
			formattedNodes: formattedHTMLNodes,
			ignoredNodes,
			inlineOpeners: analysis.inlineOpenersByFragment,
			protectedEnds: analysis.protectedEnds,
			protectedStarts: analysis.protectedStarts,
		},
		options
	);
}

/**
 * Formats the HTML blocks in each item of a list.
 */
async function formatListScopes(
	list: AST.ParentNode,
	prefixWidth: number,
	state: ScopeState
): Promise<void> {
	const isTight = !isLooseList(list, state.options.originalText);

	// Prettier’s printer uses each item’s `spread` flag to insert blank lines
	// within and between items. Its reading of looseness can differ from the
	// reference renderer’s, so lists containing raw HTML use flags based on the
	// reference renderer’s blank line rules to preserve the HTML’s context.
	// Prettier prints ignored lists from their source
	const separations =
		!state.ignoredNodes.has(list) && containsFragment(list, state.fragments)
			? list.children.map((item, index) =>
					isSeparatedFromNext(
						item,
						list.children[index + 1],
						state.options.originalText
					)
				)
			: undefined;

	for (const [index, item] of list.children.entries()) {
		if (!isParentNode(item) || state.analysis.opaqueContainers.has(item)) {
			continue;
		}

		const markerWidth = getListMarkerWidth(list, index, state.options);

		// A blank line after a list item’s content doesn’t necessarily end the
		// item, so an HTML block can remain open past that content
		await formatScopes(
			item,
			{
				ancestors:
					state.analysis.rawAncestorsByContainer.get(item) ?? [],
				endsOpenBlocks: false,
				isListItem: true,
				// When `separations` is undefined, the list is ignored or
				// contains no raw HTML
				isPrintedTight: separations?.[index] === false,
				isTight,
				prefixWidth: prefixWidth + markerWidth,
			},
			state,
			// Prettier adds indentation to nested lists and to block quotes
			// after an item’s first child. The extra width is
			// `tabWidth - markerWidth`, clamped to zero through three columns
			Math.min(Math.max(state.options.tabWidth - markerWidth, 0), 3)
		);

		if (separations) {
			(item as { spread?: boolean }).spread = separations[index];

			const nextItem = list.children[index + 1];

			if (!separations[index]) {
				checkDefinitionTitles(item, state.options);
			}

			if (!separations[index] && nextItem) {
				endBeforeNextItem(item, nextItem, state.options.originalText);
			}
		}
	}
}

/**
 * Reports an error when printing a tight list item could turn a paragraph or
 * heading into the preceding link reference definition’s title by removing the
 * blank line between them.
 */
function checkDefinitionTitles(item: AST.Node, options: ParserOptions): void {
	const children = item.children ?? [];

	for (const [index, child] of children.entries()) {
		const next = children[index + 1];
		const end = child.position?.end.offset;
		const nextStart = next?.position?.start.offset;

		if (
			child.type === 'definition' &&
			(next?.type === 'heading' || next?.type === 'paragraph') &&
			end !== undefined &&
			nextStart !== undefined &&
			/\n[\t >]*\n/.test(options.originalText.slice(end, nextStart)) &&
			/^["'(]/.test(options.originalText.slice(nextStart))
		) {
			reportUnsafeLayout({
				filepath: options.filepath,
				position: next.position?.start,
				reason: `Formatting would remove the blank line before this ${next.type}, which GitHub Flavored Markdown could then read as the preceding link reference definition’s title`,
			});
		}
	}
}

/**
 * Moves a tight list item’s end position to the line break before the next
 * item. Outside MDX, Prettier’s printer treats an item as loose when its end
 * line is more than one line above the next item’s start line, even when the
 * reference renderer ignores the blank line after a thematic break.
 */
function endBeforeNextItem(
	item: AST.Node,
	nextItem: AST.Node,
	source: string
): void {
	const { position } = item;
	const nextStart = nextItem.position?.start;

	if (!position || nextStart?.offset === undefined) {
		return;
	}

	const end = source.lastIndexOf('\n', nextStart.offset - 1);

	if (end < (position.end.offset ?? 0)) {
		return;
	}

	item.position = {
		...position,
		end: {
			column: end - source.lastIndexOf('\n', end - 1),
			line: nextStart.line - 1,
			offset: end,
		},
	};
}

/**
 * Checks whether a node contains a raw HTML fragment.
 */
function containsFragment(
	node: AST.Node,
	fragments: ReadonlySet<AST.Node>
): boolean {
	return (node.children ?? []).some(
		(child) => fragments.has(child) || containsFragment(child, fragments)
	);
}

/**
 * Returns the width of the marker that Prettier prints for a list item,
 * including the spaces after it. Accounts for Prettier’s repeated `1.`
 * numbering and alignment of ordered markers to tab stops.
 */
function getListMarkerWidth(
	list: AST.ParentNode,
	index: number,
	options: ParserOptions
): number {
	const { isAligned, ordered, start } = list as {
		isAligned?: boolean;
		ordered?: boolean;
		start?: unknown;
	};

	if (!ordered) {
		return 2;
	}

	const first = typeof start === 'number' ? start : 1;
	let number = Math.min(first + index, MAX_LIST_NUMBER);

	if (index === 0) {
		number = first;
	} else if (isNumberedAsOne(list, options)) {
		number = 1;
	}

	const width = `${number}. `.length;
	const remainder = width % options.tabWidth;
	const alignment = remainder === 0 ? 0 : options.tabWidth - remainder;

	return isAligned && alignment < 4 ? width + alignment : width;
}

/**
 * Checks whether Prettier uses `1.` for every item after the first, as when the
 * source uses `1.` throughout or starts with `0.`, `1.`, `1.`.
 */
function isNumberedAsOne(
	list: AST.ParentNode,
	options: ParserOptions
): boolean {
	const [first, second, third] = list.children.map((item) =>
		Number(
			/^\d+/.exec(
				options.originalText.slice(item.position?.start.offset ?? 0)
			)?.[0]
		)
	);

	if (second !== 1) {
		return false;
	}

	return first !== 0 || third === 1;
}

/**
 * Collects nodes that Markdown ignore comments protect from formatting, and the
 * comments that Prettier honors.
 */
function collectIgnoredNodes(root: AST.Node): {
	activeIgnoreComments: Set<AST.Node>;
	ignoredNodes: Set<AST.Node>;
} {
	const activeIgnoreComments = new Set<AST.Node>();
	const ignoredNodes = new Set<AST.Node>();
	const pending: AST.Node[] = [root];

	while (pending.length > 0) {
		const node = pending.pop()!;
		let previous: AST.Node | undefined;

		for (const child of node.children ?? []) {
			if (previous && getIgnoreCommentKind(previous) === 'next') {
				activeIgnoreComments.add(previous);
				markIgnored(child, ignoredNodes);
			}

			pending.push(child);
			previous = child;
		}
	}

	// Prettier honors ignore ranges only at the document root, and only when
	// they’re closed
	let rangeStart: number | undefined;

	for (const [index, child] of (root.children ?? []).entries()) {
		const kind = getIgnoreCommentKind(child);

		if (rangeStart === undefined && kind === 'start') {
			rangeStart = index;
		} else if (rangeStart !== undefined && kind === 'end') {
			for (const ignored of root.children!.slice(rangeStart + 1, index)) {
				markIgnored(ignored, ignoredNodes);
			}

			activeIgnoreComments.add(root.children![rangeStart]!);
			activeIgnoreComments.add(child);
			rangeStart = undefined;
		}
	}

	return { activeIgnoreComments, ignoredNodes };
}

/**
 * Returns the kind of Prettier ignore comment that a node holds: `next` for a
 * comment that ignores the next node, or `start` or `end` for a comment that
 * bounds an ignored range. Returns `undefined` for other nodes.
 */
function getIgnoreCommentKind(
	node: AST.Node
): 'end' | 'next' | 'start' | undefined {
	const match =
		node.type === 'html'
			? IGNORE_COMMENT_PATTERN.exec(node.value ?? '')
			: null;

	if (!match) {
		return undefined;
	}

	return (match[1] as 'end' | 'start' | undefined) ?? 'next';
}

/**
 * Creates a check for whether ignore comments protect a node’s source, which
 * also covers nodes reparsed from that source.
 */
function createIgnoreCheck(
	ignoredNodes: ReadonlySet<AST.Node>
): (node: AST.Node) => boolean {
	const ranges = [...ignoredNodes].flatMap(({ position }) =>
		position?.start.offset === undefined ||
		position.end.offset === undefined
			? []
			: [{ end: position.end.offset, start: position.start.offset }]
	);

	return (node) => {
		const start = node.position?.start.offset;
		const end = node.position?.end.offset;

		return (
			ignoredNodes.has(node) ||
			(start !== undefined &&
				end !== undefined &&
				ranges.some(
					(range) => range.start <= start && end <= range.end
				))
		);
	};
}

/**
 * Marks a node and its descendants as protected by an ignore comment.
 */
function markIgnored(node: AST.Node, ignoredNodes: Set<AST.Node>): void {
	ignoredNodes.add(node);

	for (const child of node.children ?? []) {
		markIgnored(child, ignoredNodes);
	}
}

/**
 * Recognizes nodes with children.
 */
function isParentNode(node: AST.Node | undefined): node is AST.ParentNode {
	return Array.isArray(node?.children);
}

/**
 * Recognizes Markdown root nodes.
 */
function isRootNode(node: AST.Node | undefined): node is AST.RootNode {
	return node?.type === 'root' && Array.isArray(node.children);
}
