import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import * as pluginHTML from 'prettier/plugins/html';
import findTagEnd from '../find-tag-end/index.ts';
import formatHTML from '../format-html/index.ts';
import isHTMLBlockSequence, {
	canInterruptParagraph,
	endsInContinuingBlock,
	findBlockStartLines,
	findNonBlockLine,
	needsCompleteTagLine,
	readTakenInHTML,
} from '../is-html-block-sequence/index.ts';
import isRawTextTag from '../is-raw-text-tag/index.ts';
import { getBlockSource } from '../render-document-context/index.ts';
import {
	reportChangedTagSpelling,
	reportFormatterFailure,
	reportUnsafeLayout,
	reportUnsupportedMarkdown,
} from '../report-error/index.ts';

// A line containing only closing tags, as Prettier prints for elements whose
// closing tags were omitted
const CLOSING_TAGS_LINE_PATTERN =
	/^[\t ]*(?:<\/[a-z][^\s/<>]*[\t ]*>[\t ]*)+$/i;

// A comment that Prettier’s Markdown printer honors as an ignore directive
export const IGNORE_COMMENT_PATTERN =
	/^<!--\s*prettier-ignore(?:-(end|start))?\s*-->$/;

// Elements that Prettier’s HTML parser closes when an enclosing element closes
const CLOSED_BY_PARENT_TAG_NAMES = new Set([
	/* prettier-ignore */
	'dd',
	'li',
	'optgroup',
	'option',
	'p',
	'rb',
	'rp',
	'rt',
	'rtc',
	'tbody',
	'td',
	'tfoot',
	'th',
	'tr',
]);

const TAKEN_IN_CONSEQUENCES: Record<TakenInContent, string> = {
	'html': 'end partway through an HTML block that follows',
	'ignore-comment':
		'include the Prettier ignore comment that follows, preventing Prettier’s Markdown printer from honoring it',
	'markdown': 'include the Markdown that follows',
};

type HTMLElement = {
	children?: HTMLElement[];
	endSourceSpan?:
		{ end: { offset: number }; start: { offset: number } } | undefined;
	isVoid?: boolean;
	kind: string;
	name?: string;
	parent?: HTMLElement;
	sourceSpan: { end: { offset: number }; start: { offset: number } };
	value?: string;
};

type FragmentPart = {
	end: number;
	kind: 'fragment';
	node: AST.HTMLNode;
	start: number;
	text: string;
};

type MarkerPart = {
	end: number;
	id: number;
	// Whether the marker separates adjacent fragments without Markdown
	isSeparator: boolean;
	kind: 'marker';
	start: number;
	text: string;
};

// Opening tags added to the skeleton for elements that earlier inline HTML in
// the container left open at the next fragment’s start
type ContextPart = {
	end: number;
	kind: 'context';
	start: number;
	text: string;
};

type SkeletonPart = ContextPart | FragmentPart | MarkerPart;

type MarkupToken = {
	end: number;
	kind: 'comment' | 'markup' | 'preserved' | 'tag';
	// The opening tag’s name as spelled in the scanned text
	name?: string;
	start: number;
};

type Skeleton = {
	parts: SkeletonPart[];
	text: string;
};

// Content after a fragment that a block left open would change
type TakenInContent = 'html' | 'ignore-comment' | 'markdown';

type ScopeLayout = {
	// Closing tags that Prettier supplies after Markdown ends the scope
	closingTags: string;
	// Closing tags that Prettier supplies between an ignored fragment and the
	// Markdown after it
	closingTagsAfter: Map<AST.HTMLNode, string>;
	values: Map<AST.HTMLNode, string>;
};

/**
 * Formats the HTML blocks of one Markdown container together, so each
 * fragment’s layout reflects the raw HTML elements it shares with the others.
 * Returns the container’s children, including any HTML nodes added for closing
 * tags that Prettier supplies at the end of the container. Separates HTML
 * blocks from adjacent Markdown blocks except in list items that Prettier
 * prints tight.
 */
export default async function formatBlockHTML(
	scope: AST.BlockScope,
	options: ParserOptions
): Promise<AST.Node[]> {
	const marker = createMarker(scope);
	const formattingOptions = getScopeOptions(scope, options);
	const fragments = scope.children.filter((child) =>
		isFragment(scope, child)
	);
	const brokenFragments = new Set<AST.HTMLNode>();

	checkSourceBlocks(scope, options);

	let layout = await formatSkeleton(
		scope,
		marker,
		brokenFragments,
		formattingOptions
	);

	for (const node of fragments) {
		if (needsExpandedLayout(scope, node, layout.values.get(node)!)) {
			brokenFragments.add(node);
		}
	}

	if (brokenFragments.size > 0) {
		layout = await formatSkeleton(
			scope,
			marker,
			brokenFragments,
			formattingOptions
		);
	}

	const children = [...scope.children];
	const values = new Map<AST.HTMLNode, string>();

	for (const node of fragments) {
		if (scope.ignoredNodes.has(node)) {
			continue;
		}

		const joined = rejoinBrackets(joinFirstTag(layout.values.get(node)!));

		// If the fragment starts inside protected content, the block reader
		// can’t tell where that content ends
		values.set(
			node,
			keepIgnoreCommentWhitespace(
				node,
				scope.protectedStarts.has(node)
					? joined
					: alignBlockStarts(joined)
			)
		);
	}

	for (const [node, aligned] of values) {
		const takenIn = findTakenInContent(scope, node, values);
		const value = takenIn
			? endBlockOnLastLine(node, aligned, takenIn, options)
			: aligned;
		checkIgnoreComment(scope, node, value, options);
		checkHTMLBlocks(
			node,
			value,
			scope.endsOpenBlocks && scope.children.at(-1) === node,
			options
		);

		node.value = value;
		scope.formattedNodes.add(node);
	}

	for (const [node, tags] of layout.closingTagsAfter) {
		const closingNode = createClosingNode(scope, node, tags);
		const takenIn = findTakenInSiblings(scope, closingNode, values, node);

		// The closing tags can’t join the protected source’s last line
		if (takenIn) {
			reportUnsafeLayout({
				filepath: options.filepath,
				position: node.position?.start,
				reason: `After formatting, the block formed by closing tags after this HTML block would remain open in GitHub Flavored Markdown and ${TAKEN_IN_CONSEQUENCES[takenIn]}`,
			});
		}

		children.splice(children.indexOf(node) + 1, 0, closingNode);
	}

	if (layout.closingTags) {
		children.push(
			createClosingNode(scope, children.at(-1), layout.closingTags)
		);
	}

	separateFromMarkdown(scope, children);

	return children;
}

/**
 * Formats a scope’s skeleton and splits the result into fragment values and the
 * closing tags that Prettier supplies after Markdown ends the scope.
 */
