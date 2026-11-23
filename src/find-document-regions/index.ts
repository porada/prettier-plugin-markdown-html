import type { ParserOptions } from 'prettier';
import type { Regions } from '../types/index.d.ts';
import * as pluginHTML from 'prettier/plugins/html';
import { FOREIGN_TAG_NAMES } from '../constants/index.ts';
import isRawTextTag from '../is-raw-text-tag/index.ts';
import isVoidTag from '../is-void-tag/index.ts';
import { locateFragmentOffset } from '../read-raw-html/index.ts';

// A custom element added after an HTML block’s content, whose ancestors in
// Prettier’s parse are the elements still open at the block’s end. The parse
// identifies it by its position, so source content can’t be mistaken for it
const BLOCK_END_MARKER = '<prettier-plugin-markdown-html-block-end>';

// The position of a node without one, which counts as the start of the document
const UNKNOWN_POINT: Regions.Location['position'] = {
	column: 1,
	line: 1,
	offset: 0,
};

type HTMLNode = {
	children?: HTMLNode[];
	// Absent where the parser closes an element without a closing tag
	endSourceSpan?: { start: { offset: number } };
	kind: string;
	sourceSpan: { start: { offset: number } };
};

type Matching = {
	elements: Regions.Element[];
	// The elements open after each HTML block, by the block’s position in the
	// container’s children, outermost first
	openElementsAfter: Array<{ elements: Regions.Element[]; index: number }>;
	unpairedClosingTags: Regions.ClosingTag[];
};

/**
 * Pairs the raw tags of a document in source order, applying any corrections,
 * and divides the document into the regions that the plugin formats or rejects.
 */
export default async function findDocumentRegions(
	document: Regions.Document,
	corrections: Regions.Corrections = {}
): Promise<Regions.DocumentRegions> {
	return {
		corrections,
		document,
		regions: await findContainerRegions(
			document.root,
			undefined,
			[],
			document,
			corrections
		),
	};
}

/**
 * Returns the fragment where an element ends, or `undefined` if the element
 * extends to the end of its container.
 */
export function findEndFragment(
	element: Regions.Element
): Regions.Fragment | undefined {
	const { end, endTag, opening } = element;

	return end === 'implicit' || end === 'opening-tag'
		? opening.fragment
		: endTag?.fragment;
}

/**
 * Finds where an element’s source ends: after the closing tag that ends it, at
 * the end of its HTML block when Prettier’s parser closes it there, at its
 * opening tag when it has no content, or at the end of its container.
 */
export function findElementEnd(
	element: Regions.Element,
	document: Regions.Document
): number {
	const { end, endTag, opening } = element;

	if (endTag) {
		return locateFragmentOffset(document, endTag.fragment, endTag.end)
			.offset!;
	}

	if (end === 'implicit') {
		return opening.fragment.node.position!.end.offset!;
	}

	if (end === 'opening-tag') {
		return locateFragmentOffset(document, opening.fragment, opening.end)
			.offset!;
	}

	const { container } = opening.fragment;

	return container.kind === 'root'
		? document.source.length
		: container.node.position!.end.offset!;
}

/**
 * Pairs raw tags across a container’s HTML blocks or within one sequence of
 * inline fragments. Enclosing raw elements provide context but cannot pair with
 * those tags. Corrections can change which closing tags participate.
 */
