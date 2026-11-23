import type { AST, Regions } from '../types/index.d.ts';
import findDocumentRegions, {
	findElementEnd,
} from '../find-document-regions/index.ts';
import isVoidTag from '../is-void-tag/index.ts';

// The source range of each HTML ignore directive and the element it protects,
// for each document
const htmlIgnoredRanges = new WeakMap<
	Regions.Document,
	Array<[number, number]>
>();

// Where each region has foreign content, computed once per region
const foreignContents = new WeakMap<Regions.Region, ForeignContent>();

// A comment that Prettier’s HTML formatter reads as an attribute ignore
// directive, for all attributes or for the named ones
const HTML_ATTRIBUTE_IGNORE_COMMENT_PATTERN =
	/^<!--\s*prettier-ignore-attribute(?:\s+\S[\s\S]*?)?\s*-->$/;

// A comment that Prettier’s HTML formatter reads as an ignore directive
const HTML_IGNORE_COMMENT_PATTERN = /^<!--\s*prettier-ignore\s*-->$/;

// The source between inline HTML and the next inline HTML of its paragraph when
// only whitespace and container prefixes separate them
const INLINE_SEPARATOR_PATTERN = /^[\t ]*(?:\n[\t >]*)?$/;

// The tag targeted by an HTML ignore directive and the directive’s start offset
type DirectiveTarget = {
	// Whether the directive protects only attributes
	isAttributeDirective: boolean;
	start: number;
	target: Regions.ClosingTag | Regions.OpeningTag;
};

type ForeignContent = {
	hasForeignAncestor: boolean;
	// Source ranges where foreign elements are open, in order and disjoint
	intervals: Array<[number, number]>;
};

/**
 * Decides which void closing tags formatting rewrites or drops in place, and
 * records the source that HTML ignore directives protect.
 */
export default async function decideCorrections(
	document: Regions.Document
): Promise<Regions.Corrections> {
	// Documents without source offsets receive no corrections
	if (
		!hasSourceOffsets(document.root) ||
		!document.fragments.every(({ node }) => hasOffsets(node))
	) {
		htmlIgnoredRanges.set(document, []);

		return {};
	}

	const initial = await findDocumentRegions(document);
	const regions = listRegions(initial.regions);
	const directiveTargets = findIgnoreDirectiveTargets(document);
	const directiveRanges = findHTMLIgnoredRanges(
		document,
		directiveTargets,
		regions
	);
	const ignoredRanges = mergeRanges(directiveRanges);
	const ignoredClosingTags = new Set(
		directiveTargets.flatMap(({ isAttributeDirective, target }) =>
			target.kind === 'closing-tag' && !isAttributeDirective
				? [target]
				: []
		)
	);

	htmlIgnoredRanges.set(document, directiveRanges);

	return {
		closingTags: decideVoidClosingTags(
			regions,
			(tag) =>
				!tag.isInForeignContent &&
				startsWithName(tag) &&
				!tag.fragment.protection &&
				!ignoredClosingTags.has(tag) &&
				!isInRanges(ignoredRanges, tag.position.offset!)
		),
	};
}

/**
 * Checks whether a closing tag’s name directly follows `</`. A browser reads
 * `</` followed by whitespace as a comment, not as a tag.
 */
function startsWithName(tag: Regions.ClosingTag): boolean {
	return tag.fragment.node.value.startsWith(`</${tag.sourceName}`, tag.start);
}

/**
 * Checks whether one HTML ignore range covers the entire source span.
 */
export function isProtectedByHTMLIgnore(
	document: Regions.Document,
	start: number,
	end = start
): boolean {
	return htmlIgnoredRanges
		.get(document)!
		.some(
			([rangeStart, rangeEnd]) => rangeStart <= start && end <= rangeEnd
		);
}

/**
 * Decides the void closing tags that formatting rewrites as `<br />` or drops,
 * mapped to their replacement text.
 */
function decideVoidClosingTags(
	regions: ReadonlyArray<Regions.Region>,
	isCorrectable: (tag: Regions.ClosingTag) => boolean
): Map<Regions.ClosingTag, string> {
	const closingTags = new Map<Regions.ClosingTag, string>();

	for (const region of regions) {
		for (const tag of region.unpairedClosingTags) {
			if (
				!isVoidTag(tag.name) ||
				!isCorrectable(tag) ||
				isInForeignContent(tag, region)
			) {
				continue;
			}

			if (tag.name === 'br') {
				closingTags.set(tag, '<br />');
			} else if (followsOwnOpeningTag(tag, region)) {
				closingTags.set(tag, '');
			}
		}
	}

	return closingTags;
}

