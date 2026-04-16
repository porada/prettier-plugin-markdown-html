import type { Options, ParserOptions } from 'prettier';
import { format } from 'prettier';

/* oxlint-disable-next-line typescript/consistent-return */
export default async function formatHTML(
	text: string,
	options?: Options | ParserOptions
): Promise<string> {
	/* oxlint-disable-next-line eslint/no-param-reassign */
	options = omitParserOptions(options);

	const {
		filepath,
		htmlFragmentPrintWidth: printWidth,
		htmlFragmentSingleAttributePerLine: singleAttributePerLine,
		htmlFragmentWhitespaceSensitivity: htmlWhitespaceSensitivity,
	} = options;

	try {
		const formatted = await format(text, {
			...options,

			filepath: `${filepath ?? 'prettier-plugin-markdown-html'}.html`,
			parser: 'html',

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
		cursorOffset,
		getVisitorKeys,
		locEnd,
		locStart,
		originalText,
		parentParser,
		parser,
		printer,
		rangeEnd,
		rangeStart,
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

	/* v8 ignore start -- @preserve */
	if (filepath) {
		message += ` in ${filepath}`;
	}

	if (error instanceof Error && error.message) {
		message += `\n\n${error.message}`;
	}

	if (error instanceof SyntaxError) {
		throw new SyntaxError(message, { cause: error });
	}

	throw new Error(message, { cause: error });
	/* v8 ignore stop -- @preserve */
}
