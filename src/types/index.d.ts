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
	 * Keep the closing bracket on the last attribute line in raw HTML fragments
	 * in Markdown. Unlike `bracketSameLine`, this option does not affect code
	 * blocks. Falls back to `bracketSameLine` when unset.
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
		// This set contains HTML nodes recorded as block fragments in the
		// document context
		blockFragments: ReadonlySet<Node>;
		children: Node[];
		// Whether the container’s end also ends an HTML block left open as its
		// last child
		endsOpenBlocks: boolean;
		formattedNodes: WeakSet<Node>;
		ignoredNodes: ReadonlySet<Node>;
		// Closing tags in inline HTML before each HTML block that close
		// elements open in the skeleton, in document order
		inlineClosingTags: ReadonlyMap<HTMLNode, string[]>;
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
		// Closing tags in inline HTML after the last HTML block that close
		// elements open in the skeleton, in document order
		trailingInlineClosingTags: ReadonlyArray<string>;
	};

	export type ConstructReading = {
		end: number;
		hasRawHTML: boolean;
		node: Node;
		start: number;
	};

	export type DocumentAnalysis = {
		// Closing tags in inline HTML after a container’s last HTML block that
		// close elements open in its skeleton, in document order
		inlineClosingTagsByContainer: Map<Node, string[]>;
		// Closing tags in inline HTML before each HTML block that close
		// elements open in its container’s skeleton, in document order
		inlineClosingTagsByFragment: Map<HTMLNode, string[]>;
		// Raw elements that inline HTML opened before each HTML block in its
		// container and left open, outermost first
		inlineOpenersByFragment: Map<HTMLNode, InlineOpener[]>;
		// Markdown containers that render inside opaque HTML tokens
		opaqueContainers: Set<Node>;
		protectedEnds: Set<HTMLNode>;
		protectedMarkdown: ProtectedMarkdown[];
		// Rendered ranges of comments, raw text, and other protected content
		protectedRanges: ProtectedRange[];
		protectedStarts: Set<HTMLNode>;
		rawAncestorsByContainer: Map<Node, string[]>;
		// Descriptions of the innermost raw element around each reference
		// reading that renders inside one
		readingContainers: Map<Node, string>;
		// Elements with opening and closing tags in separate fragments,
		// including at least one inline fragment
		splitElements: SplitElement[];
	};

	export type InlineLayout = {
		// The columns before the innermost container’s content in GitHub
		// Flavored Markdown, from which a paragraph line’s indentation counts
		containerEdge: number;
		// The block quotes and list items around the paragraph, outermost first
		containers: ReadonlyArray<Node>;
		// The columns before the paragraph’s content in Prettier’s layout,
		// including checkbox width and list continuation indentation
		contentEdge: number;
		paragraph: Node;
	};

	export type InlineOpener = {
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
		// This array records HTML blocks from Prettier’s Markdown parser that
		// the reference renderer reads as Markdown text, along with the start
		// offset of each block’s text in the rendered HTML
		markdownTexts: Array<{
			// This flag indicates whether the text occupies one line between
			// blank lines or container edges
			isIsolated: boolean;
			node: HTMLNode;
			start: number;
		}>;
		// Constructs that only Prettier’s Markdown parser recognizes, with the
		// range of the rendered reference reading
		readings: ConstructReading[];
		source: string | undefined;
	};

	export type Fragment = {
		// The paragraph, heading, or table cell around an inline fragment
		block: Node | undefined;
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

	export type ProtectedRange = {
		// The kind of HTML token or element that holds the content
		description: string;
		end: number;
		start: number;
	};

	export type SplitElement = {
		closing: Fragment;
		// The name that Prettier prints in formatted tags
		name: string;
		opening: Fragment;
		// The name as written in the opening tag. Prettier requires the closing
		// tag to use the same spelling
		sourceName: string;
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
