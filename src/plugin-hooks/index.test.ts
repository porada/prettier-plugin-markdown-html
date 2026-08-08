import type { Parser, ParserOptions, Plugin, Printer } from 'prettier';
import type { AST } from '../types/index.d.ts';
import { format } from 'prettier';
import {
	parsers as markdownParsers,
	printers as markdownPrinters,
} from 'prettier/plugins/markdown';
import { expect, test, vi } from 'vite-plus/test';
import * as pluginMarkdownHTML from '../index.ts';
import {
	createPriorParserResolver,
	createPriorPrinterResolver,
	withPriorParserOptions,
	withPriorPrinterOptions,
} from './index.ts';

const MARKDOWN_PARSER_NAMES = ['markdown', 'remark'] as const;

function getDirectParser(
	plugin: Plugin,
	parserName: (typeof MARKDOWN_PARSER_NAMES)[number]
): Parser {
	const parser = plugin.parsers?.[parserName];

	if (!parser || typeof parser === 'function') {
		throw new TypeError(`Expected a direct \`${parserName}\` parser`);
	}

	return parser;
}

function getMdastPrinter(plugin: Plugin): Printer {
	const printer = plugin.printers?.mdast;

	if (!printer) {
		throw new TypeError('Expected an `mdast` printer');
	}

	return printer;
}

function createPriorParser(
	parserName: (typeof MARKDOWN_PARSER_NAMES)[number]
): Parser {
	return {
		...markdownParsers[parserName],
		preprocess: async () => {
			await Promise.resolve();
			return 'Parser <span id = "foo">value</span>\n';
		},
	};
}

function createPriorPrinter(
	identifier: string,
	observeOptions?: (options: ParserOptions) => void
): Printer {
	const nativePrinterPreprocess = markdownPrinters.mdast.preprocess;

	return {
		...markdownPrinters.mdast,
		async preprocess(ast, options) {
			observeOptions?.(options);

			const root = (
				typeof nativePrinterPreprocess === 'function'
					? await nativePrinterPreprocess.call(
							markdownPrinters.mdast,
							ast,
							options
						)
					: ast
			) as AST.RootNode;

			const htmlNode = root.children
				.flatMap((node) => node.children ?? [])
				.find(
					(node): node is AST.HTMLNode =>
						node.type === 'html' && typeof node.value === 'string'
				);

			if (!htmlNode) {
				throw new TypeError('Expected an HTML node');
			}

			htmlNode.value = htmlNode.value.replace(
				/id\s*=\s*"[^"]*"/,
				`id="${identifier}"`
			);
			return root;
		},
	};
}

function createPriorPlugin(
	parserName: (typeof MARKDOWN_PARSER_NAMES)[number]
): Plugin {
	return {
		parsers: {
			[parserName]: createPriorParser(parserName),
		},
		printers: {
			mdast: createPriorPrinter('bar'),
		},
	};
}

test('returns `undefined` without prior hooks', async () => {
	const currentParser = getDirectParser(pluginMarkdownHTML, 'markdown');
	const resolvePriorParser = createPriorParserResolver(
		'markdown',
		markdownParsers.markdown.astFormat,
		currentParser
	);

	const parserOptions = {
		plugins: [
			null,
			'missing-plugin',
			{ parsers: undefined },
			{ parsers: { markdown: undefined } },
		],
	} as unknown as ParserOptions;

	await expect(
		resolvePriorParser(parserOptions, 'parse')
	).resolves.toBeUndefined();

	const currentPrinter = getMdastPrinter(pluginMarkdownHTML);
	const resolvePriorPrinter = createPriorPrinterResolver(
		currentPrinter,
		async () => {
			await Promise.resolve();
			return undefined;
		}
	);

	const printerOptions = {
		plugins: [
			null,
			'missing-plugin',
			{ printers: undefined },
			{ printers: { mdast: undefined } },
		],
	} as unknown as ParserOptions;

	await expect(resolvePriorPrinter(printerOptions)).resolves.toBeUndefined();
	await expect(resolvePriorPrinter(printerOptions)).resolves.toBeUndefined();
});

