import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import * as pluginHTML from 'prettier/plugins/html';
import diagnoseInvalidHTML, {
	describeSplitConstruct,
} from '../diagnose-invalid-html/index.ts';
import isRawTextTag from '../is-raw-text-tag/index.ts';
import {
	describeGeneratedElement,
	reportInvalidHTML,
	reportUnsupportedMarkdown,
} from '../report-error/index.ts';

type HTMLNode = {
	children?: HTMLNode[];
	endSourceSpan?: HTMLSourceSpan | undefined;
	kind: string;
	name?: string;
	parent?: HTMLNode;
	sourceSpan: HTMLSourceSpan;
	startSourceSpan?: HTMLSourceSpan;
};

type HTMLSourceSpan = {
	end: { offset: number };
	start: { offset: number };
};

type OffsetRange = {
	end: number;
	start: number;
};

type OpaqueToken = {
	description: string;
	// Where the token’s opening delimiter or tag begins
	opening: number;
} & OffsetRange;

type ParseError = Error & {
	loc?: { start?: { column: number; line: number } };
};

const PRESERVED_WHITESPACE_TAG_NAMES = new Set(['listing', 'plaintext', 'pre']);

/**
 * Validates a document context with Prettier’s HTML parser and describes the
 * HTML structure that each fragment belongs to.
 */
export default async function analyzeDocumentContext(
	context: AST.DocumentContext,
	options: ParserOptions
): Promise<AST.DocumentAnalysis> {
	const root = await parseHTML(context, options);
	const elementsByStart = new Map<number, HTMLNode>();
	const opaqueTokens: OpaqueToken[] = [];
	const protectedRanges: OpaqueToken[] = [];

	const generatedStarts = new Set(
		context.generatedElements.map(({ openStart }) => openStart)
	);

	collectHTMLNodes(
		root,
		context.html,
		(offset) => generatedStarts.has(offset),
		elementsByStart,
		opaqueTokens,
		protectedRanges
	);
	checkGeneratedElements(context, options, elementsByStart, opaqueTokens);
	checkMarkdownTexts(
		context,
		options,
		root,
		generatedStarts,
		protectedRanges
	);

	const inlineClosingTags = collectInlineClosingTags(
		context,
		elementsByStart
	);

	return {
		inlineClosingTagsByContainer: inlineClosingTags.byContainer,
		inlineClosingTagsByFragment: inlineClosingTags.byFragment,
		inlineOpenersByFragment: collectInlineOpeners(context, root),
		opaqueContainers: new Set(
			[...context.containers]
				.filter(
					([, generated]) =>
						findToken(opaqueTokens, generated.openStart) !==
						undefined
				)
				.map(([node]) => node)
		),
		protectedEnds: collectFragmentsAt(context, protectedRanges, 'end'),
		protectedMarkdown: collectProtectedMarkdown(context, protectedRanges),
		protectedRanges: protectedRanges.map(({ description, end, start }) => ({
			description,
			end,
			start,
		})),
		protectedStarts: collectFragmentsAt(context, protectedRanges, 'start'),
		rawAncestorsByContainer: collectRawAncestors(context, elementsByStart),
		readingContainers: collectReadingContainers(
			context,
			root,
			generatedStarts
		),
		splitElements: collectSplitElements(
			context,
			elementsByStart,
			protectedRanges
		),
	};
}

/**
 * Reports an error for Markdown text that Prettier’s Markdown parser reads as
 * an HTML block when the text is not isolated and renders inside a raw element
 * or protected content. Prettier may format the block apart from surrounding
 * content that the reference renderer keeps together.
 */
