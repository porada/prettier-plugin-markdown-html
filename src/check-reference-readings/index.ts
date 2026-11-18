import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import formatMarkdown from '../format-markdown/index.ts';
import {
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
 */
export default async function checkReferenceReadings(
	context: AST.DocumentContext,
	protectedRanges: ReadonlyArray<AST.ProtectedRange>,
	readingContainers: ReadonlyMap<AST.Node, string>,
	isIgnored: (node: AST.Node) => boolean,
	options: ParserOptions
): Promise<void> {
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

		const name = CONSTRUCT_NAMES[node.type] ?? 'Markdown';

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
