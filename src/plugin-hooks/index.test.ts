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

test.each(MARKDOWN_PARSER_NAMES)(
	'runs lazy copied `%s` hooks once in every plugin order',
	async (parserName) => {
		for (const placement of ['after', 'alone', 'before'] as const) {
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
					text.replace('value', 'bar value'),
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

			const input = '<span id = "foo">value</span>\n';
			const expectedOutput = '<span id="foo">bar value</span>\n';

			const plugins = {
				after: [pluginMarkdownHTML, wrapperPlugin],
				alone: [wrapperPlugin],
				before: [wrapperPlugin, pluginMarkdownHTML],
			}[placement];

			const output = await format(input, {
				parser: parserName,
				plugins,
			});

			expect(parse).toHaveBeenCalledTimes(1);
			expect(preprocess).toHaveBeenCalledTimes(1);
			expect(output).toBe(expectedOutput);
		}
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'runs copied `%s` hooks after plugin list replacement with this plugin last',
	async (parserName) => {
		for (const hook of ['parse', 'preprocess'] as const) {
			for (const preserveReceiver of [false, true]) {
				const parser = getDirectParser(pluginMarkdownHTML, parserName);
				const priorHook = vi.fn(
					(text: string, options: ParserOptions) =>
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
							preprocess(
								text,
								options
							): Promise<string> | string {
								options.plugins = [innerPlugin];

								if (hook === 'parse') {
									return text;
								}

								return preserveReceiver
									? parser.preprocess!.call(
											this,
											text,
											options
										)
									: parser.preprocess!(text, options);
							},
						},
					},
					printers: pluginMarkdownHTML.printers,
				};

				const input = '<span id = "foo">value</span>\n';
				const expectedOutput = '<span id="foo">value</span>\n';

				const output = await format(input, {
					parser: parserName,
					plugins: [innerPlugin, outerPlugin, pluginMarkdownHTML],
				});

				expect(priorHook).toHaveBeenCalledTimes(1);
				expect(output).toBe(expectedOutput);
			}
		}
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
				lifecycleState: {},
				parser,
				plugin: externalParserPlugin,
				plugins,
			};
		}
	);

	const resolvedPrinter = await resolvePriorPrinter({
		plugins,
	} as ParserOptions);

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
	} as ParserOptions);

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
		resolvePriorPrinter({ plugins: [plugin] } as ParserOptions)
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
				lifecycleState: {},
				parser,
				plugin: parserPlugin,
				plugins,
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

	await withPriorParserOptions(
		options,
		{
			lifecycleState: {},
			parser: priorParser,
			plugin: priorPlugin,
			plugins,
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

test.each(['rejected', 'resolved'] as const)(
	'preserves location functions around %s printer preprocessing',
	async (outcome) => {
		const currentParser = getDirectParser(pluginMarkdownHTML, 'markdown');

		const options = {
			locEnd: currentParser.locEnd,
			locStart: currentParser.locStart,
			plugins: [pluginMarkdownHTML],
		} as unknown as ParserOptions;

		const originalOptions = { ...options };
		const error = new Error();
		const result = withPriorPrinterOptions(
			options,
			{
				plugins: [],
				printer: markdownPrinters.mdast,
			},
			async (delegatedOptions) => {
				await Promise.resolve();
				expect(delegatedOptions.locEnd).toBe(currentParser.locEnd);
				expect(delegatedOptions.locStart).toBe(currentParser.locStart);

				delegatedOptions.locEnd = (node) => currentParser.locEnd(node);
				delegatedOptions.locStart = (node) =>
					currentParser.locStart(node);

				if (outcome === 'rejected') {
					throw error;
				}
			}
		);

		await expect(
			result.then(
				() => undefined,
				(caughtError: unknown) => caughtError
			)
		).resolves.toBe(outcome === 'rejected' ? error : undefined);

		expect(options).toStrictEqual(originalOptions);
	}
);

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

	await expect(
		withPriorParserOptions(options, resolved, async (delegatedOptions) => {
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
				withPriorParserOptions(
					delegatedOptions,
					next,
					async (nextOptions) => {
						await Promise.resolve();
						await expect(
							resolvePriorParser(nextOptions, 'parse')
						).resolves.toBeUndefined();

						throw error;
					}
				)
			).rejects.toBe(error);

			expect(delegatedOptions).toStrictEqual(originalDelegatedOptions);

			throw error;
		})
	).rejects.toBe(error);

	expect(options).toStrictEqual(originalOptions);
	await expect(resolvePriorParser(options, 'parse')).resolves.toBe(resolved);
});