export async function matchRawTags(
	fragments: ReadonlyArray<Regions.Fragment>,
	corrections: Regions.Corrections = {},
	ancestors: ReadonlyArray<Regions.Element> = []
): Promise<Matching> {
	const elements: Regions.Element[] = [];
	const openElementsAfter: Matching['openElementsAfter'] = [];
	const unpairedClosingTags: Regions.ClosingTag[] = [];
	// Elements that a later closing tag can still pair with
	const unpairedElements: Regions.Element[] = [];
	// Unpaired elements that an enclosing element’s closing tag in their HTML
	// block closes, which no later closing tag pairs with
	const closedInBlock = new Set<Regions.Element>();
	// Elements that enclose the current position, outermost first
	let openElements: Regions.Element[] = [];

	for (const fragment of fragments) {
		const context = [...ancestors, ...openElements];

		for (const token of fragment.tokens) {
			if (token.kind === 'opening-tag') {
				const parent = openElements.at(-1) ?? ancestors.at(-1);
				const isForeign =
					parent?.isForeign === true ||
					FOREIGN_TAG_NAMES.has(token.name);
				const element: Regions.Element = {
					closing: undefined,
					end: 'unclosed',
					endTag: undefined,
					isForeign,
					name: token.name,
					opening: token,
					parent,
				};
				elements.push(element);

				// Self-closing syntax closes only void and foreign elements
				if (isForeign ? token.isSelfClosing : isVoidTag(token.name)) {
					element.end = 'opening-tag';
				} else {
					unpairedElements.push(element);
					openElements.push(element);
				}
			} else if (
				token.kind === 'closing-tag' &&
				!corrections.closingTags?.has(token)
			) {
				const index = unpairedElements.findLastIndex(
					(candidate) =>
						candidate.name === token.name &&
						!closedInBlock.has(candidate)
				);

				if (index === -1) {
					unpairedClosingTags.push(token);
					continue;
				}

				const [element] = unpairedElements.splice(index, 1);
				element!.closing = token;
				element!.end = 'closing-tag';
				element!.endTag = token;

				const openIndex = openElements.indexOf(element!);

				// The inner elements end here. Those of the same HTML block
				// close with the element, as in Prettier’s parse, so a later
				// closing tag pairs with an element around them. Other inner
				// elements can still pair later
				if (openIndex !== -1) {
					for (const innerElement of openElements.splice(openIndex)) {
						innerElement.endTag ??= token;

						if (
							fragment.isBlock &&
							innerElement.opening.fragment === fragment
						) {
							closedInBlock.add(innerElement);
						}
					}
				}
			}
		}

		// A block that ends inside an opaque construct has no complete reading
		if (
			fragment.isBlock &&
			unpairedElements.some(
				({ opening }) => opening.fragment === fragment
			) &&
			!fragment.tokens.some(
				(token) => token.kind === 'opaque' && token.end === undefined
			)
		) {
			openElements = await readBlockStructure(fragment, {
				context,
				corrections,
				elements,
				openElements,
				unpairedElements,
			});
		}

		if (fragment.isBlock) {
			openElementsAfter.push({
				elements: [...openElements],
				index: fragment.index,
			});
		}
	}

	for (const element of unpairedElements) {
		if (element.endTag) {
			element.end = 'enclosing';
		}
	}

	return { elements, openElementsAfter, unpairedClosingTags };
}

/**
 * Reads an HTML block with its enclosing elements as context and returns the
 * elements still open at its end. Earlier blocks’ elements require explicit
 * closing tags, as do self-closing HTML elements. A parse failure preserves the
 * existing matches.
 */
