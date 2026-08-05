import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import formatHTML from '../format-html/index.ts';
import preprocessMarkdown from './index.ts';

vi.mock(import('../format-html/index.ts'), () => ({
	default: vi.fn(async (text: string) => {
		await new Promise((resolve) => setTimeout(resolve));
		return text;
	}),
}));

beforeEach(() => {
	vi.clearAllMocks();
});

test('processes root nodes only', async () => {
	const node: AST.Node = { type: 'html', value: '<p>foo</p>' };

	const result = await preprocessMarkdown(node, {} as ParserOptions);

	expect(result).toBe(node);
	expect(formatHTML).not.toHaveBeenCalled();
});

test('formats HTML in group of nodes', async () => {
	const root: AST.RootNode = {
		type: 'root',
		children: [
			{ type: 'html', value: '<div>' },
			{ type: 'html', value: '<p>foo</p></div>' },
			{ type: 'text', value: 'bar' },
		],
	};

	vi.mocked(formatHTML).mockResolvedValueOnce('<div><p>foo</p></div>');

	await preprocessMarkdown(root, {} as ParserOptions);

	expect(formatHTML).toHaveBeenCalledWith('<div>\n<p>foo</p></div>', {});
	expect(root.children).toStrictEqual([
		{ type: 'html', value: '<div><p>foo</p></div>' },
		{ type: 'text', value: 'bar' },
	]);
});

test('formats HTML nested in block and phrasing parents', async () => {
	const root: AST.RootNode = {
		type: 'root',
		children: [
			{
				type: 'blockquote',
				children: [
					{
						type: 'html',
						value: '<div id = "foo" class = "bar"><span>baz</span></div>',
					},
				],
			},
			{
				type: 'paragraph',
				children: [
					{ type: 'text', value: 'Before ' },
					{
						type: 'html',
						value: '<span id = "foo" class = "bar">',
					},
					{ type: 'text', value: 'baz' },
					{ type: 'html', value: '</span>' },
					{ type: 'text', value: ' After' },
				],
			},
		],
	};

	vi.mocked(formatHTML)
		.mockResolvedValueOnce(
			'<div id="foo" class="bar"><span>baz</span></div>'
		)
		.mockResolvedValueOnce('<span id="foo" class="bar"></span>');

	await preprocessMarkdown(root, {} as ParserOptions);

	expect(formatHTML).toHaveBeenNthCalledWith(
		1,
		'<div id = "foo" class = "bar"><span>baz</span></div>',
		{}
	);
	expect(formatHTML).toHaveBeenNthCalledWith(
		2,
		'<span id = "foo" class = "bar">',
		{
			bracketSameLine: true,
		}
	);
	expect(root.children).toStrictEqual([
		{
			type: 'blockquote',
			children: [
				{
					type: 'html',
					value: '<div id="foo" class="bar"><span>baz</span></div>',
				},
			],
		},
		{
			type: 'paragraph',
			children: [
				{ type: 'text', value: 'Before ' },
				{ type: 'html', value: '<span id="foo" class="bar">' },
				{ type: 'text', value: 'baz' },
				{ type: 'html', value: '</span>' },
				{ type: 'text', value: ' After' },
			],
		},
	]);
});

test('keeps closing tags without formatting', async () => {
	const root: AST.RootNode = {
		type: 'root',
		children: [
			{ type: 'html', value: '</div>' },
			{ type: 'text', value: 'foo' },
		],
	};

	await preprocessMarkdown(root, {} as ParserOptions);

	expect(formatHTML).not.toHaveBeenCalled();
	expect(root.children).toStrictEqual([
		{ type: 'html', value: '</div>' },
		{ type: 'text', value: 'foo' },
	]);
});

test('keeps an incomplete inline raw-text tag unchanged', async () => {
	const root: AST.RootNode = {
		type: 'root',
		children: [
			{
				type: 'paragraph',
				children: [
					{ type: 'html', value: '<title>' },
					{ type: 'text', value: 'foo' },
				],
			},
		],
	};

	await preprocessMarkdown(root, {} as ParserOptions);

	expect(root.children[0]!.children).toStrictEqual([
		{ type: 'html', value: '<title>' },
		{ type: 'text', value: 'foo' },
	]);
});

test('handles inline block HTML without source positions', async () => {
	const root: AST.RootNode = {
		type: 'root',
		children: [
			{
				type: 'paragraph',
				children: [
					{ type: 'text', value: 'Before ' },
					{ type: 'html', value: '<div></div>' },
				],
			},
		],
	};

	await preprocessMarkdown(root, {
		proseWrap: 'always',
	} as ParserOptions);

	expect(root.children[0]!.children).toStrictEqual([
		{ type: 'text', value: 'Before ' },
		{ type: 'html', value: '<div></div>' },
	]);
});

test('keeps inline separators that aren’t horizontal whitespace', async () => {
	const separators: AST.Node[] = [
		{ type: 'text', value: 'Before ' },
		{
			type: 'strong',
			children: [{ type: 'whitespace' }],
		},
	];

	for (const separator of separators) {
		separator.position = {
			start: { line: 1, column: 1, offset: 0 },
			end: { line: 1, column: 8, offset: 7 },
		};

		const root: AST.RootNode = {
			type: 'root',
			children: [
				{
					type: 'paragraph',
					children: [
						separator,
						{
							type: 'html',
							value: '<div></div>',
							position: {
								start: { line: 1, column: 8, offset: 7 },
								end: { line: 1, column: 19, offset: 18 },
							},
						},
					],
				},
			],
		};

		await preprocessMarkdown(root, {
			proseWrap: 'always',
		} as ParserOptions);

		expect(root.children[0]!.children![0]).toBe(separator);
	}
});

test('handles inline HTML without a tag name when wrapping prose', async () => {
	const root: AST.RootNode = {
		type: 'root',
		children: [
			{
				type: 'paragraph',
				children: [{ type: 'html', value: '<!-- foo -->' }],
			},
		],
	};

	await preprocessMarkdown(root, {
		proseWrap: 'always',
	} as ParserOptions);

	expect(root.children[0]!.children).toStrictEqual([
		{ type: 'html', value: '<!-- foo -->' },
	]);
});

test('preserves blank lines detected from source offsets', async () => {
	const root: AST.RootNode = {
		type: 'root',
		children: [
			{
				type: 'html',
				value: '<div></div>',
				position: {
					start: { line: 1, column: 1, offset: 0 },
					end: { line: 1, column: 12, offset: 11 },
				},
			},
			{
				type: 'html',
				value: '<p></p>',
				position: {
					start: { line: 2, column: 1, offset: 13 },
					end: { line: 2, column: 8, offset: 20 },
				},
			},
		],
	};

	await preprocessMarkdown(root, {
		originalText: '<div></div>\n\n<p></p>',
	} as ParserOptions);

	expect(formatHTML).toHaveBeenNthCalledWith(1, '<div></div>', {
		originalText: '<div></div>\n\n<p></p>',
	});
	expect(formatHTML).toHaveBeenNthCalledWith(2, '<p></p>', {
		originalText: '<div></div>\n\n<p></p>',
	});
});

test('keeps original nodes when trailing closing tags can’t be stripped', async () => {
	const node: AST.Node = { type: 'html', value: '<div><p>foo</p>' };

	const root: AST.RootNode = {
		type: 'root',
		children: [node],
	};

	vi.mocked(formatHTML).mockResolvedValueOnce('<div><p>foo</p>');

	await preprocessMarkdown(root, {} as ParserOptions);

	expect(root.children).toStrictEqual([node]);
	expect(root.children[0]!.value).toBe('<div><p>foo</p>');
});
