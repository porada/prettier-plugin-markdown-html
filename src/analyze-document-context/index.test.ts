import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import * as pluginHTML from 'prettier/plugins/html';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, onTestFinished, test, vi } from 'vite-plus/test';
import renderDocumentContext from '../render-document-context/index.ts';
import analyzeDocumentContext, { getMarkdownPosition } from './index.ts';

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

test('lists each Markdown construct in or around protected content once', async () => {
	const { analysis, root } = await analyze(`<div><pre>

foo <textarea>bar</textarea>

</pre>
</div>

baz <textarea>qux</textarea>
`);
	const inside = root.children[1]!;
	const around = root.children[3]!;

	expect(analysis.protectedMarkdown).toStrictEqual([
		{
			containers: [],
			description: '`<pre>` element',
			isEnclosing: false,
			node: inside,
			position: inside.position?.start,
		},
		{
			containers: [],
			description: '`<textarea>` element',
			isEnclosing: true,
			node: around,
			position: { column: 5, line: 8 },
		},
	]);
});

test('excludes void elements from the elements that inline HTML leaves open', async () => {
	const { analysis, root } = await analyze(
		'- foo <br> <span>\n  <div>bar</div>\n  </span>\n'
	);
	const block = root.children[0]!.children![0]!.children![1]!;

	expect([...analysis.inlineOpenersByFragment]).toStrictEqual([
		[block, [{ name: 'span', start: 18 }]],
	]);
});

test('rejects HTML at its position in the Markdown', async () => {
	await expect(analyze('foo\n\n<div><span></div>\n')).rejects
		.toThrowErrorMatchingInlineSnapshot(`
		[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML in \`foo.md\` (3:12):

		This \`</div>\` tag doesn’t match the \`<span>\` element that is still open]
	`);
});

test('rejects unclosed CDATA sections at their position in the Markdown', async () => {
	await expect(analyze('foo\n\n<![CDATA[ bar\n')).rejects
		.toThrowErrorMatchingInlineSnapshot(`
		[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML in \`foo.md\` (3:1):

		This CDATA section isn’t closed before the end of the document]
	`);
});

test('maps errors at the end of the document context to the end of the Markdown', async () => {
	await expect(analyze('<div>&#x\n')).rejects
		.toThrowErrorMatchingInlineSnapshot(`
		[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML in \`foo.md\` (2:1):

		Unable to parse entity "&#x]
	`);
});

test('reports non-error parser failures without a position', async () => {
	const parse = vi.spyOn(pluginHTML.parsers.html, 'parse');
	onTestFinished(() => {
		parse.mockRestore();
	});
	parse.mockRejectedValue('foo');

	await expect(analyze('<div></div>\n')).rejects
		.toThrowErrorMatchingInlineSnapshot(`
		[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML in \`foo.md\`:

		foo]
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

test('reports the start of later HTML block lines without the Markdown source', async () => {
	const text = '<div>\n  foo</div>\n';
	const context = renderDocumentContext(await parseMarkdown(text));
	const offset = context.html.indexOf('</div>');

	expect(
		getMarkdownPosition({ ...context, source: text }, offset)
	).toStrictEqual({ column: 6, line: 2 });
	expect(getMarkdownPosition(context, offset)).toStrictEqual({
		column: 1,
		line: 2,
	});
});

test('returns `undefined` without source positions', async () => {
	const root = await parseMarkdown('<div></div>\n\nfoo\n');

	for (const child of root.children) {
		child.position = undefined;
	}

	const context = renderDocumentContext(root);

	expect(getMarkdownPosition(context, 0)).toBeUndefined();
	expect(
		getMarkdownPosition(context, context.html.indexOf('foo'))
	).toBeUndefined();
});
