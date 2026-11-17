import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import { expect, test } from 'vite-plus/test';
import preprocessMarkdown from './index.ts';

const OPTIONS = {
	printWidth: 80,
	proseWrap: 'preserve',
	tabWidth: 4,
} as ParserOptions;

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
