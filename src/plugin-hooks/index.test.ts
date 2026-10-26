import type { Parser, ParserOptions, Plugin, Printer } from 'prettier';
import type { AST } from '../types/index.d.ts';
import { format, formatWithCursor } from 'prettier';
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
			return 'Parser <span id = "foo">baz</span>\n';
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

	return format('foo\n', {
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

	return format('foo\n', {
		parser: parserName,
		plugins: [wrapperPlugin, pluginMarkdownHTML],
	});
}

async function createEntryOptionsFixture(
	hook: 'parse' | 'preprocess',
	parserName: (typeof MARKDOWN_PARSER_NAMES)[number]
) {
	const currentParser = getDirectParser(pluginMarkdownHTML, parserName);

	const locEnd: Parser['locEnd'] = (node) => currentParser.locEnd(node);
	const locStart: Parser['locStart'] = (node) => currentParser.locStart(node);

	const priorParser: Parser = {
		...createPriorParser(parserName),
		locEnd: (node) => currentParser.locEnd(node),
		locStart: (node) => currentParser.locStart(node),
	};

	const priorPlugin: Plugin = {
		parsers: {
			[parserName]: priorParser,
		},
	};
	const removedPlugin: Plugin = {};
	const wrapperPlugin: Plugin = {
		parsers: {
			[parserName]: {
				...currentParser,
				parse: vi.fn(currentParser.parse),
				preprocess: vi.fn(currentParser.preprocess),
			},
		},
	};

	const options = {
		astFormat: currentParser.astFormat,
		locEnd: currentParser.locEnd,
		locStart: currentParser.locStart,
		parser: parserName,
		plugins: [
			removedPlugin,
			priorPlugin,
			wrapperPlugin,
			pluginMarkdownHTML,
		],
	} as unknown as ParserOptions;

	const originalOptions = { ...options };
	const resolvePriorParser = createPriorParserResolver(
		parserName,
		currentParser.astFormat,
		currentParser
	);
	const resolved = await resolvePriorParser(options, hook);

	if (!resolved?.delegation) {
		throw new Error();
	}

	const next = await resolved.delegation.resolveNext();

	if (!next) {
		throw new Error();
	}

	await withPriorParserOptions(options, resolved, async (delegatedOptions) =>
		withPriorParserOptions(delegatedOptions, next, async () => {
			await Promise.resolve();
		})
	);

	expect(options.locEnd).toBe(
		hook === 'parse' ? priorParser.locEnd : currentParser.locEnd
	);
	expect(options.locStart).toBe(
		hook === 'parse' ? priorParser.locStart : currentParser.locStart
	);
	await expect(resolvePriorParser(options, hook)).resolves.toBe(resolved);
	expect(resolved.lifecycleState).toStrictEqual({});

	const reassignedPlugins = [priorPlugin];

	return {
		locEnd,
		locStart,
		options,
		reassign: async (delegatedOptions: ParserOptions): Promise<void> => {
			delegatedOptions.locEnd = locEnd;
			delegatedOptions.locStart = locStart;
			delegatedOptions.plugins = reassignedPlugins;

			await Promise.resolve();
		},
		reassignedPlugins,
		resolved,
		verifyRestoration: async (): Promise<void> => {
			Object.assign(options, originalOptions);

			const callback = vi.fn(async (delegatedOptions: ParserOptions) => {
				await Promise.resolve();
				expect(delegatedOptions.locEnd).toBe(currentParser.locEnd);
				expect(delegatedOptions.locStart).toBe(currentParser.locStart);
				expect(delegatedOptions.plugins).toContain(removedPlugin);
			});

			await expect(resolvePriorParser(options, hook)).resolves.toBe(
				resolved
			);
			await withPriorParserOptions(options, resolved, callback);

			expect(callback).toHaveBeenCalledTimes(1);
			expect(options).toStrictEqual(originalOptions);
		},
	};
}

test.each([
	['after this plugin', 'markdown'],
	['after this plugin', 'remark'],
	['alone', 'markdown'],
	['alone', 'remark'],
	['before this plugin', 'markdown'],
	['before this plugin', 'remark'],
] as const)(
	'runs lazy copied hooks once when placed %s with the `%s` parser',
	async (placement, parserName) => {
		const parser = getDirectParser(pluginMarkdownHTML, parserName);
		const parse = vi.fn(function (
			this: Parser,
			text: string,
			options: ParserOptions
		) {
			return parser.parse.call(this, text, options);
		});
		const preprocess = vi.fn(function (
			this: Parser,
			text: string,
			options: ParserOptions
		): Promise<string> | string {
			return parser.preprocess!.call(
				this,
				text.replace('bar', 'baz bar'),
				options
			);
		});

		const wrapperPlugin = {
			parsers: {
				[parserName]: async () => {
					await Promise.resolve();
					return { ...parser, parse, preprocess };
				},
			},
			printers: pluginMarkdownHTML.printers,
		} as unknown as Plugin;

		const input = '<span id = "foo">bar</span>\n';
		const expectedOutput = '<span id="foo">baz bar</span>\n';

		const plugins = {
			'after this plugin': [pluginMarkdownHTML, wrapperPlugin],
			'alone': [wrapperPlugin],
			'before this plugin': [wrapperPlugin, pluginMarkdownHTML],
		}[placement];

		const output = await format(input, {
			parser: parserName,
			plugins,
		});

		expect(parse).toHaveBeenCalledTimes(1);
		expect(preprocess).toHaveBeenCalledTimes(1);
		expect(output).toBe(expectedOutput);
	}
);

test.each([
	['a copied `parse` hook', 'markdown', 'parse', true],
	['a copied `parse` hook', 'remark', 'parse', true],
	[
		'a copied `preprocess` hook through a wrapper that calls this plugin’s parser',
		'markdown',
		'preprocess',
		false,
	],
	[
		'a copied `preprocess` hook through a wrapper that calls this plugin’s parser',
		'remark',
		'preprocess',
		false,
	],
	[
		'a copied `preprocess` hook through a wrapper that forwards its receiver',
		'markdown',
		'preprocess',
		true,
	],
	[
		'a copied `preprocess` hook through a wrapper that forwards its receiver',
		'remark',
		'preprocess',
		true,
	],
] as const)(
	'runs %s after plugin list replacement with the `%s` parser',
	async (_, parserName, hook, preserveReceiver) => {
		const parser = getDirectParser(pluginMarkdownHTML, parserName);
		const priorHook = vi.fn((text: string, options: ParserOptions) =>
			parser[hook]!(text, options)
		);

		const innerPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...parser,
					[hook]: priorHook,
				},
			},
			printers: pluginMarkdownHTML.printers,
		};

		const outerPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...parser,
					preprocess(text, options): Promise<string> | string {
						options.plugins = [innerPlugin];

						if (hook === 'parse') {
							return text;
						}

						return preserveReceiver
							? parser.preprocess!.call(this, text, options)
							: parser.preprocess!(text, options);
					},
				},
			},
			printers: pluginMarkdownHTML.printers,
		};

		const input = '<span id = "foo">bar</span>\n';
		const expectedOutput = '<span id="foo">bar</span>\n';

		const output = await format(input, {
			parser: parserName,
			plugins: [innerPlugin, outerPlugin, pluginMarkdownHTML],
		});

		expect(priorHook).toHaveBeenCalledTimes(1);
		expect(output).toBe(expectedOutput);
	}
);

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

	let result = await resolvePriorParser(options, 'preprocess');

	expect(result?.parser).toBe(priorParser);

	options.parser = 'remark';
	result = await resolvePriorParser(options, 'parse');

	expect(result?.parser).toBe(priorParser);
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
				lifecycleState: {},
				parser,
				plugin: externalParserPlugin,
				plugins,
			};
		}
	);

	const resolvedPrinter = await resolvePriorPrinter({
		plugins,
	} as unknown as ParserOptions);

	expect(resolvedPrinter?.printer).toBe(fallbackPrinter);
	expect(resolvedPrinter?.plugins).toBe(plugins);
});