async function formatSkeleton(
	scope: AST.BlockScope,
	marker: Marker,
	brokenFragments: ReadonlySet<AST.HTMLNode>,
	options: ParserOptions
): Promise<ScopeLayout> {
	const skeleton = buildSkeleton(scope, marker, brokenFragments);
	const {
		closingTags,
		contextClosingTags,
		omittedClosingTags,
		renamableFragments,
	} = await findImplicitClosingTags(scope, skeleton, marker, options);
	const formatted = marker.removeOmittedClosingTags(
		marker.removeBreaks(
			await formatHTML(
				renderSkeleton(
					scope,
					skeleton,
					closingTags,
					omittedClosingTags,
					contextClosingTags
				),
				options,
				scope.children.find(isHTMLNode)?.position?.start
			)
		)
	);

	const markers = marker.find(formatted);
	const values = new Map<AST.HTMLNode, string>();

	let offset = 0;
	let markerIndex = 0;
	let trailingClosingTags = '';
	const closingTagsAfter = new Map<AST.HTMLNode, string>();

	for (const [index, part] of skeleton.parts.entries()) {
		if (part.kind === 'fragment') {
			const next = skeleton.parts[index + 1];
			const end =
				next?.kind === 'fragment'
					? findCommentEnd(formatted, offset, part.node.value)
					: markers[markerIndex]?.start;

			if (end === undefined) {
				reportMisplacedMarkdown(scope, options);
			}

			values.set(
				part.node,
				removeAddedBlankLines(
					trimFragment(
						formatted.slice(offset, end),
						scope.protectedStarts.has(part.node),
						scope.protectedEnds.has(part.node)
					),
					part.node
				)
			);
			offset = end;
			continue;
		}

		// The next separator marker advances the offset past these opening tags
		if (part.kind === 'context') {
			continue;
		}

		const match = markers[markerIndex];

		if (match?.id !== part.id) {
			reportMisplacedMarkdown(scope, options);
		}

		// When Markdown ends the scope, the text before the final marker holds
		// the closing tags that Prettier supplies
		if (
			index === skeleton.parts.length - 1 &&
			skeleton.parts[index - 1]?.kind === 'marker'
		) {
			trailingClosingTags = formatted.slice(offset, match.start);
		}

		const previousPart = skeleton.parts[index - 1];

		// Between the separator after an ignored fragment and the Markdown
		// marker that follows, the text holds the closing tags that Prettier
		// supplies before that Markdown
		if (
			part.isSeparator &&
			previousPart?.kind === 'fragment' &&
			scope.ignoredNodes.has(previousPart.node) &&
			index < skeleton.parts.length - 2 &&
			skeleton.parts[index + 1]?.kind === 'marker'
		) {
			const tags = trimFragment(
				formatted.slice(match.end, markers[markerIndex + 1]?.start),
				false,
				false
			);

			if (tags) {
				closingTagsAfter.set(previousPart.node, tags);
			}
		}

		offset = match.end;
		markerIndex += 1;
	}

	// Prettier can print the parsed name in a protected opening tag that
	// directly follows its HTML ignore directive, so the tag would no longer
	// match its closing tag. Prettier keeps the directives in order
	for (const [part, indexes] of renamableFragments) {
		const sourceNames = listDirectiveTargets(part.text).map(
			({ name }) => name
		);
		const printedNames = listDirectiveTargets(values.get(part.node)!).map(
			({ name }) => name
		);
		const renamed = [...indexes]
			.filter(
				(index) =>
					printedNames[index] !== undefined &&
					printedNames[index] !== sourceNames[index]
			)
			.map((index) => sourceNames[index])
			.at(0);

		if (sourceNames.length === printedNames.length && renamed) {
			reportChangedTagSpelling(renamed, {
				filepath: options.filepath,
				position: part.node.position?.start,
			});
		}
	}

	return {
		closingTags: trimFragment(trailingClosingTags, false, false),
		closingTagsAfter,
		values,
	};
}

/**
 * Finds where a fragment that consists of one complete comment ends in
 * Prettier’s output, which keeps comments unchanged.
 */
function findCommentEnd(
	formatted: string,
	offset: number,
	comment: string
): number | undefined {
	const start = formatted.indexOf(comment.trim(), offset);

	return start === -1 || /\S/.test(formatted.slice(offset, start))
		? undefined
		: start + comment.trim().length;
}

/**
 * Lists closing tags for raw elements that the rendered document closes
 * implicitly at a boundary, keyed by the part they follow. At each boundary
 * between fragments, these are the elements that the next fragment’s first tag
 * closes. At the end of the scope, these are the elements left open. Prettier
 * then prints them after each element’s content instead of after a marker.
 * Elements opened in ignored fragments, and the elements around them, keep
 * their omitted closing tags.
 */
