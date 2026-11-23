import type { AstPath, Parser, ParserOptions, Plugin, Printer } from 'prettier';
import type { AST, ParserName, PluginOptions } from './types/index.d.ts';
import * as prettier from 'prettier';
import { doc } from 'prettier';
import * as pluginHTML from 'prettier/plugins/html';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { omitParserOptions } from './format-html/index.ts';
import {
	callParserWithCompatibility,
	createPriorParserResolver,
	createPriorPrinterResolver,
	markParserAsOwn,
	markPrinterAsOwn,
	selectsPrinter,
	withoutOwnHooks,
	withPriorParserOptions,
	withPriorPrinterOptions,
} from './plugin-hooks/index.ts';
import preprocessMarkdown, {
	formattedHTMLNodes,
} from './preprocess-markdown/index.ts';

const htmlOptions = (pluginHTML as Plugin).options!;
const markdownOptions = (pluginMarkdown as Plugin).options!;
const { parsers: markdownParsers, printers: markdownPrinters } = pluginMarkdown;

// The source and parser of Markdown embedded in another document, by the empty
// syntax tree that stands in for it
const embeddedTexts = new WeakMap<
	AST.Node,
	{ parserName: ParserName; text: string }
>();

const priorParserResolverByName = new Map<
	ParserName,
	ReturnType<typeof createPriorParserResolver>
>();

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
		// Markdown embedded in another document leaves this plugin out, so
		// plain Prettier parses and prints it, with whatever syntax tree its
		// parser produces
		if (replaysEmbedded(options, name)) {
			const root: AST.Node = {
				children: [],
				position: {
					end: { column: 1, line: 1, offset: text.length },
					start: { column: 1, line: 1, offset: 0 },
				},
				type: 'root',
			};

			embeddedTexts.set(root, { parserName: name, text });
			return root;
		}

		const priorParser = await resolvePriorParser(options, 'parse');

		// Prettier skips printer preprocessing for a partial Markdown range, so
		// plain Prettier supplies that result
		return priorParser
			? withPriorParserOptions(options, priorParser, (delegatedOptions) =>
					callParserWithCompatibility(
						priorParser.parser,
						text,
						delegatedOptions
					)
				)
			: callParserWithCompatibility(nativeParser, text, options);
	}

	const preprocess: NonNullable<Parser['preprocess']> = async (
		text: string,
		options: ParserOptions
	) => {
		// Plain Prettier preprocesses Markdown embedded in another document
		if (replaysEmbedded(options, name)) {
			return text;
		}

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

	embed(path: AstPath<AST.Node>, options) {
		const embedded = embeddedTexts.get(path.node);

		if (!embedded) {
			return markdownPrinters.mdast.embed!(path, options);
		}

		const plugins = options.plugins!.map(
			withoutOwnHooks
		) as ParserOptions['plugins'];

		return async (textToDoc) => {
			const { parser } = options;
			let replayed: ReturnType<typeof textToDoc>;

			// Prettier reads the parent parser from these options at the start
			// of replay. That parser must embed the Markdown again
			options.parser = options.parentParser!;

			try {
				replayed = textToDoc(embedded.text, {
					parser: embedded.parserName,
					plugins,
				});
			} finally {
				options.parser = parser;
			}

			return replayed;
		};
	},

	async preprocess(ast, options) {
		if (embeddedTexts.has(ast)) {
			return ast;
		}

		const prepared = await prepareRoot(ast, options);

		if (isEmbedded(options)) {
			return prepared;
		}

		// Analysis and notice positions use the source columns
		return preprocessMarkdown(
			prepared,
			options,
			async (laidOut, sentinels) =>
				printTrial(laidOut, options, sentinels)
		);
	},

	print(path, options, print, args) {
		const printed = markdownPrinters.mdast.print(
			path,
			options,
			print,
			args
		);

		if (isEmbedded(options) || !formattedHTMLNodes.has(path.node)) {
			return printed;
		}

		// Empty literal lines inherit container padding. Trim that padding
		// without removing whitespace from nonempty HTML lines
		return doc.utils.mapDoc(printed, (region) =>
			region === '' ? doc.builders.trim : region
		);
	},
};

/**
 * Checks whether Prettier formats the Markdown inside another document, as it
 * does for a fenced code block of Markdown. The plugin leaves such Markdown to
 * plain Prettier and acts only on the top-level document.
 */
function isEmbedded(options: ParserOptions): boolean {
	return options.parentParser !== undefined;
}

/**
 * Checks whether this printer will replay a placeholder’s embedded Markdown.
 */
function replaysEmbedded(options: ParserOptions, name: ParserName): boolean {
	return (
		isEmbedded(options) &&
		selectsPrinter(
			options,
			typeof options.parser === 'string'
				? options.parser
				: /* v8 ignore next -- @preserve */ name,
			mdastPrinter
		)
	);
}

/**
 * Prints a laid-out syntax tree as this formatting operation would, without
 * preprocessing it again.
 */
async function printTrial(
	root: AST.Node,
	options: ParserOptions,
	sentinels: ReadonlyMap<AST.Node, string>
): Promise<string> {
	const { __debug } = prettier as unknown as {
		__debug: {
			formatAST: (
				ast: unknown,
				options: unknown
			) => Promise<{ formatted: string }>;
		};
	};
	const trialPrinter: Printer<AST.Node> = {
		...mdastPrinter,
		preprocess: undefined,
		// A sentinel before a fragment locates it in the printed text
		print(path, printOptions, print, args) {
			const printed = mdastPrinter.print(path, printOptions, print, args);
			const sentinel = sentinels.get(path.node);

			return sentinel === undefined ? printed : [sentinel, printed];
		},
	};
	const trialPlugin: Plugin = {
		parsers: {
			markdown: markdownParsers.markdown,
			remark: markdownParsers.remark,
		},
		printers: { mdast: trialPrinter },
	};

	const { formatted } = await __debug.formatAST(root, {
		...omitParserOptions(options),
		originalText: options.originalText,
		parser: options.parser,
		plugins: [...options.plugins, trialPlugin],
	});

	// The role check reparses the result, which needs line feeds
	return formatted.replaceAll(/\r\n?/g, '\n');
}

/**
 * Finds the prior Markdown printer whose preprocessing this plugin can use.
 */
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
			'Keep the closing bracket on the last attribute line in raw HTML fragments.',
		type: 'boolean',
	},
	htmlFragmentEmbeddedLanguageFormatting: {
		category: 'Markdown HTML',
		description: 'Format embedded code in raw HTML fragments.',
		type: 'choice',
		choices: [
			{
				description: 'Format embedded code.',
				value: 'auto',
			},
			{
				description: 'Leave embedded code as written.',
				value: 'off',
			},
		],
	},
	htmlFragmentPrintWidth: {
		category: 'Markdown HTML',
		description: 'Set the preferred line length for raw HTML fragments.',
		type: 'int',
	},
	htmlFragmentSingleAttributePerLine: {
		category: 'Markdown HTML',
		description: 'Use one attribute per line in raw HTML fragments.',
		type: 'boolean',
	},
	htmlFragmentWhitespaceSensitivity: {
		category: 'Markdown HTML',
		description: 'Set whitespace sensitivity for raw HTML fragments.',
		type: 'choice',
		choices: [
			{
				description: 'Follow each element’s default CSS display value.',
				value: 'css',
			},
			{
				description: 'Treat whitespace around tags as significant.',
				value: 'strict',
			},
			{
				description: 'Treat whitespace around tags as insignificant.',
				value: 'ignore',
			},
		],
	},
};

export type { PluginOptions };