function checkMarkdownTexts(
	context: AST.DocumentContext,
	options: ParserOptions,
	root: HTMLNode,
	generatedStarts: ReadonlySet<number>,
	protectedRanges: ReadonlyArray<OpaqueToken>
): void {
	for (const { isIsolated, node, start } of context.markdownTexts) {
		if (
			!isIsolated &&
			(protectedRanges.some(
				(range) => range.start <= start && start < range.end
			) ||
				findAncestors(root, start).some(
					(element) =>
						!generatedStarts.has(element.sourceSpan.start.offset)
				))
		) {
			reportUnsupportedMarkdown({
				filepath: options.filepath,
				position: node.position?.start,
				reason: 'Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown',
			});
		}
	}
}

/**
 * Describes the innermost raw element around each reference reading that
 * renders inside one.
 */
function collectReadingContainers(
	context: AST.DocumentContext,
	root: HTMLNode,
	generatedStarts: ReadonlySet<number>
): Map<AST.Node, string> {
	const containers = new Map<AST.Node, string>();

	for (const { node, start } of context.readings) {
		const element = findAncestors(root, start).findLast(
			({ sourceSpan }) => !generatedStarts.has(sourceSpan.start.offset)
		);

		if (element) {
			containers.set(
				node,
				`\`<${element.name?.toLowerCase() ?? ''}>\` element`
			);
		}
	}

	return containers;
}

/**
 * Lists the elements that contain an offset in parsed HTML, outermost first. An
 * element’s content can extend past its source span when it has no closing tag.
 */
function findAncestors(node: HTMLNode, offset: number): HTMLNode[] {
	for (const child of node.children ?? []) {
		if (
			child.sourceSpan.start.offset <= offset &&
			offset < findEnd(child)
		) {
			return child.kind === 'element'
				? [child, ...findAncestors(child, offset)]
				: [];
		}
	}

	return [];
}

/**
 * Returns the furthest end offset among a parsed node and its descendants.
 */
function findEnd(node: HTMLNode): number {
	return Math.max(
		node.sourceSpan.end.offset,
		...(node.children ?? []).map((child) => findEnd(child))
	);
}

/**
 * Lists the outermost Markdown constructs that render inside protected content,
 * with a description of the content that contains them.
 */
function collectProtectedMarkdown(
	context: AST.DocumentContext,
	protectedRanges: OpaqueToken[]
): AST.ProtectedMarkdown[] {
	const protectedMarkdown: Array<
		AST.ProtectedMarkdown & { end: number; start: number }
	> = [];
	const generatedElements = context.generatedElements.toSorted(
		(first, second) => first.openStart - second.openStart
	);

	for (const generated of generatedElements) {
		const range = findToken(protectedRanges, generated.openStart);
		const outer = protectedMarkdown.at(-1);

		if (range && !(outer && generated.openStart < outer.end)) {
			protectedMarkdown.push({
				containers:
					context.enclosingContainers.get(generated.node) ?? [],
				description: range.description,
				end: generated.closeEnd,
				isEnclosing: false,
				node: generated.node,
				position: generated.node.position?.start,
				start: generated.openStart,
			});
		}
	}

	// Markdown text may have no generated element inside the protected content,
	// as in an inline `<textarea>`. Use the innermost Markdown construct
	// enclosing that content
	for (const range of protectedRanges) {
		const enclosing = generatedElements.findLast(
			({ closeStart, openEnd }) =>
				openEnd <= range.start && range.end <= closeStart
		);

		if (
			enclosing &&
			containsMarkdownText(context, range) &&
			!protectedMarkdown.some(
				({ end, start }) =>
					start <= enclosing.openStart && enclosing.closeEnd <= end
			)
		) {
			protectedMarkdown.push({
				containers:
					context.enclosingContainers.get(enclosing.node) ?? [],
				description: range.description,
				end: enclosing.closeEnd,
				isEnclosing: true,
				node: enclosing.node,
				position: getMarkdownPosition(context, range.opening),
				start: enclosing.openStart,
			});
		}
	}

	return protectedMarkdown.map(
		({ containers, description, isEnclosing, node, position }) => ({
			containers,
			description,
			isEnclosing,
			node,
			position,
		})
	);
}

