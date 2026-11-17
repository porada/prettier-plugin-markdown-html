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
	delegation?: {
		hook: ParserHookName;
		parserName: ParserName;
		resolveNext: () => Promise<ResolvedPriorParser | undefined>;
	};
	entryOptions?: Pick<ParserOptions, 'locEnd' | 'locStart' | 'plugins'>;
	lifecycleState: Partial<
		Pick<ParserOptions, 'locEnd' | 'locStart' | 'plugins'>
	>;
	parser: Parser;
	plugin: ParserOptions['plugins'][number];
	plugins: ParserOptions['plugins'];
};

export type ResolvedPriorPrinter = {
	plugins: ParserOptions['plugins'];
	printer: Printer;
};

export interface PluginOptions {
	/**
	 * Keep the closing bracket on the last attribute line in block-level raw
	 * HTML fragments in Markdown. Unlike `bracketSameLine`, this option does
	 * not affect code blocks. Falls back to `bracketSameLine` when unset.
	 * @default undefined
	 */
	htmlFragmentBracketSameLine?: PrettierOptions['bracketSameLine'];
	/**
	 * Control formatting of `<script>` and `<style>` contents in raw HTML
	 * fragments in Markdown. Unlike `embeddedLanguageFormatting`, this option
	 * does not affect code blocks. Falls back to `embeddedLanguageFormatting`
	 * when unset.
	 * @default undefined
	 */
	htmlFragmentEmbeddedLanguageFormatting?: PrettierOptions['embeddedLanguageFormatting'];
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
	export type BlockScope = {
		// Prettier ignore comments that protect nodes, including both ends of
		// each ignored range
		activeIgnoreComments: ReadonlySet<Node>;
		ancestors: string[];
		children: Node[];
		// Whether the container’s end also ends an HTML block left open as its
		// last child
		endsOpenBlocks: boolean;
		formattedNodes: WeakSet<Node>;
		ignoredNodes: ReadonlySet<Node>;
		// Raw elements that inline HTML opened before each HTML block and left
		// open, outermost first
		inlineOpeners: ReadonlyMap<HTMLNode, InlineOpener[]>;
		isListItem: boolean;
		// Whether Prettier’s Markdown printer puts each child on the line after
		// the previous one, as it does in list items without blank lines
		// between or after their children
		isPrintedTight: boolean;
		// Whether the reference renderer reads the container as an item of a
		// tight list, rendering its paragraphs without `<p>` tags
		isTight: boolean;
		prefixWidth: number;
		protectedEnds: ReadonlySet<HTMLNode>;
		protectedStarts: ReadonlySet<HTMLNode>;
	};

	export type DocumentAnalysis = {
		// Raw elements that inline HTML opened before each HTML block in its
		// container and left open, outermost first
		inlineOpenersByFragment: Map<HTMLNode, InlineOpener[]>;
		// Markdown containers that render inside opaque HTML tokens
		opaqueContainers: Set<Node>;
		protectedEnds: Set<HTMLNode>;
		protectedMarkdown: ProtectedMarkdown[];
		protectedStarts: Set<HTMLNode>;
		rawAncestorsByContainer: Map<Node, string[]>;
	};

	export type InlineOpener = {
		// Whether an inline HTML fragment contains the element’s closing tag.
		// The block scope’s skeleton omits inline fragments
		isClosedInline: boolean;
		// The element’s name as written in the source
		name: string;
		// Where the element’s opening tag starts in the document context
		start: number;
	};

	export type DocumentContext = {
		containers: Map<Node, GeneratedElement>;
		// The block quotes and list items around each generated element and
		// reading, outermost first
		enclosingContainers: Map<Node, ReadonlyArray<Node>>;
		end: Point | undefined;
		fragments: Fragment[];
		generatedElements: GeneratedElement[];
		html: string;
		// Constructs that only Prettier’s Markdown parser recognizes, which
		// render as the reference renderer reads their source
		readings: Node[];
		source: string | undefined;
	};

	export type Fragment = {
		end: number;
		isBlock: boolean;
		isInTableCell: boolean;
		isSingleLine: boolean;
		node: HTMLNode;
		parent: Node;
		start: number;
	};

	export type GeneratedElement = {
		closeEnd: number;
		closeStart: number;
		node: Node;
		openEnd: number;
		openStart: number;
		tagName: string;
	};

	export type ProtectedMarkdown = {
		// The block quotes and list items around the construct, outermost first
		containers: ReadonlyArray<Node>;
		// The kind of HTML token or element containing the Markdown
		description: string;
		// Whether the construct encloses the protected content rather than
		// rendering inside it
		isEnclosing: boolean;
		node: Node;
		// Where to report a change: the construct itself, or the opening tag or
		// delimiter of the protected content it encloses
		position: Point | undefined;
	};

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
		position?: Position | undefined;
		type?: string;
		value?: string;
	};

	export type HTMLNode = Node & {
		type: 'html';
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
