import type { ParserOptions, Plugin } from 'prettier';
import type * as DecideRegions from '../decide-regions/index.ts';
import type { RegionDecisions } from '../decide-regions/index.ts';
import type * as FormatInlineHTML from '../format-inline-html/index.ts';
import type { AST } from '../types/index.d.ts';
import { format } from 'prettier';
import * as pluginHTML from 'prettier/plugins/html';
import { parsers as markdownParsers } from 'prettier/plugins/markdown';
import { expect, onTestFinished, test, vi } from 'vite-plus/test';
import * as pluginMarkdownHTML from '../index.ts';
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

function createFailingHTMLPlugin(failure: 'parse' | 'print'): Plugin {
	const { html: parser } = pluginHTML.parsers;
	const { html: printer } = pluginHTML.printers;

	return {
		parsers: {
			html: {
				...parser,
				parse(text, options) {
					const index = text.indexOf('<x-bad');

					if (failure === 'parse' && index !== -1) {
						const lines = text.slice(0, index).split('\n');

						throw Object.assign(new SyntaxError('Bad tag'), {
							loc: {
								start: {
									column: lines.at(-1)!.length + 1,
									line: lines.length,
								},
							},
						});
					}

					return parser.parse(text, options);
				},
			},
		},
		printers: {
			html: {
				...printer,
				print(path, options, print, args) {
					if (
						failure === 'print' &&
						(path.node as { name?: string }).name === 'x-bad'
					) {
						throw new Error('Failed to print');
					}

					return printer.print(path, options, print, args);
				},
			},
		},
	};
}

async function formatWithNotices(
	input: string,
	plugins: Plugin[]
): Promise<{ notices: unknown[][]; output: string }> {
	const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);

	try {
		const output = await format(input, {
			parser: 'markdown',
			plugins: [...plugins, pluginMarkdownHTML],
		});

		return { notices: [...warn.mock.calls], output };
	} finally {
		warn.mockRestore();
	}
}

test('passes on failures that no region explains', async () => {
	const input = '<div   >foo</div>\n';
	const root = (await markdownParsers.markdown.parse(input, {
		originalText: input,
	} as ParserOptions)) as AST.Node;
	const error = new Error('Foo');

	await expect(
		preprocessMarkdown(
			root,
			{ ...OPTIONS, originalText: input },
			async () => Promise.reject(error)
		)
	).rejects.toBe(error);
});

test('rejects the remaining regions when a failed layout rejects no further region', async () => {
	vi.resetModules();
	vi.doMock('../decide-regions/index.ts', async (importOriginal) => {
		const decideRegions = await importOriginal<typeof DecideRegions>();

		return {
			...decideRegions,
			findChangedRoles: (decisions: RegionDecisions) => [
				{
					region: decideRegions.listRegions(decisions)[0]!,
					problem: {
						kind: 'changed-role',
						position: { column: 1, line: 1, offset: 0 },
					},
				},
			],
		};
	});
	onTestFinished(() => {
		vi.doUnmock('../decide-regions/index.ts');
	});
	const { default: preprocess } = await import('./index.ts');
	const input = '<div   >foo</div>\n\n<p   >bar</p>\n';
	const root = (await markdownParsers.markdown.parse(input, {
		originalText: input,
	} as ParserOptions)) as AST.Node;
	const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);

	onTestFinished(() => {
		warn.mockRestore();
	});

	await preprocess(root, { ...OPTIONS, originalText: input }, async () => {
		await Promise.resolve();
		return input;
	});

	expect(root.children!.map(({ value }) => value)).toStrictEqual([
		'<div   >foo</div>',
		'<p   >bar</p>',
	]);
	expect(warn.mock.calls).toStrictEqual([
		[
			'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1). Formatting would change whether Prettier reads this as inline HTML, an HTML block, or text. Check nearby line breaks, indentation, and code fences.',
		],
		[
			'[prettier-plugin-markdown-html] Skipped HTML formatting (3:1). Formatting would change whether Prettier reads this as inline HTML, an HTML block, or text. Check nearby line breaks, indentation, and code fences.',
		],
	]);
});