test('resolves preprocessing extensions that reuse the current print hook', async () => {
	const currentPrinter = getMdastPrinter(pluginMarkdownHTML);
	const priorPrinter: Printer = {
		...createPriorPrinter('foo'),
		print: currentPrinter.print,
	};
	const plugin: Plugin = {
		printers: {
			mdast: priorPrinter,
		},
	};

	const resolvePriorPrinter = createPriorPrinterResolver(
		currentPrinter,
		async () => {
			await Promise.resolve();
			return undefined;
		}
	);
	const result = await resolvePriorPrinter({
		plugins: [plugin],
	} as unknown as ParserOptions);

	expect(result?.printer).toBe(priorPrinter);
});

test('rejects native printing when the current printer has an unrelated print hook', async () => {
	const currentPrinter: Printer = {
		...getMdastPrinter(pluginMarkdownHTML),
		print: () => 'foo',
	};
	const plugin: Plugin = {
		printers: {
			mdast: createPriorPrinter('bar'),
		},
	};

	const resolvePriorPrinter = createPriorPrinterResolver(
		currentPrinter,
		async () => {
			await Promise.resolve();
			return undefined;
		}
	);

	await expect(
		resolvePriorPrinter({ plugins: [plugin] } as unknown as ParserOptions)
	).resolves.toBeUndefined();
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
		lifecycleState: {},
		parser,
		plugin,
		plugins,
	};

	const resolveAssociatedPrinter = createPriorPrinterResolver(
		currentPrinter,
		async () => {
			await Promise.resolve();
			return priorParser;
		}
	);

	const options = { plugins } as unknown as ParserOptions;

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
				lifecycleState: {},
				parser,
				plugin: parserPlugin,
				plugins,
			};
		}
	);

	const resolvedPrinter = await resolvePriorPrinter({
		plugins,
	} as unknown as ParserOptions);

	expect(resolvedPrinter?.printer).toBe(fallbackPrinter);
	expect(resolvedPrinter?.plugins).toStrictEqual([fallbackPlugin]);
	expect(initializePrinter).toHaveBeenCalledTimes(1);
});

test('sets and restores prior parser location functions', async () => {
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

	const callback = vi.fn(async (delegatedOptions: ParserOptions) => {
		await Promise.resolve();
		expect(delegatedOptions.locEnd).toBe(locEnd);
		expect(delegatedOptions.locStart).toBe(locStart);
	});

	await withPriorParserOptions(
		options,
		{
			lifecycleState: {},
			parser: priorParser,
			plugin: priorPlugin,
			plugins,
		},
		callback
	);

	expect(callback).toHaveBeenCalledTimes(1);
	expect(options.locEnd).toBe(currentParser.locEnd);
	expect(options.locStart).toBe(currentParser.locStart);
	expect(options.plugins).toBe(originalPlugins);
});

test('preserves location functions around rejected printer preprocessing', async () => {
	const currentParser = getDirectParser(pluginMarkdownHTML, 'markdown');

	const options = {
		locEnd: currentParser.locEnd,
		locStart: currentParser.locStart,
		plugins: [pluginMarkdownHTML],
	} as unknown as ParserOptions;

	const originalOptions = { ...options };
	const error = new Error();
	const callback = vi.fn(async (delegatedOptions: ParserOptions) => {
		await Promise.resolve();
		expect(delegatedOptions.locEnd).toBe(currentParser.locEnd);
		expect(delegatedOptions.locStart).toBe(currentParser.locStart);

		delegatedOptions.locEnd = (node) => currentParser.locEnd(node);
		delegatedOptions.locStart = (node) => currentParser.locStart(node);

		throw error;
	});

	await expect(
		withPriorPrinterOptions(
			options,
			{
				plugins: [],
				printer: markdownPrinters.mdast,
			},
			callback
		)
	).rejects.toBe(error);

	expect(callback).toHaveBeenCalledTimes(1);
	expect(options).toStrictEqual(originalOptions);
});

test('preserves location functions around resolved printer preprocessing', async () => {
	const currentParser = getDirectParser(pluginMarkdownHTML, 'markdown');

	const options = {
		locEnd: currentParser.locEnd,
		locStart: currentParser.locStart,
		plugins: [pluginMarkdownHTML],
	} as unknown as ParserOptions;

	const originalOptions = { ...options };
	const callback = vi.fn(async (delegatedOptions: ParserOptions) => {
		await Promise.resolve();
		expect(delegatedOptions.locEnd).toBe(currentParser.locEnd);
		expect(delegatedOptions.locStart).toBe(currentParser.locStart);

		delegatedOptions.locEnd = (node) => currentParser.locEnd(node);
		delegatedOptions.locStart = (node) => currentParser.locStart(node);
	});

	await expect(
		withPriorPrinterOptions(
			options,
			{
				plugins: [],
				printer: markdownPrinters.mdast,
			},
			callback
		)
	).resolves.toBeUndefined();

	expect(callback).toHaveBeenCalledTimes(1);
	expect(options).toStrictEqual(originalOptions);
});

