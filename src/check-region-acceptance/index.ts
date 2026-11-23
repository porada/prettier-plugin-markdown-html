import type { ParserOptions } from 'prettier';
import type { Regions } from '../types/index.d.ts';
import * as pluginHTML from 'prettier/plugins/html';
import {
	findEndFragment,
	isSplitForeignElement,
} from '../find-document-regions/index.ts';
import isRawTextTag from '../is-raw-text-tag/index.ts';
import renderRegionHTML, {
	locateHTMLOffset,
} from '../render-region-html/index.ts';

type ParseError = Error & {
	loc?: { start?: { column: number; line: number } };
};

/**
 * Checks each region for unsupported markup and verifies that its corrected
 * HTML parses. Accepted regions can still fail during formatting.
 */
export default async function checkRegionAcceptance(
	documentRegions: Regions.DocumentRegions
): Promise<Map<Regions.Region, Regions.Verdict>> {
	const verdicts = new Map<Regions.Region, Regions.Verdict>();

	for (const region of documentRegions.regions) {
		await decideRegion(region, documentRegions, verdicts);
	}

	return verdicts;
}

/**
 * Decides whether a region and the regions nested in it qualify for formatting. The
 * verdict reports the region’s first problem in source order.
 */
async function decideRegion(
	region: Regions.Region,
	documentRegions: Regions.DocumentRegions,
	verdicts: Map<Regions.Region, Regions.Verdict>
): Promise<void> {
	for (const nested of region.regions) {
		await decideRegion(nested, documentRegions, verdicts);
	}

	const parseProblem = await findParseProblem(
		region,
		documentRegions,
		verdicts
	);
	const [problem] = [
		...findTagProblems(region),
		...(parseProblem ? [parseProblem] : []),
	].toSorted((a, b) => a.position.offset! - b.position.offset!);

	verdicts.set(
		region,
		problem ? { isAccepted: false, problem } : { isAccepted: true }
	);
}

/**
 * Finds mismatched tags, split or unsupported constructs, and elements that
 * cross a protected source boundary.
 */
function findTagProblems(region: Regions.Region): Regions.Problem[] {
	const problems: Regions.Problem[] = [];
	// An open raw text or `pre` element, or a construct that its HTML block
	// leaves unfinished, takes in the closing tags of the elements open around
	// it, so its own problem names the cause
	const aroundOpenContent = new Set<Regions.Element>();
	const unfinishedOffsets = region.fragments
		.filter(({ isBlock }) => isBlock)
		.flatMap(({ tokens }) => tokens)
		.filter(
			(token) =>
				token.kind === 'opaque' &&
				token.end === undefined &&
				token.construct !== 'raw-text'
		)
		.map(({ position }) => position.offset!);

	for (const element of region.elements) {
		if (
			element.end === 'unclosed' &&
			(isRawTextTag(element.name) ||
				(element.name === 'pre' && !element.isForeign))
		) {
			for (
				let current = element.parent;
				current;
				current = current.parent
			) {
				aroundOpenContent.add(current);
			}
		}

		if (
			element.end === 'unclosed' &&
			unfinishedOffsets.some(
				(offset) => element.opening.position.offset! < offset
			)
		) {
			aroundOpenContent.add(element);
		}
	}

	for (const element of region.elements) {
		const { end, endTag, opening } = element;
		const { position } = opening;

		// Self-closing syntax leaves an HTML element open where Prettier closes
		// it, so the two can pair a later closing tag differently
		if (opening.isSelfClosing && end !== 'opening-tag') {
			problems.push({ element, kind: 'self-closing', position });
		}

		// An element left open at the end of its HTML block needs its own
		// closing tag in a later block, so an enclosing element’s closing tag
		// can end it only within its block. Inline tags pair by name alone
		if (
			(end === 'unclosed' && !aroundOpenContent.has(element)) ||
			(end === 'enclosing' &&
				(region.kind === 'inline' ||
					endTag!.fragment !== opening.fragment))
		) {
			problems.push({ element, kind: 'unclosed-element', position });
		}

		const isPreformatted = element.name === 'pre' && !element.isForeign;
		const endFragment = findEndFragment(element);
		let construct: 'pre' | 'raw-text' | undefined;

		if (isPreformatted) {
			construct = 'pre';
		} else if (isRawTextTag(element.name)) {
			construct = 'raw-text';
		}

		if (construct && endFragment !== opening.fragment) {
			problems.push({ construct, kind: 'split-construct', position });
		}

		// Foreign content can’t span Markdown or end at another element’s
		// closing tag
		if (isSplitForeignElement(element)) {
			problems.push({
				construct: element.name as 'math' | 'svg',
				kind: 'split-construct',
				position,
			});
		}

		if (
			region.kind === 'inline' &&
			element.isForeign &&
			!element.parent?.isForeign
		) {
			problems.push({ element, kind: 'inline-foreign', position });
		}

		if (opening.fragment.protection !== endFragment?.protection) {
			problems.push({ element, kind: 'crossed-protection', position });
		}
	}

	for (const tag of region.unpairedClosingTags) {
		problems.push({
			kind: 'unpaired-closing-tag',
			position: tag.position,
			tag,
		});
	}

	for (const fragment of region.fragments) {
		if (
			fragment.block?.type === 'tableCell' &&
			fragment.node.value.includes(String.raw`\|`)
		) {
			problems.push({
				kind: 'escaped-pipe',
				position: fragment.tokens[0]!.position,
			});
		}

		for (const token of fragment.tokens) {
			if (token.kind !== 'opaque') {
				continue;
			}

			if (
				token.construct === 'cdata' ||
				token.construct === 'declaration' ||
				token.construct === 'processing-instruction'
			) {
				problems.push({
					construct: token.construct,
					kind: 'unsupported-construct',
					position: token.position,
				});
			} else if (
				token.end === undefined &&
				(token.construct === 'comment' ||
					token.construct === 'incomplete-tag')
			) {
				problems.push({
					construct: token.construct,
					kind: 'split-construct',
					position: token.position,
				});
			}
		}
	}

	return problems;
}

/**
 * Parses a region’s raw HTML, after corrections, inside the raw elements open
 * around the region, and describes the error if Prettier’s HTML parser throws.
 */
async function findParseProblem(
	region: Regions.Region,
	{ corrections, document }: Regions.DocumentRegions,
	verdicts: ReadonlyMap<Regions.Region, Regions.Verdict>
): Promise<Regions.Problem | undefined> {
	const regionHTML = renderRegionHTML(
		region,
		corrections,
		(nested) => verdicts.get(nested)!.isAccepted
	);

	try {
		await pluginHTML.parsers.html.parse(regionHTML.html, {
			parser: 'html',
		} as ParserOptions);
	} catch (error: unknown) {
		const start = (error as ParseError).loc?.start;

		return {
			cause: error,
			kind: 'unformattable',
			position:
				(start && locateHTMLOffset(regionHTML, start, document)) ??
				region.position,
		};
	}

	return undefined;
}