test('doesn’t resolve canonical parsers for aliased exports', async () => {
	const currentParser = getDirectParser(pluginMarkdownHTML, 'markdown');
	const initializeCanonicalParser = vi.fn(async (): Promise<Parser> => {
		await Promise.resolve();
		return markdownParsers.markdown;
	});

	const canonicalPlugin = {
		parsers: { markdown: initializeCanonicalParser },
	} as unknown as Plugin;
	const aliasPlugin: Plugin = {
		parsers: { 'markdown-alias': currentParser },
	};

	const resolvePriorParser = createPriorParserResolver(
		'markdown',
		markdownParsers.markdown.astFormat,
		currentParser
	);
	const options = {
		parser: 'markdown-alias',
		plugins: [canonicalPlugin, aliasPlugin],
	} as unknown as ParserOptions;

	await expect(resolvePriorParser(options, 'parse')).resolves.toBeUndefined();

	expect(initializeCanonicalParser).not.toHaveBeenCalled();
});

test('preserves the selected parser name between hooks', async () => {
	const currentParser = getDirectParser(pluginMarkdownHTML, 'markdown');
	const priorParser: Parser = {
		...markdownParsers.markdown,
		preprocess: (text) => text,
	};

	const priorPlugin: Plugin = { parsers: { markdown: priorParser } };

	const resolvePriorParser = createPriorParserResolver(
		'markdown',
		markdownParsers.markdown.astFormat,
		currentParser
	);

	const options = {
		parser: 'markdown',
		plugins: [priorPlugin, pluginMarkdownHTML],
	} as unknown as ParserOptions;

	await expect(
		resolvePriorParser(options, 'preprocess')
	).resolves.toMatchObject({ parser: priorParser });

	options.parser = 'remark';

	await expect(resolvePriorParser(options, 'parse')).resolves.toMatchObject({
		parser: priorParser,
	});
});

test('resolves printer-only plugins without a matching parser', async () => {
	const currentPrinter = getMdastPrinter(pluginMarkdownHTML);
	const fallbackPrinter = createPriorPrinter('fallback');

	const fallbackPlugin: Plugin = {
		printers: { mdast: fallbackPrinter },
	};

	const externalParserPlugin: Plugin = {};

	const plugins: ParserOptions['plugins'] = [fallbackPlugin];
	const parser = markdownParsers.markdown;

	const resolvePriorPrinter = createPriorPrinterResolver(
		currentPrinter,
		async () => {
			await Promise.resolve();
			return {
				locationState: {},
				parser,
				plugin: externalParserPlugin,
				plugins,
				selectedParser: parser,
			};
		}
	);

	const resolvedPrinter = await resolvePriorPrinter({
		plugins,
	} as ParserOptions);

	expect(resolvedPrinter?.printer).toBe(fallbackPrinter);
	expect(resolvedPrinter?.plugins).toBe(plugins);
});

test('returns `undefined` for printers without `preprocess`', async () => {
	const currentPrinter = getMdastPrinter(pluginMarkdownHTML);
	const parser = markdownParsers.markdown;

	const printer: Printer = {
		print: markdownPrinters.mdast.print,
	};

	const plugin: Plugin = {
		parsers: { markdown: parser },
		printers: { mdast: printer },
	};

	const plugins: ParserOptions['plugins'] = [plugin];

	const priorParser = {
		locationState: {},
		parser,
		plugin,
		plugins,
		selectedParser: parser,
	};

	const resolveAssociatedPrinter = createPriorPrinterResolver(
		currentPrinter,
		async () => {
			await Promise.resolve();
			return priorParser;
		}
	);

	const options = { plugins } as ParserOptions;

	await expect(resolveAssociatedPrinter(options)).resolves.toBeUndefined();

	const resolveFallbackPrinter = createPriorPrinterResolver(
		currentPrinter,
		async () => {
			await Promise.resolve();
			return undefined;
		}
	);

	await expect(resolveFallbackPrinter(options)).resolves.toBeUndefined();
});

