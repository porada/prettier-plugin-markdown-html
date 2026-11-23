import type { ParserOptions } from 'prettier';
import type { RegionDecisions, Rejection } from '../decide-regions/index.ts';
import type { AST, Regions } from '../types/index.d.ts';
import { parsers as markdownParsers } from 'prettier/plugins/markdown';
import { IGNORE_COMMENT_PATTERN } from '../constants/index.ts';
import decideRegions, {
	createRoleSentinels,
	diagnoseFormatting,
	findChangedBlocks,
	findChangedRoles,
	findMovedIgnoreComments,
	findRegionAt,
	isRejected,
	listContainerAncestors,
	listNotices,
	listRegions,
	listRejectedNodes,
	listUnmarkableRegions,
	locateRoleSentinels,
} from '../decide-regions/index.ts';
import formatBlockHTML, {
	getScopeOptions,
} from '../format-block-html/index.ts';
import formatInlineHTML from '../format-inline-html/index.ts';
import removeHTMLNode from '../remove-html-node/index.ts';
import { isFormatterFailure } from '../report-error/index.ts';
import reportNotices from '../report-notices/index.ts';

type ScopeLayout = Pick<
	AST.BlockScope,
	| 'ancestors'
	| 'endsOpenBlocks'
	| 'isListItem'
	| 'isPrintedTight'
	| 'prefixWidth'
>;

type ScopeState = {
	activeIgnoreComments: Set<AST.Node>;
	// HTML blocks of accepted regions
	blockFragments: Set<AST.HTMLNode>;
	decisions: RegionDecisions;
	// HTML of accepted regions
	fragments: Set<AST.HTMLNode>;
	ignoredNodes: Set<AST.Node>;
	options: ParserOptions;
	// Where each paragraph’s printed lines and its container’s content start
	paragraphEdges: Map<
		AST.Node,
		Pick<AST.InlineLayout, 'containerEdge' | 'contentEdge'>
	>;
};

// The own properties of a node before layout, to restore after a region fails
type NodeSnapshot = {
	node: AST.Node;
	properties: Record<string, unknown>;
};

// Prettier prints no list item number above this one
const MAX_LIST_NUMBER = 999_999_999;

export const formattedHTMLNodes = new WeakSet<AST.Node>();

/**
 * Reports regions whose layout fails, so formatting can start again with those
 * regions rejected.
 */
class RegionLayoutError extends Error {
	readonly rejections: ReadonlyArray<{
		problem: Rejection;
		region: Regions.Region;
	}>;

	constructor(
		cause: unknown,
		rejections: ReadonlyArray<{
			problem: Rejection;
			region: Regions.Region;
		}>
	) {
		super(
			'Formatting would change how Prettier reads the Markdown around this HTML.',
			{ cause }
		);
		this.name = 'RegionLayoutError';
		this.rejections = rejections;
	}
}

/**
 * Formats raw HTML region by region and reports rejected regions as notices. The
 * optional printer checks whether each fragment keeps its source role.
 */
export default async function preprocessMarkdown(
	root: AST.Node,
	options: ParserOptions,
	print?: (
		root: AST.RootNode,
		sentinels: ReadonlyMap<AST.Node, string>
	) => Promise<string>
): Promise<AST.Node> {
	if (!isRootNode(root)) {
		return root;
	}

	const decisions = await decideRegions(root, options);
	const { activeIgnoreComments, ignoredNodes } = collectIgnoredNodes(root);
	const snapshots = snapshotNodes(root);

	// Each failed attempt rejects at least one more region
	for (;;) {
		try {
			await layOutDocument(root, {
				activeIgnoreComments,
				decisions,
				ignoredNodes,
				options,
			});

			// Without fragments, no role can change
			const changes =
				print && decisions.documentRegions.document.fragments.length > 0
					? await checkRoles(root, decisions, options, print)
					: [];

			if (changes.length > 0) {
				throw new RegionLayoutError(undefined, changes);
			}

			break;
		} catch (error: unknown) {
			const { problems } = decisions;

			// A failure that no accepted region can explain isn’t an HTML problem
			if (!(error instanceof RegionLayoutError)) {
				throw error;
			}

			restoreNodes(snapshots);

			// One that rejects no further region would fail again the same way,
			// so the remaining accepted regions are rejected with it
			const isRepeated = error.rejections.every(({ region }) =>
				problems.has(region)
			);
			const rejections = isRepeated
				? listRegions(decisions)
						.filter((region) => !problems.has(region))
						.map((region) => ({
							region,
							problem: {
								...error.rejections[0]!.problem,
								position: region.position,
							},
						}))
				: error.rejections;

			if (rejections.length === 0) {
				break;
			}

			for (const { problem, region } of rejections) {
				problems.set(region, problem);
			}
		}
	}

	reportNotices(listNotices(decisions), options);

	return root;
}