async function findImplicitClosingTags(
	scope: AST.BlockScope,
	skeleton: Skeleton,
	marker: Marker,
	options: ParserOptions
): Promise<{
	closingTags: Map<number, string>;
	// Closing tags for the elements that the skeleton opened as context and
	// that remain open at its end because their closing tags are omitted,
	// innermost first
	contextClosingTags: string;
	omittedClosingTags: Map<number, string>;
	// Indexes in each fragment’s `listDirectiveTargets` result for directives
	// immediately followed by opening tags whose source spelling differs from
	// the parsed name
	renamableFragments: Map<FragmentPart, Set<number>>;
}> {
	let root: HTMLElement;

	try {
		root = (await pluginHTML.parsers.html.parse(skeleton.text, {
			parser: 'html',
		} as ParserOptions)) as HTMLElement;
	} catch (error: unknown) {
		reportFormatterFailure({
			cause: error,
			filepath: options.filepath,
			position: scope.children.find(isHTMLNode)?.position?.start,
		});
	}

	const { parts } = skeleton;
	const ignoredFragments = parts.filter(
		(part): part is FragmentPart =>
			part.kind === 'fragment' && scope.ignoredNodes.has(part.node)
	);
	const closingTags = new Map<number, string>();

	/**
	 * Returns a closing tag using the element name’s source spelling.
	 * Prettier’s HTML parser lowercases element names but matches closing tags
	 * case-sensitively.
	 */
	function getClosingTag(element: HTMLElement): string {
		return `</${getSourceName(element)}>`;
	}

	/**
	 * Returns an element’s name as the skeleton spells it.
	 */
	function getSourceName(element: HTMLElement): string {
		return (
			/^<([^\s/>]+)/.exec(
				skeleton.text.slice(element.sourceSpan.start.offset)
			)?.[1] ?? element.name!
		);
	}

	// Elements whose closing tags are already accounted for, so later
	// insertions don’t duplicate them
	const closedElements = new Set<HTMLElement>();

	/**
	 * Checks whether an ignore directive protects an element’s opening tag,
	 * either in Markdown or in HTML.
	 */
	function isIgnored(element: HTMLElement): boolean {
		const start = element.sourceSpan.start.offset;

		return (
			ignoredFragments.some(
				(fragment) => fragment.start <= start && start < fragment.end
			) || isProtectedByHTMLIgnore(element)
		);
	}

	/**
	 * Checks whether an HTML ignore directive protects an element’s source.
	 * Protection covers the next element and all its descendants.
	 */
	function isProtectedByHTMLIgnore(element: HTMLElement): boolean {
		const siblings = element.parent?.children ?? [];
		const previous = siblings
			.slice(0, siblings.indexOf(element))
			.findLast(
				(sibling) =>
					sibling.kind !== 'text' || /\S/.test(sibling.value ?? '')
			);

		return (
			(previous?.kind === 'comment' &&
				previous.value?.trim() === 'prettier-ignore') ||
			(element.parent?.kind === 'element' &&
				isProtectedByHTMLIgnore(element.parent))
		);
	}

	/**
	 * Finds an HTML ignore directive immediately before an element, without
	 * intervening whitespace. Excludes elements whose ancestors are protected
	 * by HTML ignore directives.
	 */
	function findAdjacentIgnoreDirective(
		element: HTMLElement
	): HTMLElement | undefined {
		const siblings = element.parent?.children ?? [];
		const previous = siblings[siblings.indexOf(element) - 1];

		return previous?.kind === 'comment' &&
			previous.value?.trim() === 'prettier-ignore' &&
			previous.sourceSpan.end.offset ===
				element.sourceSpan.start.offset &&
			!(
				element.parent?.kind === 'element' &&
				isProtectedByHTMLIgnore(element.parent)
			)
			? previous
			: undefined;
	}

	/**
	 * Reports an error when a closing tag can’t also close the elements
	 * directly inside it that keep omitted closing tags. The chain lists
	 * elements that close together, outermost first. Prettier’s HTML parser
	 * closes only some elements implicitly with an enclosing element, and a
	 * closing tag closes the innermost open element with its name.
	 */
	function checkClosingAround(
		chain: ReadonlyArray<HTMLElement>,
		keepsOmittedClosingTag: (element: HTMLElement) => boolean
	): void {
		for (const [index, element] of chain.entries()) {
			if (keepsOmittedClosingTag(element)) {
				continue;
			}

			const inside = chain
				.slice(index + 1)
				.findIndex((descendant) => !keepsOmittedClosingTag(descendant));
			const blocked = chain
				.slice(
					index + 1,
					inside === -1 ? undefined : index + 1 + inside
				)
				.find(
					(descendant) =>
						descendant.name === element.name ||
						!CLOSED_BY_PARENT_TAG_NAMES.has(descendant.name ?? '')
				);

			if (blocked) {
				reportUnsafeLayout({
					filepath: options.filepath,
					position: findFragment(
						parts,
						element.sourceSpan.start.offset
					)?.node.position?.start,
					reason: `The \`<${element.name}>\` element can’t close because an ignore directive prevents adding a closing tag to the \`<${blocked.name}>\` element inside it`,
				});
			}
		}
	}

	/**
	 * Supplies closing tags at a boundary, innermost first. Reports an error if
	 * closing an enclosing element would require adding a closing tag to an
	 * ignored element.
	 */
	function close(elements: HTMLElement[]): string {
		checkClosingAround(elements, isIgnored);

		// Ignored elements enclosing all elements that need closing tags stay
		// open at this boundary
		const firstClosed = elements.findIndex(
			(element) => !isIgnored(element)
		);
		const closed = firstClosed === -1 ? [] : elements.slice(firstClosed);

		for (const element of closed) {
			closedElements.add(element);
		}

		return closed
			.toReversed()
			.map((element) =>
				isIgnored(element)
					? marker.omitClosingTag(getSourceName(element))
					: getClosingTag(element)
			)
			.join('');
	}

	for (const [index, part] of parts.entries()) {
		const next = parts[index + 1];
		const following =
			next?.kind === 'marker' && next.isSeparator
				? parts[index + 2]
				: next;

		if (part.kind === 'fragment' && following?.kind === 'fragment') {
			// Closing tags follow the separator so they stay outside the
			// ignored fragment’s discarded formatted slice
			closingTags.set(
				scope.ignoredNodes.has(part.node) && following !== next
					? index + 1
					: index,
				close(
					findOpenElements(root, part.end, false).filter(
						(element) =>
							!containsOffset(element, following.start, false)
					)
				)
			);
		}
	}

	const end = parts.at(-1)!;
	const openAtEnd = findOpenElements(root, skeleton.text.length, true).slice(
		scope.ancestors.length
	);
	const isContext = (element: HTMLElement): boolean =>
		parts.some(
			(part) =>
				part.kind === 'context' &&
				part.start <= element.sourceSpan.start.offset &&
				element.sourceSpan.start.offset < part.end
		);

	if (end.kind === 'marker') {
		closingTags.set(
			parts.length - 2,
			(closingTags.get(parts.length - 2) ?? '') +
				close(openAtEnd.filter((element) => !isContext(element)))
		);
	}

	// Closing tags and omit markers, keyed by insertion offset in the skeleton.
	// Only marked closing tags and their markers are removed after formatting
	const omittedClosingTags = new Map<number, string>();

	const renamableFragments = new Map<FragmentPart, Set<number>>();

	// Prettier lowercases known HTML element names. If a Markdown ignore
	// directive protects only one tag, formatting can leave mismatched names.
	// The document context checks elements with at least one inline tag
	for (const element of findElements(root)) {
		const start = element.sourceSpan.start.offset;
		const opening = findFragment(parts, start);
		const closing =
			element.endSourceSpan &&
			findFragment(parts, element.endSourceSpan.start.offset);
		const sourceName = getSourceName(element);

		if (!opening || !closing || sourceName === element.name) {
			continue;
		}

		// An HTML ignore directive keeps both tags as the source spells them,
		// unless Prettier joins the opening tag to the directive
		if (isProtectedByHTMLIgnore(element)) {
			const directive = findAdjacentIgnoreDirective(element);

			// Prettier keeps tag spelling in preformatted content, which
			// `listDirectiveTargets` skips
			const index = directive
				? listDirectiveTargets(opening.text).findIndex(
						({ start }) =>
							start ===
							directive.sourceSpan.start.offset - opening.start
					)
				: -1;

			if (index !== -1 && !scope.ignoredNodes.has(opening.node)) {
				renamableFragments.set(
					opening,
					new Set([...(renamableFragments.get(opening) ?? []), index])
				);
			}

			continue;
		}

		if (
			scope.ignoredNodes.has(opening.node) !==
			scope.ignoredNodes.has(closing.node)
		) {
			reportChangedTagSpelling(sourceName, {
				filepath: options.filepath,
				position: opening.node.position?.start,
			});
		}
	}

	const omittedElements = findOmittedClosings(root, ignoredFragments);

	for (const element of omittedElements) {
		if (closedElements.has(element)) {
			continue;
		}

		// The enclosing elements that close together with this one
		const enclosing: HTMLElement[] = [];

		for (
			let ancestor = element.parent;
			ancestor?.kind === 'element' &&
			findTrailingOpenElements(ancestor).includes(
				enclosing[0] ?? element
			);
			ancestor = ancestor.parent
		) {
			enclosing.unshift(ancestor);
		}

		checkClosingAround(
			[
				// The skeleton closes the raw ancestors and context elements
				// outside the formatted fragments
				...enclosing.filter(
					(ancestor) =>
						!isContext(ancestor) &&
						getDepth(ancestor) >= scope.ancestors.length
				),
				element,
			],
			(candidate) => isIgnored(candidate) && !candidate.endSourceSpan
		);

		const trailingElements = findTrailingOpenElements(element);
		const textEnd = findContentEnd(
			trailingElements.at(-1) ?? element,
			skeleton.text
		);
		// When an element’s content ends before a part’s trailing whitespace,
		// its temporary closing tag follows the part and any closing tags added
		// at that boundary
		const contentEnd =
			parts.find(
				(part) =>
					'end' in part &&
					part.start <= textEnd &&
					textEnd < part.end &&
					!/\S/.test(skeleton.text.slice(textEnd, part.end))
			)?.end ?? textEnd;
		// The inner elements close first, so the temporary closing tag before
		// the omit marker closes only this element
		const trailingClosingTags = trailingElements
			.filter((trailing) => !closedElements.has(trailing))
			.toReversed()
			.map(getClosingTag)
			.join('');

		for (const closed of [...trailingElements, element]) {
			closedElements.add(closed);
		}

		// When an element’s content ends in an ignored fragment, printing that
		// fragment’s source already omits the closing tag Prettier adds
		if (
			!ignoredFragments.some(
				({ end, start }) => start <= contentEnd && contentEnd <= end
			)
		) {
			omittedClosingTags.set(
				contentEnd,
				(omittedClosingTags.get(contentEnd) ?? '') +
					trailingClosingTags +
					marker.omitClosingTag(getSourceName(element))
			);
		}
	}

	return {
		closingTags,
		contextClosingTags: openAtEnd
			.filter(isContext)
			.toReversed()
			.map(getClosingTag)
			.join(''),
		omittedClosingTags,
		renamableFragments,
	};
}

