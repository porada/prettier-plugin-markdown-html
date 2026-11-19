import type { AST } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test, vi } from 'vite-plus/test';
import renderDocumentContext, {
	getDelimiterRowChecks,
	hasDelimiterRowSyntax,
	isWrappableDelimiterWord,
} from './index.ts';

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

test('renders task list markers as checkboxes only outside block quotes', async () => {
	const source = '- [x] foo\n- [ ] bar\n\n> - [ ] baz\n';
	const root = await parseMarkdown(source);

	const context = renderDocumentContext(root, { source });

	expect(context.html).toBe(`<ul>
<li><input type="checkbox" checked="" disabled="" /> foo</li>
<li><input type="checkbox" disabled="" /> bar</li>
</ul>
<blockquote>
<ul>
<li>[ ] baz</li>
</ul>
</blockquote>
`);
});

test('renders link references defined only in a footnote definition’s reading as text', async () => {
	const source = '[^foo]: /bar\n[\\^foo]\n';
	const root = await parseMarkdown(source);

	const context = renderDocumentContext(root, { source });

	expect(context.html).toBe('<p>[^foo]</p>\n');
});

test('renders Markdown text that Prettier reads as HTML after an HTML block that has ended', async () => {
	const source = '<!-- foo -->\n<!doctype html>\n';
	const root = await parseMarkdown(source);

	const context = renderDocumentContext(root, { source });

	expect(context.html).toBe('<!-- foo -->\n<p>&lt;!doctype html&gt;</p>\n');
});

test('renders Markdown text that Prettier reads as HTML before an HTML block only when that block can interrupt a paragraph', async () => {
	const interruptingSource = '<!doctype html>\n<div>\n';
	const continuingSource = '<!doctype html>\n<span>\n';
	const interruptingRoot = await parseMarkdown(interruptingSource);
	const continuingRoot = await parseMarkdown(continuingSource);

	const interruptingContext = renderDocumentContext(interruptingRoot, {
		source: interruptingSource,
	});
	const continuingContext = renderDocumentContext(continuingRoot, {
		source: continuingSource,
	});

	expect(interruptingContext.html).toBe(
		'<p>&lt;!doctype html&gt;</p>\n<div>\n'
	);
	expect(continuingContext.html).toBe('<!doctype html>\n<span>\n');
});

test('keeps Markdown text that Prettier reads as HTML as raw HTML without the source', async () => {
	const root = await parseMarkdown('<!doctype html>\n');

	const context = renderDocumentContext(root);

	expect(context.html).toBe('<!doctype html>\n');
	expect(context.fragments.map(({ node }) => node.value)).toStrictEqual([
		'<!doctype html>',
	]);
});

test('renders inline syntax that only Prettier reads as text without the source', async () => {
	const root = await parseMarkdown('foo $$bar$$ baz\n');

	const context = renderDocumentContext(root);

	expect(context.html).toBe('<p>foo bar baz</p>\n');
});

test('skips link reference definitions without source positions', async () => {
	const source = 'foo <b>bar</b> $$baz$$\n';
	const root = await parseMarkdown(source);
	root.children.push({ type: 'definition' });

	const context = renderDocumentContext(root, { source });

	expect(context.html).toBe('<p>foo <b>bar</b> $$baz$$</p>\n');
});

test('renders syntax tree nodes that lack optional properties', () => {
	const root: AST.RootNode = {
		children: [
			{ type: 'heading' },
			{
				children: [
					{ type: 'emphasis' },
					{ type: 'image' },
					{ type: 'inlineCode' },
					{ type: 'link' },
				],
				type: 'paragraph',
			},
			{ type: 'code' },
			{ type: 'list' },
			{ type: 'table' },
			{ children: [{ type: 'tableRow' }], type: 'table' },
		],
		type: 'root',
	};

	const context = renderDocumentContext(root);

	expect(context.html).toBe(`<h1></h1>
<p><em></em><img src="" alt="" /><code></code><a href=""></a></p>
<pre><code></code></pre>
<ul>
</ul>
<table>
</table>
<table>
<thead>
<tr>
</tr>
</thead>
</table>
`);
});

test('records no delimiter row checks for blocks without raw HTML syntax', async () => {
	const source = 'foo\n|---|---|\n';
	const root = await parseMarkdown(source);

	const context = renderDocumentContext(root, { source });

	expect(getDelimiterRowChecks(context)).toStrictEqual([]);
});

test('records delimiter row checks for blocks with raw HTML syntax', async () => {
	const source = 'foo <b>bar</b> :---\n|---|---|\n';
	const root = await parseMarkdown(source);

	const context = renderDocumentContext(root, { source });
	const [check] = getDelimiterRowChecks(context);

	expect(getDelimiterRowChecks(context)).toHaveLength(1);
	expect(check!.block).toBe(root.children[0]);
	expect(check!.line).toStrictEqual({ column: 1, line: 2, offset: 20 });
	expect(check!.findWrapHazards()).toStrictEqual({
		definition: undefined,
		word: { column: 16, line: 1, offset: 15 },
	});
});

test('records wrap hazards for possible link reference definitions', async () => {
	const source = '- [ ]  [foo\n  bar]: x <b>y</b>\n';
	const root = await parseMarkdown(source);

	const context = renderDocumentContext(root, { source });
	const [check] = getDelimiterRowChecks(context);

	expect(check!.findWrapHazards()).toStrictEqual({
		definition: { column: 8, line: 1, offset: 7 },
		word: undefined,
	});
});

