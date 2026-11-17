import type { Parser, ParserOptions, Plugin, Printer } from 'prettier';
import type { AST, ParserName, PluginOptions } from './types/index.d.ts';
import { doc } from 'prettier';
import * as pluginHTML from 'prettier/plugins/html';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import {
	callParserWithCompatibility,
	createPriorParserResolver,
	createPriorPrinterResolver,
	markParserAsOwn,
	markPrinterAsOwn,
	withPriorParserOptions,
	withPriorPrinterOptions,
} from './plugin-hooks/index.ts';
import preprocessMarkdown, {
	formattedHTMLNodes,
	validateMarkdown,
} from './preprocess-markdown/index.ts';
import printMarkdown, {
	alignListItemHTML,
	printPrettierIgnored,
} from './print-markdown/index.ts';

const htmlOptions = (pluginHTML as Plugin).options!;
const markdownOptions = (pluginMarkdown as Plugin).options!;
const { parsers: markdownParsers, printers: markdownPrinters } = pluginMarkdown;

const priorParserResolverByName = new Map<
	ParserName,
	ReturnType<typeof createPriorParserResolver>
>();

// Text lengths before parser preprocessing, matching Prettier’s range
// comparison
const sourceLengths = new WeakMap<ParserOptions, number>();

/**
 * Creates a parser that defers to the prior compatible parser before Prettier’s
 * native parser.
 */
function createParser(name: ParserName): Parser {
	const nativeParser = markdownParsers[name];

	async function parse(
		text: string,
		options: ParserOptions
	): Promise<unknown> {
		const priorParser = await resolvePriorParser(options, 'parse');

		const ast = priorParser
			? await withPriorParserOptions(
					options,
					priorParser,
					(delegatedOptions) =>
						callParserWithCompatibility(
							priorParser.parser,
							text,
							delegatedOptions
						)
				)
			: await callParserWithCompatibility(nativeParser, text, options);

		// Prettier skips printer preprocessing for a partial Markdown range, so
		// validation runs during parsing
		if (
			options.rangeStart > 0 ||
			options.rangeEnd < (sourceLengths.get(options) ?? text.length)
		) {
			await validateMarkdown(
				await prepareRoot(ast as AST.Node, options),
				options
			);
		}

		return ast;
	}

	const preprocess: NonNullable<Parser['preprocess']> = async (
		text: string,
		options: ParserOptions
	) => {
		sourceLengths.set(options, text.length);

		const priorParser = await resolvePriorParser(options, 'preprocess');
		const priorPreprocess = priorParser?.parser.preprocess;

		if (priorParser && typeof priorPreprocess === 'function') {
			return withPriorParserOptions(
				options,
				priorParser,
				(delegatedOptions): Promise<string> | string =>
					priorPreprocess.call(
						priorParser.parser,
						text,
						delegatedOptions
					)
			);
		}

		const nativePreprocess = nativeParser.preprocess;
		return typeof nativePreprocess === 'function'
			? nativePreprocess.call(nativeParser, text, options)
			: text;
	};

	const parser: Parser = {
		...nativeParser,
		parse,
		preprocess,
	};
	const resolvePriorParser = createPriorParserResolver(
		name,
		nativeParser.astFormat,
		parser
	);
	priorParserResolverByName.set(name, resolvePriorParser);

	return markParserAsOwn(parser);
}

export const parsers: Plugin['parsers'] = {
	markdown: createParser('markdown'),
	remark: createParser('remark'),
};

/**
 * Prepares a Markdown syntax tree for printing with the prior or native
 * printer’s preprocessing.
 */
async function prepareRoot(
	ast: AST.Node,
	options: ParserOptions
): Promise<AST.Node> {
	const priorPrinter = await resolvePriorPrinter(options);
	const priorPreprocess = priorPrinter?.printer.preprocess;

	let root: AST.Node;

	if (priorPrinter && typeof priorPreprocess === 'function') {
		root = await withPriorPrinterOptions(
			options,
			priorPrinter,
			(delegatedOptions): AST.Node | Promise<AST.Node> => {
				const preprocessed = priorPreprocess.call(
					priorPrinter.printer,
					ast,
					delegatedOptions
				) as AST.Node | Promise<AST.Node>;

				return preprocessed;
			}
		);
	} else {
		const nativePreprocess = markdownPrinters.mdast.preprocess;

		/* v8 ignore next -- @preserve */
		root = (
			typeof nativePreprocess === 'function'
				? await nativePreprocess.call(
						markdownPrinters.mdast,
						ast,
						options
					)
				: ast
		) as AST.Node;
	}

	return root;
}

const mdastPrinter: Printer<AST.Node> = {
	...markdownPrinters.mdast,

	async preprocess(ast, options) {
		// Analysis and error positions use the source columns
		const root = await preprocessMarkdown(
			await prepareRoot(ast, options),
			options
		);
		alignListItemHTML(root);
		return root;
	},

	printPrettierIgnored,

	print(path, options, print, args) {
		const printed = printMarkdown(path, options, print, args);

		if (!formattedHTMLNodes.has(path.node)) {
			return printed;
		}

		// Empty literal lines inherit container padding. Trim that padding
		// without removing whitespace from nonempty HTML lines
		return doc.utils.mapDoc(printed, (part) =>
			part === '' ? doc.builders.trim : part
		);
	},
};
const resolvePriorPrinter = createPriorPrinterResolver(
	mdastPrinter,
	async (options) => {
		let parserName: ParserName | undefined;

		if (options.parser === 'markdown') {
			parserName = 'markdown';
		} else if (options.parser === 'remark') {
			parserName = 'remark';
		}

		if (!parserName) {
			return undefined;
		}

		return priorParserResolverByName.get(parserName)?.(options, 'parse');
	}
);

export const printers: Plugin['printers'] = {
	mdast: markPrinterAsOwn(mdastPrinter),
};

export const options: Plugin['options'] = {
	...htmlOptions,
	...markdownOptions,
	htmlFragmentBracketSameLine: {
		category: 'Markdown HTML',
		description:
			'Keep the closing bracket on the last attribute line in raw HTML fragments in Markdown.',
		type: 'boolean',
	},
	htmlFragmentEmbeddedLanguageFormatting: {
		category: 'Markdown HTML',
		description:
			'Control formatting of `<script>` and `<style>` contents in raw HTML fragments in Markdown.',
		type: 'choice',
		choices: [
			{
				description: 'Format embedded code.',
				value: 'auto',
			},
			{
				description: 'Never format embedded code.',
				value: 'off',
			},
		],
	},
	htmlFragmentPrintWidth: {
		category: 'Markdown HTML',
		description:
			'Override the preferred line length for raw HTML fragments in Markdown.',
		type: 'int',
	},
	htmlFragmentSingleAttributePerLine: {
		category: 'Markdown HTML',
		description:
			'Enforce one HTML attribute per line for raw HTML fragments in Markdown.',
		type: 'boolean',
	},
	htmlFragmentWhitespaceSensitivity: {
		category: 'Markdown HTML',
		description:
			'Control whitespace handling for raw HTML fragments in Markdown.',
		type: 'choice',
		choices: [
			{
				description: 'Respect CSS display property value.',
				value: 'css',
			},
			{
				description: 'Consider whitespace sensitive.',
				value: 'strict',
			},
			{
				description: 'Consider whitespace insensitive.',
				value: 'ignore',
			},
		],
	},
};

export type { PluginOptions };