test('restores parser delegation after rejected hooks', async () => {
	const currentParser = getDirectParser(pluginMarkdownHTML, 'markdown');
	const priorParser = createPriorParser('markdown');

	const initializeParser = vi.fn(async (): Promise<Parser> => {
		await Promise.resolve();
		return priorParser;
	});

	const priorPlugin = {
		parsers: {
			markdown: initializeParser,
		},
	} as unknown as Plugin;

	const wrapperPlugin: Plugin = {
		parsers: {
			markdown: {
				...currentParser,
				parse: vi.fn(currentParser.parse),
			},
		},
	};

	const options = {
		astFormat: currentParser.astFormat,
		locEnd: currentParser.locEnd,
		locStart: currentParser.locStart,
		parser: 'markdown',
		plugins: [priorPlugin, wrapperPlugin, pluginMarkdownHTML],
	} as unknown as ParserOptions;

	const originalOptions = { ...options };

	const resolvePriorParser = createPriorParserResolver(
		'markdown',
		currentParser.astFormat,
		currentParser
	);

	const resolved = await resolvePriorParser(options, 'parse');

	if (!resolved?.delegation) {
		throw new Error();
	}

	const next = await resolved.delegation.resolveNext();

	await expect(resolved.delegation.resolveNext()).resolves.toBe(next);

	if (!next) {
		throw new Error();
	}

	expect(next.parser).toBe(priorParser);
	expect(initializeParser).toHaveBeenCalledTimes(1);

	const error = new Error();
	const nextCallback = vi.fn(async (nextOptions: ParserOptions) => {
		await Promise.resolve();
		await expect(
			resolvePriorParser(nextOptions, 'parse')
		).resolves.toBeUndefined();

		throw error;
	});
	const callback = vi.fn(async (delegatedOptions: ParserOptions) => {
		await Promise.resolve();
		await expect(
			resolvePriorParser(delegatedOptions, 'parse')
		).resolves.toBe(next);

		const preprocess = await resolvePriorParser(
			delegatedOptions,
			'preprocess'
		);

		expect(preprocess?.delegation?.hook).toBe('preprocess');

		const originalDelegatedOptions = { ...delegatedOptions };

		await expect(
			withPriorParserOptions(delegatedOptions, next, nextCallback)
		).rejects.toBe(error);

		expect(delegatedOptions).toStrictEqual(originalDelegatedOptions);

		throw error;
	});

	await expect(
		withPriorParserOptions(options, resolved, callback)
	).rejects.toBe(error);

	expect(callback).toHaveBeenCalledTimes(1);
	expect(nextCallback).toHaveBeenCalledTimes(1);
	expect(options).toStrictEqual(originalOptions);
	await expect(resolvePriorParser(options, 'parse')).resolves.toBe(resolved);
});

test.each([
	['parse', 'markdown'],
	['parse', 'remark'],
	['preprocess', 'markdown'],
	['preprocess', 'remark'],
] as const)(
	'refreshes entry options after rejected `%s` hooks with the `%s` parser',
	async (hook, parserName) => {
		const {
			locEnd,
			locStart,
			options,
			reassign,
			reassignedPlugins,
			resolved,
			verifyRestoration,
		} = await createEntryOptionsFixture(hook, parserName);
		const error = new Error();

		await expect(
			withPriorParserOptions(
				options,
				resolved,
				async (delegatedOptions) => {
					await reassign(delegatedOptions);

					throw error;
				}
			)
		).rejects.toBe(error);

		expect(options.locEnd).toBe(locEnd);
		expect(options.locStart).toBe(locStart);
		expect(options.plugins).toBe(reassignedPlugins);
		await verifyRestoration();
	}
);

test.each([
	['parse', 'markdown'],
	['parse', 'remark'],
	['preprocess', 'markdown'],
	['preprocess', 'remark'],
] as const)(
	'refreshes entry options after resolved `%s` hooks with the `%s` parser',
	async (hook, parserName) => {
		const {
			locEnd,
			locStart,
			options,
			reassign,
			reassignedPlugins,
			resolved,
			verifyRestoration,
		} = await createEntryOptionsFixture(hook, parserName);

		await expect(
			withPriorParserOptions(options, resolved, reassign)
		).resolves.toBeUndefined();

		expect(options.locEnd).toBe(locEnd);
		expect(options.locStart).toBe(locStart);
		expect(options.plugins).toBe(reassignedPlugins);
		await verifyRestoration();
	}
);

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
			lifecycleState: {},
			parser: markdownParsers.markdown,
			plugin: pluginMarkdownHTML,
			plugins: delegatedPlugins,
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
	let observedLifecycleState = false;
	let parserLocations: Pick<ParserOptions, 'locEnd' | 'locStart'> | undefined;

	const locEnd: Parser['locEnd'] = (node) =>
		markdownParsers.markdown.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		markdownParsers.markdown.locStart(node);

	const initializeParser = vi.fn(async (): Promise<Parser> => {
		let preprocessed = false;
		await Promise.resolve();

		return {
			...markdownParsers.markdown,
			parse: (text: string, options: ParserOptions) => {
				observedLifecycleState = preprocessed;
				parserLocations = {
					locEnd: options.locEnd,
					locStart: options.locStart,
				};
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
	});

	const lazyPlugin = {
		parsers: {
			markdown: initializeParser,
		},
	} as unknown as Plugin;

	await format('foo\n', {
		parser: 'markdown',
		plugins: [lazyPlugin, pluginMarkdownHTML],
	});

	expect(initializeParser).toHaveBeenCalledTimes(1);
	expect(observedLifecycleState).toBe(true);
	expect(parserLocations?.locEnd).toBe(locEnd);
	expect(parserLocations?.locStart).toBe(locStart);
});

test.each(MARKDOWN_PARSER_NAMES)(
	'shares updated location functions between prior hooks with the `%s` parser',
	async (parserName) => {
		let parserLocations:
			Pick<ParserOptions, 'locEnd' | 'locStart'> | undefined;
		let printerLocations:
			Pick<ParserOptions, 'locEnd' | 'locStart'> | undefined;

		const nativeParser = markdownParsers[parserName];

		const locEnd: Parser['locEnd'] = (node) => nativeParser.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			nativeParser.locStart(node);

		const priorPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...nativeParser,
					parse: (text, options) => {
						parserLocations = {
							locEnd: options.locEnd,
							locStart: options.locStart,
						};
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
					printerLocations = {
						locEnd: options.locEnd,
						locStart: options.locStart,
					};
				}),
			},
		};

		const output = await format('<span id = "foo">bar</span>\n', {
			parser: parserName,
			plugins: [priorPlugin, pluginMarkdownHTML],
		});

		expect(output).toBe('<span id="locations">bar</span>\n');
		expect(parserLocations?.locEnd).toBe(locEnd);
		expect(parserLocations?.locStart).toBe(locStart);
		expect(printerLocations?.locEnd).toBe(locEnd);
		expect(printerLocations?.locStart).toBe(locStart);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'prefers the prior parser plugin printer over a later printer-only plugin with the `%s` parser',
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

		expect(output).toBe('Parser <span id="bar">baz</span>\n');
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'doesn’t initialize a shadowed lazy printer with the `%s` parser',
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
		).resolves.toBe('Parser <span id="bar">baz</span>\n');
		expect(initializePrinter).not.toHaveBeenCalled();
	}
);