/**
 * Checks that inline HTML stays inline, blocks keep their layout, and ignore
 * directives still protect the same targets after a trial print.
 */
async function checkRoles(
	root: AST.RootNode,
	decisions: RegionDecisions,
	options: ParserOptions,
	print: (
		root: AST.RootNode,
		sentinels: ReadonlyMap<AST.Node, string>
	) => Promise<string>
): Promise<Array<{ problem: Rejection; region: Regions.Region }>> {
	// Characters that something other than a sentinel printed
	const excluded = new Set<string>();
	let printed: ReturnType<typeof locateRoleSentinels>;

	// Each ambiguous trial print excludes at least one more character
	for (;;) {
		const sentinels = createRoleSentinels(decisions, excluded);

		// Without sentinels, the role check can’t locate any fragment, so every
		// region it would check falls back to plain Prettier. The trial print
		// still runs, so an error that Prettier raises comes first
		if (sentinels.size === 0) {
			await print(root, sentinels);

			return listUnmarkableRegions(decisions);
		}

		printed = locateRoleSentinels(await print(root, sentinels), sentinels);

		if (printed.ambiguous.size === 0) {
			break;
		}

		for (const character of printed.ambiguous) {
			excluded.add(character);
		}
	}

	const formattedRoot = (await markdownParsers[
		options.parser === 'remark' ? 'remark' : 'markdown'
	].parse(printed.text, { originalText: '' } as ParserOptions)) as AST.Node;
	const changedBlocks = findChangedBlocks(decisions, formattedRoot, printed);

	// A changed block can take in later fragments, which get another check
	// once the block is rejected
	if (changedBlocks.length > 0) {
		return changedBlocks;
	}

	return [
		...findChangedRoles(decisions, formattedRoot, printed.offsets),
		// An ignore comment that formatting moves to a line of its own can
		// protect different HTML on the next pass
		...(await findMovedIgnoreComments(decisions, formattedRoot, printed)),
	];
}

/**
 * Formats the raw HTML of the regions that aren’t rejected.
 */
async function layOutDocument(
	root: AST.RootNode,
	{
		activeIgnoreComments,
		decisions,
		ignoredNodes,
		options,
	}: Pick<
		ScopeState,
		'activeIgnoreComments' | 'decisions' | 'ignoredNodes' | 'options'
	>
): Promise<void> {
	const rejectedNodes = listRejectedNodes(decisions);

	applyClosingTagCorrections(root, decisions, rejectedNodes);

	const accepted = decisions.documentRegions.document.fragments.filter(
		({ node }) =>
			!rejectedNodes.has(node) && !decisions.removedNodes.has(node)
	);
	const state: ScopeState = {
		activeIgnoreComments,
		blockFragments: new Set(
			accepted.filter(({ isBlock }) => isBlock).map(({ node }) => node)
		),
		decisions,
		fragments: new Set(accepted.map(({ node }) => node)),
		ignoredNodes,
		options,
		paragraphEdges: new Map(),
	};

	await formatScopes(
		root,
		{
			ancestors: [],
			endsOpenBlocks: true,
			isListItem: false,
			isPrintedTight: false,
			prefixWidth: 0,
		},
		state
	);
	alignListItemHTML(root);

	const parents = indexParents(root);

	for (const region of listRegions(decisions)) {
		if (region.kind !== 'inline' || isRejected(decisions, region)) {
			continue;
		}

		const fragments = region.fragments
			.filter(
				({ node }) =>
					!ignoredNodes.has(node) && !decisions.removedNodes.has(node)
			)
			.map((fragment) => toInlineFragment(fragment, parents));
		const layout = getInlineLayout(region, state);

		try {
			await formatInlineHTML(
				fragments,
				layout,
				options,
				formattedHTMLNodes
			);
		} catch (error: unknown) {
			throw new RegionLayoutError(error, [
				{ region, problem: describeLayoutFailure(error, region) },
			]);
		}
	}
}

