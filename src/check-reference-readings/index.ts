import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import formatMarkdown from '../format-markdown/index.ts';
import {
	getDelimiterRowChecks,
	getRestOfLine,
	leavesFenceOpenBeforeHTML,
	renderReading,
} from '../render-document-context/index.ts';
import {
	reportUnsafeLayout,
	reportUnsupportedMarkdown,
} from '../report-error/index.ts';
import sliceMarkdownSource from '../slice-markdown-source/index.ts';

// Names of the constructs that only Prettier’s Markdown parser recognizes
const CONSTRUCT_NAMES: Readonly<Record<string, string>> = {
	footnoteDefinition: 'footnote definition',
	frontMatter: 'frontmatter',
	inlineMath: 'math',
	liquidNode: 'Liquid tag',
	math: 'math',
	wikiLink: 'wiki link',
};

/**
 * Reports an error when Prettier’s formatting changes the reference reading of
 * a construct that only its Markdown parser recognizes. Readings inside
 * protected content or raw elements are compared in full, with whitespace runs
 * collapsed outside `<pre>` elements. Otherwise, the comparison covers only raw
 * HTML and the tags generated around it, and runs only when raw HTML is present
 * before or after formatting.
 *
 * First, it reports an error for a paragraph, heading, or table with raw HTML
 * syntax that an ignore directive doesn’t protect, if a later content line has
 * the syntax of a table delimiter row. With `proseWrap` set to `always`, the
 * same applies to a paragraph or setext heading that starts with a possible
 * link reference definition, which a line break could complete, and to a word
 * that wrapping could move to the start of a line, where it could open another
 * Markdown block. A word that would open an HTML block there is enough on its
 * own. Prettier keeps each line’s words with `preserve`. With `never`, it joins
 * soft line breaks and keeps hard ones, so a word can start a line only where
 * it already does in the source.
 */
export default async function checkReferenceReadings(
	context: AST.DocumentContext,
	protectedRanges: ReadonlyArray<AST.ProtectedRange>,
	readingContainers: ReadonlyMap<AST.Node, string>,
	isIgnored: (node: AST.Node) => boolean,
	options: ParserOptions
): Promise<void> {
	for (const { block, findWrapHazards, line } of getDelimiterRowChecks(
		context
	)) {
		if (isIgnored(block)) {
			continue;
		}

		if (line) {
			reportUnsupportedMarkdown({
				filepath: options.filepath,
				position: line,
				reason: 'Prettier’s Markdown parser and GitHub Flavored Markdown can disagree on whether this line starts a table, which would change the context of nearby HTML or HTML-like markup',
			});
		}

		const hazards =
			options.proseWrap === 'always' ? findWrapHazards() : undefined;

		if (hazards?.definition) {
			reportUnsupportedMarkdown({
				filepath: options.filepath,
				position: hazards.definition,
				reason: 'With `proseWrap` set to `always`, a line break that Prettier adds can complete a link reference definition that starts here, which would change the context of nearby HTML or HTML-like markup',
			});
		}

		if (hazards?.word) {
			reportUnsupportedMarkdown({
				filepath: options.filepath,
				position: hazards.word,
				reason: 'With `proseWrap` set to `always`, Prettier can move this word to the start of a line, where it can open another Markdown block and change the context of nearby HTML or HTML-like markup',
			});
		}
	}

	const parserName = options.parser === 'remark' ? 'remark' : 'markdown';

	for (const { end, hasRawHTML, node, start } of context.readings) {
		// A comment or other protected content wholly inside the reading is
		// already covered by the raw HTML comparison
		const range = protectedRanges.find(
			(protectedRange) =>
				(protectedRange.start <= start && start < protectedRange.end) ||
				(protectedRange.start < end && end <= protectedRange.end)
		);
		const container = range?.description ?? readingContainers.get(node);

		const source = sliceMarkdownSource(
			options.originalText,
			node,
			context.enclosingContainers.get(node)
		)?.text;

		if (source === undefined || !node.type || isIgnored(node)) {
			continue;
		}

		// Prettier prints inline math as written, while formatting it alone
		// could read it as block math
		const formatted =
			node.type === 'inlineMath'
				? source
				: await formatMarkdown(`${source}\n`, options, {
						printWidth:
							options.printWidth -
							node.position!.start.column +
							1,
					});

		const name = CONSTRUCT_NAMES[node.type]!;

		// Formatting can leave a fence open, as when it changes the indentation
		// of a YAML block scalar. Prettier prints inline math as written, but
		// wrapping can break its last line at the first space after it. As a
		// conservative bound, its later lines in a container can lose all their
		// indentation when Prettier reindents the container
		const rest = getRestOfLine(options.originalText, node);
		const keptRest =
			options.proseWrap === 'always' ? rest.split(/[\t ]/, 1)[0] : rest;
		const lines = context.enclosingContainers.get(node)?.length
			? source.replaceAll(/\n[\t ]+/g, '\n')
			: source;
		const fenceText =
			node.type === 'inlineMath'
				? `${lines}${keptRest}`
				: `${formatted.trimEnd()}${rest}`;

		if (
			leavesFenceOpenBeforeHTML(
				node,
				fenceText,
				options.originalText,
				parserName
			)
		) {
			reportUnsupportedMarkdown({
				filepath: options.filepath,
				position: node.position?.start,
				reason: `Formatting this ${name} can leave a code fence in it open, so later raw HTML can render as code`,
			});
		}

		const before = renderReading(node.type, source, parserName);
		const after = renderReading(node.type, formatted.trimEnd(), parserName);

		// Raw HTML that formatting adds to the reading would be formatted on
		// the next pass
		if (!container && !hasRawHTML && after.fragments.length === 0) {
			continue;
		}

		const describe = container ? describeRendering : describeHTML;

		if (describe(before) !== describe(after)) {
			reportUnsafeLayout({
				filepath: options.filepath,
				position: node.position?.start,
				reason: container
					? `Formatting this ${name} would change the content of the ${container} that contains it`
					: `Formatting this ${name} would change how GitHub Flavored Markdown renders the raw HTML in it`,
			});
		}
	}
}

/**
 * Describes the raw HTML in a rendering and the tags generated around it,
 * leaving out other text. Whitespace runs in the raw HTML collapse.
 */
function describeHTML(context: AST.DocumentContext): string {
	let description = '';
	let offset = 0;

	for (const { end, start } of context.fragments) {
		description += findTags(context.html.slice(offset, start));
		description += context.html.slice(start, end).replaceAll(/\s+/g, ' ');
		offset = end;
	}

	return description + findTags(context.html.slice(offset));
}

/**
 * Describes a rendering with whitespace runs collapsed outside `<pre>`
 * elements.
 */
function describeRendering(context: AST.DocumentContext): string {
	return context.html
		.split(/(<pre[\s>][\s\S]*?<\/pre>)/)
		.map((part, index) =>
			index % 2 === 1 ? part : part.replaceAll(/\s+/g, ' ')
		)
		.join('');
}

/**
 * Joins the tags in rendered HTML, leaving out the text between them.
 */
function findTags(html: string): string {
	return html.match(/<[^>]*>/g)?.join('') ?? '';
}
