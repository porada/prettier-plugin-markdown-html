import type {
	Parser,
	ParserOptions,
	Plugin,
	Options as PrettierOptions,
	Printer,
} from 'prettier';

export type ParserHookName = 'parse' | 'preprocess';

export type ParserInitializer = () => Parser | Promise<Parser>;

export type ParserName = 'markdown' | 'remark';

export type ParseWithCompatibility = (
	this: Parser,
	text: string,
	options: ParserOptions,
	optionsForCompatibility: ParserOptions
) => unknown;

export type PluginWithParsers = Omit<Plugin, 'parsers'> & {
	parsers: Record<string, Parser | ParserInitializer | undefined>;
};

export type PluginWithPrinters = Omit<Plugin, 'printers'> & {
	printers: Record<string, Printer | PrinterInitializer | undefined>;
};

export type PrinterInitializer = () => Printer | Promise<Printer>;

export type PriorParserResolver = (
	options: ParserOptions
) => Promise<ResolvedPriorParser | undefined>;

export type ResolvedPriorParser = {
	locationState: Partial<Pick<ParserOptions, 'locEnd' | 'locStart'>>;
	parser: Parser;
	plugin: ParserOptions['plugins'][number];
	plugins: ParserOptions['plugins'];
	selectedParser: Parser;
};

export type ResolvedPriorPrinter = {
	locEnd: Parser['locEnd'];
	locStart: Parser['locStart'];
	plugins: ParserOptions['plugins'];
	printer: Printer;
};

export interface PluginOptions {
	/**
	 * Override the preferred line length for raw HTML fragments in Markdown.
	 * Unlike `printWidth`, this option does not affect code blocks or other
	 * Markdown content. Falls back to `printWidth` when unset.
	 * @default undefined
	 */
	htmlFragmentPrintWidth?: PrettierOptions['printWidth'];
	/**
	 * Enforce one HTML attribute per line for raw HTML fragments in Markdown.
	 * Unlike `singleAttributePerLine`, this option does not affect code blocks.
	 * Falls back to `singleAttributePerLine` when unset.
	 * @default undefined
	 */
	htmlFragmentSingleAttributePerLine?: PrettierOptions['singleAttributePerLine'];
	/**
	 * Control whitespace handling for raw HTML fragments in Markdown. Unlike
	 * `htmlWhitespaceSensitivity`, this option does not affect code blocks.
	 * Falls back to `htmlWhitespaceSensitivity` when unset.
	 * @default undefined
	 */
	htmlFragmentWhitespaceSensitivity?: PrettierOptions['htmlWhitespaceSensitivity'];
}

declare module 'prettier' {
	interface Options extends PluginOptions {}
}

export namespace AST {
	export type HTMLFormatMode = 'block' | 'compact' | 'inline';

	export type Point = {
		column: number;
		line: number;
		offset?: number;
	};

	export type Position = {
		end: Point;
		start: Point;
	};

	export type Node = {
		children?: Node[];
		position?: Position;
		type?: string;
		value?: string;
	};

	export type HTMLNode = Node & {
		type: 'html';
		value: string;
	};

	export type HTMLGroup = {
		children: HTMLNode[];
		value: string;
	};

	export type ParentNode = Node & {
		children: Node[];
	};

	export type RootNode = Node & {
		children: Node[];
		type: 'root';
	};
}
