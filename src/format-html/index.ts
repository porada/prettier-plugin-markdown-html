import type { Options, ParserOptions } from 'prettier';
import { format } from 'prettier';
import * as pluginHTML from 'prettier/plugins/html';

export default async function formatHTML(
	text: string,
	options?: Options | ParserOptions
): Promise<string> {
	const formattingOptions = omitParserOptions(options);
	const {
		filepath,
		htmlFragmentPrintWidth: printWidth,
		htmlFragmentSingleAttributePerLine: singleAttributePerLine,
		htmlFragmentWhitespaceSensitivity: htmlWhitespaceSensitivity,
	} = formattingOptions;

	try {
		const formatted = await format(text, {
			...formattingOptions,

			filepath: `${filepath ?? 'prettier-plugin-markdown-html'}.html`,
			parser: 'html',
			plugins: [pluginHTML, ...(formattingOptions.plugins ?? [])],

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
