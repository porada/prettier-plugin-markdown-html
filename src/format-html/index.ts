import type { Options, ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import { format } from 'prettier';
import * as pluginHTML from 'prettier/plugins/html';
import { reportFormatterFailure } from '../report-error/index.ts';

/**
 * Formats an HTML fragment, letting the plugin’s fragment options override
 * Prettier’s matching options.
 */
export default async function formatHTML(
	text: string,
	options?: Options | ParserOptions,
	position?: AST.Point
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
		reportFormatterFailure({ cause: error, filepath, position });
	}
}

/**
 * Removes Markdown parser state that a nested format call must not inherit.
 */
export function omitParserOptions(
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
