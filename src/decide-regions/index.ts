import type { ParserOptions } from 'prettier';
import type { AST, Regions } from '../types/index.d.ts';
import checkRegionAcceptance from '../check-region-acceptance/index.ts';
import decideCorrections, {
	findHTMLIgnoreTargets,
	isProtectedByHTMLIgnore,
} from '../decide-corrections/index.ts';
import findDocumentRegions, {
	findEndFragment,
	matchRawTags,
} from '../find-document-regions/index.ts';
import formatHTML, { findParseErrorLocation } from '../format-html/index.ts';
import { endsInContinuingBlock } from '../is-html-block-sequence/index.ts';
import readRawHTML, {
	locateFragmentOffset,
	locateOffset,
} from '../read-raw-html/index.ts';
import renderRegionHTML, {
	locateHTMLOffset,
} from '../render-region-html/index.ts';

// A region whose layout can’t preserve the document: the plugin’s layout check
// fails, Prettier’s Markdown parser no longer reads a fragment of the formatted
// document in its source role, an HTML block of the formatted document takes in
// the Markdown that Prettier prints on the next line, formatting would move an
// ignore comment to a line of its own where it would protect part of an
// element on the next pass, or no unused character can mark the region’s
// fragments during the role check
type LayoutProblem =
	| {
			// The plugin’s layout error
			cause: unknown;
			kind: 'unsafe-layout';
			position: AST.Point;
	  }
	| {
			kind: 'changed-role';
			position: AST.Point;
	  }
	| {
			kind: 'moved-block';
			position: AST.Point;
	  }
	| {
			kind: 'moved-ignore-comment';
			position: AST.Point;
	  }
	| {
			kind: 'open-block';
			position: AST.Point;
	  }
	| {
			kind: 'reindented-block';
			position: AST.Point;
	  }
	| {
			kind: 'unmarkable';
			position: AST.Point;
	  };

export type RegionDecisions = {
	documentRegions: Regions.DocumentRegions;
	// The element that each HTML ignore directive protects, with where the
	// directive starts, read from the source before any formatting
	htmlIgnoreTargets: Array<{ element: Regions.Element; start: number }>;
	// The problem that rejects each rejected region, from the acceptance rules or
	// from the region’s formatting and layout
	problems: Map<Regions.Region, Rejection>;
	// HTML nodes that corrections remove from the current layout: inline
	// fragments and HTML blocks left without content
	removedNodes: Set<AST.Node>;
};

export type Rejection = LayoutProblem | Regions.Problem;

// Characters that can form sentinels, which Prettier’s printer gives no width:
// control characters other than tabs and line breaks, and diacritics in the
// Combining Diacritical Marks block
const SENTINEL_CHARACTERS = [
	// Each range’s first code point and length
	[0x1, 31],
	[0x80, 32],
	[0x3_00, 112],
]
	.flatMap(([start, length]) =>
		Array.from({ length: length! }, (_, index) =>
			String.fromCodePoint(start! + index)
		)
	)
	.filter((character) => !/[\t\n\r]/.test(character));

const SENTINEL_PATTERN = new RegExp(`[${SENTINEL_CHARACTERS.join('')}]`, 'gu');

// The innermost region that owns each fragment of a document’s regions
const fragmentOwners = new WeakMap<
	Regions.DocumentRegions,
	ReadonlyMap<Regions.Fragment, Regions.Region>
>();

// A comment that Prettier’s Markdown parser reads as a Markdown ignore
// directive when it stands alone
const MARKDOWN_IGNORE_PATTERN = /^<!--\s*prettier-ignore\s*-->$/;

// Markdown nodes whose children are blocks
const CONTAINER_TYPES: ReadonlySet<string | undefined> = new Set([
	'blockquote',
	'list',
	'listItem',
	'root',
]);

/**
 * Divides the Markdown tree into regions and decides which can be formatted.
 */
