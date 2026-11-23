import type { AST } from '../types/index.d.ts';

type ErrorDetails = {
	cause?: unknown;
	filepath?: string | undefined;
	position?: AST.Point | undefined;
	reason: string;
};

const PLUGIN_PREFIX = '[prettier-plugin-markdown-html]';

// Errors that report a failure of Prettier’s HTML formatter
const formatterFailures = new WeakSet<Error>();

/**
 * Reports a layout error when formatting would change how the Markdown reads.
 */
export function reportUnsafeLayout(details: ErrorDetails): never {
	throw createError(Error, 'Unsafe Markdown layout', details);
}

/**
 * Throws an error for a failure of Prettier’s HTML formatter.
 */
export function reportFormatterFailure(
	details: Omit<ErrorDetails, 'reason'>
): never {
	const { cause } = details;

	// Prettier’s code frame and position refer to the HTML that the plugin
	// formats, not the Markdown
	const reason = (cause instanceof Error ? cause.message : String(cause))
		.split('\n', 1)[0]!
		.replace(/\s*\(\d+:\d+\)$/, '');

	const error = createError(
		cause instanceof SyntaxError ? SyntaxError : Error,
		'Failed to format HTML with Prettier',
		{ ...details, reason }
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
	filepath,
	name,
	received,
}: {
	expected: string;
	filepath?: string | undefined;
	name: string;
	received: string | undefined;
}): never {
	const location = filepath ? ` while formatting \`${filepath}\`` : '';

	throw new TypeError(
		`${PLUGIN_PREFIX} Unsupported AST format for the \`${name}\` parser. Expected \`${expected}\`, received \`${received}\`${location}`
	);
}

/**
 * Describes a region that falls back to plain Prettier, for a notice.
 */
export function describeRejectedRegion(details: ErrorDetails): string {
	return createMessage('Skipped HTML formatting', details).replace(
		':\n\n',
		': '
	);
}

/**
 * Reports a region’s fallback to plain Prettier as an error in debug mode.
 */
export function reportRejectedRegion(details: ErrorDetails): never {
	throw createError(Error, 'PRETTIER_DEBUG stopped formatting', details);
}

/**
 * Creates an error that names the plugin, includes any supplied file and
 * original Markdown position, and keeps any underlying error as its cause.
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
 * Creates a message that names the plugin and includes any supplied file and
 * original Markdown position.
 */
function createMessage(
	summary: string,
	{ filepath, position, reason }: ErrorDetails
): string {
	let message = `${PLUGIN_PREFIX} ${summary}`;

	if (filepath) {
		message += ` in \`${filepath}\``;
	}

	if (position) {
		message += ` (${position.line}:${position.column})`;
	}

	return `${message}:\n\n${reason}`;
}
