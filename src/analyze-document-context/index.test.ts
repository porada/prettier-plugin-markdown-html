import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test } from 'vite-plus/test';
import renderDocumentContext from '../render-document-context/index.ts';
import analyzeDocumentContext from './index.ts';

const OPTIONS = { filepath: 'foo.md' } as ParserOptions;

async function parseMarkdown(text: string): Promise<AST.RootNode> {
	return (await pluginMarkdown.parsers.markdown.parse(text, {
		originalText: text,
	} as never)) as AST.RootNode;
}

async function analyze(text: string): Promise<{
	analysis: AST.DocumentAnalysis;
	root: AST.RootNode;
}> {
	const root = await parseMarkdown(text);
	const analysis = await analyzeDocumentContext(
		renderDocumentContext(root, { source: text }),
		OPTIONS
	);

	return { analysis, root };
}

test('lists the raw elements that enclose each Markdown container', async () => {
	const { analysis, root } = await analyze(`<section><div>

> foo

</div>

- bar

</section>
`);
	const blockquote = root.children[1]!;
	const list = root.children[3]!;

	expect(analysis.rawAncestorsByContainer.get(blockquote)).toStrictEqual([
		'section',
		'div',
	]);
	expect(analysis.rawAncestorsByContainer.get(list)).toStrictEqual([
		'section',
	]);
	expect(
		analysis.rawAncestorsByContainer.get(list.children![0]!)
	).toStrictEqual(['section']);
});

test('marks fragments that start or end inside protected content', async () => {
	const { analysis, root } = await analyze(`<div><pre>
foo

bar

  <div>baz</div>
</pre></div>
`);
	const [opening, , closing] = root.children as AST.HTMLNode[];

	expect(analysis.protectedEnds.has(opening!)).toBe(true);
	expect(analysis.protectedStarts.has(opening!)).toBe(false);
	expect(analysis.protectedStarts.has(closing!)).toBe(true);
	expect(analysis.protectedEnds.has(closing!)).toBe(false);
});

test('rejects HTML at its position in the Markdown', async () => {
	await expect(analyze('foo\n\n<div><span></div>\n')).rejects
		.toThrowErrorMatchingInlineSnapshot(`
		[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML in \`foo.md\` (3:12):

		This \`</div>\` tag doesn’t match the \`<span>\` element that is still open]
	`);
});

test('rejects HTML tokens that take in part of a generated element', async () => {
	await expect(analyze('> <!-- foo\n\n<div>-->\n')).rejects
		.toThrowErrorMatchingInlineSnapshot(`
		[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML in \`foo.md\` (1:3):

		This comment starts inside the block quote and continues past its end]
	`);
});

test('rejects raw HTML that closes a generated element early', async () => {
	await expect(analyze('- foo <li>bar\n')).rejects
		.toThrowErrorMatchingInlineSnapshot(`
		[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML in \`foo.md\` (1:1):

		Raw HTML implicitly closes this list item before its Markdown content ends]
	`);
});

test('accepts generated elements inside HTML tokens', async () => {
	const { analysis, root } = await analyze(
		'<div></div>\n<!-- foo\n\n**bar**\n\n<div>baz -->\n'
	);
	const closing = root.children[2] as AST.HTMLNode;

	expect([...analysis.protectedStarts]).toStrictEqual([closing]);
});
