import type { Parser, ParserOptions, Printer } from 'prettier';
import type {
	ParserHookName,
	ParserInitializer,
	ParserName,
	ParseWithCompatibility,
	PluginWithParsers,
	PluginWithPrinters,
	PrinterInitializer,
	PriorParserResolver,
	ResolvedPriorParser,
	ResolvedPriorPrinter,
} from '../types/index.d.ts';
import { printers as markdownPrinters } from 'prettier/plugins/markdown';

type ParserDelegationContext = {
	delegation?: ResolvedPriorParser['delegation'];
	snapshot: Pick<ParserOptions, 'locEnd' | 'locStart' | 'plugins'>;
	syncOptions: () => void;
};

type ParserOptionsWithDelegation = ParserOptions & {
	[PARSER_DELEGATION]?: ParserDelegationContext;
};

type ParserResolverState = {
	entryOptions: NonNullable<ResolvedPriorParser['entryOptions']>;
	lifecycleState: ResolvedPriorParser['lifecycleState'];
	name: string;
	parserByPluginIndex: Map<number, Promise<Parser>>;
	plugins: ParserOptions['plugins'];
	priorParserByHook: Map<
		ParserHookName,
		Promise<ResolvedPriorParser | undefined>
	>;
};

type PrinterResolverState = {
	plugins: ParserOptions['plugins'];
	printerByPluginIndex: Map<number, Promise<Printer>>;
	priorPrinter?: Promise<ResolvedPriorPrinter | undefined>;
};

const NO_PRINTER_PREPROCESS = Symbol('no-printer-preprocess');
const PARSER_DELEGATION = Symbol.for(
	'prettier-plugin-markdown-html.parser-delegation'
);
const PARSER_HOOKS = Symbol.for('prettier-plugin-markdown-html.parser-hooks');
const PARSER_MARKER = Symbol.for('prettier-plugin-markdown-html.parser');
const PRINTER_MARKER = Symbol.for('prettier-plugin-markdown-html.printer');

/**
 * Marks a parser so resolver chains can recognize this plugin’s wrappers.
 */
export function markParserAsMarkdownHTML(parser: Parser): Parser {
	Object.defineProperty(parser, PARSER_MARKER, { value: true });
	// Copies retain hook identities without marking their overrides as canonical
	Object.defineProperty(parser, PARSER_HOOKS, {
		enumerable: true,
		value: { parse: parser.parse, preprocess: parser.preprocess },
	});
	return parser;
}

/**
 * Checks whether a parser carries this plugin’s marker directly
 * or through inheritance.
 */
function isMarkdownHTMLParser(parser: Parser): boolean {
	return Reflect.get(parser, PARSER_MARKER) === true;
}

/**
 * Marks a printer so resolver chains can recognize this plugin’s wrappers.
 */
export function markPrinterAsMarkdownHTML(printer: Printer): Printer {
	Object.defineProperty(printer, PRINTER_MARKER, { value: true });
	return printer;
}

/**
 * Checks whether a printer directly carries this plugin’s marker.
 */
function isMarkdownHTMLPrinter(printer: Printer): boolean {
	return (
		Object.getOwnPropertyDescriptor(printer, PRINTER_MARKER)?.value === true
	);
}

/**
 * Invokes a parser with options available through both Prettier’s current
 * two-argument and legacy three-argument parse signatures.
 */
export function callParserWithCompatibility(
	parser: Parser,
	text: string,
	options: ParserOptions
): unknown {
	const parse = parser.parse as ParseWithCompatibility;
	return parse.call(parser, text, options, options);
}

/**
 * Creates a resolver that finds and caches the prior compatible parser.
 */
