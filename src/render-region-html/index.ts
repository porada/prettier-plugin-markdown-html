import type { AST, Regions } from '../types/index.d.ts';
import { locateFragmentOffset } from '../read-raw-html/index.ts';

// A region’s HTML, with the stretches copied from its fragments
type RegionHTML = { html: string; segments: Segment[] };

// A stretch of a region’s HTML copied from a fragment
type Segment = {
	fragment: Regions.Fragment;
	// Where the copied HTML starts in the fragment
	fragmentOffset: number;
	length: number;
	// Where the copied HTML starts in the region’s HTML
	start: number;
};

/**
 * Builds corrected HTML inside the region’s open ancestors. Includes selected
 * nested blocks in the same container and maps copied text back to its source.
 */
export default function renderRegionHTML(
	region: Regions.Region,
	corrections: Regions.Corrections,
	isIncluded: (nested: Regions.Region) => boolean
): RegionHTML {
	const segments: Segment[] = [];
	let html = region.ancestors
		.map(({ opening }) => `<${opening.sourceName}>`)
		.join('');

	const copy = (fragment: Regions.Fragment, start: number, end: number) => {
		segments.push({
			fragment,
			fragmentOffset: start,
			length: end - start,
			start: html.length,
		});
		html += fragment.node.value.slice(start, end);
	};

	for (const [index, fragment] of listFragments(
		region,
		isIncluded
	).entries()) {
		if (index > 0 && region.kind === 'block') {
			html += '\n';
		}

		let offset = 0;

		for (const token of fragment.tokens) {
			const replacement =
				token.kind === 'closing-tag'
					? corrections.closingTags?.get(token)
					: undefined;

			if (token.kind === 'closing-tag' && replacement !== undefined) {
				copy(fragment, offset, token.start);
				html += replacement;
				offset = token.end;
			}
		}

		copy(fragment, offset, fragment.node.value.length);
	}

	return { html, segments };
}

/**
 * Maps a line and column in a region’s HTML back to the Markdown source.
 * Outside copied HTML, uses the nearest earlier segment, or the first segment
 * for leading context. Returns `undefined` if the HTML copies no fragment.
 */
export function locateHTMLOffset(
	{ html, segments }: RegionHTML,
	{ column, line }: { column: number; line: number },
	document: Regions.Document
): AST.Point | undefined {
	const offset =
		html
			.split('\n')
			.slice(0, line - 1)
			.reduce((total, text) => total + text.length + 1, 0) +
		column -
		1;
	const segment =
		segments.findLast((candidate) => candidate.start <= offset) ??
		segments[0];

	if (!segment) {
		return undefined;
	}

	return locateFragmentOffset(
		document,
		segment.fragment,
		segment.fragmentOffset +
			Math.min(Math.max(offset - segment.start, 0), segment.length)
	);
}

/**
 * Lists a region’s fragments in source order, including selected nested HTML
 * blocks in the same container.
 */
function listFragments(
	region: Regions.Region,
	isIncluded: (nested: Regions.Region) => boolean
): Regions.Fragment[] {
	if (region.kind === 'inline') {
		return region.fragments;
	}

	const fragments = [...region.fragments];

	for (const nested of region.regions) {
		if (
			nested.kind === 'block' &&
			nested.container === region.container &&
			isIncluded(nested)
		) {
			fragments.push(...listFragments(nested, isIncluded));
		}
	}

	return fragments.toSorted((a, b) => a.index - b.index);
}
