import type { AST } from '../types/index.d.ts';

type ErrorDetails = {
	cause?: unknown;
	filepath?: string | undefined;
	position?: AST.Point | undefined;
	reason: string;
};

const PLUGIN_PREFIX = '[prettier-plugin-markdown-html]';

/**
 * Throws an error for HTML that isn’t valid in its Markdown context.
 */
export function reportInvalidHTML(details: ErrorDetails): never {
	throw createError(SyntaxError, 'Invalid HTML', details);
}

/**
 * Throws an error for a Markdown layout that can’t preserve the document’s
 * interpretation.
 */
export function reportUnsafeLayout(details: ErrorDetails): never {
	throw createError(Error, 'Unsafe Markdown layout', details);
}

/**
 * Throws an error for valid Markdown that the plugin can’t format, such as a
 * construct that Prettier’s Markdown parser reads differently from GFM.
 */
export function reportUnsupportedMarkdown(details: ErrorDetails): never {
	throw createError(Error, 'Unsupported Markdown', details);
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

	throw createError(
		cause instanceof SyntaxError ? SyntaxError : Error,
		'Failed to format HTML with Prettier',
		{ ...details, reason }
	);
}

/**
 * Throws an error for a parser from another plugin that this plugin can’t work
 * with.
 */
export function reportIncompatibleParser(details: ErrorDetails): never {
	throw createError(TypeError, 'Incompatible parser', details);
}

/**
 * Names the Markdown construct that the reference renderer turns into an
 * element.
 */
export function describeGeneratedElement(tagName: string): string {
	switch (tagName) {
		case 'a':
			return 'link';

		case 'blockquote':
			return 'block quote';

		case 'code':
			return 'code span';

		case 'del':
			return 'strikethrough text';

		case 'em':
			return 'emphasized text';

		case 'li':
			return 'list item';

		case 'ol':

		case 'ul':
			return 'list';

		case 'p':
			return 'paragraph';

		case 'pre':
			return 'code block';

		case 'strong':
			return 'strongly emphasized text';

		case 'table':
			return 'table';

		case 'td':

		case 'th':
			return 'table cell';

		case 'tr':
			return 'table row';

		default:
			return /^h[1-6]$/.test(tagName) ? 'heading' : `\`<${tagName}>\``;
	}
}

/**
 * Adds the indefinite article to the name of a Markdown construct.
 */
export function withArticle(construct: string): string {
	if (construct.endsWith(' text')) {
		return construct;
	}

	return /^[aeiou]/.test(construct) ? `an ${construct}` : `a ${construct}`;
}

/**
 * Creates an error that names the plugin, includes any supplied file and
 * original Markdown position, and keeps any underlying error as its cause.
 */
function createError(
	ErrorClass:
		ErrorConstructor | SyntaxErrorConstructor | TypeErrorConstructor,
	summary: string,
	{ cause, filepath, position, reason }: ErrorDetails
): Error {
	let message = `${PLUGIN_PREFIX} ${summary}`;

	if (filepath) {
		message += ` in \`${filepath}\``;
	}

	if (position) {
		message += ` (${position.line}:${position.column})`;
	}

	const error = new ErrorClass(`${message}:\n\n${reason}`, { cause });

	if (position) {
		// Prettier’s CLI reports errors with a `loc` as syntax errors, without
		// a stack trace
		Object.defineProperty(error, 'loc', {
			value: { start: { column: position.column, line: position.line } },
		});
	}

	return error;
}