export function createPriorParserResolver(
	name: ParserName,
	expectedAstFormat: string,
	currentParser: Parser
): (
	options: ParserOptions,
	hook: ParserHookName
) => Promise<ResolvedPriorParser | undefined> {
	const resolverStateByOptions = new WeakMap<
		ParserOptions,
		ParserResolverState
	>();

	return async (options, hook) => {
		const context = (options as ParserOptionsWithDelegation)[
			PARSER_DELEGATION
		];
		const delegation = context?.delegation;

		if (delegation?.parserName === name && delegation.hook === hook) {
			return delegation.resolveNext();
		}

		let state = resolverStateByOptions.get(options);

		if (!state) {
			state = {
				entryOptions: {
					locEnd: currentParser.locEnd,
					locStart: currentParser.locStart,
					plugins: options.plugins,
				},
				lifecycleState: {},
				name:
					typeof options.parser === 'string' ? options.parser : name,
				parserByPluginIndex: new Map(),
				plugins: options.plugins,
				priorParserByHook: new Map(),
			};
			resolverStateByOptions.set(options, state);
		}

		if (!context) {
			if (options.locEnd !== state.entryOptions.locEnd) {
				state.lifecycleState.locEnd = options.locEnd;
			}

			if (options.locStart !== state.entryOptions.locStart) {
				state.lifecycleState.locStart = options.locStart;
			}

			if (options.plugins !== state.entryOptions.plugins) {
				state.lifecycleState.plugins = options.plugins;
			}

			Object.assign(state.entryOptions, {
				locEnd: options.locEnd,
				locStart: options.locStart,
				plugins: options.plugins,
			});
		}

		const cachedParser = state.priorParserByHook.get(hook);

		if (cachedParser) {
			return cachedParser;
		}

		const parser = findPriorParser(
			state,
			name,
			hook,
			currentParser,
			expectedAstFormat
		);

		state.priorParserByHook.set(hook, parser);

		return parser;
	};
}

/**
 * Finds the nearest prior compatible parser with a distinct implementation
 * of the requested hook.
 */
async function findPriorParser(
	state: ParserResolverState,
	name: ParserName,
	hook: ParserHookName,
	currentParser: Parser,
	expectedAstFormat: string,
	startIndex = state.plugins.length - 1,
	omittedPluginIndexes = new Set<number>()
): Promise<ResolvedPriorParser | undefined> {
	let isFirstParser = startIndex === state.plugins.length - 1;
	let parserPlugin: ParserOptions['plugins'][number] | undefined;

	for (let index = startIndex; index >= 0; index -= 1) {
		const plugin = state.plugins[index];

		if (!hasParsers(plugin) || !Object.hasOwn(plugin.parsers, state.name)) {
			continue;
		}

		const parserOrInitializer = plugin.parsers[state.name];

		if (!parserOrInitializer) {
			continue;
		}

		const parser = await resolveParser(state, index, parserOrInitializer);
		const isEntryParser = isFirstParser;
		isFirstParser = false;

		if (isMarkdownHTMLParser(parser)) {
			omittedPluginIndexes.add(index);
			continue;
		}

		assertCompatibleParser(state.name, parser, expectedAstFormat);

		parserPlugin ??= plugin;

		const copiedHooks = Reflect.get(parser, PARSER_HOOKS) as
			Pick<Parser, ParserHookName> | undefined;
		const parserHook = parser[hook];

		// Treat the selected copied wrapper as entered, even for lazy parsers
		// This assumes the plugin list has not changed before first entry
		if (
			parserHook === currentParser[hook] ||
			(copiedHooks && (isEntryParser || parserHook === copiedHooks[hook]))
		) {
			omittedPluginIndexes.add(index);
			continue;
		}

		if (hook === 'preprocess' && typeof parserHook !== 'function') {
			return undefined;
		}

		const omittedPlugins = new Set(
			[...omittedPluginIndexes].map((index) => state.plugins[index])
		);
		let nextParser: Promise<ResolvedPriorParser | undefined> | undefined;

		return {
			delegation: {
				hook,
				parserName: name,
				resolveNext: async () => {
					nextParser ??= findPriorParser(
						state,
						name,
						hook,
						currentParser,
						expectedAstFormat,
						index - 1,
						new Set([...omittedPluginIndexes, index])
					);
					return nextParser;
				},
			},
			entryOptions: state.entryOptions,
			lifecycleState: state.lifecycleState,
			parser,
			plugin: parserPlugin,
			get plugins() {
				const plugins = state.lifecycleState.plugins ?? state.plugins;
				return plugins.some((plugin) => omittedPlugins.has(plugin))
					? plugins.filter((plugin) => !omittedPlugins.has(plugin))
					: plugins;
			},
		};
	}

	return undefined;
}

