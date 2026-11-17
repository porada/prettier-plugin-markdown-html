import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import formatMarkdown from '../format-markdown/index.ts';
import { renderReading } from '../render-document-context/index.ts';
import { reportUnsafeLayout } from '../report-error/index.ts';
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
 * Reports an error when Prettier’s formatting of a construct that only its
 * Markdown parser recognizes would change how GFM renders the construct’s
 * source. The comparison collapses whitespace runs outside `<pre>` elements.
 */
export default async function checkReferenceReadings(
	context: AST.DocumentContext,
	isIgnored: (node: AST.Node) => boolean,
	options: ParserOptions
): Promise<void> {
	const parserName = options.parser === 'remark' ? 'remark' : 'markdown';

	for (const node of context.readings) {
		const source = sliceMarkdownSource(
			options.originalText,
			node,
			context.enclosingContainers.get(node)
		)?.text;

		if (source === undefined || !node.type || isIgnored(node)) {
			continue;
		}

		const formatted = await formatMarkdown(`${source}\n`, options, {
			printWidth: options.printWidth - node.position!.start.column + 1,
		});

		if (
			normalize(renderReading(node.type, source, parserName)) !==
			normalize(renderReading(node.type, formatted.trimEnd(), parserName))
		) {
			reportUnsafeLayout({
				filepath: options.filepath,
				position: node.position?.start,
				reason: `Formatting this ${CONSTRUCT_NAMES[node.type] ?? 'Markdown'} would change how GitHub Flavored Markdown renders it`,
			});
		}
	}
}

/**
 * Collapses whitespace runs outside `<pre>` elements for the rendering
 * comparison.
 */
function normalize(html: string): string {
	return html
		.split(/(<pre[\s>][\s\S]*?<\/pre>)/)
		.map((part, index) =>
			index % 2 === 1 ? part : part.replaceAll(/\s+/g, ' ')
		)
		.join('');
}