/**
 * Finds the fragment that contains an offset in the skeleton.
 */
function findFragment(
	parts: SkeletonPart[],
	offset: number
): FragmentPart | undefined {
	return parts.find(
		(part): part is FragmentPart =>
			part.kind === 'fragment' &&
			part.start <= offset &&
			offset < part.end
	);
}

/**
 * Counts the elements around an element in the skeleton.
 */
function getDepth(element: HTMLElement): number {
	let depth = 0;

	for (
		let ancestor = element.parent;
		ancestor?.kind === 'element';
		ancestor = ancestor.parent
	) {
		depth += 1;
	}

	return depth;
}

/**
 * Lists the trailing chain of elements with omitted closing tags, outermost
 * first. Whitespace-only text is skipped when finding each element’s last
 * child.
 */
function findTrailingOpenElements(element: HTMLElement): HTMLElement[] {
	const lastChild = element.children?.findLast(
		(child) => child.kind !== 'text' || /\S/.test(child.value ?? '')
	);

	return lastChild?.kind === 'element' &&
		!lastChild.isVoid &&
		!lastChild.endSourceSpan
		? [lastChild, ...findTrailingOpenElements(lastChild)]
		: [];
}

/**
 * Finds where an element’s content ends in the skeleton, after which Prettier
 * prints its closing tag. Trailing whitespace doesn’t count.
 */
function findContentEnd(element: HTMLElement, text: string): number {
	const lastChild = element.children?.findLast(
		(child) => child.kind !== 'text' || /\S/.test(child.value ?? '')
	);
	const { offset: start } = element.sourceSpan.start;
	const end = (lastChild ?? element).sourceSpan.end.offset;

	return start + text.slice(start, end).trimEnd().length;
}

/**
 * Lists the elements in a parsed skeleton, in document order.
 */
function findElements(root: HTMLElement): HTMLElement[] {
	const elements: HTMLElement[] = [];

	for (const child of root.children ?? []) {
		if (child.kind === 'element') {
			elements.push(child, ...findElements(child));
		}
	}

	return elements;
}

/**
 * Lists the elements that open in ignored fragments and close implicitly before
 * the end of the skeleton, innermost first. Their closing tags stay omitted.
 */
function findOmittedClosings(
	root: HTMLElement,
	ignoredFragments: ReadonlyArray<FragmentPart>
): HTMLElement[] {
	const elements: HTMLElement[] = [];

	/**
	 * Adds an element’s descendants before the element itself.
	 */
	function visit(element: HTMLElement): void {
		for (const child of element.children ?? []) {
			visit(child);
		}

		const start = element.sourceSpan.start.offset;

		if (
			element.kind === 'element' &&
			!element.isVoid &&
			!element.endSourceSpan &&
			!isLastOpenElement(element) &&
			ignoredFragments.some(
				(fragment) => fragment.start <= start && start < fragment.end
			)
		) {
			elements.push(element);
		}
	}

	visit(root);
	return elements;
}

/**
 * Lists the elements that remain open at an offset, outermost first.
 */
function findOpenElements(
	root: HTMLElement,
	offset: number,
	isEnd: boolean
): HTMLElement[] {
	const elements: HTMLElement[] = [];
	let element: HTMLElement | undefined = root;

	while (element) {
		const child: HTMLElement | undefined = element.children?.findLast(
			(candidate) => candidate.sourceSpan.start.offset < offset
		);

		element =
			child?.kind === 'element' &&
			!child.isVoid &&
			containsOffset(child, offset, isEnd)
				? child
				: undefined;

		if (element) {
			elements.push(element);
		}
	}

	return elements;
}

/**
 * Checks whether an element is open at an offset. An element without a closing
 * tag ends with its last child, or stays open to the end of the document when
 * nothing after it closes it.
 */
function containsOffset(
	element: HTMLElement,
	offset: number,
	isEnd: boolean
): boolean {
	if (element.endSourceSpan) {
		return element.endSourceSpan.start.offset >= offset;
	}

	return (
		findOpenElementEnd(element) > offset ||
		(isEnd && isLastOpenElement(element))
	);
}

/**
 * Finds where an element without a closing tag ends in the skeleton: after its
 * last child, which can lack a closing tag too.
 */
function findOpenElementEnd(element: HTMLElement): number {
	const lastChild = element.children?.at(-1);

	return lastChild?.kind === 'element' &&
		!lastChild.isVoid &&
		!lastChild.endSourceSpan
		? findOpenElementEnd(lastChild)
		: (lastChild ?? element).sourceSpan.end.offset;
}

/**
 * Checks whether an element without a closing tag stays open to the end of the
 * document, which happens when no later sibling closes it.
 */
function isLastOpenElement(element: HTMLElement): boolean {
	let current: HTMLElement | undefined = element;

	while (current?.parent) {
		const siblings: HTMLElement[] = current.parent.children ?? [];

		if (siblings.at(-1) !== current) {
			return false;
		}

		current =
			current.parent.kind === 'element' ? current.parent : undefined;
	}

	return true;
}

/**
 * Joins a skeleton’s parts into the HTML that Prettier formats, adding the
 * closing tags of implicitly closed elements after their parts and closing the
 * raw ancestors at the end.
 */