/**
 * Resolves and caches a parser or initializer by plugin index.
 */
async function resolveParser(
	state: ParserResolverState,
	index: number,
	parserOrInitializer: Parser | ParserInitializer
): Promise<Parser> {
	const cachedParser = state.parserByPluginIndex.get(index);

	if (cachedParser) {
		return cachedParser;
	}

	const parser = initializeParser(parserOrInitializer);

	state.parserByPluginIndex.set(index, parser);

	return parser;
}

/**
 * Returns a direct parser or initializes a lazy parser.
 */
async function initializeParser(
	parserOrInitializer: Parser | ParserInitializer
): Promise<Parser> {
	return typeof parserOrInitializer === 'function'
		? parserOrInitializer()
		: parserOrInitializer;
}

/**
 * Throws when a parser’s AST format is incompatible with this plugin.
 */
function assertCompatibleParser(
	name: string,
	parser: Parser,
	expectedAstFormat: string
): void {
	if (parser.astFormat !== expectedAstFormat) {
		throw new TypeError(
			`[prettier-plugin-markdown-html] Unsupported AST format for the \`${name}\` parser. Expected \`${expectedAstFormat}\`, received \`${parser.astFormat}\``
		);
	}
}

/**
 * Creates a resolver that finds and caches the prior compatible printer.
 */
export function createPriorPrinterResolver(
	currentPrinter: Printer,
	resolvePriorParser: PriorParserResolver
): (options: ParserOptions) => Promise<ResolvedPriorPrinter | undefined> {
	const resolverStateByOptions = new WeakMap<
		ParserOptions,
		WeakMap<ParserOptions['plugins'], PrinterResolverState>
	>();

	return async (options) => {
		let resolverStateByPlugins = resolverStateByOptions.get(options);

		if (!resolverStateByPlugins) {
			resolverStateByPlugins = new WeakMap();
			resolverStateByOptions.set(options, resolverStateByPlugins);
		}

		let state = resolverStateByPlugins.get(options.plugins);

		if (!state) {
			state = {
				plugins: options.plugins,
				printerByPluginIndex: new Map(),
			};

			resolverStateByPlugins.set(options.plugins, state);
		}

		if (state.priorPrinter) {
			return state.priorPrinter;
		}

		const printer = findPriorPrinter(
			state,
			options,
			currentPrinter,
			resolvePriorParser
		);

		state.priorPrinter = printer;
		return printer;
	};
}

/**
 * Finds the prior compatible printer, preferring the selected parser’s plugin.
 */
async function findPriorPrinter(
	state: PrinterResolverState,
	options: ParserOptions,
	currentPrinter: Printer,
	resolvePriorParser: PriorParserResolver
): Promise<ResolvedPriorPrinter | undefined> {
	const priorParser = await resolvePriorParser(options);

	const omittedPluginIndexes = findCurrentPrinterPluginIndexes(
		state,
		currentPrinter
	);

	if (priorParser) {
		const parserPluginIndex = state.plugins.lastIndexOf(priorParser.plugin);

		if (parserPluginIndex !== -1) {
			const printer = await resolvePriorPrinterCandidate(
				state,
				parserPluginIndex,
				currentPrinter,
				omittedPluginIndexes
			);

			if (printer === NO_PRINTER_PREPROCESS) {
				return undefined;
			}

			if (printer) {
				return {
					plugins: omitPluginIndexes(
						state.plugins,
						omittedPluginIndexes
					),
					printer,
				};
			}
		}
	}

	for (let index = state.plugins.length - 1; index >= 0; index -= 1) {
		const printer = await resolvePriorPrinterCandidate(
			state,
			index,
			currentPrinter,
			omittedPluginIndexes
		);

		if (printer === NO_PRINTER_PREPROCESS) {
			return undefined;
		}

		if (printer) {
			return {
				plugins: omitPluginIndexes(state.plugins, omittedPluginIndexes),
				printer,
			};
		}
	}

	return undefined;
}