test.each([
	{ includePrior: false, mainPlugin: 'current', parserName: 'markdown' },
	{ includePrior: false, mainPlugin: 'independent', parserName: 'markdown' },
	{ includePrior: false, mainPlugin: 'none', parserName: 'markdown' },
	{ includePrior: true, mainPlugin: 'current', parserName: 'markdown' },
	{ includePrior: true, mainPlugin: 'independent', parserName: 'markdown' },
	{ includePrior: true, mainPlugin: 'none', parserName: 'markdown' },
	{ includePrior: false, mainPlugin: 'current', parserName: 'remark' },
	{ includePrior: false, mainPlugin: 'independent', parserName: 'remark' },
	{ includePrior: false, mainPlugin: 'none', parserName: 'remark' },
	{ includePrior: true, mainPlugin: 'current', parserName: 'remark' },
	{ includePrior: true, mainPlugin: 'independent', parserName: 'remark' },
	{ includePrior: true, mainPlugin: 'none', parserName: 'remark' },
] as const)(
	'composes copied parser wrappers without repeating hooks with the `$parserName` parser',
	async ({ includePrior, mainPlugin, parserName }) => {
		let plugin = pluginMarkdownHTML;

		if (mainPlugin === 'independent') {
			vi.resetModules();
			plugin = await import('../index.ts');
		}

		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);

		let parseCallCount = 0;
		let preprocessCallCount = 0;

		const priorPlugin = createPriorPlugin(parserName);
		const priorParser = getDirectParser(priorPlugin, parserName);

		const priorParse = vi.spyOn(priorParser, 'parse');
		const priorPreprocess = vi.spyOn(priorParser, 'preprocess');

		const wrapperPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...currentParser,
					async parse(text, options) {
						parseCallCount += 1;

						if (parseCallCount > 3) {
							throw new Error();
						}

						await Promise.resolve();
						return currentParser.parse(text, options);
					},
					async preprocess(text, options) {
						preprocessCallCount += 1;

						if (preprocessCallCount > 3) {
							throw new Error();
						}

						await Promise.resolve();
						return currentParser.preprocess!(text, options);
					},
				},
			},
		};

		const mainPlugins = mainPlugin === 'none' ? [] : [plugin];
		const plugins = [
			...(includePrior ? [priorPlugin] : []),
			wrapperPlugin,
			...mainPlugins,
		];

		const output = await format('foo\n', {
			parser: parserName,
			plugins,
		});

		expect(output).toBe(
			includePrior ? 'Parser <span id="bar">baz</span>\n' : 'foo\n'
		);
		expect(parseCallCount).toBe(1);
		expect(preprocessCallCount).toBe(1);
		expect(priorParse).toHaveBeenCalledTimes(Number(includePrior));
		expect(priorPreprocess).toHaveBeenCalledTimes(Number(includePrior));
	}
);

test.each([
	{ includeMain: false, parserName: 'markdown' },
	{ includeMain: true, parserName: 'markdown' },
	{ includeMain: false, parserName: 'remark' },
	{ includeMain: true, parserName: 'remark' },
] as const)(
	'composes successive copied parser wrappers with the `$parserName` parser',
	async ({ includeMain, parserName }) => {
		vi.resetModules();

		const independentPlugin = await import('../index.ts');

		const initializeParser = vi.fn(async (): Promise<Parser> => {
			await Promise.resolve();
			return createPriorParser(parserName);
		});

		const priorPlugin = {
			parsers: {
				[parserName]: initializeParser,
			},
			printers: {
				mdast: createPriorPrinter('bar'),
			},
		} as unknown as Plugin;

		const wrapperParsers = [pluginMarkdownHTML, independentPlugin].map(
			(plugin) => {
				const currentParser = getDirectParser(plugin, parserName);
				let parseCallCount = 0;
				let preprocessCallCount = 0;

				return {
					...currentParser,
					parse: vi.fn(
						async (text: string, options: ParserOptions) => {
							parseCallCount += 1;

							if (parseCallCount > 3) {
								throw new Error();
							}

							await Promise.resolve();
							return currentParser.parse(text, options);
						}
					),
					preprocess: vi.fn(
						async (text: string, options: ParserOptions) => {
							preprocessCallCount += 1;

							if (preprocessCallCount > 3) {
								throw new Error();
							}

							await Promise.resolve();
							return currentParser.preprocess!(text, options);
						}
					),
				};
			}
		);

		const output = await format('ignored\n', {
			parser: parserName,
			plugins: [
				priorPlugin,
				...wrapperParsers.map((parser) => ({
					parsers: {
						[parserName]: parser,
					},
				})),
				...(includeMain ? [pluginMarkdownHTML] : []),
			],
		});

		expect(output).toBe('Parser <span id="bar">baz</span>\n');
		expect(initializeParser).toHaveBeenCalledTimes(1);

		for (const hook of wrapperParsers.flatMap(({ parse, preprocess }) => [
			parse,
			preprocess,
		])) {
			expect(hook).toHaveBeenCalledTimes(1);
		}
	}
);

test.each([
	['parse', 'markdown'],
	['parse', 'remark'],
	['preprocess', 'markdown'],
	['preprocess', 'remark'],
] as const)(
	'skips unchanged copied `%s` hooks from an independent instance with the `%s` parser',
	async (hook, parserName) => {
		vi.resetModules();

		const independentPlugin = await import('../index.ts');

		const copiedParser = {
			...getDirectParser(independentPlugin, parserName),
		};

		const copiedPlugin: Plugin = {
			parsers: {
				[parserName]: copiedParser,
			},
		};

		const priorParser = createPriorParser(parserName);

		const priorPlugin: Plugin = {
			parsers: {
				[parserName]: priorParser,
			},
		};

		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);
		const resolvePriorParser = createPriorParserResolver(
			parserName,
			currentParser.astFormat,
			currentParser
		);

		const options = {
			parser: parserName,
			plugins: [priorPlugin, copiedPlugin, pluginMarkdownHTML],
		} as unknown as ParserOptions;

		const resolved = await resolvePriorParser(options, hook);

		expect(resolved?.parser).toBe(priorParser);
		expect(resolved?.plugin).toBe(copiedPlugin);

		if (!resolved) {
			throw new Error();
		}

		const reassignedPlugins = [priorPlugin];
		resolved.lifecycleState.plugins = reassignedPlugins;

		expect(resolved.plugins).toBe(reassignedPlugins);

		resolved.lifecycleState.plugins = [
			pluginMarkdownHTML,
			priorPlugin,
			copiedPlugin,
		];

		expect(resolved.plugins).toStrictEqual(reassignedPlugins);
	}
);

test.each([
	['after this plugin', 'markdown'],
	['after this plugin', 'remark'],
	['alone', 'markdown'],
	['alone', 'remark'],
	['before this plugin', 'markdown'],
	['before this plugin', 'remark'],
] as const)(
	'uses location fields from a copied wrapper placed %s only when Prettier selects it with the `%s` parser',
	async (placement, parserName) => {
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);
		const nativeParser = markdownParsers[parserName];

		const locEnd = vi.fn(nativeParser.locEnd);
		const locStart = vi.fn(nativeParser.locStart);
		const parse = vi.fn(currentParser.parse);
		const priorLocEnd = vi.fn(nativeParser.locEnd);
		const priorLocStart = vi.fn(nativeParser.locStart);

		const priorPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...nativeParser,
					locEnd: priorLocEnd,
					locStart: priorLocStart,
				},
			},
		};

		const wrapperPlugin: Plugin = {
			...pluginMarkdownHTML,
			parsers: {
				[parserName]: {
					...currentParser,
					locEnd,
					locStart,
					parse,
				},
			},
		};

		const input = 'Parser <span id = "foo">bar</span>\n';
		const options = {
			cursorOffset: input.indexOf('bar') + 2,
			parser: parserName,
		};

		const expectedResult = await formatWithCursor(input, {
			...options,
			plugins: [pluginMarkdownHTML],
		});

		const plugins = {
			'after this plugin': [
				priorPlugin,
				pluginMarkdownHTML,
				wrapperPlugin,
			],
			'alone': [priorPlugin, wrapperPlugin],
			'before this plugin': [
				priorPlugin,
				wrapperPlugin,
				pluginMarkdownHTML,
			],
		}[placement];

		const isSelectedParser = placement !== 'before this plugin';

		const result = await formatWithCursor(input, {
			...options,
			plugins,
		});

		expect(result).toStrictEqual(expectedResult);
		expect(parse).toHaveBeenCalledTimes(1);
		expect(isSelectedParser ? locEnd : priorLocEnd).toHaveBeenCalled();
		expect(isSelectedParser ? locStart : priorLocStart).toHaveBeenCalled();
		expect(isSelectedParser ? priorLocEnd : locEnd).not.toHaveBeenCalled();
		expect(
			isSelectedParser ? priorLocStart : locStart
		).not.toHaveBeenCalled();
	}
);