/**
 * Applies closing tag corrections to accepted regions and removes inline nodes
 * they leave empty.
 */
function applyClosingTagCorrections(
	root: AST.RootNode,
	decisions: RegionDecisions,
	rejectedNodes: ReadonlySet<AST.Node>
): void {
	const { closingTags } = decisions.documentRegions.corrections;
	const parents = indexParents(root);

	decisions.removedNodes.clear();

	for (const fragment of decisions.documentRegions.document.fragments) {
		const { node } = fragment;
		const tags = fragment.tokens.filter(
			(token): token is Regions.ClosingTag =>
				token.kind === 'closing-tag' && closingTags?.has(token) === true
		);

		if (tags.length === 0 || rejectedNodes.has(node)) {
			continue;
		}

		const value = replaceClosingTags(node.value, tags, closingTags!);

		if (value.trim() !== '') {
			node.value = value;
			continue;
		}

		removeHTMLNode(node, parents.get(node)!);
		decisions.removedNodes.add(node);
	}
}

/**
 * Replaces corrected closing tags in a fragment’s HTML.
 */
function replaceClosingTags(
	value: string,
	tags: ReadonlyArray<Regions.ClosingTag>,
	closingTags: ReadonlyMap<Regions.ClosingTag, string>
): string {
	let corrected = '';
	let offset = 0;

	for (const tag of tags) {
		corrected += value.slice(offset, tag.start) + closingTags.get(tag)!;
		offset = tag.end;
	}

	return corrected + value.slice(offset);
}

/**
 * Describes why a region’s formatting or layout failed. The error’s own location
 * in the original Markdown applies when it lies in the region.
 */
function describeLayoutFailure(
	error: unknown,
	region: Regions.Region
): Rejection {
	const location = (error as { loc?: { start?: AST.Point } }).loc?.start;
	const position =
		location && findRegionAt([region], location)
			? { column: location.column, line: location.line }
			: region.position;

	return isFormatterFailure(error)
		? { cause: error.cause, kind: 'unformattable', position }
		: { cause: error, kind: 'unsafe-layout', position };
}

/**
 * Formats HTML blocks in this container and its descendants. A failure rejects
 * the responsible region if it can be identified. Otherwise it rejects all
 * accepted regions in the affected scope.
 */