/**
 * Checks whether protected content includes text rendered from Markdown outside
 * raw HTML fragments. Whitespace counts, since formatting can change it.
 */
function containsMarkdownText(
	context: AST.DocumentContext,
	range: OffsetRange
): boolean {
	let offset = range.start;

	for (const fragment of context.fragments.toSorted(
		(first, second) => first.start - second.start
	)) {
		if (fragment.end <= offset || fragment.start >= range.end) {
			continue;
		}

		if (offset < fragment.start) {
			return true;
		}

		offset = Math.max(offset, fragment.end);
	}

	return offset < Math.min(range.end, context.html.length);
}

/**
 * Parses the document context, reporting rejected markup at its position in the
 * original Markdown.
 */
async function parseHTML(
	context: AST.DocumentContext,
	options: ParserOptions
): Promise<HTMLNode> {
	try {
		return (await pluginHTML.parsers.html.parse(context.html, {
			...options,
			parser: 'html',
		} as ParserOptions)) as HTMLNode;
	} catch (error: unknown) {
		const location = (error as ParseError).loc?.start;
		// Prettier reports one-based columns
		const offset =
			location === undefined
				? undefined
				: getOffset(context.html, location.line, location.column - 1);
		const diagnosis = diagnoseInvalidHTML(context, offset);
		const reportedOffset = diagnosis?.offset ?? offset;

		reportInvalidHTML({
			cause: error,
			filepath: options.filepath,
			position:
				reportedOffset === undefined
					? undefined
					: getMarkdownPosition(context, reportedOffset),
			// Positions in Prettier’s message refer to the document context,
			// not the Markdown
			reason:
				diagnosis?.reason ??
				(error instanceof Error
					? error.message
							.split('\n', 1)[0]!
							.replace(/\s*\(\d+:\d+\)$/, '')
					: String(error)),
		});
	}
}

/**
 * Indexes elements by the start of their opening tags and collects the spans of
 * opaque tokens and protected content.
 */
function collectHTMLNodes(
	node: HTMLNode,
	html: string,
	isGeneratedStart: (offset: number) => boolean,
	elementsByStart: Map<number, HTMLNode>,
	opaqueTokens: OpaqueToken[],
	protectedRanges: OpaqueToken[]
): void {
	for (const child of node.children ?? []) {
		const { end, start } = {
			end: child.sourceSpan.end.offset,
			start: child.sourceSpan.start.offset,
		};

		if (child.kind === 'element') {
			elementsByStart.set(start, child);

			const name = child.name?.toLowerCase() ?? '';
			const contentStart = child.startSourceSpan?.end.offset ?? end;
			const contentEnd =
				child.endSourceSpan?.start.offset ?? Number.POSITIVE_INFINITY;

			if (isRawTextTag(name)) {
				const range = {
					description: `\`<${name}>\` element`,
					end: contentEnd,
					opening: start,
					start: contentStart,
				};
				opaqueTokens.push(range);
				protectedRanges.push(range);
			} else if (
				PRESERVED_WHITESPACE_TAG_NAMES.has(name) &&
				// Code blocks generated from Markdown are Prettier’s to format
				!isGeneratedStart(start)
			) {
				protectedRanges.push({
					description: `\`<${name}>\` element`,
					end: contentEnd,
					opening: start,
					start: contentStart,
				});
			}
		} else if (
			child.kind === 'comment' ||
			child.kind === 'docType' ||
			child.kind === 'cdata'
		) {
			const description = describeToken(html, start);
			opaqueTokens.push({ description, end, opening: start, start });
			// The token’s delimiters aren’t part of its protected content
			protectedRanges.push({
				description,
				end: end - 1,
				opening: start,
				start: start + 1,
			});
		}

		collectHTMLNodes(
			child,
			html,
			isGeneratedStart,
			elementsByStart,
			opaqueTokens,
			protectedRanges
		);
	}
}