function renderSkeleton(
	scope: AST.BlockScope,
	skeleton: Skeleton,
	closingTags: ReadonlyMap<number, string>,
	omittedClosingTags: ReadonlyMap<number, string>,
	contextClosingTags: string
): string {
	const lines = skeleton.parts.map((part, index) => {
		let { text } = part;
		// The line break after a block belongs to the content of the elements
		// that stay open across it, so their closing tags follow on a new line
		let tags = closingTags.get(index) ?? '';

		for (const [offset, omitted] of [...omittedClosingTags].toSorted(
			([first], [second]) => second - first
		)) {
			// Inner elements close before the ignored elements around them
			if (offset === part.end) {
				tags += omitted;
			} else if (part.start < offset && offset < part.end) {
				const textOffset = offset - part.start;
				text =
					text.slice(0, textOffset) +
					omitted +
					text.slice(textOffset);
			}
		}

		return tags ? `${text}\n${tags}` : text;
	});

	if (scope.ancestors.length > 0) {
		lines.unshift(scope.ancestors.map((name) => `<${name}>`).join(''));
	}

	lines.push(
		contextClosingTags +
			scope.ancestors
				.toReversed()
				.map((name) => `</${name}>`)
				.join('')
	);

	return lines.join('\n');
}

/**
 * Builds the parts of the HTML that Prettier formats for a scope: its HTML
 * fragments and markers in place of the Markdown between them. Offsets refer to
 * the skeleton with the raw ancestors opened before the parts.
 */
function buildSkeleton(
	scope: AST.BlockScope,
	marker: Marker,
	brokenFragments: ReadonlySet<AST.HTMLNode>
): Skeleton {
	const parts: SkeletonPart[] = [];
	let text = scope.ancestors.map((name) => `<${name}>`).join('');
	let contextOpeners: AST.InlineOpener[] = [];
	let isInProtectedContent = false;

	/**
	 * Adds a part on a line of its own.
	 */
	function addLine(line: string): number {
		text += text ? '\n' : '';
		const start = text.length;
		text += line;
		return start;
	}

	/**
	 * Adds tags that keep the skeleton’s elements open or closed as inline HTML
	 * leaves them, followed by a separator. They don’t appear in the output.
	 */
	function addContext(tags: string): void {
		const start = addLine(tags);
		parts.push({ end: text.length, kind: 'context', start, text: tags });
		addMarker('comment', true);
	}

	/**
	 * Adds a marker for Markdown content or a fragment boundary, using plain
	 * text inside protected content.
	 */
	function addMarker(form: MarkerForm, isSeparator: boolean): void {
		const id = parts.length;
		const markerText = marker.create(
			id,
			isInProtectedContent ? 'text' : form
		);
		const start = addLine(markerText);
		parts.push({
			end: text.length,
			id,
			isSeparator,
			kind: 'marker',
			start,
			text: markerText,
		});
	}

	if (scope.ancestors.length > 0) {
		addMarker('comment', false);
	}

	let previous: AST.Node | undefined;

	/**
	 * Keeps closing tags outside an ignored fragment’s formatted slice, which
	 * is discarded in favor of its source.
	 */
	function addSeparatorAfterIgnored(): void {
		if (isFragment(scope, previous) && scope.ignoredNodes.has(previous)) {
			addMarker('comment', true);
		}
	}

	for (const child of scope.children) {
		if (isFragment(scope, child)) {
			// A complete comment needs no separator unless it matches an ignore
			// directive after trimming. The separator prevents Prettier’s HTML
			// printer from applying `prettier-ignore` to an element that spans
			// later fragments
			if (
				isFragment(scope, previous) &&
				(!isComment(previous.value) ||
					IGNORE_COMMENT_PATTERN.test(previous.value.trim()))
			) {
				addMarker('comment', true);
			}

			// Inline HTML before this block can close elements in the skeleton
			// or leave elements open when the block starts
			const openers = scope.inlineOpeners.get(child) ?? [];
			const kept = contextOpeners.filter(({ start }) =>
				openers.some((opener) => opener.start === start)
			);
			const added = openers.filter(
				({ start }) => !kept.some((opener) => opener.start === start)
			);
			const contextTags =
				(scope.inlineClosingTags.get(child) ?? []).join('') +
				added.map(({ name }) => `<${name}>`).join('');

			if (contextTags) {
				addContext(contextTags);
			}

			contextOpeners = [...kept, ...added];

			const source = getBlockSource(child);
			const line = brokenFragments.has(child)
				? marker.insertBreak(source)
				: source;
			const start = addLine(line);

			parts.push({
				end: text.length,
				kind: 'fragment',
				node: child,
				start,
				text: line,
			});
			isInProtectedContent = scope.protectedEnds.has(child);
		} else {
			addSeparatorAfterIgnored();
			addMarker(getGeneratedTagName(child, scope) ?? 'comment', false);
		}

		previous = child;
	}

	addSeparatorAfterIgnored();

	if (scope.trailingInlineClosingTags.length > 0) {
		addContext(scope.trailingInlineClosingTags.join(''));
	}

	addMarker('comment', false);

	return { parts, text };
}

/**
 * Checks whether HTML consists of one complete comment.
 */
function isComment(html: string): boolean {
	const comment = html.trim();
	return (
		comment.startsWith('<!--') &&
		comment.indexOf('-->', 4) === comment.length - 3
	);
}

type MarkerForm = 'comment' | 'text' | (string & {});

type Marker = {
	create: (id: number, form: MarkerForm) => string;
	find: (text: string) => Array<{ end: number; id: number; start: number }>;
	insertBreak: (html: string) => string;
	omitClosingTag: (name: string) => string;
	removeBreaks: (text: string) => string;
	removeOmittedClosingTags: (text: string) => string;
};

/**
 * Creates markers with an attribute name that doesn’t occur in the scope.
 */
function createMarker(scope: AST.BlockScope): Marker {
	const sourceText = scope.children
		.filter(isHTMLNode)
		.map(({ value }) => value)
		.join('\n');
	let name = 'data-prettier-markdown-html';

	while (sourceText.includes(name)) {
		name += '-';
	}

	// Markers contain no quotes, so they can stand inside a quoted attribute
	// value that spans several fragments. Prettier may break a marker’s tags
	// across lines when the print width is narrow
	const markerPattern = new RegExp(
		String.raw`<([a-z][a-z0-9]*)\s+${name}-(\d+)\s*(?:\/\s*)?>(?:\s*<\/\1\s*>)?|<!--${name}-(\d+)-->|(?<![\w-])${name}-text-(\d+)`,
		'g'
	);
	const breakPattern = new RegExp(
		String.raw`\n[\t ]*<div\s+${name}-break\s*>\s*<\/div\s*>(?=\n)|<div\s+${name}-break\s*>\s*<\/div\s*>`,
		'g'
	);
	const omittedClosingTagPattern = new RegExp(
		String.raw`\s*<\/[a-z][^\s/>]*\s*>\s*<!--${name}-omit-->`,
		'gi'
	);

	return {
		create(id, form) {
			if (form === 'comment') {
				return `<!--${name}-${id}-->`;
			}

			if (form === 'text') {
				return `${name}-text-${id}`;
			}

			return form === 'hr'
				? `<hr ${name}-${id} />`
				: `<${form} ${name}-${id}></${form}>`;
		},
		find(text) {
			return [...text.matchAll(markerPattern)].map((match) => ({
				end: match.index + match[0].length,
				id: Number(match[2] ?? match[3] ?? match[4]),
				start: match.index,
			}));
		},
		insertBreak(html) {
			const tagEnd = findTagEnd(html, html.search(/\S/));

			if (tagEnd === undefined) {
				return html;
			}

			// Keep the source’s line structure so Prettier preserves no extra
			// blank line around the break
			const rest = html.slice(tagEnd);
			return `${html.slice(0, tagEnd)}\n<div ${name}-break></div>${/^[\t ]*\n/.test(rest) ? '' : '\n'}${rest}`;
		},
		omitClosingTag(name_) {
			return `</${name_}><!--${name}-omit-->`;
		},
		removeBreaks(text) {
			return text.replaceAll(breakPattern, '');
		},
		removeOmittedClosingTags(text) {
			return text.replaceAll(omittedClosingTagPattern, '');
		},
	};
}