test('reuses resolved lazy printers while falling back', async () => {
	const currentPrinter = getMdastPrinter(pluginMarkdownHTML);
	const fallbackPrinter = createPriorPrinter('fallback');

	const fallbackPlugin: Plugin = {
		printers: { mdast: fallbackPrinter },
	};

	const initializePrinter = vi.fn(async (): Promise<Printer> => {
		await Promise.resolve();
		return currentPrinter;
	});

	const lazyPrinter = Object.assign(initializePrinter, {
		print: currentPrinter.print,
	});

	const parser = markdownParsers.markdown;
	const parserPlugin: Plugin = {
		parsers: { markdown: parser },
		printers: { mdast: lazyPrinter },
	};

	const plugins: ParserOptions['plugins'] = [
		fallbackPlugin,
		parserPlugin,
		pluginMarkdownHTML,
	];

	const resolvePriorPrinter = createPriorPrinterResolver(
		currentPrinter,
		async () => {
			await Promise.resolve();
			return {
				locationState: {},
				parser,
				plugin: parserPlugin,
				plugins,
				selectedParser: parser,
			};
		}
	);

	const resolvedPrinter = await resolvePriorPrinter({
		plugins,
	} as ParserOptions);

	expect(resolvedPrinter?.printer).toBe(fallbackPrinter);
	expect(resolvedPrinter?.plugins).toStrictEqual([fallbackPlugin]);
	expect(initializePrinter).toHaveBeenCalledTimes(1);
});

test('sets and restores prior hook location functions', async () => {
	const currentParser = getDirectParser(pluginMarkdownHTML, 'markdown');

	const locEnd: Parser['locEnd'] = (node) =>
		markdownParsers.markdown.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		markdownParsers.markdown.locStart(node);

	const priorParser: Parser = {
		...markdownParsers.markdown,
		locEnd,
		locStart,
	};

	const priorPlugin: Plugin = {
		parsers: { markdown: priorParser },
	};

	const plugins: ParserOptions['plugins'] = [priorPlugin];

	const options = {
		astFormat: currentParser.astFormat,
		locEnd: currentParser.locEnd,
		locStart: currentParser.locStart,
		plugins: [pluginMarkdownHTML],
	} as unknown as ParserOptions;

	const originalPlugins = options.plugins;

	await withPriorParserOptions(
		options,
		{
			locationState: {},
			parser: priorParser,
			plugin: priorPlugin,
			plugins,
			selectedParser: priorParser,
		},
		async (delegatedOptions) => {
			await Promise.resolve();
			expect(delegatedOptions.locEnd).toBe(locEnd);
			expect(delegatedOptions.locStart).toBe(locStart);
		}
	);

	expect(options.locEnd).toBe(currentParser.locEnd);
	expect(options.locStart).toBe(currentParser.locStart);
	expect(options.plugins).toBe(originalPlugins);

	await withPriorPrinterOptions(
		options,
		{
			locEnd,
			locStart,
			plugins,
			printer: markdownPrinters.mdast,
		},
		async (delegatedOptions) => {
			await Promise.resolve();
			expect(delegatedOptions.locEnd).toBe(locEnd);
			expect(delegatedOptions.locStart).toBe(locStart);
		}
	);

	expect(options.locEnd).toBe(currentParser.locEnd);
	expect(options.locStart).toBe(currentParser.locStart);
	expect(options.plugins).toBe(originalPlugins);
});

