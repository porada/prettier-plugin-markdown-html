import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import { format } from 'prettier';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test } from 'vite-plus/test';
import * as pluginMarkdownHTML from '../index.ts';
import preprocessMarkdown, { validateMarkdown } from './index.ts';

const OPTIONS = {
	printWidth: 80,
	proseWrap: 'preserve',
	tabWidth: 4,
} as ParserOptions;

async function parseMarkdown(text: string): Promise<AST.RootNode> {
	return (await pluginMarkdown.parsers.markdown.parse(text, {
		originalText: text,
	} as never)) as AST.RootNode;
}

test('processes root nodes only', async () => {
	const node: AST.Node = { type: 'html', value: '<p   id="foo">bar</p>' };

	const result = await preprocessMarkdown(node, OPTIONS);

	expect(result).toBe(node);
	expect(node.value).toBe('<p   id="foo">bar</p>');
});

test('returns documents without raw HTML unchanged', async () => {
	const paragraph: AST.Node = {
		children: [{ type: 'text', value: 'foo' }],
		type: 'paragraph',
	};
	const root: AST.RootNode = { children: [paragraph], type: 'root' };

	const result = await preprocessMarkdown(root, OPTIONS);

	expect(result).toBe(root);
	expect(root.children).toStrictEqual([
		{ children: [{ type: 'text', value: 'foo' }], type: 'paragraph' },
	]);
});