/**
 * Checks that every element generated from Markdown keeps its own opening and
 * closing tags, and that opaque tokens contain generated elements completely or
 * not at all.
 */
function checkGeneratedElements(
	context: AST.DocumentContext,
	options: ParserOptions,
	elementsByStart: Map<number, HTMLNode>,
	opaqueTokens: OpaqueToken[]
): void {
	for (const generated of context.generatedElements) {
		const openToken = findToken(opaqueTokens, generated.openStart);
		const closeToken = findToken(opaqueTokens, generated.closeStart);
		const construct = describeGeneratedElement(generated.tagName);

		if (openToken !== closeToken) {
			const token = (openToken ?? closeToken)!;

			reportInvalidHTML({
				filepath: options.filepath,
				position: getMarkdownPosition(context, token.opening),
				reason: describeSplitConstruct(
					construct,
					openToken,
					closeToken
				),
			});
		}

		if (openToken) {
			continue;
		}

		const element = elementsByStart.get(generated.openStart);

		if (element?.endSourceSpan?.start.offset !== generated.closeStart) {
			reportInvalidHTML({
				filepath: options.filepath,
				position: getMarkdownPosition(context, generated.openStart),
				reason: element?.endSourceSpan
					? `A closing tag in raw HTML ends this ${construct} before its Markdown content ends`
					: `Raw HTML implicitly closes this ${construct} before its Markdown content ends`,
			});
		}
	}
}

/**
 * Names the kind of opaque token that starts at an offset.
 */
function describeToken(html: string, offset: number): string {
	if (html.startsWith('<!--', offset)) {
		return 'comment';
	}

	if (html.startsWith('<![CDATA[', offset)) {
		return 'CDATA section';
	}

	return html.startsWith('<?', offset)
		? 'processing instruction'
		: 'declaration';
}

/**
 * Collects the fragments whose first or last character is protected content.
 */
function collectFragmentsAt(
	context: AST.DocumentContext,
	protectedRanges: OpaqueToken[],
	boundary: 'end' | 'start'
): Set<AST.HTMLNode> {
	return new Set(
		context.fragments
			.filter((fragment) => {
				const offset =
					boundary === 'start' ? fragment.start : fragment.end - 1;
				return protectedRanges.some(
					({ end, start }) => start <= offset && offset < end
				);
			})
			.map(({ node }) => node)
	);
}

/**
 * Lists, for each HTML block, the raw elements that inline HTML earlier in its
 * container opened and left open, outermost first. In a tight list item, an
 * element that a paragraph opens can enclose the blocks that follow it.
 */
function collectInlineOpeners(
	context: AST.DocumentContext,
	root: HTMLNode
): Map<AST.HTMLNode, AST.InlineOpener[]> {
	const openersByFragment = new Map<AST.HTMLNode, AST.InlineOpener[]>();

	for (const fragment of context.fragments) {
		if (!fragment.isBlock) {
			continue;
		}

		const containerStart =
			context.containers.get(fragment.parent)?.openEnd ?? 0;
		const openers = findEnclosingElements(root, fragment.start).filter(
			(element) => {
				const start = element.sourceSpan.start.offset;

				return (
					start >= containerStart &&
					context.fragments.some(
						(opener) =>
							!opener.isBlock &&
							opener.start <= start &&
							start < opener.end
					)
				);
			}
		);

		// Prettier’s parser matches tag names case-sensitively, so the skeleton
		// opens each element with its name as written
		if (openers.length > 0) {
			openersByFragment.set(
				fragment.node,
				openers.map((element) => ({
					name:
						/^<([^\s/>]+)/.exec(
							context.html.slice(element.sourceSpan.start.offset)
						)?.[1] ?? '',
					start: element.sourceSpan.start.offset,
				}))
			);
		}
	}

	return openersByFragment;
}