export default async function decideRegions(
	root: AST.RootNode,
	options: ParserOptions
): Promise<RegionDecisions> {
	const document = readRawHTML(root, options.originalText ?? '');
	const corrections = await decideCorrections(document);
	const documentRegions = await findDocumentRegions(document, corrections);
	const verdicts = await checkRegionAcceptance(documentRegions);
	const problems = new Map<Regions.Region, Rejection>();
	const decisions: RegionDecisions = {
		documentRegions,
		htmlIgnoreTargets: [],
		problems,
		removedNodes: new Set(),
	};

	for (const [region, verdict] of verdicts) {
		if (!verdict.isAccepted) {
			problems.set(region, verdict.problem);
		}
	}

	decisions.htmlIgnoreTargets = findHTMLIgnoreTargets(
		document,
		listRegions(decisions)
	);

	// An HTML ignore directive reaches only its own HTML block, so a protected
	// element that continues past it crosses the protection
	for (const { element } of decisions.htmlIgnoreTargets) {
		const region = findFragmentRegion(decisions, element.opening.fragment);

		if (
			findEndFragment(element) !== element.opening.fragment &&
			!problems.has(region)
		) {
			problems.set(region, {
				element,
				kind: 'crossed-protection',
				position: element.opening.position,
			});
		}
	}

	return decisions;
}

/**
 * Lists every region in source order, each before the regions nested in it.
 */
export function listRegions(decisions: RegionDecisions): Regions.Region[] {
	const regions: Regions.Region[] = [];

	const visit = (region: Regions.Region): void => {
		regions.push(region);

		for (const nested of region.regions) {
			visit(nested);
		}
	};

	for (const region of decisions.documentRegions.regions) {
		visit(region);
	}

	return regions;
}

/**
 * Checks whether this region or any enclosing region was rejected.
 */
export function isRejected(
	decisions: RegionDecisions,
	region: Regions.Region
): boolean {
	for (
		let current: Regions.Region | undefined = region;
		current;
		current = current.parent
	) {
		if (decisions.problems.has(current)) {
			return true;
		}
	}

	return false;
}

/**
 * Lists HTML nodes in rejected regions and their descendants in source order.
 */
export function listRejectedNodes(decisions: RegionDecisions): Set<AST.Node> {
	const nodes: AST.Node[] = [];

	const visit = (
		region: Regions.Region,
		isInRejectedRegion: boolean
	): void => {
		const isRejectedRegion =
			isInRejectedRegion || decisions.problems.has(region);

		if (isRejectedRegion) {
			nodes.push(...region.fragments.map(({ node }) => node));
		}

		for (const nested of region.regions) {
			visit(nested, isRejectedRegion);
		}
	};

	for (const region of decisions.documentRegions.regions) {
		visit(region, false);
	}

	return new Set(
		nodes.toSorted(
			(a, b) =>
				/* v8 ignore start -- @preserve */
				(a.position?.start.offset ?? 0) -
				(b.position?.start.offset ?? 0)
			/* v8 ignore stop -- @preserve */
		)
	);
}

/**
 * Lists enclosing raw element names from outermost to innermost.
 */
export function listContainerAncestors(
	decisions: RegionDecisions,
	containerNode: AST.Node
): string[] {
	const region = listRegions(decisions).find(
		({ container }) => container.node === containerNode
	);

	return (region?.ancestors ?? [])
		.filter(
			({ opening }) => opening.fragment.container !== region!.container
		)
		.map(({ opening }) => opening.name);
}

/**
 * Finds the innermost region whose source contains a point, among the given regions
 * and the regions nested in them.
 */
export function findRegionAt(
	regions: ReadonlyArray<Regions.Region>,
	point: Pick<AST.Point, 'column' | 'line'>
): Regions.Region | undefined {
	for (const region of regions) {
		const nodes = region.kind === 'block' ? region.nodes : [region.node];
		const start = nodes[0]!.position?.start;
		const end = nodes.at(-1)!.position?.end;

		if (
			start &&
			end &&
			comparePoints(start, point) <= 0 &&
			comparePoints(point, end) <= 0
		) {
			return findRegionAt(region.regions, point) ?? region;
		}
	}

	return undefined;
}

