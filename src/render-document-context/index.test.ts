import type { AST } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test } from 'vite-plus/test';
import renderDocumentContext from './index.ts';

async function parseMarkdown(text: string): Promise<AST.RootNode> {
	return (await pluginMarkdown.parsers.markdown.parse(text, {
		originalText: text,
	} as never)) as AST.RootNode;
}

test('renders Markdown as the reference renderer does', async () => {
	const source = `# foo

> - [x] bar
> - baz

1. *qux* **quux** ~~corge~~ \`grault\` [garply](waldo) ![fred](plugh)

| xyzzy |
| :-- |
| thud |

\`\`\`js
foo
\`\`\`

***
`;
	const root = await parseMarkdown(source);

	const context = renderDocumentContext(root, { source });

	// Captured from
	// `cmark-gfm --unsafe -e autolink -e strikethrough -e table -e tasklist` at
	// the reference version
	expect(context.html).toBe(`<h1>foo</h1>
<blockquote>
<ul>
<li>[x] bar</li>
<li>baz</li>
</ul>
</blockquote>
<ol>
<li><em>qux</em> <strong>quux</strong> <del>corge</del> <code>grault</code> <a href="waldo">garply</a> <img src="plugh" alt="fred" /></li>
</ol>
<table>
<thead>
<tr>
<th align="left">xyzzy</th>
</tr>
</thead>
<tbody>
<tr>
<td align="left">thud</td>
</tr>
</tbody>
</table>
<pre><code class="language-js">foo
</code></pre>
<hr />
`);
});

test('records where raw HTML fragments appear', async () => {
	const source = `<div>
foo
</div>

bar <b>baz</b>

## qux <i>quux</i>

| corge |
| --- |
| <span title="grault\\|garply">waldo</span> |
`;
	const root = await parseMarkdown(source);

	const context = renderDocumentContext(root, { source });

	expect(
		context.fragments.map(
			({ end, isBlock, isInTableCell, isSingleLine, start }) => ({
				html: context.html.slice(start, end),
				isBlock,
				isInTableCell,
				isSingleLine,
			})
		)
	).toStrictEqual([
		{
			html: '<div>\nfoo\n</div>',
			isBlock: true,
			isInTableCell: false,
			isSingleLine: false,
		},
		{
			html: '<b>',
			isBlock: false,
			isInTableCell: false,
			isSingleLine: false,
		},
		{
			html: '</b>',
			isBlock: false,
			isInTableCell: false,
			isSingleLine: false,
		},
		{
			html: '<i>',
			isBlock: false,
			isInTableCell: false,
			isSingleLine: true,
		},
		{
			html: '</i>',
			isBlock: false,
			isInTableCell: false,
			isSingleLine: true,
		},
		{
			html: '<span title="grault|garply">',
			isBlock: false,
			isInTableCell: true,
			isSingleLine: true,
		},
		{
			html: '</span>',
			isBlock: false,
			isInTableCell: true,
			isSingleLine: true,
		},
	]);
});

test('records the tags of generated elements and containers', async () => {
	const source = '> foo *bar*\n';
	const root = await parseMarkdown(source);
	const blockquote = root.children[0]!;

	const context = renderDocumentContext(root, { source });

	expect(
		context.generatedElements.map(
			({ closeEnd, closeStart, openEnd, openStart }) =>
				`${context.html.slice(openStart, openEnd)}…${context.html.slice(closeStart, closeEnd)}`
		)
	).toStrictEqual(['<em>…</em>', '<p>…</p>', '<blockquote>…</blockquote>']);
	expect(context.containers.get(blockquote)?.tagName).toBe('blockquote');
	expect(context.end).toStrictEqual(root.position?.end);
});

test('reads footnote definitions as the reference renderer does', async () => {
	const source = '[^foo]: bar\n\n    <div title = "baz">qux</div>\n';
	const root = await parseMarkdown(source);

	const context = renderDocumentContext(root, { source });

	expect(context.fragments).toStrictEqual([]);
	expect(context.html).toBe(
		'<pre><code>&lt;div title = &quot;baz&quot;&gt;qux&lt;/div&gt;\n</code></pre>\n'
	);
});

test('reads footnote definitions in tight lists without paragraphs', async () => {
	const source = '- [^foo]: bar <b>baz</b>\n- qux\n';
	const root = await parseMarkdown(source);

	const context = renderDocumentContext(root, { source });

	expect(context.html).toBe(
		'<ul>\n<li>[^foo]: bar <b>baz</b></li>\n<li>qux</li>\n</ul>\n'
	);
});

test('rejects raw HTML that only the reference renderer reads', async () => {
	const source = '$$\n<span>\n$$\n';
	const root = await parseMarkdown(source);

	expect(() =>
		renderDocumentContext(root, { filepath: 'foo.md', source })
	).toThrow(
		'[prettier-plugin-markdown-html] Unsupported Markdown in `foo.md`'
	);
});

test('renders loose lists with paragraphs and tight lists without them', async () => {
	const looseSource = '- foo\n\n- bar\n';
	const tightSource = '- foo\n- bar\n';
	const looseRoot = await parseMarkdown(looseSource);
	const tightRoot = await parseMarkdown(tightSource);

	const looseContext = renderDocumentContext(looseRoot, {
		source: looseSource,
	});
	const tightContext = renderDocumentContext(tightRoot, {
		source: tightSource,
	});

	expect(looseContext.html).toBe(
		'<ul>\n<li>\n<p>foo</p>\n</li>\n<li>\n<p>bar</p>\n</li>\n</ul>\n'
	);
	expect(tightContext.html).toBe('<ul>\n<li>foo</li>\n<li>bar</li>\n</ul>\n');
});

test('renders unresolved link references as text', async () => {
	const source = '[foo] [bar]\n\n[bar]: /baz\n';
	const root = await parseMarkdown(source);

	const context = renderDocumentContext(root, { source });

	expect(context.html).toBe('<p>[foo] <a href="">bar</a></p>\n');
});