/**
 * Selects an element to represent a Markdown block when Prettier formats the
 * surrounding HTML.
 */
function getGeneratedTagName(
	node: AST.Node,
	scope: AST.BlockScope
): string | undefined {
	switch (node.type) {
		case 'blockquote':
			return 'blockquote';

		case 'code':

		case 'footnoteDefinition':
			return 'pre';

		case 'definition':

		case 'frontMatter':
			return undefined;

		case 'heading':
			return `h${(node as { depth?: number }).depth ?? 1}`;

		case 'list':
			return (node as { ordered?: boolean }).ordered ? 'ol' : 'ul';

		case 'paragraph':
			// Paragraphs in tight lists render as text without a wrapper
			return scope.isTight ? 'span' : 'p';

		case 'table':
			return 'table';

		case 'thematicBreak':
			return 'hr';

		default:
			return 'p';
	}
}

/**
 * Narrows the formatting width by the Markdown container prefixes that precede
 * each line of the scope.
 */
function getScopeOptions(
	scope: AST.BlockScope,
	options: ParserOptions
): ParserOptions {
	const { htmlFragmentPrintWidth, printWidth } = options;
	const width =
		typeof htmlFragmentPrintWidth === 'number'
			? htmlFragmentPrintWidth
			: printWidth;

	return {
		...options,
		htmlFragmentPrintWidth: undefined,
		printWidth: Math.max(width - scope.prefixWidth, 0),
	};
}

/**
 * Removes the line breaks that separate a fragment from its markers. The first
 * line moves to the container’s content edge unless its leading whitespace is
 * protected content.
 */
function trimFragment(
	text: string,
	isProtectedStart: boolean,
	isProtectedEnd: boolean
): string {
	let value = isProtectedStart
		? text.replace(/^\n/, '')
		: text.replace(/^\s+/, '');

	value = isProtectedEnd ? value.replace(/\n[\t ]*$/, '') : value.trimEnd();

	return value;
}

/**
 * Removes blank lines that Prettier adds inside a fragment, such as after an
 * implicitly closed list item. A blank line would end the HTML block. The
 * source includes trailing line breaks when the block remains open at the end
 * of its container. Blank lines in raw text and preformatted content, such as
 * embedded code that Prettier formats, belong to that content and stay.
 */
function removeAddedBlankLines(value: string, node: AST.HTMLNode): string {
	if (/\n[\t ]*\n/.test(node.value)) {
		return value;
	}

	const preservedRanges = findPreservedRanges(value);

	return value.replaceAll(/\n(?:[\t ]*\n)+/g, (blankLines, offset: number) =>
		preservedRanges.some(([start, end]) => start <= offset && offset < end)
			? blankLines
			: '\n'
	);
}

/**
 * Lists the ranges of raw text and preformatted element contents in formatted
 * HTML. Comments, other markup declarations, and attribute values can’t start
 * those ranges.
 */
function findPreservedRanges(html: string): Array<[number, number]> {
	return scanMarkup(html)
		.filter(({ kind }) => kind === 'preserved')
		.map(({ end, start }) => [start, end]);
}

/**
 * Lists HTML ignore directives outside preserved content in source order, with
 * the following opening tag’s name as written, or `undefined` if no opening tag
 * immediately follows.
 */
function listDirectiveTargets(
	html: string
): Array<{ name: string | undefined; start: number }> {
	const targets: Array<{ name: string | undefined; start: number }> = [];
	let directive: MarkupToken | undefined;

	for (const token of scanMarkup(html)) {
		if (directive) {
			targets.push({
				name:
					token.kind === 'tag' && token.start === directive.end
						? token.name
						: undefined,
				start: directive.start,
			});
			directive = undefined;
		}

		if (
			token.kind === 'comment' &&
			/^<!--\s*prettier-ignore\s*-->$/.test(
				html.slice(token.start, token.end)
			)
		) {
			directive = token;
		}
	}

	return directive
		? [...targets, { name: undefined, start: directive.start }]
		: targets;
}

/**
 * Scans HTML for comments, opening tags, other markup, and preserved raw text
 * and preformatted content, in source order. Quoted attribute values stay
 * within their tags. Ordinary text is skipped.
 */
function scanMarkup(html: string): MarkupToken[] {
	const tokens: MarkupToken[] = [];
	const tagNamePattern = /<([a-z][^\s/>]*)/iy;

	for (let index = html.indexOf('<'); index !== -1;) {
		tagNamePattern.lastIndex = index;
		const name = tagNamePattern.exec(html)?.[1];
		let next: number;

		if (html.startsWith('<!--', index)) {
			const commentEnd = html.indexOf('-->', index + 4);
			next = commentEnd === -1 ? html.length : commentEnd + 3;
			tokens.push({ end: next, kind: 'comment', start: index });
		} else if (html.startsWith('<![CDATA[', index)) {
			const sectionEnd = html.indexOf(']]>', index + 9);
			next = sectionEnd === -1 ? html.length : sectionEnd + 3;
			tokens.push({ end: next, kind: 'markup', start: index });
		} else if (name) {
			next = findTagEnd(html, index) ?? html.length;
			tokens.push({ end: next, kind: 'tag', name, start: index });
		} else if (/^<[!/?]/.test(html.slice(index, index + 2))) {
			// Declarations, processing instructions, and closing tags end at
			// the first `>`, regardless of quotes
			const markupEnd = html.indexOf('>', index);
			next = markupEnd === -1 ? html.length : markupEnd + 1;
			tokens.push({ end: next, kind: 'markup', start: index });
		} else {
			next = index + 1;
		}

		// Prettier’s parser closes self-closing tags of any element
		if (
			name &&
			(isRawTextTag(name) || name.toLowerCase() === 'pre') &&
			!html.slice(index, next).endsWith('/>')
		) {
			const closingTagPattern = new RegExp(
				String.raw`<\/${name}(?=[\s/>])`,
				'gi'
			);
			closingTagPattern.lastIndex = next;
			const end = closingTagPattern.exec(html)?.index ?? html.length;

			tokens.push({ end, kind: 'preserved', start: next });
			next = end;
		}

		index = html.indexOf('<', next);
	}

	return tokens;
}

/**
 * Checks whether a fragment needs Prettier’s expanded layout because its first
 * tag shares a line with content, which would turn the block into a paragraph.
 */