/**
 * Finds the first formatting failure, checking nested regions before their
 * parents. Uses the parser’s error location or the region’s start.
 */
export async function diagnoseFormatting(
	regions: ReadonlyArray<Regions.Region>,
	decisions: RegionDecisions,
	options: ParserOptions
): Promise<{ problem: Rejection; region: Regions.Region } | undefined> {
	const diagnose = async (
		region: Regions.Region
	): Promise<{ problem: Rejection; region: Regions.Region } | undefined> => {
		for (const nested of region.regions.filter((candidate) =>
			regions.includes(candidate)
		)) {
			const diagnosis = await diagnose(nested);

			if (diagnosis) {
				return diagnosis;
			}
		}

		const regionHTML = renderRegionHTML(
			region,
			decisions.documentRegions.corrections,
			(nested) => !decisions.problems.has(nested)
		);

		try {
			await formatHTML(regionHTML.html, options);
		} catch (error: unknown) {
			const location = await findParseErrorLocation(
				regionHTML.html,
				options
			);

			return {
				region,
				problem: {
					cause: (error as Error).cause,
					kind: 'unformattable',
					position:
						(location &&
							locateHTMLOffset(
								regionHTML,
								location,
								decisions.documentRegions.document
							)) ??
						region.position,
				},
			};
		}

		return undefined;
	};

	for (const region of regions.filter(
		({ parent }) => !parent || !regions.includes(parent)
	)) {
		const diagnosis = await diagnose(region);

		if (diagnosis) {
			return diagnosis;
		}
	}

	return undefined;
}

/**
 * Marks surviving, unprotected fragments in accepted and rejected regions.
 * Returns an empty map when no usable marker characters remain.
 */
export function createRoleSentinels(
	decisions: RegionDecisions,
	excluded: ReadonlySet<string> = new Set()
): Map<AST.Node, string> {
	const { source } = decisions.documentRegions.document;
	const used = new Set(source.match(SENTINEL_PATTERN));
	const digits = SENTINEL_CHARACTERS.filter(
		(character) => !used.has(character) && !excluded.has(character)
	);
	const sentinels = new Map<AST.Node, string>();

	if (digits.length === 0) {
		return sentinels;
	}

	for (const [index, { node }] of [
		...listCheckedFragments(decisions),
		...listCheckedFragments(decisions, true),
	].entries()) {
		sentinels.set(node, encodeSentinel(index, digits));
	}

	return sentinels;
}

/**
 * Locates fragments and removes recognized markers from the trial print.
 * Reports ambiguous characters to exclude from the next attempt.
 */
export function locateRoleSentinels(
	printed: string,
	sentinels: ReadonlyMap<AST.Node, string>
): {
	ambiguous: Set<string>;
	offsets: Map<AST.Node, number>;
	text: string;
} {
	const nodes = new Map(
		[...sentinels].map(([node, sentinel]) => [sentinel, node])
	);
	const offsets = new Map<AST.Node, number>();
	const ambiguous = new Set<string>();
	const digits = new Set<string>();

	for (const sentinel of sentinels.values()) {
		for (const digit of sentinel) {
			digits.add(digit);
		}
	}

	let text = '';
	let offset = 0;

	for (const match of printed.matchAll(
		new RegExp(`[${[...digits].join('')}]+`, 'gu')
	)) {
		const node = nodes.get(match[0]);

		if (!node || offsets.has(node)) {
			for (const character of match[0]) {
				ambiguous.add(character);
			}

			continue;
		}

		text += printed.slice(offset, match.index);
		offset = match.index + match[0].length;
		// Indentation can follow the sentinel, before the fragment’s text
		offsets.set(
			node,
			text.length + /^[\t ]*/.exec(printed.slice(offset))![0].length
		);
	}

	return { ambiguous, offsets, text: text + printed.slice(offset) };
}

/**
 * Reports each accepted region at the first HTML ignore directive whose target
 * would change on the next pass.
 */