test.each([
	['after this plugin', 'markdown'],
	['after this plugin', 'remark'],
	['alone', 'markdown'],
	['alone', 'remark'],
] as const)(
	'preserves wrapper location overrides from parser fields when placed %s with the `%s` parser',
	async (placement, parserName) => {
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);
		const priorParser = createPriorParser(parserName);

		const locEnd: Parser['locEnd'] = (node) => currentParser.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			currentParser.locStart(node);

		let parserOptions: ParserOptions | undefined;

		const observeOptions = vi.fn((options: ParserOptions) => {
			expect(options.locEnd).toBe(locEnd);
			expect(options.locStart).toBe(locStart);
		});

		const priorPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...priorParser,
					parse(text, options) {
						parserOptions = options;
						observeOptions(options);

						return priorParser.parse(text, options);
					},
				},
			},
			printers: {
				mdast: createPriorPrinter('bar', observeOptions),
			},
		};
		const copiedPlugin: Plugin = {
			...pluginMarkdownHTML,
			parsers: {
				[parserName]: {
					...currentParser,
					locEnd,
					locStart,
				},
			},
		};

		const plugins = {
			'after this plugin': [
				priorPlugin,
				pluginMarkdownHTML,
				copiedPlugin,
			],
			'alone': [priorPlugin, copiedPlugin],
		}[placement];

		const output = await format('foo\n', {
			parser: parserName,
			plugins,
		});

		expect(output).toBe('Parser <span id="bar">baz</span>\n');
		expect(observeOptions).toHaveBeenCalledTimes(2);
		expect(parserOptions?.locEnd).toBe(locEnd);
		expect(parserOptions?.locStart).toBe(locStart);
	}
);

test.each([
	['after this plugin', 'markdown'],
	['after this plugin', 'remark'],
	['alone', 'markdown'],
	['alone', 'remark'],
	['before this plugin', 'markdown'],
	['before this plugin', 'remark'],
] as const)(
	'preserves wrapper location overrides from the `preprocess` hook when placed %s with the `%s` parser',
	async (placement, parserName) => {
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);
		const priorParser = createPriorParser(parserName);

		const locEnd: Parser['locEnd'] = (node) => currentParser.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			currentParser.locStart(node);

		let parserOptions: ParserOptions | undefined;

		const observeOptions = vi.fn((options: ParserOptions) => {
			expect(options.locEnd).toBe(locEnd);
			expect(options.locStart).toBe(locStart);
		});

		const priorPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...priorParser,
					parse(text, options) {
						parserOptions = options;
						observeOptions(options);

						return priorParser.parse(text, options);
					},
				},
			},
			printers: {
				mdast: createPriorPrinter('bar', observeOptions),
			},
		};
		const copiedPlugin: Plugin = {
			...pluginMarkdownHTML,
			parsers: {
				[parserName]: {
					...currentParser,
					preprocess(text, options) {
						options.locEnd = locEnd;
						options.locStart = locStart;

						return text;
					},
				},
			},
		};

		const plugins = {
			'after this plugin': [
				priorPlugin,
				pluginMarkdownHTML,
				copiedPlugin,
			],
			'alone': [priorPlugin, copiedPlugin],
			'before this plugin': [
				priorPlugin,
				copiedPlugin,
				pluginMarkdownHTML,
			],
		}[placement];

		const output = await format('Parser <span id = "foo">baz</span>\n', {
			parser: parserName,
			plugins,
		});

		expect(output).toBe('Parser <span id="bar">baz</span>\n');
		expect(observeOptions).toHaveBeenCalledTimes(2);
		expect(parserOptions?.locEnd).toBe(locEnd);
		expect(parserOptions?.locStart).toBe(locStart);
	}
);

test.each([
	['parse', 'after this plugin', 'markdown'],
	['parse', 'after this plugin', 'remark'],
	['parse', 'alone', 'markdown'],
	['parse', 'alone', 'remark'],
	['parse', 'before this plugin', 'markdown'],
	['parse', 'before this plugin', 'remark'],
	['preprocess', 'after this plugin', 'markdown'],
	['preprocess', 'after this plugin', 'remark'],
	['preprocess', 'alone', 'markdown'],
	['preprocess', 'alone', 'remark'],
	['preprocess', 'before this plugin', 'markdown'],
	['preprocess', 'before this plugin', 'remark'],
] as const)(
	'passes location overrides from `%s` wrappers to the prior parser when placed %s with the `%s` parser',
	async (hook, placement, parserName) => {
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);
		const priorParser = createPriorParser(parserName);
		const currentHook = currentParser[hook];
		const priorHook = priorParser[hook];

		const locEnd: Parser['locEnd'] = (node) => currentParser.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			currentParser.locStart(node);

		let observedLocEnd: Parser['locEnd'] | undefined;
		let observedLocStart: Parser['locStart'] | undefined;
		let observedOptions: ParserOptions | undefined;
		let observedPrinterLocEnd: Parser['locEnd'] | undefined;
		let observedPrinterLocStart: Parser['locStart'] | undefined;
		let hookCallCount = 0;

		if (!currentHook || !priorHook) {
			throw new Error();
		}

		const priorPluginHook = vi.fn(
			async (text: string, options: ParserOptions) => {
				await Promise.resolve();
				observedLocEnd = options.locEnd;
				observedLocStart = options.locStart;
				observedOptions = options;

				return priorHook.call(priorParser, text, options);
			}
		);

		const priorPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...priorParser,
					[hook]: priorPluginHook,
				},
			},
			printers: {
				mdast: createPriorPrinter('bar', (options) => {
					observedPrinterLocEnd = options.locEnd;
					observedPrinterLocStart = options.locStart;
				}),
			},
		};

		const wrapperPlugin: Plugin = {
			...pluginMarkdownHTML,
			parsers: {
				[parserName]: {
					...currentParser,
					async [hook](text: string, options: ParserOptions) {
						hookCallCount += 1;

						if (hookCallCount > 3) {
							throw new Error();
						}

						await Promise.resolve();
						options.locEnd = locEnd;
						options.locStart = locStart;

						return currentHook.call(currentParser, text, options);
					},
				},
			},
		};

		const plugins = {
			'after this plugin': [
				priorPlugin,
				pluginMarkdownHTML,
				wrapperPlugin,
			],
			'alone': [priorPlugin, wrapperPlugin],
			'before this plugin': [
				priorPlugin,
				wrapperPlugin,
				pluginMarkdownHTML,
			],
		}[placement];

		const output = await format('foo\n', {
			parser: parserName,
			plugins,
		});

		expect(observedLocEnd).toBe(locEnd);
		expect(observedLocStart).toBe(locStart);
		expect(priorPluginHook).toHaveBeenCalledTimes(1);
		expect(hookCallCount).toBe(1);
		expect(output).toBe('Parser <span id="bar">baz</span>\n');
		expect(observedOptions?.locEnd).toBe(locEnd);
		expect(observedOptions?.locStart).toBe(locStart);
		expect(observedPrinterLocEnd).toBe(locEnd);
		expect(observedPrinterLocStart).toBe(locStart);
	}
);