function needsExpandedLayout(
	scope: AST.BlockScope,
	node: AST.HTMLNode,
	value: string
): boolean {
	if (
		scope.protectedStarts.has(node) ||
		scope.ignoredNodes.has(node) ||
		!needsCompleteTagLine(value)
	) {
		return false;
	}

	const tagEnd = findTagEnd(value, 0);
	const firstLineEnd = value.indexOf('\n');

	return (
		tagEnd !== undefined &&
		/\S/.test(
			value.slice(tagEnd, firstLineEnd === -1 ? undefined : firstLineEnd)
		)
	);
}

/**
 * Checks whether the next node starts no later than the line after this node
 * ends, so no blank line separates them.
 */
function isAdjacent(node: AST.Node, next: AST.Node): boolean {
	const end = node.position?.end.line;
	const start = next.position?.start.line;

	return end !== undefined && start !== undefined && start <= end + 1;
}

/**
 * Finds content after a fragment that its formatted value would take in and
 * change by ending inside an HTML block that continues until a blank line. That
 * block takes in each sibling that Prettier prints on the next line. Returns
 * `markdown` if it would take in Markdown, `ignore-comment` if it would take in
 * a Prettier ignore comment, `html` if it would end partway through a block of
 * the HTML after it, or `undefined` if everything it takes in keeps its
 * reading.
 */
function findTakenInContent(
	scope: AST.BlockScope,
	node: AST.HTMLNode,
	values: ReadonlyMap<AST.HTMLNode, string>
): TakenInContent | undefined {
	// If the source fragment already ends in such a block, nothing follows it
	// on the next line
	if (
		!endsInContinuingBlock(values.get(node)!) ||
		endsInContinuingBlock(node.value)
	) {
		return undefined;
	}

	return findTakenInSiblings(scope, node, values);
}

/**
 * Keeps surrounding whitespace on a standalone ignore comment so Prettier’s
 * Markdown printer doesn’t treat it as a directive during this pass.
 */
function keepIgnoreCommentWhitespace(
	node: AST.HTMLNode,
	value: string
): string {
	const comment = node.value.trim();

	// With closing tags after it, the comment shares its HTML block and isn’t a
	// directive either way
	return !IGNORE_COMMENT_PATTERN.test(node.value) &&
		IGNORE_COMMENT_PATTERN.test(comment) &&
		value === comment
		? node.value
		: value;
}

/**
 * Finds following content that an HTML block left open at a node’s end would
 * change. For a closing node, the scan starts after the sibling it follows and
 * uses the closing node’s position for spacing checks.
 */
function findTakenInSiblings(
	scope: AST.BlockScope,
	node: AST.HTMLNode,
	values: ReadonlyMap<AST.HTMLNode, string>,
	sibling: AST.Node = node
): TakenInContent | undefined {
	let previous = node;

	for (const next of scope.children.slice(
		scope.children.indexOf(sibling) + 1
	)) {
		if (!isPrintedOnNextLine(scope, previous, next)) {
			return undefined;
		}

		if (!isFragment(scope, next)) {
			return 'markdown';
		}

		// Prettier’s Markdown printer honors an ignore comment only when it
		// occupies a separate HTML block, so taking one in would let Prettier
		// format the content it protects
		if (scope.activeIgnoreComments.has(next)) {
			return 'ignore-comment';
		}

		const reading = readTakenInHTML(values.get(next) ?? next.value);

		if (reading !== 'continues') {
			return reading === 'splits' ? 'html' : undefined;
		}

		previous = next;
	}

	return undefined;
}

/**
 * Reports an error when formatting would add HTML to the block of an ignore
 * comment that Prettier honors. Prettier recognizes the comment only as an HTML
 * block of its own.
 */
function checkIgnoreComment(
	scope: AST.BlockScope,
	node: AST.HTMLNode,
	value: string,
	options: ParserOptions
): void {
	if (value !== node.value && scope.activeIgnoreComments.has(node)) {
		reportUnsafeLayout({
			filepath: options.filepath,
			position: node.position?.start,
			reason: 'After formatting, this Prettier ignore comment would share its HTML block with other HTML, so Prettier would no longer recognize it',
		});
	}
}

/**
 * Checks whether Prettier’s Markdown printer puts a sibling on the line right
 * after an HTML node, without a blank line between them. Outside items printed
 * tight, `separateFromMarkdown` separates any Markdown siblings that the
 * printer would otherwise leave adjacent.
 */
function isPrintedOnNextLine(
	scope: AST.BlockScope,
	node: AST.HTMLNode,
	next: AST.Node
): boolean {
	return (
		scope.isPrintedTight || (next.type === 'html' && isAdjacent(node, next))
	);
}

/**
 * Separates HTML blocks from adjacent Markdown blocks by one blank line where
 * Prettier’s Markdown printer would otherwise keep them on adjacent lines:
 * after paragraphs and Liquid tags, and before Liquid tags and lists nested in
 * list items. Moving the later node’s start one line down makes the printer add
 * the blank line. Prettier ignores positions in items it prints tight, which
 * keeps tight lists tight.
 */
function separateFromMarkdown(
	scope: AST.BlockScope,
	children: AST.Node[]
): void {
	if (scope.isPrintedTight) {
		return;
	}

	for (const [index, node] of children.entries()) {
		const previous = children[index - 1];
		const previousEnd = previous?.position?.end.line;
		const start = node.position?.start;

		if (
			!previous ||
			previousEnd === undefined ||
			start?.line !== previousEnd + 1
		) {
			continue;
		}

		// Closing nodes count as HTML too
		const isAfterHTML =
			(isFragment(scope, previous) ||
				scope.formattedNodes.has(previous)) &&
			(node.type === 'liquidNode' ||
				(node.type === 'list' && scope.isListItem));
		const isBeforeHTML =
			(isFragment(scope, node) || scope.formattedNodes.has(node)) &&
			(previous.type === 'liquidNode' || previous.type === 'paragraph');

		if (isAfterHTML || isBeforeHTML) {
			node.position = {
				...node.position!,
				start: { ...start, line: start.line + 1 },
			};
		}
	}
}

/**
 * Joins the HTML block that a fragment’s formatted value leaves open onto the
 * preceding line, so it no longer takes in the content after it. Prettier
 * breaks lines only where whitespace is insignificant or present, so a space
 * replaces each line break. Only lines of closing tags join, as other lines can
 * hold text, embedded code, or attribute values.
 */
function endBlockOnLastLine(
	node: AST.HTMLNode,
	value: string,
	takenIn: TakenInContent,
	options: ParserOptions
): string {
	const lines = value.split('\n');
	const start = findBlockStartLines(value).at(-1) ?? 0;
	const previousLine = lines[start - 1];

	// After a blank line, the joined line would still start a block
	if (
		previousLine === undefined ||
		/^[\t ]*$/.test(previousLine) ||
		!lines
			.slice(start)
			.every((line) => CLOSING_TAGS_LINE_PATTERN.test(line))
	) {
		reportUnsafeLayout({
			filepath: options.filepath,
			position: node.position?.start,
			reason: `After formatting, this HTML block would remain open in GitHub Flavored Markdown and ${TAKEN_IN_CONSEQUENCES[takenIn]}`,
		});
	}

	return [
		...lines.slice(0, start - 1),
		[previousLine, ...lines.slice(start).map((line) => line.trim())].join(
			' '
		),
	].join('\n');
}