export async function findMovedIgnoreComments(
	decisions: RegionDecisions,
	formattedRoot: AST.Node,
	{ offsets, text }: { offsets: ReadonlyMap<AST.Node, number>; text: string }
): Promise<Array<{ problem: Rejection; region: Regions.Region }>> {
	const directives = listMarkdownIgnoreDirectives(formattedRoot);

	if (directives.length === 0) {
		return [];
	}

	const { document } = decisions.documentRegions;
	const located = document.fragments
		.filter(({ isBlock, node }) => isBlock && offsets.has(node))
		.map((fragment) => ({ fragment, offset: offsets.get(fragment.node)! }))
		.toSorted((a, b) => a.offset - b.offset);
	const printedDocument = readRawHTML(formattedRoot as AST.RootNode, text);
	// Ignore comments in the trial print, by the same token rules as in the
	// source, so comment-like text in attributes or raw text doesn’t count
	const printedComments = printedDocument.fragments.flatMap(({ tokens }) =>
		tokens
			.filter((token) => isIgnoreComment(token, text))
			.map(({ position }) => position.offset!)
	);
	const moved = new Map<Regions.Region, Rejection>();

	for (const { comment, next } of directives) {
		// The trial print’s syntax tree has source positions
		const offset = comment.position!.start.offset!;
		const owner = located.findLast(
			(candidate) => candidate.offset <= offset
		);

		// A comment that stands alone in the source is Prettier’s own
		if (!owner || MARKDOWN_IGNORE_PATTERN.test(owner.fragment.node.value)) {
			continue;
		}

		const { fragment } = owner;
		const region = findFragmentRegion(decisions, fragment);
		const index = printedComments.filter(
			(commentOffset) =>
				commentOffset >= owner.offset && commentOffset < offset
		).length;
		const token = fragment.tokens.filter((candidate) =>
			isIgnoreComment(candidate, document.source)
		)[index];

		if (!token || moved.has(region) || isRejected(decisions, region)) {
			continue;
		}

		const target = decisions.htmlIgnoreTargets.find(
			({ start }) => start === token.position.offset
		)?.element;

		if (
			!target ||
			!(await keepsProtection(printedDocument, text, next, target))
		) {
			moved.set(region, {
				kind: 'moved-ignore-comment',
				position: token.position,
			});
		}
	}

	return [...moved].map(([region, problem]) => ({ region, problem }));
}

/**
 * Lists the comments that Prettier’s Markdown parser reads as Markdown ignore
 * directives, each with the node it protects.
 */
function listMarkdownIgnoreDirectives(
	node: AST.Node,
	directives: Array<{ comment: AST.Node; next: AST.Node }> = []
): Array<{ comment: AST.Node; next: AST.Node }> {
	const children = node.children ?? [];

	for (const [index, child] of children.entries()) {
		const next = children[index + 1];

		if (
			child.type === 'html' &&
			next &&
			MARKDOWN_IGNORE_PATTERN.test(child.value!)
		) {
			directives.push({ comment: child, next });
		}

		listMarkdownIgnoreDirectives(child, directives);
	}

	return directives;
}

/**
 * Checks whether a token is a single-line ignore comment in the source.
 */
function isIgnoreComment(token: Regions.Token, source: string): boolean {
	const { end, position, start } = token;

	return (
		token.kind === 'opaque' &&
		token.construct === 'comment' &&
		end !== undefined &&
		position.offset !== undefined &&
		MARKDOWN_IGNORE_PATTERN.test(
			source.slice(position.offset, position.offset + end - start)
		)
	);
}

/**
 * Checks whether the printed Markdown ignore directive protects exactly the
 * element targeted by the original HTML directive.
 */
