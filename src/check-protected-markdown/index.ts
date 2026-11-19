import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import * as pluginHTML from 'prettier/plugins/html';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import formatHTML from '../format-html/index.ts';
import formatMarkdown from '../format-markdown/index.ts';
import isRawTextTag from '../is-raw-text-tag/index.ts';
import renderDocumentContext from '../render-document-context/index.ts';
import { reportUnsafeLayout } from '../report-error/index.ts';
import sliceMarkdownSource from '../slice-markdown-source/index.ts';

type HTMLNode = {
	children?: HTMLNode[];
	endSourceSpan?: { start: { offset: number } } | undefined;
	kind: string;
	name?: string;
	sourceSpan: { end: { offset: number }; start: { offset: number } };
	startSourceSpan?: { end: { offset: number } };
};

const PRESERVED_WHITESPACE_TAG_NAMES = new Set(['listing', 'plaintext', 'pre']);

/**
 * Reports an error when formatting Markdown would change protected content in
 * the rendered HTML.
 */
export default async function checkProtectedMarkdown(
	protectedMarkdown: ReadonlyArray<AST.ProtectedMarkdown>,
	isIgnored: (node: AST.Node) => boolean,
	options: ParserOptions
): Promise<void> {
	const parserName = options.parser === 'remark' ? 'remark' : 'markdown';

	for (const {
		containers,
		description,
		isEnclosing,
		node,
		position,
	} of protectedMarkdown) {
		const source = sliceMarkdownSource(
			options.originalText,
			node,
			containers
		)?.text;

		if (source === undefined || isIgnored(node)) {
			continue;
		}

		// Markdown container prefixes narrow the lines of the construct
		const formatted = await formatMarkdown(source, options, {
			printWidth: options.printWidth - node.position!.start.column + 1,
		});

		if (formatted.trimEnd() === source.trimEnd()) {
			continue;
		}

		const before = renderMarkdown(source, parserName);
		const after = renderFormattedMarkdown(formatted, parserName);

		// A construct around protected content may change elsewhere
		const isChanged =
			after === undefined ||
			(isEnclosing
				? !(await hasSameProtectedContent(
						before,
						after,
						options,
						position
					))
				: before !== after);

		if (isChanged) {
			reportUnsafeLayout({
				filepath: options.filepath,
				position,
				reason: `Formatting this Markdown would change the content of the ${description} that contains it`,
			});
		}
	}
}

/**
 * Renders Markdown as the reference renderer does.
 */
function renderMarkdown(
	text: string,
	parserName: 'markdown' | 'remark'
): string {
	const root = pluginMarkdown.parsers[parserName].parse(text, {
		originalText: text,
	} as ParserOptions) as AST.RootNode;

	return renderDocumentContext(root, {
		checksInlineSyntax: false,
		parserName,
		source: text,
	}).html;
}

/**
 * Renders formatted Markdown as the reference renderer does. Returns
 * `undefined` if formatting created Markdown that the plugin can’t render,
 * which counts as a change.
 */
function renderFormattedMarkdown(
	text: string,
	parserName: 'markdown' | 'remark'
): string | undefined {
	try {
		return renderMarkdown(text, parserName);
	} catch {
		return undefined;
	}
}

/**
 * Checks whether two renderings have the same protected content, either
 * directly or after Prettier’s HTML normalization, which can change raw content
 * that Prettier doesn’t protect, such as whitespace-only bodies and `title`
 * text. Renderings that don’t parse as HTML must match exactly.
 */
async function hasSameProtectedContent(
	before: string,
	after: string,
	options: ParserOptions,
	position: AST.Point | undefined
): Promise<boolean> {
	const beforeContent = await readProtectedContent(before);
	const afterContent = await readProtectedContent(after);

	if (beforeContent === undefined || afterContent === undefined) {
		return before === after;
	}

	if (beforeContent === afterContent) {
		return true;
	}

	const normalizationOptions = {
		...options,
		embeddedLanguageFormatting: 'off',
		htmlFragmentEmbeddedLanguageFormatting: 'off',
	} as const;

	return (
		(await readProtectedContent(
			await formatHTML(before, normalizationOptions, position)
		)) ===
		(await readProtectedContent(
			await formatHTML(after, normalizationOptions, position)
		))
	);
}

/**
 * Lists the protected content of rendered HTML: comments, CDATA sections, raw
 * text, and preformatted content. Returns `undefined` if the HTML doesn’t
 * parse.
 */
async function readProtectedContent(html: string): Promise<string | undefined> {
	let root: HTMLNode;

	try {
		root = (await pluginHTML.parsers.html.parse(html, {
			parser: 'html',
		} as ParserOptions)) as HTMLNode;
	} catch {
		return undefined;
	}

	const contents: string[] = [];
	const pending = [root];

	while (pending.length > 0) {
		const node = pending.shift()!;
		const name = node.name?.toLowerCase() ?? '';

		if (node.kind === 'comment' || node.kind === 'cdata') {
			contents.push(
				html.slice(
					node.sourceSpan.start.offset,
					node.sourceSpan.end.offset
				)
			);
		} else if (
			node.kind === 'element' &&
			(isRawTextTag(name) || PRESERVED_WHITESPACE_TAG_NAMES.has(name))
		) {
			// The content of an unclosed element runs to the end
			contents.push(
				html.slice(
					node.startSourceSpan!.end.offset,
					node.endSourceSpan?.start.offset
				)
			);
			continue;
		}

		pending.unshift(...(node.children ?? []));
	}

	return JSON.stringify(contents);
}