test.each(MARKDOWN_PARSER_NAMES)(
	'refreshes entry `%s` options after resolved and rejected hooks',
	async (parserName) => {
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);

		const locEnd: Parser['locEnd'] = (node) => currentParser.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			currentParser.locStart(node);

		for (const hook of ['parse', 'preprocess'] as const) {
			for (const rejects of [false, true]) {
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

				await withPriorParserOptions(
					options,
					resolved,
					async (delegatedOptions) =>
						withPriorParserOptions(
							delegatedOptions,
							next,
							async () => {
								await Promise.resolve();
							}
						)
				);

				expect(options.locEnd).toBe(
					hook === 'parse' ? priorParser.locEnd : currentParser.locEnd
				);
				expect(options.locStart).toBe(
					hook === 'parse'
						? priorParser.locStart
						: currentParser.locStart
				);

				await expect(resolvePriorParser(options, hook)).resolves.toBe(
					resolved
				);
				expect(resolved.lifecycleState).toStrictEqual({});

				const error = new Error();
				const reassignedPlugins = [priorPlugin];
				const result = withPriorParserOptions(
					options,
					resolved,
					async (delegatedOptions) => {
						delegatedOptions.locEnd = locEnd;
						delegatedOptions.locStart = locStart;
						delegatedOptions.plugins = reassignedPlugins;

						await Promise.resolve();

						if (rejects) {
							throw error;
						}
					}
				);

				await expect(
					result.catch((caughtError: unknown) => caughtError)
				).resolves.toBe(rejects ? error : undefined);

				expect(options.locEnd).toBe(locEnd);
				expect(options.locStart).toBe(locStart);
				expect(options.plugins).toBe(reassignedPlugins);

				Object.assign(options, originalOptions);

				await expect(resolvePriorParser(options, hook)).resolves.toBe(
					resolved
				);
				await withPriorParserOptions(
					options,
					resolved,
					async (delegatedOptions) => {
						await Promise.resolve();
						expect(delegatedOptions.locEnd).toBe(
							currentParser.locEnd
						);
						expect(delegatedOptions.locStart).toBe(
							currentParser.locStart
						);
						expect(delegatedOptions.plugins).toContain(
							removedPlugin
						);
					}
				);

				expect(options).toStrictEqual(originalOptions);
			}
		}
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
	'composes copied `%s` parser wrappers without repeating hooks',
	async (parserName) => {
		vi.resetModules();

		const independentPlugin = await import('../index.ts');
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);

		for (const mainPlugin of [pluginMarkdownHTML, independentPlugin]) {
			for (const includePrior of [false, true]) {
				for (const includeMain of [false, true]) {
					let parseCallCount = 0;
					let preprocessCallCount = 0;

					const priorPlugin = createPriorPlugin(parserName);
					const priorParser = getDirectParser(
						priorPlugin,
						parserName
					);

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
									return currentParser.preprocess!(
										text,
										options
									);
								},
							},
						},
					};

					const plugins = [
						...(includePrior ? [priorPlugin] : []),
						wrapperPlugin,
						...(includeMain ? [mainPlugin] : []),
					];

					const output = await format('value\n', {
						parser: parserName,
						plugins,
					});

					expect(output).toBe(
						includePrior
							? 'Parser <span id="bar">value</span>\n'
							: 'value\n'
					);
					expect(parseCallCount).toBe(1);
					expect(preprocessCallCount).toBe(1);
					expect(priorParse).toHaveBeenCalledTimes(
						Number(includePrior)
					);
					expect(priorPreprocess).toHaveBeenCalledTimes(
						Number(includePrior)
					);
				}
			}
		}
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'composes successive copied `%s` parser wrappers',
	async (parserName) => {
		vi.resetModules();

		const independentPlugin = await import('../index.ts');

		for (const includeMain of [false, true]) {
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

			expect(output).toBe('Parser <span id="bar">value</span>\n');
			expect(initializeParser).toHaveBeenCalledTimes(1);

			for (const parser of wrapperParsers) {
				expect(parser.parse).toHaveBeenCalledTimes(1);
				expect(parser.preprocess).toHaveBeenCalledTimes(1);
			}
		}
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'skips unchanged copied `%s` hooks from independent plugin copies',
	async (parserName) => {
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
		} as ParserOptions;

		for (const hook of ['parse', 'preprocess'] as const) {
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
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'uses copied `%s` wrapper location fields only when selected by Prettier',
	async (parserName) => {
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

		const input = 'Parser <span id = "foo">value</span>\n';
		const options = {
			cursorOffset: input.indexOf('value') + 2,
			parser: parserName,
		};

		const expectedOutput = await formatWithCursor(input, {
			...options,
			plugins: [pluginMarkdownHTML],
		});

		for (const placement of ['after', 'alone', 'before'] as const) {
			const plugins = {
				after: [priorPlugin, pluginMarkdownHTML, wrapperPlugin],
				alone: [priorPlugin, wrapperPlugin],
				before: [priorPlugin, wrapperPlugin, pluginMarkdownHTML],
			}[placement];

			const isSelectedParser = placement !== 'before';

			locEnd.mockClear();
			locStart.mockClear();
			parse.mockClear();
			priorLocEnd.mockClear();
			priorLocStart.mockClear();

			const output = await formatWithCursor(input, {
				...options,
				plugins,
			});

			expect(output).toStrictEqual(expectedOutput);
			expect(parse).toHaveBeenCalledTimes(1);
			expect(isSelectedParser ? locEnd : priorLocEnd).toHaveBeenCalled();
			expect(
				isSelectedParser ? locStart : priorLocStart
			).toHaveBeenCalled();
			expect(
				isSelectedParser ? priorLocEnd : locEnd
			).not.toHaveBeenCalled();
			expect(
				isSelectedParser ? priorLocStart : locStart
			).not.toHaveBeenCalled();
		}
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'preserves selected copied `%s` parser locations',
	async (parserName) => {
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

		for (const plugins of [
			[priorPlugin, copiedPlugin],
			[priorPlugin, pluginMarkdownHTML, copiedPlugin],
		]) {
			observeOptions.mockClear();

			const output = await format('value\n', {
				parser: parserName,
				plugins,
			});

			expect(output).toBe('Parser <span id="bar">value</span>\n');
			expect(observeOptions).toHaveBeenCalledTimes(2);
			expect(parserOptions?.locEnd).toBe(locEnd);
			expect(parserOptions?.locStart).toBe(locStart);
		}
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'preserves locations assigned by copied `%s` preprocessing',
	async (parserName) => {
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

		for (const plugins of [
			[priorPlugin, copiedPlugin],
			[priorPlugin, pluginMarkdownHTML, copiedPlugin],
			[priorPlugin, copiedPlugin, pluginMarkdownHTML],
		]) {
			observeOptions.mockClear();

			const output = await format(
				'Parser <span id = "foo">value</span>\n',
				{
					parser: parserName,
					plugins,
				}
			);

			expect(output).toBe('Parser <span id="bar">value</span>\n');
			expect(observeOptions).toHaveBeenCalledTimes(2);
			expect(parserOptions?.locEnd).toBe(locEnd);
			expect(parserOptions?.locStart).toBe(locStart);
		}
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'preserves independent `%s` option overrides across copied hook positions',
	async (parserName) => {
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);

		const locEnd: Parser['locEnd'] = (node) => currentParser.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			currentParser.locStart(node);

		for (const hook of ['parse', 'preprocess'] as const) {
			for (const override of ['locations', 'plugins']) {
				for (const position of ['after', 'before', 'only']) {
					const priorParser: Parser = {
						...createPriorParser(parserName),
						locEnd: (node) => currentParser.locEnd(node),
						locStart: (node) => currentParser.locStart(node),
					};
					const currentHook = currentParser[hook];
					const priorHook = priorParser[hook];

					const removedPlugin: Plugin = {};
					let parserOptions: ParserOptions | undefined;
					let reassignedPlugins: ParserOptions['plugins'] | undefined;
					let callCount = 0;

					if (!currentHook || !priorHook) {
						throw new Error();
					}

					const observeOptions = vi.fn((options: ParserOptions) => {
						parserOptions = options;

						expect(options.locEnd).toBe(
							override === 'locations'
								? locEnd
								: priorParser.locEnd
						);
						expect(options.locStart).toBe(
							override === 'locations'
								? locStart
								: priorParser.locStart
						);

						const originalPlugins = expect.arrayContaining([
							removedPlugin,
							priorPlugin,
						]);

						expect(options.plugins).toStrictEqual(
							override === 'plugins'
								? reassignedPlugins?.filter(
										(plugin) =>
											plugin !== pluginMarkdownHTML
									)
								: originalPlugins
						);
					});

					const priorPlugin: Plugin = {
						parsers: {
							[parserName]: {
								...priorParser,
								async [hook](
									text: string,
									options: ParserOptions
								) {
									await Promise.resolve();
									observeOptions(options);

									return priorHook.call(
										priorParser,
										text,
										options
									);
								},
							},
						},
						printers: {
							mdast: createPriorPrinter('bar', (options) => {
								expect(options.locEnd).toBe(
									override === 'locations'
										? locEnd
										: priorParser.locEnd
								);
								expect(options.locStart).toBe(
									override === 'locations'
										? locStart
										: priorParser.locStart
								);
								expect(
									options.plugins.includes(removedPlugin)
								).toBe(override === 'locations');
							}),
						},
					};
					const wrapperPlugin: Plugin = {
						...pluginMarkdownHTML,
						parsers: {
							[parserName]: {
								...currentParser,
								async [hook](
									text: string,
									options: ParserOptions
								) {
									callCount += 1;

									if (callCount > 3) {
										throw new Error();
									}

									if (override === 'locations') {
										options.locEnd = locEnd;
										options.locStart = locStart;
									} else {
										reassignedPlugins =
											options.plugins.filter(
												(plugin) =>
													plugin !== removedPlugin &&
													plugin !== wrapperPlugin
											);

										options.plugins = reassignedPlugins;
									}

									await Promise.resolve();

									return currentHook.call(
										currentParser,
										text,
										options
									);
								},
							},
						},
					};

					const plugins = [removedPlugin, priorPlugin];

					if (position === 'after') {
						plugins.push(pluginMarkdownHTML, wrapperPlugin);
					} else if (position === 'before') {
						plugins.push(wrapperPlugin, pluginMarkdownHTML);
					} else {
						plugins.push(wrapperPlugin);
					}

					const output = await format('value\n', {
						parser: parserName,
						plugins,
					});

					expect(output).toBe('Parser <span id="bar">value</span>\n');
					expect(callCount).toBe(1);
					expect(observeOptions).toHaveBeenCalledTimes(1);
					expect(parserOptions?.locEnd).toBe(
						override === 'locations' ? locEnd : priorParser.locEnd
					);
					expect(parserOptions?.locStart).toBe(
						override === 'locations'
							? locStart
							: priorParser.locStart
					);

					expect(parserOptions?.plugins === reassignedPlugins).toBe(
						override === 'plugins'
					);
					expect(parserOptions?.plugins).toStrictEqual(
						expect.arrayContaining(
							override === 'plugins' ? [priorPlugin] : plugins
						)
					);
				}
			}
		}
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'preserves options assigned before copied `%s` hooks delegate',
	async (parserName) => {
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);

		const locEnd: Parser['locEnd'] = (node) => currentParser.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			currentParser.locStart(node);

		for (const hook of ['parse', 'preprocess'] as const) {
			const priorPlugin = createPriorPlugin(parserName);
			const priorParser = getDirectParser(priorPlugin, parserName);
			const currentHook = currentParser[hook];
			const priorHook = priorParser[hook];

			const removedPlugin: Plugin = {};
			let reassignedPlugins: ParserOptions['plugins'] | undefined;
			let callCount = 0;

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
						[hook]: async (
							text: string,
							options: ParserOptions
						) => {
							callCount += 1;

							if (callCount > 3) {
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
							return currentHook.call(
								currentParser,
								text,
								options
							);
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

			expect(output).toBe('Parser <span id="bar">value</span>\n');
			expect(callCount).toBe(1);
			expect(observeOptions).toHaveBeenCalledTimes(1);
		}
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'preserves prior `%s` locations during delegated printer preprocessing',
	async (parserName) => {
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);
		const priorPlugin = createPriorPlugin(parserName);
		const priorParser = getDirectParser(priorPlugin, parserName);

		const locEnd: Parser['locEnd'] = (node) => currentParser.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			currentParser.locStart(node);

		let parseCallCount = 0;

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
				mdast: createPriorPrinter('baz', (options) => {
					expect(options.locEnd).toBe(priorParser.locEnd);
					expect(options.locStart).toBe(priorParser.locStart);
				}),
			},
		};

		const output = await format('ignored\n', {
			parser: parserName,
			plugins: [priorPlugin, wrapperPlugin, pluginMarkdownHTML],
		});

		expect(output).toBe('Parser <span id="baz">value</span>\n');
		expect(parseCallCount).toBe(1);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'restores outer `%s` locations when a wrapper rejects a parsed AST',
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
	'preserves explicit location resets after prior `%s` parsing',
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
				mdast: createPriorPrinter('baz', (options) => {
					expect(options.locEnd).toBe(currentParser.locEnd);
					expect(options.locStart).toBe(currentParser.locStart);
				}),
			},
		};

		const output = await format('ignored\n', {
			parser: parserName,
			plugins: [priorPlugin, wrapperPlugin, pluginMarkdownHTML],
		});

		expect(output).toBe('Parser <span id="baz">value</span>\n');
		expect(parseCallCount).toBe(1);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'preserves reassigned plugin lists between prior `%s` hooks',
	async (parserName) => {
		let initializationCount = 0;
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

		const priorPlugin = {
			parsers: {
				[parserName]: async () => {
					initializationCount += 1;
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
				},
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

		expect(output).toBe('Parser <span id="bar">value</span>\n');
		expect(initializationCount).toBe(1);
		expect(observedLifecycleState).toBe(true);
		expect(parserPlugins).toBe(reassignedPlugins);
		expect(printerPlugins).toBe(reassignedPlugins);
		expect(removedParse).not.toHaveBeenCalled();
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'preserves prior `%s` AST locations through copied wrappers',
	async (parserName) => {
		const currentParser = getDirectParser(pluginMarkdownHTML, parserName);
		const input = 'Parser <span id = "foo">value</span>\n';
		const priorParser = createPriorParser(parserName);
		const positions = new WeakMap<AST.Node, AST.Position>();

		const locEnd: Parser['locEnd'] = (node: AST.Node) =>
			positions.get(node)?.end.offset ?? priorParser.locEnd(node);
		const locStart: Parser['locStart'] = (node: AST.Node) =>
			positions.get(node)?.start.offset ?? priorParser.locStart(node);

		const priorPrinter = createPriorPrinter('bar', (options) => {
			expect(options.locEnd).toBe(locEnd);
			expect(options.locStart).toBe(locStart);
		});

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
					preprocess(ast: AST.RootNode, options) {
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
					},
				},
			},
		};

		const options = {
			cursorOffset: input.indexOf('value') + 2,
			parser: parserName,
		};

		const expectedOutput = await formatWithCursor(input, {
			...options,
			plugins: [priorPlugin],
		});

		expect(expectedOutput.formatted).toBe(
			'Parser <span id="bar">value</span>\n'
		);

		for (const delegates of [false, true]) {
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

			for (const plugins of [
				[priorPlugin, pluginMarkdownHTML],
				[priorPlugin, wrapperPlugin],
				[priorPlugin, pluginMarkdownHTML, wrapperPlugin],
				[priorPlugin, wrapperPlugin, pluginMarkdownHTML],
			]) {
				const output = await format(input, {
					parser: parserName,
					plugins,
				});
				const outputWithCursor = await formatWithCursor(input, {
					...options,
					plugins,
				});

				expect(output).toBe(expectedOutput.formatted);
				expect(outputWithCursor).toStrictEqual(expectedOutput);
				expect(outputWithCursor.cursorOffset).toBe(
					outputWithCursor.formatted.indexOf('value') + 2
				);
			}
		}
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
					hasMatchingLocations =
						options.locEnd === priorParser.locEnd &&
						options.locStart === priorParser.locStart;
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