async function keepsProtection(
	printedDocument: Regions.Document,
	text: string,
	node: AST.Node,
	target: Regions.Element
): Promise<boolean> {
	// The trial print’s syntax tree has source positions
	const start = node.position!.start.offset!;
	const end = node.position!.end.offset!;
	const sequence = printedDocument.fragments.filter(
		(fragment) => fragment.node === node || fragment.block === node
	);
	const opening = sequence[0]?.tokens[0];

	if (
		opening?.kind !== 'opening-tag' ||
		opening.name !== target.name ||
		text.slice(start, opening.position.offset).trim() !== ''
	) {
		return false;
	}

	const matching = await matchRawTags(sequence, {});
	const element = matching.elements.find(
		(candidate) => candidate.opening === opening
	);
	let elementEnd: number | undefined;

	if (element?.end === 'opening-tag') {
		elementEnd = locateFragmentOffset(
			printedDocument,
			opening.fragment,
			opening.end
		).offset;
	} else if (element?.end === 'closing-tag') {
		elementEnd = locateFragmentOffset(
			printedDocument,
			element.endTag!.fragment,
			element.endTag!.end
		).offset;
	}

	return (
		elementEnd !== undefined && text.slice(elementEnd, end).trim() === ''
	);
}

/**
 * Finds accepted regions whose inline fragments lose their source role after
 * formatting: the reparsed trial print has no inline HTML starting where the
 * fragment does. `findChangedBlocks` checks HTML blocks.
 */
export function findChangedRoles(
	decisions: RegionDecisions,
	formattedRoot: AST.Node,
	offsets: ReadonlyMap<AST.Node, number>
): Array<{ problem: Rejection; region: Regions.Region }> {
	const inlineStarts = new Set(
		listInlineHTML(formattedRoot).map(
			({ position }) => position?.start.offset
		)
	);
	const changes = new Map<Regions.Region, Rejection>();

	for (const fragment of listCheckedFragments(decisions)) {
		const region = findFragmentRegion(decisions, fragment);
		const offset = offsets.get(fragment.node);

		// A region’s problem starts at its first changed fragment
		if (
			!fragment.isBlock &&
			!changes.has(region) &&
			(offset === undefined || !inlineStarts.has(offset))
		) {
			changes.set(region, {
				kind: 'changed-role',
				/* v8 ignore start -- @preserve */
				position:
					locateFragment(decisions, fragment) ?? region.position,
				/* v8 ignore stop -- @preserve */
			});
		}
	}

	return [...changes].map(([region, problem]) => ({ region, problem }));
}

/**
 * Lists the HTML nodes of a syntax tree outside Markdown containers’ block
 * children: inline HTML in paragraphs, headings, and table cells.
 */
function listInlineHTML(node: AST.Node, nodes: AST.Node[] = []): AST.Node[] {
	for (const child of node.children ?? []) {
		if (child.type === 'html' && !CONTAINER_TYPES.has(node.type)) {
			nodes.push(child);
		}

		listInlineHTML(child, nodes);
	}

	return nodes;
}

/**
 * Finds accepted regions whose HTML changes indentation, container, or block
 * boundaries in the trial print. A block may continue into the next accepted
 * HTML block in the same container.
 */