test('records wrap hazards for words that would open HTML blocks in paragraphs without raw HTML syntax', async () => {
	const source = 'foo <div bar\n\nfoo <span bar\n\n# foo <div bar\n';
	const root = await parseMarkdown(source);

	const context = renderDocumentContext(root, { source });
	const checks = getDelimiterRowChecks(context);

	expect(checks.map(({ block }) => block)).toStrictEqual(
		root.children.slice(0, 2)
	);
	expect(checks.map(({ line }) => line)).toStrictEqual([
		undefined,
		undefined,
	]);
	expect(checks.map((check) => check.findWrapHazards())).toStrictEqual([
		{ definition: undefined, word: { column: 5, line: 1, offset: 4 } },
		undefined,
	]);
});

test('records no delimiter row checks without the source', async () => {
	const root = await parseMarkdown('foo <b>bar</b>\n|---|---|\n');

	const context = renderDocumentContext(root);

	expect(getDelimiterRowChecks(context)).toStrictEqual([]);
});

test('reads the position of each text node once when finding wrap hazards', async () => {
	const source = `${'[a === b](/x) word '.repeat(512)}<b>x</b>\n`;
	const root = await parseMarkdown(source);
	const context = renderDocumentContext(root, { source });
	const [check] = getDelimiterRowChecks(context);
	const texts = root.children[0]!.children!.filter(
		({ type }) => type === 'text'
	);
	const getPosition = vi.fn();

	for (const text of texts) {
		const { position } = text;

		Object.defineProperty(text, 'position', {
			get() {
				getPosition();

				return position;
			},
		});
	}

	expect(check!.findWrapHazards()).toStrictEqual({
		definition: undefined,
		word: undefined,
	});
	expect(getPosition).toHaveBeenCalledTimes(texts.length);
});

test('reads the bullets of sibling lists once when finding wrap hazards', async () => {
	const source = '- foo <b>bar</b>\n\nbaz\n\n'.repeat(128);
	const root = await parseMarkdown(source);
	const context = renderDocumentContext(root, { source });
	const checks = getDelimiterRowChecks(context);
	const getType = vi.fn();

	for (const child of root.children) {
		const { type } = child;

		Object.defineProperty(child, 'type', {
			get() {
				getType();

				return type;
			},
		});
	}

	expect(checks.map((check) => check.findWrapHazards())).toStrictEqual(
		Array.from({ length: 128 }, () => ({
			definition: undefined,
			word: undefined,
		}))
	);
	expect(getType).toHaveBeenCalledTimes(root.children.length);
});

test('skips text nodes without both source offsets when finding wrap hazards', async () => {
	const linkSource = 'foo [a === b](/x) <b>y</b>\n';
	const linkRoot = await parseMarkdown(linkSource);
	delete linkRoot.children[0]!.children![0]!.position!.end.offset;
	const fenceSource = 'foo <b>x</b> ~~~ bar\n';
	const fenceRoot = await parseMarkdown(fenceSource);
	const { position } = fenceRoot.children[0]!.children![0]!;
	delete position!.start.offset;
	delete position!.end.offset;

	const [linkCheck] = getDelimiterRowChecks(
		renderDocumentContext(linkRoot, { source: linkSource })
	);
	const [fenceCheck] = getDelimiterRowChecks(
		renderDocumentContext(fenceRoot, { source: fenceSource })
	);

	expect(linkCheck!.findWrapHazards()).toStrictEqual({
		definition: undefined,
		word: undefined,
	});
	expect(fenceCheck!.findWrapHazards()).toStrictEqual({
		definition: undefined,
		word: { column: 14, line: 1, offset: 13 },
	});
});

test('skips paragraphs without source positions when checking for delimiter rows', async () => {
	const source = 'foo\n';
	const root = await parseMarkdown(source);
	root.children.push({ children: [], type: 'paragraph' });

	const context = renderDocumentContext(root, { source });

	expect(context.html).toBe('<p>foo</p>\n<p></p>\n');
});

test('checks lines for the syntax of table delimiter rows', () => {
	expect(hasDelimiterRowSyntax(':---')).toBe(true);
	expect(hasDelimiterRowSyntax('| --- | :-: |')).toBe(true);
	expect(hasDelimiterRowSyntax(' \t---:|--\v')).toBe(true);
	expect(hasDelimiterRowSyntax('---')).toBe(true);
	expect(hasDelimiterRowSyntax('--\\|--')).toBe(false);
	expect(hasDelimiterRowSyntax('|')).toBe(false);
	expect(hasDelimiterRowSyntax('| foo |')).toBe(false);
	expect(hasDelimiterRowSyntax('::-')).toBe(false);
});

test('checks words that wrapping can move onto a line of their own as delimiter rows or setext underlines', () => {
	expect(isWrappableDelimiterWord(':---')).toBe(true);
	expect(isWrappableDelimiterWord('--')).toBe(true);
	expect(isWrappableDelimiterWord('|')).toBe(true);
	expect(isWrappableDelimiterWord('===')).toBe(true);
	expect(isWrappableDelimiterWord('=')).toBe(true);
	expect(isWrappableDelimiterWord(':')).toBe(false);
	expect(isWrappableDelimiterWord('-')).toBe(false);
	expect(isWrappableDelimiterWord('=-')).toBe(false);
	expect(isWrappableDelimiterWord('foo\u00A0:---')).toBe(false);
});