/**
 * Checks whether a closing tag directly follows an opening tag of the same
 * name, in its own fragment or at the end of the inline fragment before it.
 */
function followsOwnOpeningTag(
	tag: Regions.ClosingTag,
	region: Regions.Region
): boolean {
	const { fragment } = tag;
	const index = fragment.tokens.indexOf(tag);

	if (index > 0) {
		const previous = fragment.tokens[index - 1]!;

		return (
			previous.kind === 'opening-tag' &&
			previous.name === tag.name &&
			previous.end === tag.start
		);
	}

	const { fragments } = region;
	const previousFragment = fragments[fragments.indexOf(fragment) - 1];
	const opening = previousFragment?.tokens.at(-1);

	return (
		tag.start === 0 &&
		!fragment.isBlock &&
		previousFragment !== undefined &&
		!previousFragment.isBlock &&
		opening?.kind === 'opening-tag' &&
		opening.name === tag.name &&
		opening.end === previousFragment.node.value.length &&
		previousFragment.node.position?.end.offset ===
			fragment.node.position?.start.offset
	);
}

/**
 * Checks whether a closing tag lies inside an open SVG or MathML element.
 */
function isInForeignContent(
	tag: Regions.ClosingTag,
	region: Regions.Region
): boolean {
	const { hasForeignAncestor, intervals } = getForeignContent(region);
	const offset = tag.position.offset!;
	let low = 0;
	let high = intervals.length - 1;
	let found: [number, number] | undefined;

	// Finds the last interval that starts before the tag
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);

		if (intervals[middle]![0] < offset) {
			found = intervals[middle];
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}

	return hasForeignAncestor || (found !== undefined && found[1] > offset);
}

/**
 * Lists open foreign element ranges and checks for a foreign ancestor.
 */
function getForeignContent(region: Regions.Region): ForeignContent {
	let content = foreignContents.get(region);

	if (!content) {
		const intervals: Array<[number, number]> = [];

		for (const element of region.elements) {
			const { end, isForeign, opening } = element;

			if (!isForeign || end === 'opening-tag') {
				continue;
			}

			const start = opening.position.offset!;
			const stop = findOpenEnd(element);
			const last = intervals.at(-1);

			// Elements are in source order, so each starts after the last start
			if (last && start <= last[1]) {
				last[1] = Math.max(last[1], stop);
			} else {
				intervals.push([start, stop]);
			}
		}

		content = {
			hasForeignAncestor: region.ancestors.some(
				({ isForeign }) => isForeign
			),
			intervals,
		};
		foreignContents.set(region, content);
	}

	return content;
}

/**
 * Returns a foreign element’s closing tag offset, or `Infinity` if still open.
 * Prettier never closes foreign elements implicitly.
 */
function findOpenEnd({ endTag }: Regions.Element): number {
	return endTag ? endTag.position.offset! : Number.POSITIVE_INFINITY;
}

/**
 * Finds the source range of each HTML ignore directive and the element it
 * protects, in source order of the directives. Each range runs from the
 * directive to where the element’s source ends, which is the end of its
 * container if nothing closes it.
 */
function findHTMLIgnoredRanges(
	document: Regions.Document,
	targets: ReadonlyArray<DirectiveTarget>,
	regions: ReadonlyArray<Regions.Region>
): Array<[number, number]> {
	return matchTargetElements(targets, regions).map(
		({ element, start }): [number, number] => [
			start,
			findElementEnd(element, document),
		]
	);
}

/**
 * Pairs protected elements with the offsets of their HTML ignore comments.
 */
export function findHTMLIgnoreTargets(
	document: Regions.Document,
	regions: ReadonlyArray<Regions.Region>
): Array<{ element: Regions.Element; start: number }> {
	return matchTargetElements(findIgnoreDirectiveTargets(document), regions);
}

/**
 * Pairs elements with the source offsets of their `prettier-ignore` directives.
 */
function matchTargetElements(
	targets: ReadonlyArray<DirectiveTarget>,
	regions: ReadonlyArray<Regions.Region>
): Array<{ element: Regions.Element; start: number }> {
	const elements = new Map(
		regions.flatMap(({ elements: regionElements }) =>
			regionElements.map((element) => [element.opening, element] as const)
		)
	);

	return targets.flatMap(({ isAttributeDirective, start, target }) => {
		const element =
			target.kind === 'opening-tag' && !isAttributeDirective
				? elements.get(target)
				: undefined;

		return element ? [{ element, start }] : [];
	});
}

/**
 * Lists the tags targeted by HTML ignore and attribute ignore directives, with
 * each directive’s source offset, in document order.
 */