export function findChangedBlocks(
	decisions: RegionDecisions,
	formattedRoot: AST.Node,
	{ offsets, text }: { offsets: ReadonlyMap<AST.Node, number>; text: string }
): Array<{ problem: Rejection; region: Regions.Region }> {
	const blocks = listPrintedBlocks(formattedRoot);
	const fragments = listCheckedFragments(decisions).filter(
		({ isBlock }) => isBlock
	);
	const problems = new Map<Regions.Region, Rejection>();

	for (const fragment of fragments) {
		const region = findFragmentRegion(decisions, fragment);
		const offset = offsets.get(fragment.node);

		if (problems.has(region)) {
			continue;
		}

		/* v8 ignore start -- @preserve */
		const position = locateFragment(decisions, fragment) ?? region.position;
		/* v8 ignore stop -- @preserve */

		if (offset === undefined) {
			problems.set(region, { kind: 'changed-role', position });
			continue;
		}

		// The fragment’s value prints one line for each of its own
		const lineCount = fragment.node.value.split('\n').length;
		let end = offset - 1;

		for (let line = 0; line < lineCount && end < text.length; line += 1) {
			const lineEnd = text.indexOf('\n', end + 1);

			end =
				lineEnd === -1
					? /* v8 ignore next -- @preserve */ text.length
					: lineEnd;
		}

		const first = blocks.find(
			({ node }) =>
				node.position!.start.offset! <= offset &&
				offset < node.position!.end.offset!
		);
		const last = blocks.find(
			({ node }) =>
				node.position!.start.offset! < end &&
				end <= node.position!.end.offset!
		);

		if (
			!first ||
			!last ||
			first.parent !== last.parent ||
			!first.parent
				.children!.slice(first.index, last.index + 1)
				.every(({ type }) => type === 'html')
		) {
			problems.set(region, { kind: 'changed-role', position });
			continue;
		}

		if (first.containers !== listSourceContainers(fragment.container)) {
			problems.set(region, { kind: 'moved-block', position });
			continue;
		}

		// Each printed line reads back as the formatted line, so the printer
		// adds no indentation inside the block. Prettier’s printer drops
		// trailing whitespace from every line, as for plain Prettier
		const firstLine = text.slice(0, offset).split('\n').length;
		const siblings = first.parent.children!.slice(
			first.index,
			last.index + 1
		);
		const isReindented = fragment.node.value
			.split('\n')
			.some((line, index) => {
				const lineNumber = firstLine + index;
				const node = siblings.find(
					({ position }) =>
						position!.start.line <= lineNumber &&
						lineNumber <= position!.end.line
				);

				return (
					node?.value
						?.split('\n')
						[lineNumber - node.position!.start.line]?.trimEnd() !==
					line.trimEnd()
				);
			});

		if (isReindented) {
			problems.set(region, { kind: 'reindented-block', position });
			continue;
		}

		const next = fragments.find(
			(candidate) =>
				candidate.container === fragment.container &&
				candidate.index === fragment.index + 1
		);
		const nextOffset = next && offsets.get(next.node);
		const nextLineEnd = text.indexOf('\n', end + 1);
		const continuesIntoNext =
			nextOffset !== undefined &&
			nextOffset > end &&
			(nextLineEnd === -1 || nextOffset <= nextLineEnd);
		const following = last.parent.children![last.index + 1];

		if (
			!continuesIntoNext &&
			(last.node.position!.end.offset! > end ||
				(endsInContinuingBlock(fragment.node.value) &&
					following?.position?.start.line ===
						last.node.position!.end.line + 1))
		) {
			problems.set(region, { kind: 'open-block', position });
		}
	}

	return [...problems].map(([region, problem]) => ({ region, problem }));
}

type PrintedBlock = {
	// The Markdown containers around the block, from the root
	containers: string;
	index: number;
	node: AST.Node;
	parent: AST.Node;
};

/**
 * Locates a fragment’s start in the original Markdown. Layout can move an HTML
 * block’s start column to steer Prettier’s printer.
 */
function locateFragment(
	decisions: RegionDecisions,
	fragment: Regions.Fragment
): AST.Point | undefined {
	const offset = fragment.node.position?.start.offset;

	return offset === undefined
		? /* v8 ignore next -- @preserve */ undefined
		: locateOffset(decisions.documentRegions.document, offset);
}

/**
 * Lists the HTML blocks of a reparsed trial print in document order, with their
 * place among their parent’s children and the containers around them.
 */
function listPrintedBlocks(
	node: AST.Node,
	containers = 'root',
	blocks: PrintedBlock[] = []
): PrintedBlock[] {
	for (const [index, child] of (node.children ?? []).entries()) {
		if (
			child.type === 'html' &&
			child.position &&
			CONTAINER_TYPES.has(node.type)
		) {
			blocks.push({ containers, index, node: child, parent: node });
		}

		listPrintedBlocks(
			child,
			child.type === 'blockquote' || child.type === 'listItem'
				? `${containers}/${child.type}`
				: containers,
			blocks
		);
	}

	return blocks;
}

/**
 * Returns the path of Markdown container kinds from the root to this container.
 */
function listSourceContainers(container: Regions.Container): string {
	return container.parent
		? `${listSourceContainers(container.parent)}/${container.kind}`
		: container.kind;
}