test('preserves plugin lists reassigned by prior hooks', async () => {
	const currentParser = getDirectParser(pluginMarkdownHTML, 'markdown');
	const delegatedPlugins: ParserOptions['plugins'] = [];
	const reassignedParserPlugins: ParserOptions['plugins'] = [];
	const reassignedPrinterPlugins: ParserOptions['plugins'] = [];

	const parserOptions = {
		astFormat: currentParser.astFormat,
		locEnd: currentParser.locEnd,
		locStart: currentParser.locStart,
		plugins: [pluginMarkdownHTML],
	} as unknown as ParserOptions;

	await withPriorParserOptions(
		parserOptions,
		{
			locationState: {},
			parser: markdownParsers.markdown,
			plugin: pluginMarkdownHTML,
			plugins: delegatedPlugins,
			selectedParser: markdownParsers.markdown,
		},
		async (delegatedOptions) => {
			await Promise.resolve();
			delegatedOptions.plugins = reassignedParserPlugins;
		}
	);

	expect(parserOptions.plugins).toBe(reassignedParserPlugins);

	const printerOptions = {
		locEnd: currentParser.locEnd,
		locStart: currentParser.locStart,
		plugins: [pluginMarkdownHTML],
	} as unknown as ParserOptions;

	await withPriorPrinterOptions(
		printerOptions,
		{
			locEnd: markdownParsers.markdown.locEnd,
			locStart: markdownParsers.markdown.locStart,
			plugins: delegatedPlugins,
			printer: markdownPrinters.mdast,
		},
		async (delegatedOptions) => {
			await Promise.resolve();
			delegatedOptions.plugins = reassignedPrinterPlugins;
		}
	);

	expect(printerOptions.plugins).toBe(reassignedPrinterPlugins);
});

test('preserves parser lifecycle state after plugin list reassignment', async () => {
	let initializationCount = 0;
	let observedLifecycleState = false;

	const locEnd: Parser['locEnd'] = (node) =>
		markdownParsers.markdown.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		markdownParsers.markdown.locStart(node);

	const lazyPlugin = {
		parsers: {
			markdown: async () => {
				initializationCount += 1;
				let preprocessed = false;
				await Promise.resolve();

				return {
					...markdownParsers.markdown,
					parse: (text: string, options: ParserOptions) => {
						observedLifecycleState =
							preprocessed &&
							options.locEnd === locEnd &&
							options.locStart === locStart;
						return markdownParsers.markdown.parse(text, options);
					},
					preprocess: (text: string, options: ParserOptions) => {
						preprocessed = true;
						options.locEnd = locEnd;
						options.locStart = locStart;
						options.plugins = [...options.plugins];
						return text;
					},
				};
			},
		},
	} as unknown as Plugin;

	await format('value\n', {
		parser: 'markdown',
		plugins: [lazyPlugin, pluginMarkdownHTML],
	});

	expect(initializationCount).toBe(1);
	expect(observedLifecycleState).toBe(true);
});