function findIgnoreDirectiveTargets(
	document: Regions.Document
): DirectiveTarget[] {
	const targets: DirectiveTarget[] = [];

	for (const [fragmentIndex, fragment] of document.fragments.entries()) {
		const { tokens } = fragment;
		const { value } = fragment.node;

		for (const [index, token] of tokens.entries()) {
			const isAttributeDirective = isHTMLAttributeIgnoreComment(
				token,
				value
			);
			const target =
				isAttributeDirective || isHTMLIgnoreComment(token, value)
					? findIgnoreTarget(
							fragment,
							index,
							document.fragments[fragmentIndex + 1],
							document.source
						)
					: undefined;

			if (target) {
				targets.push({
					isAttributeDirective,
					start: token.position.offset!,
					target,
				});
			}
		}
	}

	return targets;
}

/**
 * Finds the tag an HTML ignore directive protects: the next tag after only
 * whitespace in the directive’s fragment, or, inline, a closing tag that starts
 * the next fragment of the same block.
 */
function findIgnoreTarget(
	fragment: Regions.Fragment,
	index: number,
	nextFragment: Regions.Fragment | undefined,
	source: string
): Regions.ClosingTag | Regions.OpeningTag | undefined {
	const { tokens } = fragment;
	const { value } = fragment.node;
	const comment = tokens[index]!;
	const next = tokens[index + 1];

	if (next) {
		return next.kind !== 'opaque' &&
			value.slice(comment.end, next.start).trim() === ''
			? next
			: undefined;
	}

	if (fragment.isBlock) {
		return undefined;
	}

	const [first] = nextFragment?.tokens ?? [];

	return first?.kind === 'closing-tag' &&
		first.start === 0 &&
		first.fragment.block === fragment.block &&
		INLINE_SEPARATOR_PATTERN.test(
			source.slice(
				fragment.node.position?.end.offset,
				first.fragment.node.position?.start.offset
			)
		)
		? first
		: undefined;
}

/**
 * Checks whether a token is a Prettier HTML attribute ignore comment.
 */
function isHTMLAttributeIgnoreComment(
	token: Regions.Token,
	value: string
): boolean {
	return (
		token.kind === 'opaque' &&
		token.construct === 'comment' &&
		HTML_ATTRIBUTE_IGNORE_COMMENT_PATTERN.test(
			value.slice(token.start, token.end)
		)
	);
}

/**
 * Checks whether a token is a Prettier HTML ignore comment.
 */
function isHTMLIgnoreComment(token: Regions.Token, value: string): boolean {
	return (
		token.kind === 'opaque' &&
		token.construct === 'comment' &&
		HTML_IGNORE_COMMENT_PATTERN.test(value.slice(token.start, token.end))
	);
}

/**
 * Merges source ranges into disjoint ranges in order.
 */
function mergeRanges(
	ranges: ReadonlyArray<[number, number]>
): Array<[number, number]> {
	const merged: Array<[number, number]> = [];

	for (const [start, end] of ranges.toSorted(([a], [b]) => a - b)) {
		const last = merged.at(-1);

		if (last && start <= last[1]) {
			last[1] = Math.max(last[1], end);
		} else {
			merged.push([start, end]);
		}
	}

	return merged;
}

/**
 * Checks whether an offset falls in one of a list of disjoint source ranges in
 * order. A range’s end is the offset after its element, so it isn’t included.
 */
function isInRanges(
	ranges: ReadonlyArray<[number, number]>,
	offset: number
): boolean {
	let low = 0;
	let high = ranges.length - 1;

	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const [start, end] = ranges[middle]!;

		if (offset < start) {
			high = middle - 1;
		} else if (offset >= end) {
			low = middle + 1;
		} else {
			return true;
		}
	}

	return false;
}

/**
 * Lists every region in source order, each before the regions nested in it.
 */
function listRegions(regions: ReadonlyArray<Regions.Region>): Regions.Region[] {
	return regions.flatMap((region) => [
		region,
		...listRegions(region.regions),
	]);
}

/**
 * Checks whether a Markdown container, its blocks, and the containers nested in
 * it record where they start and end in the source.
 */
function hasSourceOffsets(container: Regions.Container): boolean {
	return (
		hasOffsets(container.node) &&
		container.node.children.every((child) => hasOffsets(child)) &&
		container.containers.every((nested) => hasSourceOffsets(nested))
	);
}

/**
 * Checks whether a node records where it starts and ends in the source.
 */
function hasOffsets(node: AST.Node): boolean {
	return (
		node.position?.start.offset !== undefined &&
		node.position.end.offset !== undefined
	);
}