async function readBlockStructure(
	fragment: Regions.Fragment,
	{
		context,
		corrections,
		elements,
		openElements,
		unpairedElements,
	}: {
		// The elements open before the block, outermost first
		context: ReadonlyArray<Regions.Element>;
		corrections: Regions.Corrections;
		elements: ReadonlyArray<Regions.Element>;
		openElements: ReadonlyArray<Regions.Element>;
		unpairedElements: Regions.Element[];
	}
): Promise<Regions.Element[]> {
	const { value } = fragment.node;
	const elementsByOffset = new Map<number, Regions.Element>();
	const blockElements = new Map(
		elements
			.filter(({ opening }) => opening.fragment === fragment)
			.map((element) => [element.opening, element])
	);
	let html = '';

	for (const element of context) {
		elementsByOffset.set(html.length, element);
		html += `<${element.opening.sourceName}>`;
	}

	let offset = 0;
	// Where the closing tags of self-closing elements of the block start in the
	// parsed HTML
	const selfClosedTagOffsets = new Set<number>();

	for (const token of fragment.tokens) {
		const replacement =
			token.kind === 'closing-tag'
				? corrections.closingTags?.get(token)
				: undefined;

		if (
			token.kind === 'closing-tag' &&
			replacement === undefined &&
			elements.some(
				({ closing, opening }) =>
					closing === token && opening.isSelfClosing
			)
		) {
			selfClosedTagOffsets.add(html.length + token.start - offset);
		}

		if (token.kind === 'opening-tag') {
			elementsByOffset.set(
				html.length + token.start - offset,
				blockElements.get(token)!
			);
		} else if (token.kind === 'closing-tag' && replacement !== undefined) {
			html += value.slice(offset, token.start) + replacement;
			offset = token.end;
		}
	}

	html += value.slice(offset);

	const markerOffset = html.length;
	let root: HTMLNode;

	try {
		root = (await pluginHTML.parsers.html.parse(
			`${html}${BLOCK_END_MARKER}`,
			{ parser: 'html' } as ParserOptions
		)) as HTMLNode;
	} catch {
		return [...openElements];
	}

	let markerPath: Set<Regions.Element> | undefined;
	// Enclosing elements that Prettier closes at a descendant’s closing tag
	// because it read the descendant’s opening tag as self-closing
	const closedByTag = new Set<Regions.Element>();

	/**
	 * Visits the parsed elements, giving each element of the block the nearest
	 * enclosing element that corresponds to a source tag as its parent.
	 */
	const visit = (
		node: HTMLNode,
		parent: Regions.Element | undefined,
		path: ReadonlyArray<Regions.Element>
	): void => {
		// The root and elements always have children
		for (const child of node.children!) {
			const start = child.sourceSpan.start.offset;

			if (child.kind !== 'element') {
				continue;
			}

			if (start === markerOffset) {
				markerPath = new Set(path);
				continue;
			}

			const element = elementsByOffset.get(start);

			// Each parsed element starts at a source tag or a context tag,
			// since the scan reads tags as Prettier does
			/* v8 ignore next 4 -- @preserve */
			if (!element) {
				visit(child, parent, path);
				continue;
			}

			if (element.opening.fragment === fragment) {
				element.parent = parent;

				if (
					child.endSourceSpan &&
					selfClosedTagOffsets.has(child.endSourceSpan.start.offset)
				) {
					closedByTag.add(element);
				}
			}

			visit(child, element, [...path, element]);
		}
	};

	visit(root, undefined, []);

	// Blocks that end inside a tag or another opaque construct go unread, so
	// the marker follows complete content
	/* v8 ignore next 3 -- @preserve */
	if (!markerPath) {
		return [...openElements];
	}

	// Prettier closes self-closing syntax that a browser leaves open, so the
	// closing tag that Prettier pairs with an enclosing element closes the
	// self-closing element instead
	const isOpen = (element: Regions.Element): boolean =>
		element.opening.fragment !== fragment ||
		element.opening.isSelfClosing ||
		closedByTag.has(element) ||
		markerPath!.has(element);

	for (const element of unpairedElements.filter(
		(candidate) => !isOpen(candidate)
	)) {
		element.end = 'implicit';
		element.endTag = undefined;
		unpairedElements.splice(unpairedElements.indexOf(element), 1);
	}

	return openElements.filter((element) => isOpen(element));
}

/**
 * Finds regions in this container and its nested containers. The supplied
 * ancestors are raw elements open around the container. Returns the regions that
 * belong to no region within this container.
 */