test.each(MARKDOWN_PARSER_NAMES)(
	'shares updated location functions between prior `%s` hooks',
	async (parserName) => {
		let hasMatchingParserLocations = false;
		let hasMatchingPrinterLocations = false;

		const nativeParser = markdownParsers[parserName];

		const locEnd: Parser['locEnd'] = (node) => nativeParser.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			nativeParser.locStart(node);

		const priorPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...nativeParser,
					parse: (text, options) => {
						hasMatchingParserLocations =
							options.locEnd === locEnd &&
							options.locStart === locStart;
						return nativeParser.parse(text, options);
					},
					preprocess: async (text, options) => {
						await Promise.resolve();
						options.locEnd = locEnd;
						options.locStart = locStart;
						return text;
					},
				},
			},
			printers: {
				mdast: createPriorPrinter('locations', (options) => {
					hasMatchingPrinterLocations =
						options.locEnd === locEnd &&
						options.locStart === locStart;
				}),
			},
		};

		const output = await format('<span id = "foo">value</span>\n', {
			parser: parserName,
			plugins: [priorPlugin, pluginMarkdownHTML],
		});

		expect(output).toBe('<span id="locations">value</span>\n');
		expect(hasMatchingParserLocations).toBe(true);
		expect(hasMatchingPrinterLocations).toBe(true);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'prefers the prior `%s` parser plugin printer over a later printer-only plugin',
	async (parserName) => {
		const parserPlugin = createPriorPlugin(parserName);

		const laterPrinterPlugin: Plugin = {
			printers: {
				mdast: createPriorPrinter('later'),
			},
		};

		const output = await format('ignored\n', {
			parser: parserName,
			plugins: [parserPlugin, laterPrinterPlugin, pluginMarkdownHTML],
		});

		expect(output).toBe('Parser <span id="bar">value</span>\n');
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'doesn’t initialize a shadowed lazy `%s` printer',
	async (parserName) => {
		const initializePrinter = vi.fn(async (): Promise<Printer> => {
			await Promise.resolve();
			throw new Error();
		});

		const lazyPrinter = Object.assign(initializePrinter, {
			print: markdownPrinters.mdast.print,
		});

		const parserPlugin = createPriorPlugin(parserName);

		const shadowedPrinterPlugin: Plugin = {
			printers: {
				mdast: lazyPrinter,
			},
		};

		await expect(
			format('ignored\n', {
				parser: parserName,
				plugins: [
					parserPlugin,
					shadowedPrinterPlugin,
					pluginMarkdownHTML,
				],
			})
		).resolves.toBe('Parser <span id="bar">value</span>\n');
		expect(initializePrinter).not.toHaveBeenCalled();
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'avoids recursion through `%s` wrappers that inherit from the current parser',
	async (parserName) => {
		const parser = getDirectParser(pluginMarkdownHTML, parserName);
		let parseCallCount = 0;

		const wrapperParser = {
			parse: (text: string, options: ParserOptions) => {
				parseCallCount += 1;

				if (parseCallCount > 1) {
					throw new Error();
				}

				return parser.parse(text, options);
			},
		} as unknown as Parser;

		Object.setPrototypeOf(wrapperParser, parser);

		const wrapperPlugin: Plugin = {
			parsers: { [parserName]: wrapperParser },
		};

		const expectedOutput = await format('value\n', {
			parser: parserName,
			plugins: [wrapperPlugin],
		});

		const output = await format('value\n', {
			parser: parserName,
			plugins: [wrapperPlugin, pluginMarkdownHTML],
		});

		expect(output).toBe(expectedOutput);
		expect(parseCallCount).toBe(1);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'composes a copied `%s` parser wrapper’s distinct printer',
	async (parserName) => {
		let hasMatchingLocations = false;
		let includesCurrentPlugin: boolean | undefined;

		const priorPlugin = createPriorPlugin(parserName);
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);

		const locEnd: Parser['locEnd'] = (node) => currentParser.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			currentParser.locStart(node);

		const copiedParserPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...currentParser,
					locEnd,
					locStart,
				},
			},
			printers: {
				mdast: createPriorPrinter('copied', (options) => {
					hasMatchingLocations =
						options.locEnd === locEnd &&
						options.locStart === locStart;
					includesCurrentPlugin =
						options.plugins.includes(pluginMarkdownHTML);
				}),
			},
		};

		const output = await format('ignored\n', {
			parser: parserName,
			plugins: [priorPlugin, copiedParserPlugin, pluginMarkdownHTML],
		});

		expect(output).toBe('Parser <span id="copied">value</span>\n');
		expect(hasMatchingLocations).toBe(true);
		expect(includesCurrentPlugin).toBe(false);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'composes and caches a lazy prior `%s` printer initializer',
	async (parserName) => {
		const initializePrinter = vi.fn(async (): Promise<Printer> => {
			await Promise.resolve();
			return createPriorPrinter('lazy');
		});

		const lazyPrinter = Object.assign(initializePrinter, {
			print: markdownPrinters.mdast.print,
		});

		const priorPlugin: Plugin = {
			parsers: {
				[parserName]: createPriorParser(parserName),
			},
			printers: {
				mdast: lazyPrinter,
			},
		};

		const output = await format('ignored\n', {
			parser: parserName,
			plugins: [priorPlugin, pluginMarkdownHTML],
		});

		expect(output).toBe('Parser <span id="lazy">value</span>\n');
		expect(initializePrinter).toHaveBeenCalledTimes(1);
	}
);