/**
 * Lists inline closing tags that close elements open in a container’s skeleton,
 * where markers stand in for Markdown between HTML blocks. These elements
 * opened in or before an earlier HTML block of the container. Tags are in
 * document order, keyed by the next HTML block or by the container when no HTML
 * block follows.
 */
function collectInlineClosingTags(
	context: AST.DocumentContext,
	elementsByStart: ReadonlyMap<number, HTMLNode>
): {
	byContainer: Map<AST.Node, string[]>;
	byFragment: Map<AST.HTMLNode, string[]>;
} {
	const closings = [...elementsByStart]
		.flatMap(([start, element]) => {
			const offset = element.endSourceSpan?.start.offset;
			const isInline =
				offset !== undefined &&
				context.fragments.some(
					(fragment) =>
						!fragment.isBlock &&
						fragment.start <= offset &&
						offset < fragment.end
				);

			return isInline
				? [
						{
							offset,
							start,
							tag:
								/^<\/[^\s/>]+/.exec(
									context.html.slice(offset)
								)?.[0] ?? '',
						},
					]
				: [];
		})
		.toSorted((first, second) => first.offset - second.offset);
	const blocksByContainer = new Map<AST.Node, AST.Fragment[]>();

	for (const fragment of context.fragments) {
		if (fragment.isBlock) {
			blocksByContainer.set(fragment.parent, [
				...(blocksByContainer.get(fragment.parent) ?? []),
				fragment,
			]);
		}
	}

	const byContainer = new Map<AST.Node, string[]>();
	const byFragment = new Map<AST.HTMLNode, string[]>();

	for (const [container, blocks] of blocksByContainer) {
		const generated = context.containers.get(container);
		const containerStart = generated?.openEnd ?? 0;
		const containerEnd = generated?.closeStart ?? context.html.length;

		for (const [index, previous] of blocks.entries()) {
			const next = blocks[index + 1];
			const end = next?.start ?? containerEnd;
			const tags = closings
				.filter(
					({ offset, start }) =>
						previous.end <= offset &&
						offset < end &&
						containerStart <= start &&
						start < previous.end
				)
				.map(({ tag }) => `${tag}>`);

			if (tags.length === 0) {
				continue;
			}

			if (next) {
				byFragment.set(next.node, tags);
			} else {
				byContainer.set(container, tags);
			}
		}
	}

	return { byContainer, byFragment };
}

/**
 * Lists the elements whose opening and closing tags are in different fragments,
 * at least one of them inline. Inline fragments are formatted apart from the
 * HTML blocks of their container.
 */
function collectSplitElements(
	context: AST.DocumentContext,
	elementsByStart: ReadonlyMap<number, HTMLNode>,
	protectedRanges: ReadonlyArray<OffsetRange>
): AST.SplitElement[] {
	const findFragment = (offset: number): AST.Fragment | undefined =>
		context.fragments.find(
			({ end, start }) => start <= offset && offset < end
		);
	const elements: AST.SplitElement[] = [];

	for (const [start, element] of elementsByStart) {
		// Prettier keeps both tags of elements in preformatted content
		if (
			!element.endSourceSpan ||
			protectedRanges.some(
				(range) => range.start <= start && start < range.end
			)
		) {
			continue;
		}

		const opening = findFragment(start);
		const closing = findFragment(element.endSourceSpan.start.offset);

		if (
			opening &&
			closing &&
			opening !== closing &&
			!(opening.isBlock && closing.isBlock)
		) {
			elements.push({
				closing,
				name: element.name ?? '',
				opening,
				sourceName:
					/^<([^\s/>]+)/.exec(context.html.slice(start))?.[1] ?? '',
			});
		}
	}

	return elements;
}

/**
 * Lists the elements that enclose an offset, outermost first.
 */
