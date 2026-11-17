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

	return {
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
		protectedStarts: collectFragmentsAt(context, protectedRanges, 'start'),
		rawAncestorsByContainer: collectRawAncestors(context, elementsByStart),
	};
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
					isClosedInline: context.fragments.some(
						({ end, isBlock, start }) =>
							!isBlock &&
							element.endSourceSpan !== undefined &&
							element.endSourceSpan !== null &&
							start <= element.endSourceSpan.start.offset &&
							element.endSourceSpan.start.offset < end
					),
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
