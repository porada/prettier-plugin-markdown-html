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

type ParserResolverState = {
	locationState: ResolvedPriorParser['locationState'];
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
const PARSER_MARKER = Symbol.for('prettier-plugin-markdown-html.parser');
const PRINTER_MARKER = Symbol.for('prettier-plugin-markdown-html.printer');

/**
 * Marks a parser so resolver chains can recognize this plugin’s wrappers.
 */
export function markParserAsMarkdownHTML(parser: Parser): Parser {
	Object.defineProperty(parser, PARSER_MARKER, { value: true });
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
		let state = resolverStateByOptions.get(options);

		if (!state) {
			state = {
				locationState: {},
				name:
					typeof options.parser === 'string' ? options.parser : name,
				parserByPluginIndex: new Map(),
				plugins: options.plugins,
				priorParserByHook: new Map(),
			};
			resolverStateByOptions.set(options, state);
		}

		const cachedParser = state.priorParserByHook.get(hook);

		if (cachedParser) {
			return cachedParser;
		}

		const parser = findPriorParser(
			state,
			state.name,
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
	name: string,
	hook: ParserHookName,
	currentParser: Parser,
	expectedAstFormat: string
): Promise<ResolvedPriorParser | undefined> {
	const omittedPluginIndexes = new Set<number>();

	let parserPlugin: ParserOptions['plugins'][number] | undefined;
	let selectedParser: Parser | undefined;

	for (let index = state.plugins.length - 1; index >= 0; index -= 1) {
		const plugin = state.plugins[index];

		if (!hasParsers(plugin) || !Object.hasOwn(plugin.parsers, name)) {
			continue;
		}

		const parserOrInitializer = plugin.parsers[name];

		if (!parserOrInitializer) {
			continue;
		}

		const parser = await resolveParser(state, index, parserOrInitializer);

		if (isMarkdownHTMLParser(parser)) {
			omittedPluginIndexes.add(index);
			continue;
		}

		assertCompatibleParser(name, parser, expectedAstFormat);

		parserPlugin ??= plugin;
		selectedParser ??= parser;

		const parserHook = parser[hook];

		if (parserHook === currentParser[hook]) {
			omittedPluginIndexes.add(index);
			continue;
		}

		if (hook === 'preprocess' && typeof parserHook !== 'function') {
			return undefined;
		}

		return {
			locationState: state.locationState,
			parser,
			plugin: parserPlugin,
			plugins: omitPluginIndexes(state.plugins, omittedPluginIndexes),
			selectedParser,
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

	const locEnd =
		priorParser?.locationState.locEnd ??
		priorParser?.selectedParser.locEnd ??
		options.locEnd;
	const locStart =
		priorParser?.locationState.locStart ??
		priorParser?.selectedParser.locStart ??
		options.locStart;

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
					locEnd,
					locStart,
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
				locEnd,
				locStart,
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
 * Accepts preprocessing extensions that reuse the current structural hooks.
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
		printer.print === currentPrinter.print &&
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
	const { astFormat, locEnd, locStart, plugins } = options;

	const delegatedLocEnd =
		priorParser.locationState.locEnd ?? priorParser.parser.locEnd;
	const delegatedLocStart =
		priorParser.locationState.locStart ?? priorParser.parser.locStart;
	const delegatedPlugins = priorParser.plugins;

	options.astFormat = priorParser.parser.astFormat;
	options.locEnd = delegatedLocEnd;
	options.locStart = delegatedLocStart;
	options.plugins = delegatedPlugins;

	try {
		return await callback(options);
	} finally {
		if (options.locEnd !== delegatedLocEnd) {
			priorParser.locationState.locEnd = options.locEnd;
		}

		if (options.locStart !== delegatedLocStart) {
			priorParser.locationState.locStart = options.locStart;
		}

		options.astFormat = astFormat;
		options.locEnd = priorParser.locationState.locEnd ?? locEnd;
		options.locStart = priorParser.locationState.locStart ?? locStart;

		if (options.plugins === delegatedPlugins) {
			options.plugins = plugins;
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

	options.locEnd = priorPrinter.locEnd;
	options.locStart = priorPrinter.locStart;
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