test('rejects the remaining regions when a failed role check names only rejected regions', async () => {
	vi.resetModules();
	vi.doMock('../decide-regions/index.ts', async (importOriginal) => {
		const decideRegions = await importOriginal<typeof DecideRegions>();

		return {
			...decideRegions,
			findChangedBlocks: () => [],
			findChangedRoles: (decisions: RegionDecisions) => [
				{
					region: decideRegions.listRegions(decisions)[0]!,
					problem: {
						kind: 'changed-role',
						position: { column: 1, line: 1, offset: 0 },
					},
				},
			],
		};
	});
	onTestFinished(() => {
		vi.doUnmock('../decide-regions/index.ts');
	});
	const { default: preprocess } = await import('./index.ts');
	const input = '<div   >foo</div>\n\n<p   >bar</p>\n';
	const root = (await markdownParsers.markdown.parse(input, {
		originalText: input,
	} as ParserOptions)) as AST.Node;
	const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);

	onTestFinished(() => {
		warn.mockRestore();
	});

	await preprocess(root, { ...OPTIONS, originalText: input }, async () => {
		await Promise.resolve();
		return input;
	});

	expect(root.children!.map(({ value }) => value)).toStrictEqual([
		'<div   >foo</div>',
		'<p   >bar</p>',
	]);
	expect(warn.mock.calls).toStrictEqual([
		[
			'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1). Formatting would change whether Prettier reads this as inline HTML, an HTML block, or text. Check nearby line breaks, indentation, and code fences.',
		],
		[
			'[prettier-plugin-markdown-html] Skipped HTML formatting (3:1). Formatting would change whether Prettier reads this as inline HTML, an HTML block, or text. Check nearby line breaks, indentation, and code fences.',
		],
	]);
});

test('rejects a region whose layout fails with an error of its own', async () => {
	const error = new Error('foo\nbar');

	vi.resetModules();
	vi.doMock('../format-inline-html/index.ts', async (importOriginal) => ({
		...(await importOriginal<object>()),
		default: async () => {
			await Promise.resolve();
			throw error;
		},
	}));
	onTestFinished(() => {
		vi.doUnmock('../format-inline-html/index.ts');
	});
	const { default: preprocess } = await import('./index.ts');
	const input = 'foo <b   >bar</b>\n\n<div   >baz</div>\n';
	const root = (await markdownParsers.markdown.parse(input, {
		originalText: input,
	} as ParserOptions)) as AST.Node;
	const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);

	onTestFinished(() => {
		warn.mockRestore();
	});

	await preprocess(root, { ...OPTIONS, originalText: input });

	expect(root.children![0]!.children![1]!.value).toBe('<b   >');
	expect(root.children![1]!.value).toBe('<div>baz</div>');
	expect(warn.mock.calls).toStrictEqual([
		[
			'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1):\n\nfoo\nbar',
		],
	]);
});

test('rejects a region whose layout no Markdown arrangement satisfies', async () => {
	vi.resetModules();
	const { reportUnsafeLayout } = await import('../report-error/index.ts');
	let error: unknown;

	try {
		reportUnsafeLayout({ reason: 'foo' });
	} catch (caughtError: unknown) {
		error = caughtError;
	}

	vi.doMock('../format-inline-html/index.ts', async (importOriginal) => ({
		...(await importOriginal<object>()),
		default: async () => {
			await Promise.resolve();
			throw error;
		},
	}));
	onTestFinished(() => {
		vi.doUnmock('../format-inline-html/index.ts');
	});
	const { default: preprocess } = await import('./index.ts');
	const input = 'foo <b   >bar</b>\n';
	const root = (await markdownParsers.markdown.parse(input, {
		originalText: input,
	} as ParserOptions)) as AST.Node;
	const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);

	onTestFinished(() => {
		warn.mockRestore();
	});

	await preprocess(root, { ...OPTIONS, originalText: input });

	expect(root.children![0]!.children![1]!.value).toBe('<b   >');
	expect(warn.mock.calls).toStrictEqual([
		['[prettier-plugin-markdown-html] Skipped HTML formatting (1:1). foo'],
	]);
});

test('rejects only the region that Prettier can’t format with the configured printer', async () => {
	await expect(
		formatWithNotices('<div   >foo</div>\n\n<x-bad   >bar</x-bad>\n', [
			createFailingHTMLPlugin('print'),
		])
	).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (3:1). Prettier can’t format this HTML:\n\nFailed to print',
			],
		],
		output: '<div>foo</div>\n\n<x-bad   >bar</x-bad>\n',
	});
});

test('tries an inline region on its own when its container’s HTML fails to format', async () => {
	await expect(
		formatWithNotices('foo <b   >bar</b>\n\n<x-bad   >baz</x-bad>\n', [
			createFailingHTMLPlugin('print'),
		])
	).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (3:1). Prettier can’t format this HTML:\n\nFailed to print',
			],
		],
		output: 'foo <b>bar</b>\n\n<x-bad   >baz</x-bad>\n',
	});
});

