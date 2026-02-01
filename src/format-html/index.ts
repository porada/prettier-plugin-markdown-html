import type { Options, ParserOptions } from 'prettier';
import { format } from 'prettier';

export default async function formatHTML(
	text: string,
	options?: Options | ParserOptions
): Promise<string> {
	const { filepath } = options ?? {};

	try {
		const formatted = await format(text, {
			parser: 'html',
			filepath: `${filepath ?? 'prettier-plugin-markdown-html'}.html`,
			...omitParserOptions(options),
		});

		return formatted.trim();
	} catch {
		return text;
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
		filepath,
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
