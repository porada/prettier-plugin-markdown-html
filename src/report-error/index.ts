import type { AST } from '../types/index.d.ts';

type ErrorDetails = {
	cause?: unknown;
	position?: AST.Point | undefined;
	reason?: string;
	vendorMessage?: string;
};

const PLUGIN_PREFIX = '[prettier-plugin-markdown-html]';

// Errors that report a failure of Prettier’s HTML formatter
const formatterFailures = new WeakSet<Error>();

// The plugin’s explanation of a rejected layout, without its location
const layoutReasons = new WeakMap<Error, string>();

/**
 * Reports a layout error when formatting would change how the Markdown reads.
 */
export function reportUnsafeLayout(
	details: ErrorDetails & { reason: string }
): never {
	const error = createError(Error, 'Unsafe Markdown layout', details);
	layoutReasons.set(error, details.reason);
	throw error;
}

/**
 * Returns the plugin’s explanation when a layout error rejects a region.
 */
export function getLayoutReason(error: unknown): string | undefined {
	return error instanceof Error ? layoutReasons.get(error) : undefined;
}

/**
 * Returns the HTML formatter’s diagnostic without a position or code frame
 * relative to the HTML fragment.
 */
export function describeFormatterError(cause: unknown): string {
	const message = cause instanceof Error ? cause.message : String(cause);
	const frame =
		cause instanceof Error && 'codeFrame' in cause
			? cause.codeFrame
			: undefined;
	const description =
		typeof frame === 'string' && message.endsWith(`\n${frame}`)
			? message.slice(0, -frame.length - 1)
			: message;
	const [diagnostic] = description.split(/\r?\n(?=[ \t]*>?[ \t]*\d+ \|)/, 1);
	return diagnostic!.replace(/[ \t]*\(\d+:\d+\)$/m, '');
}

/**
 * Throws an error for a failure of Prettier’s HTML formatter.
 */
export function reportFormatterFailure(
	details: Pick<ErrorDetails, 'cause' | 'position'>
): never {
	const { cause } = details;
	const error = createError(
		cause instanceof SyntaxError ? SyntaxError : Error,
		'Failed to format HTML with Prettier',
		{ ...details, vendorMessage: describeFormatterError(cause) }
	);

	formatterFailures.add(error);
	throw error;
}

/**
 * Checks whether an error reports a failure of Prettier’s HTML formatter.
 */
export function isFormatterFailure(error: unknown): error is Error {
	return error instanceof Error && formatterFailures.has(error);
}

/**
 * Throws an error for a parser from another plugin whose syntax trees this
 * plugin can’t work with.
 */
export function reportUnsupportedASTFormat({
	expected,
	name,
	received,
}: {
	expected: string;
	name: string;
	received: string | undefined;
}): never {
	throw new TypeError(
		`${PLUGIN_PREFIX} Unsupported AST format for the \`${name}\` parser. Expected \`${expected}\`, received \`${received}\``
	);
}

/**
 * Describes a rejected region and names its Markdown file when supplied.
 */
export function describeRejectedRegion(
	details: ErrorDetails,
	filepath?: string
): string {
	return createMessage('Skipped HTML formatting', details, filepath);
}

/**
 * Reports a region’s fallback to plain Prettier as an error in debug mode.
 */
export function reportRejectedRegion(details: ErrorDetails): never {
	throw createError(Error, '`PRETTIER_DEBUG` stopped formatting', details);
}

/**
 * Retains the underlying error and exposes the original Markdown position
 * to Prettier when available.
 */
function createError(
	ErrorClass:
		ErrorConstructor | SyntaxErrorConstructor | TypeErrorConstructor,
	summary: string,
	details: ErrorDetails
): Error {
	const { cause, position } = details;
	const error = new ErrorClass(createMessage(summary, details), { cause });

	if (position) {
		// Prettier’s CLI reports errors with a `loc` as syntax errors, without
		// a stack trace
		Object.defineProperty(error, 'loc', {
			value: { start: { column: position.column, line: position.line } },
		});
	}

	return error;
}

/**
 * Keeps the plugin’s explanation on one line and separates a vendor diagnostic
 * from it with a blank line.
 */
function createMessage(
	summary: string,
	{ position, reason, vendorMessage }: ErrorDetails,
	filepath?: string
): string {
	let message = `${PLUGIN_PREFIX} ${summary}`;

	if (filepath) {
		message += ` in \`${filepath}\``;
	}

	if (position) {
		message += ` (${position.line}:${position.column})`;
	}

	if (reason) {
		message += `. ${reason}`;
	}

	if (vendorMessage) {
		message += `:\n\n${vendorMessage}`;
	}

	return message;
}