/**
 * Keeps prior-printer delegation from returning to the current printer chain.
 */
function findCurrentPrinterPluginIndexes(
	state: PrinterResolverState,
	currentPrinter: Printer
): Set<number> {
	const indexes = new Set<number>();

	for (let index = state.plugins.length - 1; index >= 0; index -= 1) {
		const plugin = state.plugins[index];

		if (!hasPrinters(plugin) || !Object.hasOwn(plugin.printers, 'mdast')) {
			continue;
		}

		const printerOrInitializer = plugin.printers.mdast;

		if (!printerOrInitializer) {
			continue;
		}

		if (typeof printerOrInitializer === 'function') {
			continue;
		}

		if (isCurrentPrinter(printerOrInitializer, currentPrinter)) {
			indexes.add(index);
		}
	}

	return indexes;
}

/**
 * Accepts preprocessing extensions with compatible Markdown structural hooks.
 */
async function resolvePriorPrinterCandidate(
	state: PrinterResolverState,
	index: number,
	currentPrinter: Printer,
	omittedPluginIndexes: Set<number>
): Promise<Printer | typeof NO_PRINTER_PREPROCESS | undefined> {
	const plugin = state.plugins[index];

	if (!hasPrinters(plugin) || !Object.hasOwn(plugin.printers, 'mdast')) {
		return undefined;
	}

	const printerOrInitializer = plugin.printers.mdast;

	if (!printerOrInitializer) {
		return undefined;
	}

	const printer = await resolvePrinter(state, index, printerOrInitializer);

	if (isCurrentPrinter(printer, currentPrinter)) {
		omittedPluginIndexes.add(index);
		return undefined;
	}

	return typeof printer.preprocess === 'function' &&
		(printer.print === currentPrinter.print ||
			(isMarkdownHTMLPrinter(currentPrinter) &&
				printer.print === markdownPrinters.mdast.print)) &&
		printer.getVisitorKeys === currentPrinter.getVisitorKeys
		? printer
		: NO_PRINTER_PREPROCESS;
}

/**
 * Checks if a printer belongs to this plugin or uses the same preprocess hook.
 */
function isCurrentPrinter(printer: Printer, currentPrinter: Printer): boolean {
	return (
		isMarkdownHTMLPrinter(printer) ||
		printer.preprocess === currentPrinter.preprocess
	);
}

/**
 * Resolves and caches a printer or initializer by plugin index.
 */
async function resolvePrinter(
	state: PrinterResolverState,
	index: number,
	printerOrInitializer: Printer | PrinterInitializer
): Promise<Printer> {
	const cachedPrinter = state.printerByPluginIndex.get(index);

	if (cachedPrinter) {
		return cachedPrinter;
	}

	const printer = initializePrinter(printerOrInitializer);
	state.printerByPluginIndex.set(index, printer);
	return printer;
}

/**
 * Returns a direct printer or initializes a lazy printer.
 */
async function initializePrinter(
	printerOrInitializer: Printer | PrinterInitializer
): Promise<Printer> {
	return typeof printerOrInitializer === 'function'
		? printerOrInitializer()
		: printerOrInitializer;
}

/**
 * Checks whether a value exposes a parser map.
 */
function hasParsers(plugin: unknown): plugin is PluginWithParsers {
	if (!plugin || typeof plugin !== 'object') {
		return false;
	}

	const { parsers } = plugin as { parsers?: unknown };
	return typeof parsers === 'object' && parsers !== null;
}

/**
 * Checks whether a value exposes a printer map.
 */
function hasPrinters(plugin: unknown): plugin is PluginWithPrinters {
	if (!plugin || typeof plugin !== 'object') {
		return false;
	}

	const { printers } = plugin as { printers?: unknown };
	return typeof printers === 'object' && printers !== null;
}

