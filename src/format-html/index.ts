import type { Options, ParserOptions } from 'prettier';
import { format } from 'prettier';
import * as pluginHTML from 'prettier/plugins/html';

/**
 * Formats an HTML fragment, letting the plugin’s fragment options override
 * Prettier’s matching options.
 */
export default async function formatHTML(
	text: string,
	options?: Options | ParserOptions
): Promise<string> {
	const formattingOptions = omitParserOptions(options);
	const {
		filepath,
		htmlFragmentBracketSameLine: bracketSameLine,
		htmlFragmentEmbeddedLanguageFormatting: embeddedLanguageFormatting,
		htmlFragmentPrintWidth: printWidth,
		htmlFragmentSingleAttributePerLine: singleAttributePerLine,
		htmlFragmentWhitespaceSensitivity: htmlWhitespaceSensitivity,
	} = formattingOptions;

	try {
		const formatted = await format(text, {
			...formattingOptions,

			// The outer Markdown printer applies the requested line endings
			endOfLine: 'lf',
			filepath: `${filepath ?? 'prettier-plugin-markdown-html'}.html`,
			parser: 'html',
			plugins: [pluginHTML, ...(formattingOptions.plugins ?? [])],

			...(bracketSameLine !== undefined && { bracketSameLine }),
			...(typeof embeddedLanguageFormatting === 'string' && {
				embeddedLanguageFormatting,
			}),
			...(typeof htmlWhitespaceSensitivity === 'string' && {
				htmlWhitespaceSensitivity,
			}),
			...(typeof printWidth === 'number' && {
				printWidth,
			}),
			...(singleAttributePerLine !== undefined && {
				singleAttributePerLine,
			}),
		});

		return formatted.trim();
	} catch (error: unknown) {
		reportFormattingError(filepath, error);
	}
}

/**
 * Removes Markdown parser state that a nested HTML format call must
 * not inherit.
 */
function omitParserOptions(
	options: Options | ParserOptions | undefined
): Options {
	if (!options) {
		return {};
	}

	/* oxlint-disable eslint/no-unused-vars */
	const {
		__embeddedInHtml,
		astFormat,
		checkIgnorePragma,
		cursorOffset,
		getVisitorKeys,
		insertPragma,
		locEnd,
		locStart,
		originalText,
		parentParser,
		parser,
		printer,
		rangeEnd,
		rangeStart,
		requirePragma,
		...formattingOptions
	} = options;
	/* oxlint-enable eslint/no-unused-vars */

	return formattingOptions;
}

/**
 * Throws an error that names the plugin and any supplied file, keeping the
 * original error as its cause.
 */
function reportFormattingError(
	filepath: string | undefined,
	error: unknown
): never {
	let message =
		'[prettier-plugin-markdown-html] Failed to format HTML fragment';

	if (filepath) {
		message += ` in \`${filepath}\``;
	}

	/* v8 ignore next -- @preserve */
	if (error instanceof Error && error.message) {
		message += `:\n\n${error.message}`;
	}

	/* v8 ignore next -- @preserve */
	if (error instanceof SyntaxError) {
		throw new SyntaxError(message, { cause: error });
	}

	/* v8 ignore next -- @preserve */
	throw new Error(message, { cause: error });
}
