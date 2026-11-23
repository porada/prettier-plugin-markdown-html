import type { ParserOptions } from 'prettier';
import type { Rejection } from '../decide-regions/index.ts';
import type { Regions } from '../types/index.d.ts';
import { HTML_WHITESPACE } from '../constants/index.ts';
import {
	describeFormatterError,
	describeRejectedRegion,
	getLayoutReason,
	reportRejectedRegion,
} from '../report-error/index.ts';

const CONSTRUCT_DESCRIPTIONS: Readonly<
	Record<
		Extract<Regions.Problem, { kind: 'split-construct' }>['construct'],
		string
	>
> = {
	'comment': 'Close this comment with `-->` in the same HTML fragment.',
	'incomplete-tag':
		'Complete this tag, including any quoted attribute values, in the same HTML fragment.',
	'math': 'Close `<math>` with `</math>` in the same HTML block, before any enclosing element closes.',
	'svg': 'Close `<svg>` with `</svg>` in the same HTML block, before any enclosing element closes.',
};

// The notices that appear individually before a count of the rest
const MAX_LISTED_NOTICES = 5;

// The syntax that the plugin rejects wherever it occurs
const UNSUPPORTED_CONSTRUCT_NAMES: Readonly<
	Record<
		Extract<
			Regions.Problem,
			{ kind: 'unsupported-construct' }
		>['construct'],
		string
	>
> = {
	'cdata': 'a CDATA section',
	'declaration': 'a markup declaration',
	'processing-instruction': 'a processing instruction',
};

// A run of the characters that Prettier’s HTML lexer reads as whitespace
const WHITESPACE_PATTERN = new RegExp(String.raw`[${HTML_WHITESPACE}]+`, 'g');

/**
 * Reports the regions that fall back to plain Prettier on standard error, in
 * source order. Only the first few appear individually, followed by a count of
 * the rest. When `PRETTIER_DEBUG` is set, the first rejection throws instead.
 */
export default function reportNotices(
	notices: ReadonlyArray<{ problem: Rejection }>,
	options: Pick<ParserOptions, 'filepath'>
): void {
	const [first] = notices;

	if (!first) {
		return;
	}

	const { filepath } = options;

	if (
		(globalThis as { process?: { env?: Record<string, unknown> } }).process
			?.env?.PRETTIER_DEBUG
	) {
		reportRejectedRegion(describeProblem(first.problem));
	}

	for (const { problem } of notices.slice(0, MAX_LISTED_NOTICES)) {
		// Notices go to standard error, as Prettier’s own warnings do
		/* oxlint-disable-next-line eslint/no-console */
		console.warn(
			describeRejectedRegion(describeProblem(problem), filepath)
		);
	}

	const remaining = notices.length - MAX_LISTED_NOTICES;

	if (remaining > 0) {
		/* oxlint-disable-next-line eslint/no-console */
		console.warn(
			describeRejectedRegion(
				{
					reason: `${remaining} more ${remaining === 1 ? 'region' : 'regions'}.`,
				},
				filepath
			)
		);
	}
}

/**
 * Gives the details of a rejection: where it starts in the original Markdown,
 * why the region falls back to plain Prettier, and any underlying error.
 */
function describeProblem(problem: Rejection): {
	cause?: unknown;
	position: Rejection['position'];
	reason?: string;
	vendorMessage?: string;
} {
	const { position } = problem;

	switch (problem.kind) {
		case 'changed-role':
			return {
				position,
				reason: 'Formatting would change whether Prettier reads this as inline HTML, an HTML block, or text. Check nearby line breaks, indentation, and code fences.',
			};

		case 'crossed-protection':
			return {
				position,
				reason: `An ignore directive covers only part of this \`<${problem.element.opening.sourceName}>\` element. Keep the whole element inside or outside the ignored source.`,
			};

		case 'escaped-pipe':
			return {
				position,
				reason: 'The raw HTML in this table cell contains an escaped pipe (`\\|`).',
			};

		case 'inline-foreign':
			return {
				position,
				reason: `To format this inline \`<${problem.element.opening.sourceName}>\`, put the whole element in one HTML block.`,
			};

		case 'moved-block':
			return {
				position,
				reason: 'Prettier’s Markdown layout would change how this HTML block is nested in lists or block quotes.',
			};

		case 'moved-ignore-comment':
			return {
				position,
				reason: 'Formatting would put this `prettier-ignore` comment on its own line and change which HTML it ignores on the next pass. Keep the HTML you want to ignore in one Markdown block, with a blank line after it.',
			};

		case 'open-block':
			return {
				position,
				reason: 'Formatting would make the next line of Markdown part of this HTML block. Add a blank line after the block.',
			};

		case 'reindented-block':
			return {
				position,
				reason: 'Prettier’s Markdown layout would change the indentation inside the formatted HTML block.',
			};

		case 'self-closing':
			return {
				position,
				reason: `HTML doesn’t support self-closing syntax for \`<${problem.element.opening.sourceName}>\`. Use an explicit closing tag \`</${problem.element.opening.sourceName}>\`.`,
			};

		case 'split-element':
			return {
				position,
				reason: `Keep \`<${problem.element.opening.sourceName}>\` and \`</${problem.element.opening.sourceName}>\` together in one HTML block.`,
			};

		case 'split-construct':
			return {
				position,
				reason: CONSTRUCT_DESCRIPTIONS[problem.construct],
			};

		case 'unclosed-element':
			return {
				position,
				reason: `Close \`<${problem.element.opening.sourceName}>\` with \`</${problem.element.opening.sourceName}>\` in the same Markdown region, or escape \`<\` as \`&lt;\` if the tag is meant as text.`,
			};

		case 'unmarkable':
			return {
				position,
				reason: 'The plugin can’t check this document’s HTML layout because every character it can use as a marker already appears in the text.',
			};

		case 'unpaired-closing-tag': {
			const { end, fragment, sourceName, start } = problem.tag;
			const tag = fragment.node.value
				.slice(start, end)
				.replaceAll(WHITESPACE_PATTERN, ' ');

			return {
				position,
				reason: `No opening \`<${sourceName}>\` matches this \`${tag}\` in the same Markdown region.`,
			};
		}

		case 'unsupported-construct':
			return {
				position,
				reason: `This region contains ${UNSUPPORTED_CONSTRUCT_NAMES[problem.construct]}, which the plugin doesn’t support.`,
			};

		case 'unsafe-layout': {
			const { cause } = problem;
			const reason = getLayoutReason(cause);

			if (reason !== undefined) {
				return { cause, position, reason };
			}

			const vendorMessage =
				cause instanceof Error ? cause.message : String(cause);
			return { cause, position, vendorMessage };
		}

		case 'unformattable':
			return {
				cause: problem.cause,
				position,
				reason: 'Prettier can’t format this HTML',
				vendorMessage: describeFormatterError(problem.cause),
			};
	}
}