test('keeps inline HTML formatted when an HTML block beside it fails to parse', async () => {
	await expect(
		formatWithNotices(
			'foo <b   >bar</b>\n\n<div>\n<x-bad   >baz</x-bad>\n</div>\n',
			[createFailingHTMLPlugin('parse')]
		)
	).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (4:1). Prettier can’t format this HTML:\n\nBad tag',
			],
		],
		output: 'foo <b>bar</b>\n\n<div>\n<x-bad   >baz</x-bad>\n</div>\n',
	});
});

test('tries a region on its own with its corrections when its HTML fails to format', async () => {
	await expect(
		formatWithNotices(
			'> <div   >\n> <x-bad>foo</x-bad></br>\n> </div>\n>\n> bar\n\nbaz\n',
			[createFailingHTMLPlugin('print')]
		)
	).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (1:3). Prettier can’t format this HTML:\n\nFailed to print',
			],
		],
		output: '> <div   >\n> <x-bad>foo</x-bad></br>\n> </div>\n>\n> bar\n\nbaz\n',
	});
});

test('locates a parse failure on a later line of a region', async () => {
	await expect(
		formatWithNotices('<div>\n<x-bad   >foo</x-bad>\n</div>\n', [
			createFailingHTMLPlugin('parse'),
		])
	).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (2:1). Prettier can’t format this HTML:\n\nBad tag',
			],
		],
		output: '<div>\n<x-bad   >foo</x-bad>\n</div>\n',
	});
});

test('rejects the regions of a container whose HTML fails to format only together', async () => {
	const { html: parser } = pluginHTML.parsers;
	const plugin: Plugin = {
		parsers: {
			html: {
				...parser,
				parse(text, options) {
					// The markers stand for the Markdown between a container’s
					// blocks, so only their formatting together fails
					if (text.includes('data-prettier-markdown-html')) {
						throw new Error('Foo');
					}

					return parser.parse(text, options);
				},
			},
		},
	};

	await expect(
		formatWithNotices(
			'<div   >bar</div>\n\n> <div   >\n>\n> baz\n>\n> </div>\n',
			[plugin]
		)
	).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1). Prettier can’t format this HTML:\n\nFoo',
			],
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (3:3). Prettier can’t format this HTML:\n\nFoo',
			],
		],
		output: '<div   >bar</div>\n\n> <div   >\n>\n> baz\n>\n> </div>\n',
	});
});

test('removes properties that a failed layout added before trying again', async () => {
	vi.resetModules();
	vi.doMock('../format-inline-html/index.ts', async (importOriginal) => {
		const original = await importOriginal<typeof FormatInlineHTML>();

		return {
			...original,
			default: async (...args: Parameters<typeof original.default>) => {
				const [fragments] = args;

				for (const { node } of fragments) {
					Object.assign(node, { foo: true });
				}

				await Promise.resolve();

				throw Object.assign(new Error('Bar'), {
					loc: { start: { column: 5, line: 1 } },
				});
			},
		};
	});
	onTestFinished(() => {
		vi.doUnmock('../format-inline-html/index.ts');
	});
	const { default: preprocess } = await import('./index.ts');
	const input = 'foo <b   >bar</b>\n';
	const root = (await markdownParsers.markdown.parse(input, {
		originalText: input,
	} as ParserOptions)) as AST.Node;

	await preprocess(root, { ...OPTIONS, originalText: input });

	expect(
		root.children![0]!.children!.filter((node) => 'foo' in node)
	).toStrictEqual([]);
});

test('rejects only the nested region that Prettier can’t format', async () => {
	const { html: parser } = pluginHTML.parsers;
	const plugin: Plugin = {
		parsers: {
			html: {
				...parser,
				parse(text, options) {
					if (text.includes('id="bad"')) {
						throw new SyntaxError('Bad attribute');
					}

					return parser.parse(text, options);
				},
			},
		},
	};

	await expect(
		formatWithNotices(
			'<details   >\n\n<div id="bad">foo</div>\n\n<div   >bar</div>\n\n</details>\n',
			[plugin]
		)
	).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (3:1). Prettier can’t format this HTML:\n\nBad attribute',
			],
		],
		output: '<details>\n\n<div id="bad">foo</div>\n\n<div>bar</div>\n\n</details>\n',
	});
});

test('reports the nested region whose embedded code Prettier can’t format when `PRETTIER_DEBUG` is set', async () => {
	vi.stubEnv('PRETTIER_DEBUG', '1');
	onTestFinished(() => {
		vi.unstubAllEnvs();
	});

	await expect(
		format(
			'<details>\n\n<div><style>a { color: </style></div>\n\n</details>\n',
			{
				parser: 'markdown',
				plugins: [pluginMarkdownHTML],
			}
		)
	).rejects.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] \`PRETTIER_DEBUG\` stopped formatting (3:1). Prettier can’t format this HTML:

		CssSyntaxError: Unclosed block]
	`);
});