test('works with independently loaded plugin copies', async () => {
	vi.resetModules();

	const firstPlugin = await import('../index.ts');

	vi.resetModules();

	const secondPlugin = await import('../index.ts');

	expect(getDirectParser(firstPlugin, 'markdown').parse).not.toBe(
		getDirectParser(secondPlugin, 'markdown').parse
	);
	expect(getMdastPrinter(firstPlugin).preprocess).not.toBe(
		getMdastPrinter(secondPlugin).preprocess
	);

	const input = '<div id = "foo">value</div>\n';

	const singleCopyOutput = await format(input, {
		parser: 'markdown',
		plugins: [secondPlugin],
	});

	const duplicateCopyOutput = await format(input, {
		parser: 'markdown',
		plugins: [firstPlugin, secondPlugin],
	});

	expect(duplicateCopyOutput).toBe(singleCopyOutput);
});

async function formatWithIncompatiblePriorParser(
	parserName: (typeof MARKDOWN_PARSER_NAMES)[number]
): Promise<string> {
	const priorPlugin: Plugin = {
		parsers: {
			[parserName]: {
				...markdownParsers[parserName],
				astFormat: 'incompatible-mdast',
			},
		},
	};

	return format('value\n', {
		parser: parserName,
		plugins: [priorPlugin, pluginMarkdownHTML],
	});
}

async function formatWithIncompatibleWrapper(
	parserName: (typeof MARKDOWN_PARSER_NAMES)[number]
): Promise<string> {
	const currentParser = getDirectParser(pluginMarkdownHTML, parserName);

	const wrapperPlugin: Plugin = {
		parsers: {
			[parserName]: {
				...currentParser,
				astFormat: 'incompatible-mdast',
				preprocess: undefined,
			},
		},
	};

	return format('value\n', {
		parser: parserName,
		plugins: [wrapperPlugin, pluginMarkdownHTML],
	});
}

test('rejects incompatible `markdown` wrappers before skipping shared hooks', async () => {
	await expect(
		formatWithIncompatibleWrapper('markdown')
	).rejects.toThrowErrorMatchingInlineSnapshot(
		`[TypeError: [prettier-plugin-markdown-html] Unsupported AST format for the \`markdown\` parser. Expected \`mdast\`, received \`incompatible-mdast\`]`
	);
});

test('rejects incompatible `remark` wrappers before skipping shared hooks', async () => {
	await expect(
		formatWithIncompatibleWrapper('remark')
	).rejects.toThrowErrorMatchingInlineSnapshot(
		`[TypeError: [prettier-plugin-markdown-html] Unsupported AST format for the \`remark\` parser. Expected \`mdast\`, received \`incompatible-mdast\`]`
	);
});

test('rejects prior `markdown` parsers with incompatible AST formats', async () => {
	await expect(
		formatWithIncompatiblePriorParser('markdown')
	).rejects.toThrowErrorMatchingInlineSnapshot(
		`[TypeError: [prettier-plugin-markdown-html] Unsupported AST format for the \`markdown\` parser. Expected \`mdast\`, received \`incompatible-mdast\`]`
	);
});

test('rejects prior `remark` parsers with incompatible AST formats', async () => {
	await expect(
		formatWithIncompatiblePriorParser('remark')
	).rejects.toThrowErrorMatchingInlineSnapshot(
		`[TypeError: [prettier-plugin-markdown-html] Unsupported AST format for the \`remark\` parser. Expected \`mdast\`, received \`incompatible-mdast\`]`
	);
});
