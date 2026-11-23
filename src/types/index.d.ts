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
	 * Keep the closing bracket on the last attribute line in raw HTML. Inherits
	 * `bracketSameLine` when unset.
	 *
	 * @default undefined
	 */
	htmlFragmentBracketSameLine?: PrettierOptions['bracketSameLine'];
	/**
	 * Format embedded code in raw HTML. `auto` formats languages Prettier
	 * recognizes. `off` leaves embedded code as written. Inherits
	 * `embeddedLanguageFormatting` when unset.
	 *
	 * @default undefined
	 */
	htmlFragmentEmbeddedLanguageFormatting?: PrettierOptions['embeddedLanguageFormatting'];
	/**
	 * Set the preferred line length for raw HTML fragments. Inherits
	 * `printWidth` when unset.
	 *
	 * @default undefined
	 */
	htmlFragmentPrintWidth?: PrettierOptions['printWidth'];
	/**
	 * Use one attribute per line in raw HTML. Inherits `singleAttributePerLine`
	 * when unset.
	 *
	 * @default undefined
	 */
	htmlFragmentSingleAttributePerLine?: PrettierOptions['singleAttributePerLine'];
	/**
	 * Set whitespace sensitivity for raw HTML. `css` follows each element’s
	 * default CSS display value. `strict` treats whitespace around tags as
	 * significant. `ignore` treats it as insignificant. Inherits
	 * `htmlWhitespaceSensitivity` when unset.
	 *
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
		// The HTML blocks of accepted regions
		blockFragments: ReadonlySet<Node>;
		children: Node[];
		// Whether the container’s end also ends an HTML block left open as its
		// last child
		endsOpenBlocks: boolean;
		formattedNodes: WeakSet<Node>;
		ignoredNodes: ReadonlySet<Node>;
		isListItem: boolean;
		// Whether Prettier’s Markdown printer puts each child on the line after
		// the previous one, as it does in list items without blank lines
		// between or after their children
		isPrintedTight: boolean;
		prefixWidth: number;
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
		// Inline HTML that corrections removed from the paragraph, whose source
		// the layout leaves out
		removedNodes?: ReadonlyArray<HTMLNode>;
	};

	export type Fragment = {
		isSingleLine: boolean;
		node: HTMLNode;
		parent: Node;
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

export namespace Regions {
	export type BlockRegion = {
		// Where the run of sibling blocks starts and ends in the container’s
		// children, inclusive
		firstIndex: number;
		kind: 'block';
		lastIndex: number;
		nodes: AST.Node[];
	} & RegionBase;

	export type ClosingTag = ClosingTagToken & Location;

	export type ClosingTagToken = {
		end: number;
		// Set for a closing tag inside SVG or MathML content, where a closing
		// tag that pairs with nothing leaves the end of that content unknown
		isInForeignContent?: true;
		kind: 'closing-tag';
		// The lowercase name that tag matching compares
		name: string;
		// The name as written
		sourceName: string;
		start: number;
	};

	// The document root, a block quote, or a list item, whose raw tags pair
	// only with one another
	export type Container = {
		// HTML blocks that are children of the container, in source order
		blocks: Fragment[];
		containers: Container[];
		// The position in the parent container’s children of the block that
		// holds this container, such as its block quote or list
		index: number | undefined;
		inlines: InlineBlock[];
		kind: 'blockquote' | 'listItem' | 'root';
		node: AST.ParentNode;
		parent: Container | undefined;
	};

	// Changes that corrections make to raw tags before regions form
	export type Corrections = {
		// Closing tags that a correction removes or rewrites, mapped to their
		// replacement text. These tags take no region in tag matching
		closingTags?: ReadonlyMap<ClosingTag, string>;
	};

	export type Document = {
		// Fragments outside footnote definitions, in source order
		fragments: Fragment[];
		// The outermost protected source around each node that an ignore
		// directive protects, including descendants of protected nodes
		protections: ReadonlyMap<AST.Node, Protection>;
		root: Container;
		source: string;
	};

	export type DocumentRegions = {
		corrections: Corrections;
		document: Document;
		// Regions outside any other region, in source order
		regions: Region[];
	};

	export type Element = {
		closing: ClosingTag | undefined;
		// How the element ends: through its own closing tag, the closing tag of
		// an enclosing raw element, a later tag in its HTML block that
		// Prettier’s parser reads as closing it, or its opening tag. Only HTML
		// void elements and self-closing foreign elements end at their opening
		// tags. An unclosed element extends to the end of its container
		end:
			| 'closing-tag'
			| 'enclosing'
			| 'implicit'
			| 'opening-tag'
			| 'unclosed';
		// Closing tag for this element or for the ancestor that closes it
		endTag: ClosingTag | undefined;
		// Whether the element is inside SVG or MathML content, where HTML void
		// names can take closing tags
		isForeign: boolean;
		name: string;
		opening: OpeningTag;
		parent: Element | undefined;
	};

	// A stretch of source that Prettier’s Markdown parser identifies as HTML
	export type Fragment = {
		// The paragraph, heading, or table cell around an inline fragment
		block: AST.Node | undefined;
		container: Container;
		// Index of the fragment’s block among the container’s children
		index: number;
		isBlock: boolean;
		node: AST.HTMLNode;
		// Outermost group of protected nodes containing this fragment
		protection: Protection | undefined;
		tokens: Token[];
	};

	// A paragraph, heading, or table cell that contains inline HTML
	export type InlineBlock = {
		container: Container;
		fragments: Fragment[];
		index: number;
		node: AST.Node;
	};

	export type InlineRegion = RegionBase & {
		index: number;
		kind: 'inline';
		// The paragraph, heading, or table cell
		node: AST.Node;
	};

	// Where a token appears in the original Markdown
	export type Location = {
		fragment: Fragment;
		position: AST.Point;
	};

	// Source whose tag-like text is literal. A tag that its fragment ends
	// before completing counts as one
	export type OpaqueConstruct =
		| 'cdata'
		| 'comment'
		| 'declaration'
		| 'incomplete-tag'
		| 'processing-instruction'
		| 'raw-text';

	export type OpaqueToken = {
		construct: OpaqueConstruct;
		// Where the construct ends, or `undefined` if it continues past the end
		// of the scanned HTML
		end: number | undefined;
		kind: 'opaque';
		start: number;
	};

	export type OpaqueSource = Location & OpaqueToken;

	export type OpeningTag = Location & OpeningTagToken;

	export type OpeningTagToken = {
		end: number;
		isSelfClosing: boolean;
		kind: 'opening-tag';
		// The lowercase name that tag matching compares
		name: string;
		// The name as written
		sourceName: string;
		start: number;
	};

	export type Region = BlockRegion | InlineRegion;

	type RegionBase = {
		// The raw elements open around the region, outermost first, including
		// those opened outside its Markdown container
		ancestors: Element[];
		container: Container;
		// Elements opened in the region’s own fragments
		elements: Element[];
		// Fragments outside the region’s nested regions
		fragments: Fragment[];
		// Whether ignore directives protect the entire region
		isProtected: boolean;
		parent: Region | undefined;
		position: AST.Point;
		// Nested regions, in source order
		regions: Region[];
		unpairedClosingTags: ClosingTag[];
	};

	// Why a region doesn’t qualify for formatting, at the first point in source
	// order that shows it. When Prettier can’t parse or format the region’s HTML,
	// the cause is Prettier’s error. Acceptance checks only the parse, and the
	// formatting of each region decides whether formatting throws
	export type Problem =
		| {
				cause: unknown;
				kind: 'unformattable';
				position: AST.Point;
		  }
		| {
				construct: 'cdata' | 'declaration' | 'processing-instruction';
				kind: 'unsupported-construct';
				position: AST.Point;
		  }
		| {
				construct:
					| 'comment'
					| 'incomplete-tag'
					| 'math'
					| 'pre'
					| 'raw-text'
					| 'svg';
				kind: 'split-construct';
				position: AST.Point;
		  }
		| {
				element: Element;
				kind:
					| 'crossed-protection'
					| 'inline-foreign'
					| 'self-closing'
					| 'unclosed-element';
				position: AST.Point;
		  }
		| {
				kind: 'escaped-pipe';
				position: AST.Point;
		  }
		| {
				kind: 'unpaired-closing-tag';
				position: AST.Point;
				tag: ClosingTag;
		  };

	// Sibling nodes that an ignore directive protects: the next node for
	// `prettier-ignore`, or the nodes within an ignored range
	export type Protection = {
		kind: 'next' | 'range';
		nodes: AST.Node[];
	};

	export type Token = ClosingTag | OpaqueSource | OpeningTag;

	export type Verdict =
		{ isAccepted: false; problem: Problem } | { isAccepted: true };
}
