import type { Options, ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import * as prettier from 'prettier';
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
	const htmlOptions = getHTMLOptions(options);

	try {
		const formatted = await prettier.format(text, htmlOptions);

		return formatted.trim();
	} catch (error: unknown) {
		reportFormatterFailure({
			cause: error,
			filepath: options?.filepath,
			position,
		});
	}
}

/**
 * Reports a formatter failure if the configured parser rejects the HTML output.
 */
export async function checkFormattedHTML(
	text: string,
	options?: Options | ParserOptions,
	position?: AST.Point
): Promise<void> {
	try {
		await parseHTML(text, options);
	} catch (error: unknown) {
		reportFormatterFailure({
			cause: error,
			filepath: options?.filepath,
			position,
		});
	}
}

/**
 * Finds where the configured HTML parser rejects a fragment, with the options
 * that formatting uses. Returns `undefined` if the fragment parses, as when
 * formatting fails in the printer or an embedded language.
 */
export async function findParseErrorLocation(
	text: string,
	options?: Options | ParserOptions
): Promise<{ column: number; line: number } | undefined> {
	try {
		await parseHTML(text, options);
	} catch (error: unknown) {
		return (error as { loc?: { start?: { column: number; line: number } } })
			.loc?.start;
	}

	return undefined;
}

/**
 * Parses HTML with the configured parser and the options that formatting uses.
 */
async function parseHTML(
	text: string,
	options: Options | ParserOptions | undefined
): Promise<void> {
	// Prettier exposes parsing with the configured plugins only for debugging
	const { __debug } = prettier as unknown as {
		__debug: {
			parse: (text: string, options: Options) => Promise<unknown>;
		};
	};

	await __debug.parse(text, getHTMLOptions(options));
}

/**
 * Returns the options for formatting an HTML fragment, letting the plugin’s
 * fragment options override Prettier’s matching options.
 */
function getHTMLOptions(options: Options | ParserOptions | undefined): Options {
	const formattingOptions = omitParserOptions(options);
	const {
		filepath,
		htmlFragmentBracketSameLine: bracketSameLine,
		htmlFragmentEmbeddedLanguageFormatting: embeddedLanguageFormatting,
		htmlFragmentPrintWidth: printWidth,
		htmlFragmentSingleAttributePerLine: singleAttributePerLine,
		htmlFragmentWhitespaceSensitivity: htmlWhitespaceSensitivity,
	} = formattingOptions;

	return {
		...formattingOptions,

		// The outer Markdown printer applies the requested line endings
		endOfLine: 'lf',

		// Plugins can use the Markdown file’s path to locate their
		// configuration. Without an `.htm` or `.html` extension, Prettier
		// preserves `DOCTYPE` case, which can determine whether the reference
		// renderer recognizes an HTML block
		filepath: filepath?.replace(/(?:\.html?)+$/, ''),
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
	};
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