async function findContainerRegions(
	container: Regions.Container,
	enclosing: Regions.Region | undefined,
	ancestors: ReadonlyArray<Regions.Element>,
	document: Regions.Document,
	corrections: Regions.Corrections
): Promise<Regions.Region[]> {
	const children = container.node.children ?? [];
	const matching = await matchRawTags(
		container.blocks,
		corrections,
		ancestors
	);
	const spans = findSpans(container, matching, children.length);
	const regionsByKey = new Map<string, Regions.BlockRegion>();
	const regionsByIndex = new Map<number, Regions.BlockRegion>();

	const findAncestors = (index: number): Regions.Element[] => [
		...ancestors,
		...(matching.openElementsAfter.findLast(
			(snapshot) => snapshot.index < index
		)?.elements ?? []),
	];

	const inlineMatchings = new Map<Regions.InlineBlock, Matching>();
	const leftOpenElements = new Map<number, Regions.Element[]>();
	// The first inline region in each block that leaves raw text or `pre` open
	const firstLeftOpenInlines = new Map<number, Regions.InlineBlock>();

	for (const inline of container.inlines) {
		const inlineMatching = await matchRawTags(
			inline.fragments,
			corrections,
			findAncestors(inline.index)
		);
		const leftOpen = inlineMatching.elements.filter(
			(element) =>
				isTextContainer(element) &&
				element.end !== 'closing-tag' &&
				element.end !== 'opening-tag'
		);

		inlineMatchings.set(inline, inlineMatching);

		// A browser reads everything after a raw text element or `pre` that its
		// paragraph leaves open as the element’s text, so the region runs to the
		// end of the container
		if (leftOpen.length > 0) {
			spans.push([inline.index, children.length]);

			if (!firstLeftOpenInlines.has(inline.index)) {
				firstLeftOpenInlines.set(inline.index, inline);
			}

			leftOpenElements.set(inline.index, [
				...(leftOpenElements.get(inline.index) ?? []),
				...leftOpen,
			]);
		}
	}

	/**
	 * Returns the region for the smallest run of blocks around a block that no
	 * span crosses. These runs either nest or don’t overlap. A run that reaches
	 * past the last child ends with the container.
	 */
	const getRunRegion = (index: number): Regions.BlockRegion => {
		const [firstIndex, end] = findRun(index, spans);
		const key = `${firstIndex}:${end}`;
		let region = regionsByKey.get(key);

		if (!region) {
			const lastIndex = Math.min(end, children.length - 1);
			const nodes = children.slice(firstIndex, lastIndex + 1);

			region = {
				ancestors: findAncestors(firstIndex),
				container,
				elements: [],
				firstIndex,
				fragments: [],
				isProtected: nodes.every((node) =>
					document.protections.has(node)
				),
				kind: 'block',
				lastIndex,
				nodes,
				parent: undefined,
				regions: [],
				position: nodes[0]!.position?.start ?? UNKNOWN_POINT,
				unpairedClosingTags: [],
			};
			regionsByKey.set(key, region);
		}

		return region;
	};

	// Each HTML block belongs to the smallest run around it
	for (const fragment of container.blocks) {
		const region = getRunRegion(fragment.index);

		region.fragments.push(fragment);
		regionsByIndex.set(fragment.index, region);
	}

	for (const [index, elements] of leftOpenElements) {
		getRunRegion(index).elements.push(...elements);
	}

	for (const element of matching.elements) {
		regionsByIndex
			.get(element.opening.fragment.index)!
			.elements.push(element);
	}

	for (const tag of matching.unpairedClosingTags) {
		regionsByIndex.get(tag.fragment.index)!.unpairedClosingTags.push(tag);
	}

	// Each run is the smallest around its first block, so sorting by first
	// index puts each run after the runs around it
	const blockRegions = [...regionsByKey.values()].toSorted(
		(a, b) => a.firstIndex - b.firstIndex
	);
	const findInnermostRegion = (
		index: number
	): Regions.BlockRegion | undefined =>
		blockRegions.findLast(
			({ firstIndex, lastIndex }) =>
				firstIndex <= index && index <= lastIndex
		);
	const outerRegions: Regions.Region[] = [];

	const attach = (
		region: Regions.Region,
		parent: Regions.BlockRegion | undefined
	): void => {
		region.parent = parent ?? enclosing;
		(parent?.regions ?? outerRegions).push(region);
	};

	for (const [index, region] of blockRegions.entries()) {
		attach(
			region,
			blockRegions
				.slice(0, index)
				.findLast(
					({ firstIndex, lastIndex }) =>
						firstIndex <= region.firstIndex &&
						region.lastIndex <= lastIndex
				)
		);
	}

	for (const inline of container.inlines) {
		const inlineMatching = inlineMatchings.get(inline)!;
		const firstLeftOpen = firstLeftOpenInlines.get(inline.index);
		let parent = findInnermostRegion(inline.index);

		// The region that runs from a paragraph, heading, or table cell to the
		// end of the container starts there, after the table cells before it.
		// When the run starts earlier, an enclosing element’s region takes in the
		// run, so the cells before share its decision
		if (
			firstLeftOpen &&
			parent === getRunRegion(inline.index) &&
			parent.firstIndex === inline.index &&
			container.inlines.indexOf(inline) <
				container.inlines.indexOf(firstLeftOpen)
		) {
			parent = blockRegions.find((region) => region === parent!.parent);
		}

		attach(
			{
				ancestors: findAncestors(inline.index),
				container,
				elements: inlineMatching.elements,
				fragments: inline.fragments,
				index: inline.index,
				isProtected: document.protections.has(inline.node),
				kind: 'inline',
				node: inline.node,
				parent: undefined,
				regions: [],
				position: inline.node.position?.start ?? UNKNOWN_POINT,
				unpairedClosingTags: inlineMatching.unpairedClosingTags,
			},
			parent
		);
	}

	for (const nested of container.containers) {
		const parent = findInnermostRegion(nested.index!);

		for (const region of await findContainerRegions(
			nested,
			parent ?? enclosing,
			findAncestors(nested.index!),
			document,
			corrections
		)) {
			(parent?.regions ?? outerRegions).push(region);
		}
	}

	for (const region of blockRegions) {
		region.regions = sortRegions(region.regions);
	}

	return sortRegions(outerRegions);
}