/**
 * Moves the later lines that start HTML blocks within a fragment to the content
 * edge, as for the first line of a fragment. A comment or similar token can end
 * its block on its first line, so the next line starts another block.
 */
function alignBlockStarts(value: string): string {
	const lines = value.split('\n');
	let index = findNonBlockLine(value);

	// Indentation of four columns or more would turn the line into indented
	// code
	while (index !== undefined && index > 0) {
		const line = lines[index]!.trimStart();

		if (line === lines[index]) {
			break;
		}

		lines[index] = line;
		index = findNonBlockLine(lines.join('\n'));
	}

	for (const start of findBlockStartLines(lines.join('\n'))) {
		if (start > 0) {
			lines[start] = lines[start]!.trimStart();
		}
	}

	return lines.join('\n');
}

/**
 * Rejoins brackets that Prettier puts on lines of their own to the ends of
 * their tags where the HTML would otherwise stop reading as HTML blocks. A lone
 * `>` after a comment that ends its block can start a block quote.
 */
function rejoinBrackets(value: string): string {
	const lines = value.split('\n');
	let index = findNonBlockLine(value);

	while (index !== undefined && index > 0) {
		const bracket = /^[\t ]*(\/?>)$/.exec(lines[index]!)?.[1];

		if (!bracket) {
			break;
		}

		lines.splice(
			index - 1,
			2,
			lines[index - 1] + (bracket === '/>' ? ' />' : '>')
		);
		index = findNonBlockLine(lines.join('\n'));
	}

	return lines.join('\n');
}

/**
 * Keeps the first tag of a block on one physical line when GFM recognizes the
 * block only by a complete tag on its first line.
 */
function joinFirstTag(value: string): string {
	if (!needsCompleteTagLine(value)) {
		return value;
	}

	const tagEnd = findTagEnd(value, 0);
	const firstLineEnd = value.indexOf('\n');

	if (tagEnd === undefined || firstLineEnd === -1 || tagEnd <= firstLineEnd) {
		return value;
	}

	const tag = value.slice(0, tagEnd);
	let joined = '';
	let quote: string | undefined;

	for (const character of tag) {
		if (quote) {
			joined += character;
			quote = character === quote ? undefined : quote;
		} else if (/\s/.test(character)) {
			joined += joined.endsWith(' ') ? '' : ' ';
		} else {
			joined += character;
			quote =
				character === '"' || character === "'" ? character : undefined;
		}
	}

	if (joined.includes('\n')) {
		return value;
	}

	return joined.replace(/ (?=>$)/, '') + value.slice(tagEnd);
}

/**
 * Reports an error when the reference renderer doesn’t recognize a non-ignored
 * HTML block found by Prettier’s Markdown parser.
 */
export function checkSourceBlocks(
	scope: Pick<AST.BlockScope, 'blockFragments' | 'children' | 'ignoredNodes'>,
	options: ParserOptions
): void {
	for (const [index, child] of scope.children.entries()) {
		if (
			isHTMLNode(child) &&
			scope.blockFragments.has(child) &&
			!scope.ignoredNodes.has(child)
		) {
			checkSourceBlock(child, scope.children[index - 1], options);
		}
	}
}

/**
 * Reports an error when the reference renderer doesn’t recognize an HTML block
 * found by Prettier’s Markdown parser, including one that interrupts a
 * paragraph only for Prettier.
 */
function checkSourceBlock(
	node: AST.HTMLNode,
	previous: AST.Node | undefined,
	options: ParserOptions
): void {
	const source = getBlockSource(node);
	const previousEnd = previous?.position?.end.line;
	const interruptsParagraph =
		previous?.type === 'paragraph' &&
		previousEnd !== undefined &&
		node.position?.start.line === previousEnd + 1;

	if (
		!isHTMLBlockSequence(source, source) ||
		(interruptsParagraph &&
			!canInterruptParagraph(source.split('\n', 1)[0]!))
	) {
		reportUnsupportedMarkdown({
			filepath: options.filepath,
			position: node.position?.start,
			reason: interruptsParagraph
				? 'Prettier’s Markdown parser starts an HTML block here, but GitHub Flavored Markdown continues the paragraph above'
				: 'Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown',
		});
	}
}

/**
 * Reports an error if formatted HTML no longer forms HTML blocks. An open block
 * must retain the source’s end condition unless the end of its container also
 * ends the block.
 */
function checkHTMLBlocks(
	node: AST.HTMLNode,
	value: string,
	canStayOpen: boolean,
	options: ParserOptions
): void {
	// A block left open at the end of the document or a block quote can’t
	// include following Markdown. In a list item, it can change how the item is
	// parsed
	const isOnlyLeftOpen = isHTMLBlockSequence(value, value);

	if (
		!isHTMLBlockSequence(value, node.value) &&
		!(isOnlyLeftOpen && canStayOpen)
	) {
		reportUnsafeLayout({
			filepath: options.filepath,
			position: node.position?.start,
			// The layout still forms HTML blocks but leaves one open with an
			// end condition that the source doesn’t share
			reason: isOnlyLeftOpen
				? 'After formatting, this HTML block would remain open in GitHub Flavored Markdown and include the Markdown that follows'
				: 'After formatting, GitHub Flavored Markdown would no longer recognize this as an HTML block, and some of its content would be interpreted as Markdown',
		});
	}
}

/**
 * Reports an error when Prettier’s HTML output loses the place of the Markdown
 * between a scope’s HTML blocks.
 */
function reportMisplacedMarkdown(
	scope: AST.BlockScope,
	options: ParserOptions
): never {
	reportUnsafeLayout({
		filepath: options.filepath,
		position: scope.children.find(isHTMLNode)?.position?.start,
		reason: 'The plugin can’t restore the Markdown between these HTML blocks to its original place after Prettier formats the HTML',
	});
}

/**
 * Creates an HTML node for closing tags that Prettier supplies after an ignored
 * fragment or at the end of a container.
 */
function createClosingNode(
	scope: AST.BlockScope,
	previous: AST.Node | undefined,
	closingTags: string
): AST.HTMLNode {
	const end = previous?.position?.end;
	const node: AST.HTMLNode = {
		position: end ? { end, start: end } : undefined,
		type: 'html',
		value: closingTags,
	};

	scope.formattedNodes.add(node);

	return node;
}

/**
 * Checks whether an HTML node is recorded as a block fragment in the document
 * context. Prettier’s other HTML blocks are left to its Markdown formatter.
 */
function isFragment(
	scope: AST.BlockScope,
	node: AST.Node | undefined
): node is AST.HTMLNode {
	return isHTMLNode(node) && scope.blockFragments.has(node);
}

/**
 * Recognizes HTML nodes with source text that can be formatted.
 */
function isHTMLNode(node: AST.Node | undefined): node is AST.HTMLNode {
	return node?.type === 'html' && typeof node.value === 'string';
}