/**
 * Reports each accepted region at its first unprotected, surviving fragment
 * when the trial print has no markers to locate it.
 */
export function listUnmarkableRegions(
	decisions: RegionDecisions
): Array<{ problem: Rejection; region: Regions.Region }> {
	const problems = new Map<Regions.Region, Rejection>();

	for (const fragment of listCheckedFragments(decisions)) {
		const region = findFragmentRegion(decisions, fragment);

		if (!problems.has(region)) {
			problems.set(region, {
				kind: 'unmarkable',
				/* v8 ignore start -- @preserve */
				position:
					locateFragment(decisions, fragment) ?? region.position,
				/* v8 ignore stop -- @preserve */
			});
		}
	}

	return [...problems].map(([region, problem]) => ({ region, problem }));
}

/**
 * Writes a fragment’s index in bijective numeration with the free sentinel
 * characters as digits, so a single character gives distinct runs.
 */
function encodeSentinel(index: number, digits: ReadonlyArray<string>): string {
	let sentinel = '';

	for (
		let rest = index + 1;
		rest > 0;
		rest = Math.floor((rest - 1) / digits.length)
	) {
		sentinel = digits[(rest - 1) % digits.length]! + sentinel;
	}

	return sentinel;
}

/**
 * Lists surviving, unprotected fragments in source order, from accepted regions
 * by default or from rejected regions when requested.
 */
function listCheckedFragments(
	decisions: RegionDecisions,
	isRejected = false
): Regions.Fragment[] {
	const rejected = listRejectedNodes(decisions);

	return decisions.documentRegions.document.fragments.filter(
		({ node, protection }) =>
			!protection &&
			rejected.has(node) === isRejected &&
			!decisions.removedNodes.has(node)
	);
}

/**
 * Lists the rejected regions that need a notice, in source order: those outside
 * any other rejected region, unless ignore directives acknowledge them.
 */
export function listNotices(
	decisions: RegionDecisions
): Array<{ problem: Rejection; region: Regions.Region }> {
	const notices: Array<{ problem: Rejection; region: Regions.Region }> = [];

	const visit = (region: Regions.Region): void => {
		const problem = decisions.problems.get(region);

		if (problem) {
			if (!isAcknowledged(decisions, region)) {
				notices.push({ region, problem });
			}

			return;
		}

		for (const nested of region.regions) {
			visit(nested);
		}
	};

	for (const region of decisions.documentRegions.regions) {
		visit(region);
	}

	return notices;
}

/**
 * Checks whether Markdown or HTML ignore directives protect the whole rejected
 * region and silence its notice.
 */
function isAcknowledged(
	decisions: RegionDecisions,
	region: Regions.Region
): boolean {
	const { document } = decisions.documentRegions;
	const nodes = region.kind === 'block' ? region.nodes : [region.node];
	const start = nodes[0]!.position?.start.offset;
	const end = nodes.at(-1)!.position?.end.offset;

	return (
		region.isProtected ||
		(start !== undefined &&
			end !== undefined &&
			isProtectedByHTMLIgnore(document, start, end))
	);
}

/**
 * Finds the innermost region that holds a fragment.
 */
function findFragmentRegion(
	decisions: RegionDecisions,
	fragment: Regions.Fragment
): Regions.Region {
	let owners = fragmentOwners.get(decisions.documentRegions);

	if (!owners) {
		const map = new Map<Regions.Fragment, Regions.Region>();

		// A region comes before the regions nested in it, so the innermost region
		// that owns a fragment comes last
		for (const region of listRegions(decisions)) {
			for (const owned of region.fragments) {
				map.set(owned, region);
			}
		}

		owners = map;
		fragmentOwners.set(decisions.documentRegions, map);
	}

	return owners.get(fragment)!;
}

/**
 * Compares two points in source order.
 */
function comparePoints(
	a: Pick<AST.Point, 'column' | 'line'>,
	b: Pick<AST.Point, 'column' | 'line'>
): number {
	return a.line - b.line || a.column - b.column;
}