test.each([
	['parse', 'after this plugin', 'markdown'],
	['parse', 'after this plugin', 'remark'],
	['parse', 'alone', 'markdown'],
	['parse', 'alone', 'remark'],
	['parse', 'before this plugin', 'markdown'],
	['parse', 'before this plugin', 'remark'],
	['preprocess', 'after this plugin', 'markdown'],
	['preprocess', 'after this plugin', 'remark'],
	['preprocess', 'alone', 'markdown'],
	['preprocess', 'alone', 'remark'],
	['preprocess', 'before this plugin', 'markdown'],
	['preprocess', 'before this plugin', 'remark'],
] as const)(
	'passes plugin list overrides from `%s` wrappers to the prior parser when placed %s with the `%s` parser',
	async (hook, placement, parserName) => {
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);
		const priorParser = createPriorParser(parserName);
		const currentHook = currentParser[hook];
		const priorHook = priorParser[hook];

		let observedOptions: ParserOptions | undefined;
		let observedPlugins: ParserOptions['plugins'] | undefined;
		let observedPrinterPlugins: ParserOptions['plugins'] | undefined;
		let hookCallCount = 0;

		if (!currentHook || !priorHook) {
			throw new Error();
		}

		const priorPluginHook = vi.fn(
			async (text: string, options: ParserOptions) => {
				await Promise.resolve();
				observedOptions = options;
				observedPlugins = options.plugins;

				return priorHook.call(priorParser, text, options);
			}
		);

		const priorPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...priorParser,
					[hook]: priorPluginHook,
				},
			},
			printers: {
				mdast: createPriorPrinter('bar', (options) => {
					observedPrinterPlugins = options.plugins;
				}),
			},
		};

		const reassignedPlugins: ParserOptions['plugins'] = [priorPlugin];

		const wrapperPlugin: Plugin = {
			...pluginMarkdownHTML,
			parsers: {
				[parserName]: {
					...currentParser,
					async [hook](text: string, options: ParserOptions) {
						hookCallCount += 1;

						if (hookCallCount > 3) {
							throw new Error();
						}

						await Promise.resolve();
						options.plugins = reassignedPlugins;

						return currentHook.call(currentParser, text, options);
					},
				},
			},
		};

		const plugins = {
			'after this plugin': [
				priorPlugin,
				pluginMarkdownHTML,
				wrapperPlugin,
			],
			'alone': [priorPlugin, wrapperPlugin],
			'before this plugin': [
				priorPlugin,
				wrapperPlugin,
				pluginMarkdownHTML,
			],
		}[placement];

		const output = await format('foo\n', {
			parser: parserName,
			plugins,
		});

		expect(observedPlugins).toBe(reassignedPlugins);
		expect(priorPluginHook).toHaveBeenCalledTimes(1);
		expect(hookCallCount).toBe(1);
		expect(output).toBe('Parser <span id="bar">baz</span>\n');
		expect(observedOptions?.plugins).toBe(reassignedPlugins);
		expect(observedPrinterPlugins).toBe(reassignedPlugins);
	}
);

