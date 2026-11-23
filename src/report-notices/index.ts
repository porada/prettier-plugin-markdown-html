import type { ParserOptions } from 'prettier';
import type { Rejection } from '../decide-regions/index.ts';
import type { Regions } from '../types/index.d.ts';
import { HTML_WHITESPACE } from '../constants/index.ts';
import {
	describeRejectedRegion,
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
	'pre': 'Keep `<pre>` and `</pre>` together in one HTML block.',
	'raw-text': 'Keep both tags of this raw text element in one HTML block.',
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
		reportRejectedRegion(describeProblem(first.problem, filepath));
	}

	for (const { problem } of notices.slice(0, MAX_LISTED_NOTICES)) {
		// Notices go to standard error, as Prettier’s own warnings do
		/* oxlint-disable-next-line eslint/no-console */
		console.warn(
			describeRejectedRegion(describeProblem(problem, filepath))
		);
	}

	const remaining = notices.length - MAX_LISTED_NOTICES;

	if (remaining > 0) {
		/* oxlint-disable-next-line eslint/no-console */
		console.warn(
			describeRejectedRegion({
				filepath,
				reason: `${remaining} more ${remaining === 1 ? 'region' : 'regions'}.`,
			})
		);
	}
}

/**
 * Gives the details of a rejection: where it starts in the original Markdown,
 * why the region falls back to plain Prettier, and any underlying error.
 */
function describeProblem(
	problem: Rejection,
	filepath: string | undefined
): {
	cause?: unknown;
	filepath: string | undefined;
	position: Rejection['position'];
	reason: string;
} {
	const { position } = problem;

	switch (problem.kind) {
		case 'changed-role':
			return {
				filepath,
				position,
				reason: 'Formatting would change whether Prettier reads this as inline HTML, an HTML block, or text. Check nearby line breaks, indentation, and code fences.',
			};

		case 'crossed-protection':
			return {
				filepath,
				position,
				reason: `An ignore directive covers only part of this \`<${problem.element.opening.sourceName}>\` element. Keep the whole element inside or outside the ignored source.`,
			};

		case 'escaped-pipe':
			return {
				filepath,
				position,
				reason: 'The raw HTML in this table cell contains an escaped pipe (`\\|`).',
			};

		case 'inline-foreign':
			return {
				filepath,
				position,
				reason: `To format this inline \`<${problem.element.opening.sourceName}>\`, put the whole element in one HTML block.`,
			};

		case 'moved-block':
			return {
				filepath,
				position,
				reason: 'Prettier’s Markdown layout would change how this HTML block is nested in lists or block quotes.',
			};

		case 'moved-ignore-comment':
			return {
				filepath,
				position,
				reason: 'Formatting would put this `prettier-ignore` comment on its own line and change which HTML it ignores on the next pass. Keep the HTML you want to ignore in one Markdown block, with a blank line after it.',
			};

		case 'open-block':
			return {
				filepath,
				position,
				reason: 'Formatting would make the next line of Markdown part of this HTML block. Add a blank line after the block.',
			};

		case 'reindented-block':
			return {
				filepath,
				position,
				reason: 'Prettier’s Markdown layout would change the indentation inside the formatted HTML block.',
			};

		case 'self-closing':
			return {
				filepath,
				position,
				reason: `HTML leaves \`<${problem.element.opening.sourceName}/>\` open. Use \`<${problem.element.opening.sourceName}>\` and \`</${problem.element.opening.sourceName}>\`.`,
			};

		case 'split-construct':
			return {
				filepath,
				position,
				reason: CONSTRUCT_DESCRIPTIONS[problem.construct],
			};

		case 'unclosed-element':
			return {
				filepath,
				position,
				reason: `Close \`<${problem.element.opening.sourceName}>\` with \`</${problem.element.opening.sourceName}>\` in the same Markdown region, or escape \`<\` as \`&lt;\` if the tag is meant as text.`,
			};

		case 'unmarkable':
			return {
				filepath,
				position,
				reason: 'The plugin can’t check this document’s HTML layout because every character it can use as a marker already appears in the text.',
			};

		case 'unpaired-closing-tag': {
			const { end, fragment, sourceName, start } = problem.tag;
			const tag = fragment.node.value
				.slice(start, end)
				.replaceAll(WHITESPACE_PATTERN, ' ');

			return {
				filepath,
				position,
				reason: `No opening \`<${sourceName}>\` matches this \`${tag}\` in the same Markdown region.`,
			};
		}

		case 'unsupported-construct':
			return {
				filepath,
				position,
				reason: `This region contains ${UNSUPPORTED_CONSTRUCT_NAMES[problem.construct]}, which the plugin doesn’t support.`,
			};

		default:
			return {
				cause: problem.cause,
				filepath,
				position,
				reason: describeCause(problem),
			};
	}
}

/**
 * Describes the error behind a region whose HTML Prettier can’t format or whose
 * layout can’t preserve the document.
 */
function describeCause(
	problem: Extract<Rejection, { cause: unknown }>
): string {
	const message =
		problem.cause instanceof Error
			? problem.cause.message
			: String(problem.cause);

	// A layout error’s reason follows the plugin’s summary, and Prettier’s
	// first line names the error without its code frame
	const summaryEnd = message.indexOf('\n\n');
	const reason =
		problem.kind === 'unsafe-layout'
			? message
					.slice(summaryEnd === -1 ? 0 : summaryEnd + 2)
					.split('\n', 1)[0]!
			: message.split('\n', 1)[0]!.replace(/\s*\(\d+:\d+\)$/, '');

	return problem.kind === 'unsafe-layout'
		? reason
		: `Prettier can’t format this HTML: ${reason}`;
}
