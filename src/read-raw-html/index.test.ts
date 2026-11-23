import type { ParserOptions } from 'prettier';
import type { AST, Regions } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test } from 'vite-plus/test';
import readRawHTML, { locateFragmentOffset, locateOffset } from './index.ts';

async function readMarkdown(markdown: string): Promise<Regions.Document> {
	const root = (await pluginMarkdown.parsers.markdown.parse(markdown, {
		originalText: markdown,
	} as unknown as ParserOptions)) as AST.RootNode;

	return readRawHTML(root, markdown);
}

function describeContainer(container: Regions.Container): unknown {
	return {
		blocks: container.blocks.map(({ index, node }) => [index, node.value]),
		containers: container.containers.map((nested) => ({
			index: nested.index,
			...(describeContainer(nested) as object),
		})),
		inlines: container.inlines.map(({ fragments, index, node }) => [
			index,
			node.type,
			fragments.map((fragment) => fragment.node.value),
		]),
		kind: container.kind,
	};
}

test('reads the fragments of each Markdown container', async () => {
	const document = await readMarkdown(`# <img src="foo.png"> bar

<div>baz</div>

> <p>qux</p>
>
> - <b>quux</b>

| <i>corge</i> |
| --- |

    <s>garply</s>

[^1]: <u>grault</u>
`);

	expect(describeContainer(document.root)).toStrictEqual({
		blocks: [[1, '<div>baz</div>']],
		containers: [
			{
				blocks: [[0, '<p>qux</p>']],
				containers: [
					{
						blocks: [],
						containers: [],
						index: 1,
						inlines: [[0, 'paragraph', ['<b>', '</b>']]],
						kind: 'listItem',
					},
				],
				index: 2,
				inlines: [],
				kind: 'blockquote',
			},
		],
		inlines: [
			[0, 'heading', ['<img src="foo.png">']],
			[3, 'tableCell', ['<i>', '</i>']],
		],
		kind: 'root',
	});
	expect(document.fragments.map(({ node }) => node.value)).toStrictEqual([
		'<img src="foo.png">',
		'<div>baz</div>',
		'<p>qux</p>',
		'<b>',
		'</b>',
		'<i>',
		'</i>',
	]);
});

test('continues raw text across the HTML blocks of a container', async () => {
	const document = await readMarkdown(`<div><script>

<p>foo</p>

<p>bar</script>
`);

	expect(
		document.root.blocks.map(({ tokens }) =>
			tokens.map((token) =>
				token.kind === 'opaque' ? token.construct : token.name
			)
		)
	).toStrictEqual([['div', 'script'], ['raw-text'], ['raw-text', 'script']]);
});

test('locates tokens in the original Markdown', async () => {
	const markdown = '> <div>\n>\t<p>foo</p>\n> </div>\n';
	const document = await readMarkdown(markdown);
	const [fragment] = document.root.containers[0]!.blocks;

	expect(fragment!.tokens.map(({ position }) => position)).toStrictEqual([
		{ column: 3, line: 1, offset: 2 },
		{ column: 3, line: 2, offset: markdown.indexOf('<p>') },
		{ column: 9, line: 2, offset: markdown.indexOf('</p>') },
		{ column: 3, line: 3, offset: markdown.indexOf('</div>') },
	]);
	expect(locateFragmentOffset(document, fragment!, 0)).toStrictEqual({
		column: 3,
		line: 1,
		offset: 2,
	});
	expect(locateOffset(document, markdown.length)).toStrictEqual({
		column: 1,
		line: 4,
		offset: markdown.length,
	});
});

test('locates tags on later lines of inline HTML', async () => {
	const markdown = 'foo <a\n  href="bar">baz</a>\n';
	const document = await readMarkdown(markdown);
	const [fragment] = document.fragments;

	expect(locateFragmentOffset(document, fragment!, 6)).toStrictEqual({
		column: 4,
		line: 2,
		offset: markdown.indexOf('ref'),
	});
});

test('locates tokens after tabs in list items', async () => {
	const markdown = '- foo\n\t<details>\n';
	const document = await readMarkdown(markdown);
	const [fragment] = document.fragments;

	expect(fragment!.tokens.map(({ position }) => position)).toStrictEqual([
		{ column: 2, line: 2, offset: markdown.indexOf('<details>') },
	]);
});

test('records the source that ignore directives protect', async () => {
	const document = await readMarkdown(`- <!-- prettier-ignore -->
  <b>foo</b>

<!-- prettier-ignore-start -->
<i>bar</i>

<div>baz</div>

<!-- prettier-ignore-end -->

> <!-- prettier-ignore-start -->
> <u>qux</u>
> <!-- prettier-ignore-end -->

<!-- prettier-ignore-start -->
<s>quux</s>
`);
	const [bold, , italic, , div] = document.fragments.filter(
		({ node }) => !node.value.startsWith('<!--')
	);
	const [listItem] = document.root.containers[0]!.node.children;

	expect(bold!.protection).toStrictEqual({
		kind: 'next',
		nodes: [bold!.block],
	});
	expect(
		italic!.protection!.nodes.map((node) => [
			node.type,
			node.position!.start.line,
		])
	).toStrictEqual([
		['html', 4],
		['paragraph', 5],
		['html', 7],
		['html', 9],
	]);
	expect(div!.protection).toBe(italic!.protection);
	expect(
		document.fragments
			.filter(({ protection }) => !protection)
			.map(({ node }) => node.value)
	).toStrictEqual([
		'<!-- prettier-ignore -->',
		'<!-- prettier-ignore-start -->',
		'<u>',
		'</u>',
		'<!-- prettier-ignore-end -->',
		'<!-- prettier-ignore-start -->',
		'<s>',
		'</s>',
	]);
	expect(document.protections.get(bold!.node)).toBe(bold!.protection);
	expect(document.protections.has(listItem!)).toBe(false);
});

test('protects inline nodes after inline ignore directives', async () => {
	const document = await readMarkdown(
		'foo <!-- prettier-ignore --><b>bar</b> baz\n'
	);
	const [comment, opening, closing] = document.fragments;

	expect(comment!.protection).toBeUndefined();
	expect(opening!.protection).toStrictEqual({
		kind: 'next',
		nodes: [opening!.node],
	});
	expect(closing!.protection).toBeUndefined();
});

test('locates the tokens of long HTML blocks in linear time', async () => {
	const rows = Array.from(
		{ length: 20_000 },
		(_, index) => `<tr><td>${index}</td></tr>`
	);
	const document = await readMarkdown(
		`<table>\n${rows.join('\n')}\n</table>\n`
	);
	const [fragment] = document.fragments;

	expect(fragment!.tokens.at(-1)!.position).toStrictEqual({
		column: 1,
		line: 20_002,
		offset: document.source.lastIndexOf('</table>'),
	});
});