test('diagnoses a region with the accepted regions nested in it', async () => {
	const input =
		'<details><x-bad></x-bad>\n\n<div   >foo</div>\n\n</details>\n';

	await expect(
		formatWithNotices(input, [createFailingHTMLPlugin('print')])
	).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1). Prettier can’t format this HTML:\n\nFailed to print',
			],
		],
		output: input,
	});
});

test('diagnoses a failure with the options of the formatting that failed', async () => {
	const { html: printer } = pluginHTML.printers;
	const plugin: Plugin = {
		parsers: { html: pluginHTML.parsers.html },
		printers: {
			html: {
				...printer,
				print(path, options, print, args) {
					if (
						(path.node as { name?: string }).name === 'x-bad' &&
						options.printWidth < 80
					) {
						throw new Error('Too narrow');
					}

					return printer.print(path, options, print, args);
				},
			},
		},
	};

	await expect(
		formatWithNotices(
			'> <div   >foo</div>\n>\n> <x-bad   >\n> bar\n> </x-bad>\n',
			[plugin]
		)
	).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (3:3). Prettier can’t format this HTML:\n\nToo narrow',
			],
		],
		output: '> <div>foo</div>\n>\n> <x-bad   >\n> bar\n> </x-bad>\n',
	});
});

test('reports where the configured parser rejects a region', async () => {
	await expect(
		formatWithNotices(
			'<p   >foo</p>\n\n<div   ><x-bad>bar</x-bad></div>\n',
			[createFailingHTMLPlugin('parse')]
		)
	).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (3:9). Prettier can’t format this HTML:\n\nBad tag',
			],
		],
		output: '<p>foo</p>\n\n<div   ><x-bad>bar</x-bad></div>\n',
	});
});

test('leaves corrections out of rejected regions', async () => {
	await expect(
		formatWithNotices('foo <b>bar</img>\n', [])
	).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (1:5). Close `<b>` with `</b>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
			],
		],
		output: 'foo <b>bar</img>\n',
	});
});

test('decides corrections again after a layout attempt rejects a region they depended on', async () => {
	const input = '<div   ><x-bad>foo</x-bad>\n\nbar\n\n</div>\n\n</div>\n';

	await expect(
		formatWithNotices(input, [createFailingHTMLPlugin('print')])
	).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1). Prettier can’t format this HTML:\n\nFailed to print',
			],
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (7:1). No opening `<div>` matches this `</div>` in the same Markdown region.',
			],
		],
		output: input,
	});
});

test('restores inline HTML that a correction removed when a later layout attempt rejects its region', async () => {
	const input = '<img src="bar.png"\n width=200></img>\n';

	await expect(formatWithNotices(input, [])).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1). Formatting would leave this tag alone on the paragraph’s first line, where Prettier or GitHub Flavored Markdown would read it as an HTML block.',
			],
		],
		output: input,
	});
});

test('lays out inline HTML without removed closing tags on the first pass', async () => {
	const { notices, output } = await formatWithNotices(
		'<a href="https://example.com/foo/bar/baz/qux/quux/corge/grault/garply/waldo"><img src="fred.png" width="850"></img></a>\n',
		[]
	);

	expect(notices).toStrictEqual([]);
	expect(output).toBe(
		'<a href="https://example.com/foo/bar/baz/qux/quux/corge/grault/garply/waldo"><img\n  src="fred.png"\n  width="850"\n/></a>\n'
	);
	await expect(
		format(output, {
			parser: 'markdown',
			plugins: [pluginMarkdownHTML],
		})
	).resolves.toBe(output);
});

test('formats the HTML outside a container whose layout fails', async () => {
	const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);

	onTestFinished(() => {
		warn.mockRestore();
	});

	const output = await format(
		'<span   >x</span>\n\n- foo\n  <!-- bar --><div>baz</div>\n  **qux**\n- quux\n\n- corge\n',
		{ ...OPTIONS, parser: 'markdown', plugins: [pluginMarkdownHTML] }
	);

	expect(output).toBe(
		'<span>x</span>\n\n- foo\n  <!-- bar --><div>baz</div>\n    **qux**\n- quux\n\n- corge\n'
	);
	expect(warn.mock.calls).toStrictEqual([
		[
			'[prettier-plugin-markdown-html] Skipped HTML formatting (4:3). After formatting, this HTML block would remain open in GitHub Flavored Markdown and include the Markdown that follows.',
		],
	]);
});