async function formatScopes(
	container: AST.ParentNode,
	layout: ScopeLayout,
	state: ScopeState,
	nestingIndentation = 0
): Promise<void> {
	const { activeIgnoreComments, blockFragments, ignoredNodes, options } =
		state;

	for (const [index, child] of container.children.entries()) {
		if (!isParentNode(child)) {
			continue;
		}

		// Prettier indents an item’s later children like nested lists, and
		// aligns a task item’s first child after its checkbox
		if (child.type === 'paragraph') {
			state.paragraphEdges.set(child, {
				containerEdge: layout.prefixWidth,
				contentEdge:
					layout.prefixWidth +
					(index > 0
						? nestingIndentation
						: getCheckboxWidth(container)),
			});
		} else if (child.type === 'blockquote') {
			await formatScopes(
				child,
				{
					ancestors: listContainerAncestors(state.decisions, child),
					endsOpenBlocks: layout.endsOpenBlocks,
					isListItem: false,
					isPrintedTight: false,
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

	// After a nested list that starts an item, the item’s HTML blocks print at
	// the nested list’s indentation
	const blockLayout =
		layout.isListItem && container.children[0]?.type === 'list'
			? {
					...layout,
					prefixWidth: layout.prefixWidth + nestingIndentation,
				}
			: layout;

	try {
		container.children = await formatBlockHTML(
			{
				...blockLayout,
				activeIgnoreComments,
				blockFragments,
				children: container.children,
				formattedNodes: formattedHTMLNodes,
				ignoredNodes,
			},
			options
		);
	} catch (error: unknown) {
		throw new RegionLayoutError(
			error,
			await attributeFailure(
				error,
				container,
				state,
				getScopeOptions(blockLayout, options)
			)
		);
	}
}

/**
 * Locates the accepted region responsible for a layout failure. Falls back to
 * the scope’s outermost accepted regions when the failure cannot be located.
 */
async function attributeFailure(
	error: unknown,
	scope: AST.Node,
	state: ScopeState,
	options: ParserOptions = state.options
): Promise<Array<{ problem: Rejection; region: Regions.Region }>> {
	const { decisions } = state;
	const regions = listRegions(decisions).filter(
		(region) => isWithin(region, scope) && !isRejected(decisions, region)
	);
	const outerRegions = regions.filter(
		({ parent }) => !parent || !regions.includes(parent)
	);

	if (isFormatterFailure(error)) {
		const diagnosis = await diagnoseFormatting(regions, decisions, options);

		if (diagnosis) {
			return [diagnosis];
		}
	} else {
		const location = (error as { loc?: { start?: AST.Point } }).loc?.start;
		const region = location && findRegionAt(outerRegions, location);

		/* v8 ignore else -- @preserve */
		if (region) {
			return [{ region, problem: describeLayoutFailure(error, region) }];
		}
	}

	// A failure that names no accepted region rejects them all, so the next
	// attempt doesn’t fail the same way
	/* v8 ignore next -- @preserve */
	return outerRegions.map((region) => ({
		region,
		problem: describeLayoutFailure(error, region),
	}));
}

/**
 * Checks whether a region lies in a container or list, at any depth.
 */
function isWithin(region: Regions.Region, scope: AST.Node): boolean {
	for (
		let container: Regions.Container | undefined = region.container;
		container;
		container = container.parent
	) {
		if (
			container.node === scope ||
			scope.children?.includes(container.node)
		) {
			return true;
		}
	}

	return false;
}

/**
 * Returns the width of the checkbox that Prettier prints for a task list item,
 * including the space after it.
 */
function getCheckboxWidth(container: AST.Node): number {
	return typeof (container as { checked?: unknown }).checked === 'boolean'
		? 4
		: 0;
}

/**
 * Returns the layout of a paragraph, heading, or table cell with inline HTML,
 * if formatting reached it.
 */
function getInlineLayout(
	region: Regions.InlineRegion,
	state: ScopeState
): AST.InlineLayout | undefined {
	const edges = state.paragraphEdges.get(region.node);
	const containers: AST.Node[] = [];

	for (
		let container: Regions.Container | undefined = region.container;
		container?.parent;
		container = container.parent
	) {
		containers.unshift(container.node);
	}

	return edges
		? {
				...edges,
				containers,
				paragraph: region.node,
				removedNodes: region.fragments
					.filter(({ node }) =>
						state.decisions.removedNodes.has(node)
					)
					.map(({ node }) => node),
			}
		: undefined;
}

/**
 * Identifies the inline node’s parent and whether its tag must fit on one line.
 */
function toInlineFragment(
	fragment: Regions.Fragment,
	parents: ReadonlyMap<AST.Node, AST.Node>
): AST.Fragment {
	const block = fragment.block!;

	return {
		isSingleLine: block.type === 'heading' || block.type === 'tableCell',
		node: fragment.node,
		parent: parents.get(fragment.node)!,
	};
}

/**
 * Maps each node of a syntax tree to its parent.
 */
function indexParents(root: AST.Node): Map<AST.Node, AST.Node> {
	const parents = new Map<AST.Node, AST.Node>();
	const pending = [root];

	for (const node of pending) {
		for (const child of node.children ?? []) {
			parents.set(child, node);
			pending.push(child);
		}
	}

	return parents;
}

/**
 * Saves each node’s own properties so a failed layout can be retried.
 */
function snapshotNodes(root: AST.Node): NodeSnapshot[] {
	const snapshots: NodeSnapshot[] = [];
	const pending = [root];

	for (const node of pending) {
		snapshots.push({ node, properties: { ...node } });
		pending.push(...(node.children ?? []));
	}

	return snapshots;
}

/**
 * Aligns a formatted HTML block with the first child of a two-child list item
 * so Prettier preserves the item’s indentation.
 */
function alignListItemHTML(node: AST.Node): void {
	const children = node.children ?? [];
	const [first, second] = children;

	if (
		node.type === 'listItem' &&
		children.length === 2 &&
		second?.position &&
		formattedHTMLNodes.has(second) &&
		first?.position
	) {
		second.position = {
			...second.position,
			start: {
				...second.position.start,
				column: first.position.start.column,
			},
		};
	}

	for (const child of children) {
		alignListItemHTML(child);
	}
}

/**
 * Restores the nodes of a syntax tree to their recorded properties, and forgets
 * what the failed layout recorded for them.
 */
function restoreNodes(snapshots: ReadonlyArray<NodeSnapshot>): void {
	for (const { node, properties } of snapshots) {
		for (const key of Object.keys(node)) {
			// Formatting adds no properties at present, but one it added would
			// otherwise carry into the next attempt
			/* v8 ignore next -- @preserve */
			if (!Object.hasOwn(properties, key)) {
				Reflect.deleteProperty(node, key);
			}
		}

		Object.assign(node, properties);
		formattedHTMLNodes.delete(node);
	}
}

/**
 * Formats the HTML blocks in each item of a list.
 */
async function formatListScopes(
	list: AST.ParentNode,
	prefixWidth: number,
	state: ScopeState
): Promise<void> {
	for (const [index, item] of list.children.entries()) {
		if (!isParentNode(item)) {
			continue;
		}

		const markerWidth = getListMarkerWidth(list, index, state.options);
		const isPrintedTight = !isPrintedLooseItem(
			item,
			list.children[index + 1]
		);

		// A blank line after a list item’s content doesn’t necessarily end the
		// item, so an HTML block can remain open past that content
		await formatScopes(
			item,
			{
				ancestors: listContainerAncestors(state.decisions, item),
				endsOpenBlocks: false,
				isListItem: true,
				isPrintedTight,
				prefixWidth: prefixWidth + markerWidth,
			},
			state,
			// Prettier adds indentation to nested lists and to block quotes
			// after an item’s first child. The extra width is
			// `tabWidth - markerWidth`, clamped to zero through three columns
			Math.min(Math.max(state.options.tabWidth - markerWidth, 0), 3)
		);
	}
}

/**
 * Checks whether Prettier’s Markdown printer prints a list item loose, with
 * blank lines between its children and after it.
 */
function isPrintedLooseItem(
	item: AST.Node,
	next: AST.Node | undefined
): boolean {
	const end = item.position?.end.line;
	const nextStart = next?.position?.start.line;

	return (
		(item as { spread?: boolean }).spread === true ||
		(end !== undefined && nextStart !== undefined && end + 1 < nextStart)
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
				options.originalText.slice(item.position?.start.offset)
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
function collectIgnoredNodes(root: AST.RootNode): {
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

	for (const [index, child] of root.children.entries()) {
		const kind = getIgnoreCommentKind(child);

		if (rangeStart === undefined && kind === 'start') {
			rangeStart = index;
		} else if (rangeStart !== undefined && kind === 'end') {
			for (const ignored of root.children.slice(rangeStart + 1, index)) {
				markIgnored(ignored, ignoredNodes);
			}

			activeIgnoreComments.add(root.children[rangeStart]!);
			activeIgnoreComments.add(child);
			rangeStart = undefined;
		}
	}

	return { activeIgnoreComments, ignoredNodes };
}

/**
 * Identifies a Prettier ignore comment as `next`, `start`, or `end`. Returns
 * `undefined` for other nodes.
 */
function getIgnoreCommentKind(
	node: AST.Node
): 'end' | 'next' | 'start' | undefined {
	const match =
		node.type === 'html'
			? IGNORE_COMMENT_PATTERN.exec((node as AST.HTMLNode).value)
			: null;

	if (!match) {
		return undefined;
	}

	return (match[1] as 'end' | 'start' | undefined) ?? 'next';
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