function findEnclosingElements(root: HTMLNode, offset: number): HTMLNode[] {
	const elements: HTMLNode[] = [];
	let children = root.children ?? [];
	let element: HTMLNode | undefined;

	do {
		element = children.find(
			(child) =>
				child.kind === 'element' &&
				child.sourceSpan.start.offset < offset &&
				(child.endSourceSpan
					? child.endSourceSpan.start.offset >= offset
					: (child.children?.at(-1) ?? child).sourceSpan.end.offset >
						offset)
		);

		if (element) {
			elements.push(element);
			children = element.children ?? [];
		}
	} while (element);

	return elements;
}

/**
 * Lists the raw elements enclosing each generated container, outermost first.
 */
function collectRawAncestors(
	context: AST.DocumentContext,
	elementsByStart: Map<number, HTMLNode>
): Map<AST.Node, string[]> {
	const ancestorsByContainer = new Map<AST.Node, string[]>();

	for (const [node, generated] of context.containers) {
		const ancestors: string[] = [];
		let ancestor = elementsByStart.get(generated.openStart)?.parent;

		while (ancestor && ancestor.kind === 'element') {
			if (isRawElement(context, ancestor)) {
				ancestors.unshift(ancestor.name ?? '');
			}

			ancestor = ancestor.parent;
		}

		ancestorsByContainer.set(node, ancestors);
	}

	return ancestorsByContainer;
}

/**
 * Checks whether an element’s opening tag comes from a raw HTML fragment.
 */
function isRawElement(
	context: AST.DocumentContext,
	element: HTMLNode
): boolean {
	const start = element.sourceSpan.start.offset;
	return context.fragments.some(
		(fragment) => fragment.start <= start && start < fragment.end
	);
}

/**
 * Finds the opaque token that contains an offset.
 */
function findToken(
	tokens: OpaqueToken[],
	offset: number
): OpaqueToken | undefined {
	return tokens.find(({ end, start }) => start <= offset && offset < end);
}

/**
 * Converts a one-based line and zero-based column into an offset.
 */
function getOffset(text: string, line: number, column: number): number {
	let offset = 0;

	for (let index = 1; index < line; index += 1) {
		const next = text.indexOf('\n', offset);

		if (next === -1) {
			return text.length;
		}

		offset = next + 1;
	}

	return Math.min(offset + column, text.length);
}

/**
 * Maps an offset in the document context to the closest position in the
 * original Markdown.
 */
export function getMarkdownPosition(
	context: AST.DocumentContext,
	offset: number
): AST.Point | undefined {
	const fragment = context.fragments.find(
		({ end, start }) => start <= offset && offset <= end
	);

	if (fragment) {
		const start = fragment.node.position?.start;

		if (!start) {
			return undefined;
		}

		const before = fragment.node.value.slice(0, offset - fragment.start);
		const lineIndex = before.split('\n').length - 1;
		const column = before.length - before.lastIndexOf('\n') - 1;

		if (lineIndex === 0) {
			return { column: start.column + column, line: start.line };
		}

		// Container prefixes can vary between lines, and Prettier’s parser can
		// expand their tabs. Match the line’s content to the source to recover
		// the original column
		const sourceLine =
			context.source?.split('\n')[start.line - 1 + lineIndex] ?? '';
		const valueLine = fragment.node.value.split('\n')[lineIndex] ?? '';
		const content = valueLine.trimStart();
		const contentColumn = content
			? sourceLine.lastIndexOf(content)
			: sourceLine.length;
		const indentation = valueLine.length - content.length;

		return {
			column:
				Math.max(
					contentColumn === -1
						? sourceLine.length - valueLine.length + column
						: contentColumn + column - indentation,
					0
				) + 1,
			line: start.line + lineIndex,
		};
	}

	if (offset >= context.html.length && context.end) {
		return { column: context.end.column, line: context.end.line };
	}

	const generated = context.generatedElements.findLast(
		({ openStart }) => openStart <= offset
	);
	const start = generated?.node.position?.start;

	return start ? { column: start.column, line: start.line } : undefined;
}