/**
 * Checks whether an SVG or MathML element lacks its own closing tag in the HTML
 * block or inline region that opens it, before any enclosing element closes.
 */
export function isSplitForeignElement(element: Regions.Element): boolean {
	const { end, endTag, name, opening } = element;

	if (!FOREIGN_TAG_NAMES.has(name) || end === 'opening-tag') {
		return false;
	}

	if (end !== 'closing-tag') {
		return true;
	}

	if (opening.fragment.isBlock) {
		return endTag!.fragment !== opening.fragment;
	}

	// Inline tags pair by name alone, so an enclosing element can close first
	for (
		let current: Regions.Element | undefined = element.parent;
		current;
		current = current.parent
	) {
		if (
			current.endTag &&
			current.endTag.position.offset! < endTag!.position.offset!
		) {
			return true;
		}
	}

	return false;
}

/**
 * Checks whether an element’s content is raw text or preformatted text.
 */
function isTextContainer(element: Regions.Element): boolean {
	return (
		isRawTextTag(element.name) ||
		(element.name === 'pre' && !element.isForeign)
	);
}

/**
 * Finds the spans of container children covered by raw elements or unclosed
 * opaque constructs. Open-ended spans extend past the last child so a final
 * HTML block can still form its own region.
 */
function findSpans(
	container: Regions.Container,
	matching: Matching,
	containerEnd: number
): Array<[number, number]> {
	const spans: Array<[number, number]> = [];

	for (const element of matching.elements) {
		const { end, opening } = element;

		if (end !== 'implicit' && end !== 'opening-tag') {
			spans.push([
				opening.fragment.index,
				findEndFragment(element)?.index ?? containerEnd,
			]);
		}
	}

	// Raw text that continues past its fragment belongs to its element
	for (const fragment of container.blocks) {
		for (const token of fragment.tokens) {
			if (
				token.kind === 'opaque' &&
				token.end === undefined &&
				token.construct !== 'raw-text'
			) {
				spans.push([fragment.index, containerEnd]);
			}
		}
	}

	return spans;
}

/**
 * Finds the smallest run of blocks around a block that no span crosses. A span
 * crosses a run when one of its ends is inside and the other outside.
 */
function findRun(
	index: number,
	spans: ReadonlyArray<[number, number]>
): [number, number] {
	let first = index;
	let last = index;
	let isExtended = true;

	while (isExtended) {
		isExtended = false;

		for (const [start, end] of spans) {
			const isStartInside = first <= start && start <= last;
			const isEndInside = first <= end && end <= last;

			if (isStartInside !== isEndInside) {
				first = Math.min(first, start);
				last = Math.max(last, end);
				isExtended = true;
			}
		}
	}

	return [first, last];
}

/**
 * Sorts regions in source order.
 */
function sortRegions(regions: ReadonlyArray<Regions.Region>): Regions.Region[] {
	return regions.toSorted((a, b) => a.position.offset! - b.position.offset!);
}