test.each([
	['parse', 'markdown'],
	['parse', 'remark'],
	['preprocess', 'markdown'],
	['preprocess', 'remark'],
] as const)(
	'preserves options assigned before copied `%s` hooks delegate with the `%s` parser',
	async (hook, parserName) => {
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);

		const locEnd: Parser['locEnd'] = (node) => currentParser.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			currentParser.locStart(node);

		const priorPlugin = createPriorPlugin(parserName);
		const priorParser = getDirectParser(priorPlugin, parserName);
		const currentHook = currentParser[hook];
		const priorHook = priorParser[hook];

		const removedPlugin: Plugin = {};
		let reassignedPlugins: ParserOptions['plugins'] | undefined;
		let hookCallCount = 0;

		if (!currentHook || !priorHook) {
			throw new Error();
		}

		const observeOptions = vi.fn((options: ParserOptions) => {
			expect(options.locEnd).toBe(locEnd);
			expect(options.locStart).toBe(locStart);
			expect(options.plugins).toBe(reassignedPlugins);
			expect(options.plugins).not.toContain(removedPlugin);
		});

		priorParser[hook] = async (text, options) => {
			await Promise.resolve();
			observeOptions(options);
			return priorHook.call(priorParser, text, options);
		};

		const wrapperPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...currentParser,
					[hook]: async (text: string, options: ParserOptions) => {
						hookCallCount += 1;

						if (hookCallCount > 3) {
							throw new Error();
						}

						options.locEnd = locEnd;
						options.locStart = locStart;
						reassignedPlugins = options.plugins.filter(
							(plugin) =>
								plugin !== removedPlugin &&
								plugin !== wrapperPlugin
						);

						options.plugins = reassignedPlugins;
						await Promise.resolve();
						return currentHook.call(currentParser, text, options);
					},
				},
			},
		};

		const output = await format('ignored\n', {
			parser: parserName,
			plugins: [
				removedPlugin,
				priorPlugin,
				wrapperPlugin,
				pluginMarkdownHTML,
			],
		});

		expect(output).toBe('Parser <span id="bar">baz</span>\n');
		expect(hookCallCount).toBe(1);
		expect(observeOptions).toHaveBeenCalledTimes(1);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'preserves prior locations during delegated printer preprocessing with the `%s` parser',
	async (parserName) => {
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);
		const priorPlugin = createPriorPlugin(parserName);
		const priorParser = getDirectParser(priorPlugin, parserName);

		const locEnd: Parser['locEnd'] = (node) => currentParser.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			currentParser.locStart(node);

		let parseCallCount = 0;

		const observePrinterOptions = vi.fn((options: ParserOptions) => {
			expect(options.locEnd).toBe(priorParser.locEnd);
			expect(options.locStart).toBe(priorParser.locStart);
		});

		const wrapperPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...currentParser,
					locEnd,
					locStart,
					async parse(text, options) {
						parseCallCount += 1;

						if (parseCallCount > 3) {
							throw new Error();
						}

						await Promise.resolve();
						return currentParser.parse(text, options);
					},
				},
			},
			printers: {
				mdast: createPriorPrinter('qux', observePrinterOptions),
			},
		};

		const output = await format('ignored\n', {
			parser: parserName,
			plugins: [priorPlugin, wrapperPlugin, pluginMarkdownHTML],
		});

		expect(output).toBe('Parser <span id="qux">baz</span>\n');
		expect(parseCallCount).toBe(1);
		expect(observePrinterOptions).toHaveBeenCalledTimes(1);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'restores parser locations when a wrapper rejects after delegated parsing with the `%s` parser',
	async (parserName) => {
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);
		const priorPlugin = createPriorPlugin(parserName);
		const priorParser = getDirectParser(priorPlugin, parserName);

		priorParser.locEnd = (node) => currentParser.locEnd(node);
		priorParser.locStart = (node) => currentParser.locStart(node);

		let parserOptions: ParserOptions | undefined;
		let parseCallCount = 0;
		const error = new Error();

		const wrapperPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...currentParser,
					async parse(text, options) {
						parseCallCount += 1;

						if (parseCallCount > 3) {
							throw new Error();
						}

						parserOptions = options;

						await currentParser.parse(text, options);

						throw error;
					},
				},
			},
		};

		await expect(
			format('ignored\n', {
				parser: parserName,
				plugins: [priorPlugin, wrapperPlugin, pluginMarkdownHTML],
			})
		).rejects.toBe(error);

		expect(parseCallCount).toBe(1);
		expect(parserOptions?.locEnd).toBe(currentParser.locEnd);
		expect(parserOptions?.locStart).toBe(currentParser.locStart);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'preserves explicit location resets after prior parsing with the `%s` parser',
	async (parserName) => {
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);
		const priorParser = createPriorParser(parserName);

		const locEnd: Parser['locEnd'] = (node) => currentParser.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			currentParser.locStart(node);

		const priorPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...priorParser,
					parse(text, options) {
						options.locEnd = locEnd;
						options.locStart = locStart;
						return priorParser.parse(text, options);
					},
				},
			},
		};

		let parseCallCount = 0;

		const observePrinterOptions = vi.fn((options: ParserOptions) => {
			expect(options.locEnd).toBe(currentParser.locEnd);
			expect(options.locStart).toBe(currentParser.locStart);
		});

		const wrapperPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...currentParser,
					async parse(text, options) {
						parseCallCount += 1;

						if (parseCallCount > 3) {
							throw new Error();
						}

						const originalLocEnd = options.locEnd;
						const originalLocStart = options.locStart;

						const ast = await currentParser.parse(text, options);

						options.locEnd = originalLocEnd;
						options.locStart = originalLocStart;
						return ast;
					},
				},
			},
			printers: {
				mdast: createPriorPrinter('qux', observePrinterOptions),
			},
		};

		const output = await format('ignored\n', {
			parser: parserName,
			plugins: [priorPlugin, wrapperPlugin, pluginMarkdownHTML],
		});

		expect(output).toBe('Parser <span id="qux">baz</span>\n');
		expect(parseCallCount).toBe(1);
		expect(observePrinterOptions).toHaveBeenCalledTimes(1);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'preserves reassigned plugin lists between prior hooks with the `%s` parser',
	async (parserName) => {
		let observedLifecycleState = false;
		let reassignedPlugins: ParserOptions['plugins'] | undefined;
		let parserPlugins: ParserOptions['plugins'] | undefined;
		let printerPlugins: ParserOptions['plugins'] | undefined;

		const priorParser = createPriorParser(parserName);
		const removedParse = vi.fn(priorParser.parse);

		const removedPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...priorParser,
					parse: removedParse,
				},
			},
		};

		const initializeParser = vi.fn(async (): Promise<Parser> => {
			let preprocessed = false;
			await Promise.resolve();

			return {
				...priorParser,
				parse(text: string, options: ParserOptions) {
					observedLifecycleState = preprocessed;
					parserPlugins = options.plugins;
					return options.plugins.includes(removedPlugin)
						? removedParse(text, options)
						: priorParser.parse(text, options);
				},
				async preprocess(text: string, options: ParserOptions) {
					preprocessed = true;
					reassignedPlugins = options.plugins.filter(
						(plugin) => plugin !== removedPlugin
					);

					options.plugins = reassignedPlugins;
					return priorParser.preprocess!(text, options);
				},
			};
		});

		const priorPlugin = {
			parsers: {
				[parserName]: initializeParser,
			},
			printers: {
				mdast: createPriorPrinter('bar', (options) => {
					printerPlugins = options.plugins;
				}),
			},
		} as unknown as Plugin;

		const output = await format('ignored\n', {
			parser: parserName,
			plugins: [removedPlugin, priorPlugin, pluginMarkdownHTML],
		});

		expect(output).toBe('Parser <span id="bar">baz</span>\n');
		expect(initializeParser).toHaveBeenCalledTimes(1);
		expect(observedLifecycleState).toBe(true);
		expect(parserPlugins).toBe(reassignedPlugins);
		expect(printerPlugins).toBe(reassignedPlugins);
		expect(removedParse).not.toHaveBeenCalled();
	}
);