test('skips formatting checks when only validating documents without raw HTML', async () => {
	const text = '[^foo]:\n\n    bar <b   >baz</b>\n';
	const options = { ...OPTIONS, originalText: text, plugins: [] };

	await expect(
		validateMarkdown(await parseMarkdown(text), options)
	).resolves.toBeUndefined();
	await expect(preprocessMarkdown(await parseMarkdown(text), options)).rejects
		.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

		Formatting this footnote definition would change how GitHub Flavored Markdown renders the raw HTML in it]
	`);
});

test('formats HTML blocks in nested containers without source positions', async () => {
	const root: AST.RootNode = {
		children: [
			{
				children: [
					{
						children: [
							{
								children: [
									{
										type: 'html',
										value: '<div   id="foo">bar</div>',
									},
								],
								type: 'blockquote',
							},
						],
						type: 'listItem',
					},
				],
				type: 'list',
			},
		],
		type: 'root',
	};

	await preprocessMarkdown(root, OPTIONS);

	expect(
		root.children[0]!.children![0]!.children![0]!.children
	).toStrictEqual([{ type: 'html', value: '<div id="foo">bar</div>' }]);
});

test('formats HTML blocks in list items without source positions before other items', async () => {
	const root: AST.RootNode = {
		children: [
			{
				children: [
					{
						children: [
							{
								type: 'html',
								value: '<div   id="foo">bar</div>',
							},
						],
						type: 'listItem',
					},
					{
						children: [
							{
								type: 'html',
								value: '<div   id="baz">qux</div>',
							},
						],
						position: {
							end: { column: 28, line: 2, offset: 55 },
							start: { column: 1, line: 2, offset: 28 },
						},
						type: 'listItem',
					},
				],
				type: 'list',
			},
		],
		type: 'root',
	};

	await preprocessMarkdown(root, OPTIONS);

	expect(
		root.children[0]!.children!.map(({ children }) => children)
	).toStrictEqual([
		[{ type: 'html', value: '<div id="foo">bar</div>' }],
		[{ type: 'html', value: '<div id="baz">qux</div>' }],
	]);
});

test('skips list items without children', async () => {
	const item: AST.Node = { type: 'listItem' };
	const root: AST.RootNode = {
		children: [
			{
				children: [
					item,
					{
						children: [
							{
								type: 'html',
								value: '<div   id="foo">bar</div>',
							},
						],
						type: 'listItem',
					},
				],
				type: 'list',
			},
		],
		type: 'root',
	};

	await preprocessMarkdown(root, OPTIONS);

	expect(item).toStrictEqual({ type: 'listItem' });
	expect(root.children[0]!.children![1]!.children).toStrictEqual([
		{ type: 'html', value: '<div id="foo">bar</div>' },
	]);
});

test('measures ordered list markers without a start number from 1', async () => {
	const html: AST.HTMLNode = {
		type: 'html',
		value: '<div   id="foo">bar</div>',
	};
	const list = {
		children: [{ children: [html], type: 'listItem' }],
		ordered: true,
		type: 'list',
	};
	const root: AST.RootNode = { children: [list], type: 'root' };

	await preprocessMarkdown(root, { ...OPTIONS, printWidth: 26 });

	expect(html.value).toBe('<div id="foo">bar</div>');
});

test.each([
	{ output: '1. <div id="foo">bar</div>\n', tabWidth: 3 },
	{ output: '1.  <div id="foo">\n        bar\n    </div>\n', tabWidth: 4 },
	{ output: '1. <div id="foo">bar</div>\n', tabWidth: 8 },
])(
	'measures aligned ordered list markers at $tabWidth-column tab stops',
	async ({ output: expectedOutput, tabWidth }) => {
		const options = {
			parser: 'markdown',
			plugins: [pluginMarkdownHTML],
			printWidth: 26,
			tabWidth,
		};

		const output = await format('1.  <div id="foo">bar</div>\n', options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test('measures the repeated numbers of ordered lists that start at 0', async () => {
	const input =
		'0. foo\n1. bar\n1. baz\n1. qux\n1. quux\n1. corge\n1. grault\n1. garply\n1. waldo\n1. fred\n1. <div   id="plugh">xyzzy</div>\n';
	const expectedOutput =
		'0. foo\n1. bar\n1. baz\n1. qux\n1. quux\n1. corge\n1. grault\n1. garply\n1. waldo\n1. fred\n1. <div id="plugh">xyzzy</div>\n';
	const options = {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
		printWidth: 30,
		tabWidth: 4,
	};

	const output = await format(input, options);

	expect(output).toBe(expectedOutput);
	await expect(format(output, options)).resolves.toBe(output);
});

test('keeps HTML in footnote definitions literal', async () => {
	const html: AST.HTMLNode = {
		type: 'html',
		value: '<div title = "foo">bar</div>',
	};
	const root: AST.RootNode = {
		children: [
			{ type: 'html', value: '<p   id="baz">qux</p>' },
			{ children: [html], type: 'footnoteDefinition' },
		],
		type: 'root',
	};

	await preprocessMarkdown(root, OPTIONS);

	expect(root.children[0]).toStrictEqual({
		type: 'html',
		value: '<p id="baz">qux</p>',
	});
	expect(html.value).toBe('<div title = "foo">bar</div>');
});

test('formats inline HTML outside paragraphs, headings, and table cells', async () => {
	const root: AST.RootNode = {
		children: [
			{
				children: [
					{ type: 'html', value: '<b   id="foo">' },
					{ type: 'text', value: 'bar' },
					{ type: 'html', value: '</b>' },
				],
				type: 'baz',
			},
		],
		type: 'root',
	};

	await preprocessMarkdown(root, OPTIONS);

	expect(root.children[0]!.children).toStrictEqual([
		{ type: 'html', value: '<b id="foo">' },
		{ type: 'text', value: 'bar' },
		{ type: 'html', value: '</b>' },
	]);
});

test('keeps HTML after ignore comments unchanged', async () => {
	const root: AST.RootNode = {
		children: [
			{ type: 'html', value: '<!-- prettier-ignore -->' },
			{ type: 'html', value: '<div   id="foo">bar</div>' },
			{ type: 'html', value: '<!-- prettier-ignore-start -->' },
			{ type: 'html', value: '<div   id="baz">qux</div>' },
			{ type: 'html', value: '<!-- prettier-ignore-end -->' },
			{ type: 'html', value: '<div   id="quux">corge</div>' },
		],
		type: 'root',
	};

	await preprocessMarkdown(root, OPTIONS);

	expect(root.children.map(({ value }) => value)).toStrictEqual([
		'<!-- prettier-ignore -->',
		'<div   id="foo">bar</div>',
		'<!-- prettier-ignore-start -->',
		'<div   id="baz">qux</div>',
		'<!-- prettier-ignore-end -->',
		'<div id="quux">corge</div>',
	]);
});

test('keeps inline block tags off line starts only next to their separator', async () => {
	const separator: AST.Node = { type: 'whitespace', value: ' ' };
	const positionlessSeparator: AST.Node = { type: 'whitespace', value: ' ' };
	const point = (offset: number): AST.Point => ({
		column: offset + 1,
		line: 1,
		offset,
	});
	const root: AST.RootNode = {
		children: [
			{
				children: [
					{
						children: [{ type: 'word', value: 'foo' }, separator],
						position: { end: point(4), start: point(0) },
						type: 'sentence',
					},
					{
						position: { end: point(12), start: point(4) },
						type: 'html',
						value: '<center>',
					},
					{ type: 'text', value: 'bar' },
					{ type: 'html', value: '</center>' },
				],
				type: 'paragraph',
			},
			{
				children: [
					{
						children: [
							{ type: 'word', value: 'baz' },
							positionlessSeparator,
						],
						type: 'sentence',
					},
					{ type: 'html', value: '<center>' },
					{ type: 'text', value: 'qux' },
					{ type: 'html', value: '</center>' },
				],
				type: 'paragraph',
			},
		],
		type: 'root',
	};

	await preprocessMarkdown(root, { ...OPTIONS, proseWrap: 'always' });

	expect(separator.type).toBe('text');
	expect(positionlessSeparator.type).toBe('whitespace');
});