/**
 * Prevents current wrappers from re-entering delegated hooks.
 */
function omitPluginIndexes(
	plugins: ParserOptions['plugins'],
	indexes: ReadonlySet<number>
): ParserOptions['plugins'] {
	return indexes.size === 0
		? plugins
		: plugins.filter((_, index) => !indexes.has(index));
}

/**
 * Invokes a callback with options configured for the prior parser.
 */
export async function withPriorParserOptions<T>(
	options: ParserOptions,
	priorParser: ResolvedPriorParser,
	callback: (options: ParserOptions) => T
): Promise<Awaited<T>> {
	const delegationOptions = options as ParserOptionsWithDelegation;
	const previousContext = delegationOptions[PARSER_DELEGATION];
	previousContext?.syncOptions();

	const { astFormat, locEnd, locStart, plugins } = options;
	const { lifecycleState } = priorParser;
	const delegatedLocEnd = lifecycleState.locEnd ?? priorParser.parser.locEnd;
	const delegatedLocStart =
		lifecycleState.locStart ?? priorParser.parser.locStart;
	const delegatedPlugins = priorParser.plugins;

	options.astFormat = priorParser.parser.astFormat;
	options.locEnd = delegatedLocEnd;
	options.locStart = delegatedLocStart;
	options.plugins = delegatedPlugins;

	const context: ParserDelegationContext = {
		delegation: priorParser.delegation,
		snapshot: {
			locEnd: delegatedLocEnd,
			locStart: delegatedLocStart,
			plugins: delegatedPlugins,
		},
		syncOptions() {
			if (options.locEnd !== context.snapshot.locEnd) {
				lifecycleState.locEnd = options.locEnd;
			}

			if (options.locStart !== context.snapshot.locStart) {
				lifecycleState.locStart = options.locStart;
			}

			if (options.plugins !== context.snapshot.plugins) {
				lifecycleState.plugins = options.plugins;
			}
		},
	};
	delegationOptions[PARSER_DELEGATION] = context;

	// Keep AST handoff defaults separate from explicit hook overrides
	let parsedLocations: Pick<ParserOptions, 'locEnd' | 'locStart'> | undefined;

	try {
		const result = await callback(options);

		if (priorParser.delegation?.hook === 'parse') {
			parsedLocations = {
				locEnd: options.locEnd,
				locStart: options.locStart,
			};
		}

		return result;
	} finally {
		context.syncOptions();

		options.astFormat = astFormat;
		options.locEnd =
			lifecycleState.locEnd ?? parsedLocations?.locEnd ?? locEnd;
		options.locStart =
			lifecycleState.locStart ?? parsedLocations?.locStart ?? locStart;

		if (options.plugins === delegatedPlugins) {
			options.plugins = plugins;
		}

		if (previousContext) {
			// Automatic handoff becomes the parent’s baseline, not an explicit override
			previousContext.snapshot = {
				locEnd: options.locEnd,
				locStart: options.locStart,
				plugins: options.plugins,
			};
			delegationOptions[PARSER_DELEGATION] = previousContext;
		} else {
			if (priorParser.entryOptions) {
				Object.assign(priorParser.entryOptions, {
					locEnd: options.locEnd,
					locStart: options.locStart,
					plugins: options.plugins,
				});
			}

			Reflect.deleteProperty(delegationOptions, PARSER_DELEGATION);
		}
	}
}

/**
 * Invokes a callback with options configured for the prior printer.
 */
export async function withPriorPrinterOptions<T>(
	options: ParserOptions,
	priorPrinter: ResolvedPriorPrinter,
	callback: (options: ParserOptions) => T
): Promise<Awaited<T>> {
	const { locEnd, locStart, plugins } = options;
	const delegatedPlugins = priorPrinter.plugins;

	options.plugins = delegatedPlugins;

	try {
		return await callback(options);
	} finally {
		options.locEnd = locEnd;
		options.locStart = locStart;

		if (options.plugins === delegatedPlugins) {
			options.plugins = plugins;
		}
	}
}