test.each([
	{
		delegates: false,
		parserName: 'markdown',
		placement: 'after this plugin',
		scenario: 'through an unchanged wrapper placed after this plugin',
	},
	{
		delegates: false,
		parserName: 'markdown',
		placement: 'alone',
		scenario: 'through an unchanged wrapper placed alone',
	},
	{
		delegates: false,
		parserName: 'markdown',
		placement: 'before this plugin',
		scenario: 'through an unchanged wrapper placed before this plugin',
	},
	{
		delegates: false,
		parserName: 'markdown',
		placement: 'none',
		scenario: 'without a wrapper',
	},
	{
		delegates: false,
		parserName: 'remark',
		placement: 'after this plugin',
		scenario: 'through an unchanged wrapper placed after this plugin',
	},
	{
		delegates: false,
		parserName: 'remark',
		placement: 'alone',
		scenario: 'through an unchanged wrapper placed alone',
	},
	{
		delegates: false,
		parserName: 'remark',
		placement: 'before this plugin',
		scenario: 'through an unchanged wrapper placed before this plugin',
	},
	{
		delegates: false,
		parserName: 'remark',
		placement: 'none',
		scenario: 'without a wrapper',
	},
	{
		delegates: true,
		parserName: 'markdown',
		placement: 'after this plugin',
		scenario: 'through a delegating wrapper placed after this plugin',
	},
	{
		delegates: true,
		parserName: 'markdown',
		placement: 'alone',
		scenario: 'through a delegating wrapper placed alone',
	},
	{
		delegates: true,
		parserName: 'markdown',
		placement: 'before this plugin',
		scenario: 'through a delegating wrapper placed before this plugin',
	},
	{
		delegates: true,
		parserName: 'remark',
		placement: 'after this plugin',
		scenario: 'through a delegating wrapper placed after this plugin',
	},
	{
		delegates: true,
		parserName: 'remark',
		placement: 'alone',
		scenario: 'through a delegating wrapper placed alone',
	},
	{
		delegates: true,
		parserName: 'remark',
		placement: 'before this plugin',
		scenario: 'through a delegating wrapper placed before this plugin',
	},
] as const)(
	'preserves prior AST locations $scenario with the `$parserName` parser',
	async ({ delegates, parserName, placement }) => {
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);
		const input = 'Parser <span id = "foo">baz</span>\n';
		const priorParser = createPriorParser(parserName);
		const positions = new WeakMap<AST.Node, AST.Position>();

		const locEnd: Parser['locEnd'] = (node: AST.Node) =>
			positions.get(node)?.end.offset ?? priorParser.locEnd(node);
		const locStart: Parser['locStart'] = (node: AST.Node) =>
			positions.get(node)?.start.offset ?? priorParser.locStart(node);

		const observePrinterOptions = vi.fn((options: ParserOptions) => {
			expect(options.locEnd).toBe(locEnd);
			expect(options.locStart).toBe(locStart);
		});
		const priorPrinter = createPriorPrinter('bar', observePrinterOptions);
		const preprocess = vi.fn(
			(ast: AST.RootNode, options: ParserOptions) => {
				expect(options.locEnd(ast)).toBe(
					positions.get(ast)?.end.offset
				);
				expect(options.locStart(ast)).toBe(
					positions.get(ast)?.start.offset
				);

				for (const node of [ast, ...ast.children]) {
					const position = positions.get(node);

					if (position) {
						node.position = position;
					}
				}

				return priorPrinter.preprocess!(ast, options);
			}
		);

		const priorPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...priorParser,
					locEnd,
					locStart,
					async parse(text, options) {
						const ast = (await priorParser.parse(
							text,
							options
						)) as AST.RootNode;

						for (const node of [ast, ...ast.children]) {
							if (node.position) {
								positions.set(node, node.position);
								delete node.position;
							}
						}

						return ast;
					},
				},
			},
			printers: {
				mdast: {
					...priorPrinter,
					preprocess,
				},
			},
		};

		const options = {
			cursorOffset: input.indexOf('baz') + 2,
			parser: parserName,
		};

		const expectedResult = await formatWithCursor(input, {
			...options,
			plugins: [priorPlugin],
		});

		observePrinterOptions.mockClear();
		preprocess.mockClear();

		expect(expectedResult.formatted).toBe(
			'Parser <span id="bar">baz</span>\n'
		);

		const copiedParser: Parser = { ...currentParser };

		if (delegates) {
			copiedParser.parse = (text, options) =>
				currentParser.parse(text, options);
		}

		const wrapperPlugin: Plugin = {
			...pluginMarkdownHTML,
			parsers: {
				[parserName]: copiedParser,
			},
		};

		const plugins = {
			'after this plugin': [
				priorPlugin,
				pluginMarkdownHTML,
				wrapperPlugin,
			],
			'alone': [priorPlugin, wrapperPlugin],
			'before this plugin': [
				priorPlugin,
				wrapperPlugin,
				pluginMarkdownHTML,
			],
			'none': [priorPlugin, pluginMarkdownHTML],
		}[placement];

		const output = await format(input, {
			parser: parserName,
			plugins,
		});
		const result = await formatWithCursor(input, {
			...options,
			plugins,
		});

		expect(output).toBe(expectedResult.formatted);
		expect(result).toStrictEqual(expectedResult);
		expect(result.cursorOffset).toBe(result.formatted.indexOf('baz') + 2);
		expect(preprocess).toHaveBeenCalledTimes(2);
		expect(observePrinterOptions).toHaveBeenCalledTimes(2);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'avoids recursion through wrappers that inherit from the current parser with the `%s` parser',
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

		const expectedOutput = await format('foo\n', {
			parser: parserName,
			plugins: [wrapperPlugin],
		});

		const output = await format('foo\n', {
			parser: parserName,
			plugins: [wrapperPlugin, pluginMarkdownHTML],
		});

		expect(output).toBe(expectedOutput);
		expect(parseCallCount).toBe(1);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'composes a copied parser wrapper’s distinct printer with the `%s` parser',
	async (parserName) => {
		let includesCurrentPlugin: boolean | undefined;
		let printerLocations:
			Pick<ParserOptions, 'locEnd' | 'locStart'> | undefined;

		const priorPlugin = createPriorPlugin(parserName);
		const priorParser = getDirectParser(priorPlugin, parserName);
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
					printerLocations = {
						locEnd: options.locEnd,
						locStart: options.locStart,
					};
					includesCurrentPlugin =
						options.plugins.includes(pluginMarkdownHTML);
				}),
			},
		};

		const output = await format('ignored\n', {
			parser: parserName,
			plugins: [priorPlugin, copiedParserPlugin, pluginMarkdownHTML],
		});

		expect(output).toBe('Parser <span id="copied">baz</span>\n');
		expect(printerLocations?.locEnd).toBe(priorParser.locEnd);
		expect(printerLocations?.locStart).toBe(priorParser.locStart);
		expect(includesCurrentPlugin).toBe(false);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'composes and caches a lazy prior printer initializer with the `%s` parser',
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

		expect(output).toBe('Parser <span id="lazy">baz</span>\n');
		expect(initializePrinter).toHaveBeenCalledTimes(1);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'works with independently loaded plugin copies with the `%s` parser',
	async (parserName) => {
		vi.resetModules();

		const firstPlugin = await import('../index.ts');

		vi.resetModules();

		const secondPlugin = await import('../index.ts');

		expect(getDirectParser(firstPlugin, parserName).parse).not.toBe(
			getDirectParser(secondPlugin, parserName).parse
		);
		expect(getMdastPrinter(firstPlugin).preprocess).not.toBe(
			getMdastPrinter(secondPlugin).preprocess
		);

		const input = '<div id = "foo">bar</div>\n';

		const expectedOutput = await format(input, {
			parser: parserName,
			plugins: [secondPlugin],
		});

		const output = await format(input, {
			parser: parserName,
			plugins: [firstPlugin, secondPlugin],
		});

		expect(output).toBe(expectedOutput);
	}
);

test('rejects incompatible wrappers before skipping shared hooks with the `markdown` parser', async () => {
	await expect(
		formatWithIncompatibleWrapper('markdown')
	).rejects.toThrowErrorMatchingInlineSnapshot(
		`[TypeError: [prettier-plugin-markdown-html] Unsupported AST format for the \`markdown\` parser. Expected \`mdast\`, received \`incompatible-mdast\`]`
	);
});

test('rejects incompatible wrappers before skipping shared hooks with the `remark` parser', async () => {
	await expect(
		formatWithIncompatibleWrapper('remark')
	).rejects.toThrowErrorMatchingInlineSnapshot(
		`[TypeError: [prettier-plugin-markdown-html] Unsupported AST format for the \`remark\` parser. Expected \`mdast\`, received \`incompatible-mdast\`]`
	);
});

test('rejects prior parsers with incompatible AST formats with the `markdown` parser', async () => {
	await expect(
		formatWithIncompatiblePriorParser('markdown')
	).rejects.toThrowErrorMatchingInlineSnapshot(
		`[TypeError: [prettier-plugin-markdown-html] Unsupported AST format for the \`markdown\` parser. Expected \`mdast\`, received \`incompatible-mdast\`]`
	);
});

test('rejects prior parsers with incompatible AST formats with the `remark` parser', async () => {
	await expect(
		formatWithIncompatiblePriorParser('remark')
	).rejects.toThrowErrorMatchingInlineSnapshot(
		`[TypeError: [prettier-plugin-markdown-html] Unsupported AST format for the \`remark\` parser. Expected \`mdast\`, received \`incompatible-mdast\`]`
	);
});
