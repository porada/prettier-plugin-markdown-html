import type { Options, ParserOptions, Plugin } from 'prettier';
import type { AST } from '../types/index.d.ts';
import { format } from 'prettier';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { omitParserOptions } from '../format-html/index.ts';
import { withoutOwnHooks } from '../plugin-hooks/index.ts';
import printMarkdown, { alignListItemHTML } from '../print-markdown/index.ts';

/**
 * Formats Markdown without this plugin, retaining the other plugins. Uses the
 * current options with LF line endings, then applies any overrides.
 */
export default async function formatMarkdown(
	text: string,
	options: ParserOptions,
	overrides: Options = {}
): Promise<string> {
	/* oxlint-disable eslint/no-unused-vars */
	const {
		htmlFragmentBracketSameLine,
		htmlFragmentEmbeddedLanguageFormatting,
		htmlFragmentPrintWidth,
		htmlFragmentSingleAttributePerLine,
		htmlFragmentWhitespaceSensitivity,
		...formattingOptions
	} = omitParserOptions(options);
	/* oxlint-enable eslint/no-unused-vars */
	const parserName = options.parser === 'remark' ? 'remark' : 'markdown';
	const plugins = (options.plugins ?? []).map(withoutOwnHooks) as Plugin[];

	return format(text, {
		...formattingOptions,
		endOfLine: 'lf',
		parser: parserName,
		plugins: [...plugins, createPrinterPlugin(plugins, parserName)],
		...overrides,
	});
}

/**
 * Creates a plugin for nested Markdown formatting that uses `printMarkdown`
 * without this plugin’s HTML preprocessing. Prettier uses the printer of the
 * plugin that supplies the parser, so the new plugin reuses the Markdown parser
 * of the last plugin that supplies one. Its printer runs that plugin’s printer
 * preprocessing, or Prettier’s if unavailable, before aligning HTML in list
 * items.
 */
function createPrinterPlugin(
	plugins: ReadonlyArray<Plugin>,
	parserName: 'markdown' | 'remark'
): Plugin {
	const nativeParser = pluginMarkdown.parsers[parserName];
	const nativePrinter = pluginMarkdown.printers.mdast;
	const parserPlugin = plugins.findLast(
		(plugin) => plugin?.parsers?.[parserName] !== undefined
	);
	const priorPrinter = parserPlugin?.printers?.mdast;
	const preprocess =
		typeof priorPrinter === 'object' && priorPrinter.preprocess
			? priorPrinter.preprocess.bind(priorPrinter)
			: nativePrinter.preprocess!.bind(nativePrinter);

	return {
		parsers: {
			[parserName]: parserPlugin?.parsers?.[parserName] ?? nativeParser,
		},
		printers: {
			mdast: {
				...nativePrinter,
				async preprocess(ast, printerOptions) {
					const root = (await preprocess(
						ast,
						printerOptions
					)) as AST.Node;
					alignListItemHTML(root);
					return root;
				},
				print: printMarkdown,
			},
		},
	};
}
