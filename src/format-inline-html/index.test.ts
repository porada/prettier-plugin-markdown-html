import type { ParserOptions, Plugin } from 'prettier';
import type { AST } from '../types/index.d.ts';
import { format } from 'prettier';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test } from 'vite-plus/test';
import * as pluginMarkdownHTML from '../index.ts';
import formatInlineHTML, { formatInlineTagName } from './index.ts';

const OPTIONS = { printWidth: 30, tabWidth: 4 } as ParserOptions;

async function parseParagraph(source: string): Promise<{
	fragment: AST.Fragment;
	layout: AST.InlineLayout;
}> {
	const root = (await pluginMarkdown.parsers.markdown.parse(
		source,
		{} as ParserOptions
	)) as AST.Node;
	const paragraph = root.children![0]!;
	const node = paragraph.children!.find(
		(child) => child.type === 'html'
	) as AST.HTMLNode;

	return {
		fragment: createFragment(node.value, {
			block: paragraph,
			end: node.position!.end.offset!,
			node,
			parent: paragraph,
			start: node.position!.start.offset!,
		}),
		layout: { containerEdge: 0, containers: [], contentEdge: 0, paragraph },
	};
}

function createPositionStrippingPlugin(type: string): Plugin {
	const { preprocess } = pluginMarkdown.printers.mdast;

	return {
		parsers: { markdown: pluginMarkdown.parsers.markdown },
		printers: {
			mdast: {
				...pluginMarkdown.printers.mdast,
				async preprocess(ast, options) {
					const root = (await preprocess!(ast, options)) as AST.Node;
					const pending = [root];

					for (const node of pending) {
						if (node.type === type) {
							delete node.position;
							break;
						}

						pending.push(...(node.children ?? []));
					}

					return root;
				},
			},
		},
	};
}

function createFragment(
	value: string,
	overrides: Partial<AST.Fragment> = {}
): AST.Fragment {
	const node: AST.HTMLNode = { type: 'html', value };

	return {
		block: undefined,
		end: value.length,
		isBlock: false,
		isInTableCell: false,
		isSingleLine: false,
		node,
		parent: { children: [node], type: 'paragraph' },
		start: 0,
		...overrides,
	};
}

test('formats opening tags without their closing tags', async () => {
	const fragment = createFragment('<span   id = "foo">');
	const formattedNodes = new WeakSet<AST.Node>();

	await formatInlineHTML(
		[fragment],
		undefined,
		new Set(),
		OPTIONS,
		formattedNodes
	);

	expect(fragment.node.value).toBe('<span id="foo">');
	expect(formattedNodes.has(fragment.node)).toBe(true);
});

test('formats void and closing tags', async () => {
	const voidFragment = createFragment('<img   src="foo.png">');
	const closingFragment = createFragment('</span   >');

	await formatInlineHTML(
		[voidFragment],
		undefined,
		new Set(),
		OPTIONS,
		new WeakSet()
	);
	await formatInlineHTML(
		[closingFragment],
		undefined,
		new Set(),
		OPTIONS,
		new WeakSet()
	);

	expect(voidFragment.node.value).toBe('<img src="foo.png" />');
	expect(closingFragment.node.value).toBe('</span>');
});

test('keeps other HTML tokens and protected content unchanged', async () => {
	const commentFragment = createFragment('<!--   foo   -->');
	const protectedFragment = createFragment('<span   id = "bar">');
	const formattedNodes = new WeakSet<AST.Node>();

	await formatInlineHTML(
		[commentFragment],
		undefined,
		new Set(),
		OPTIONS,
		formattedNodes
	);
	await formatInlineHTML(
		[protectedFragment],
		undefined,
		new Set([protectedFragment.node]),
		OPTIONS,
		formattedNodes
	);

	expect(commentFragment.node.value).toBe('<!--   foo   -->');
	expect(protectedFragment.node.value).toBe('<span   id = "bar">');
	expect(formattedNodes.has(commentFragment.node)).toBe(false);
	expect(formattedNodes.has(protectedFragment.node)).toBe(false);
});

test('lays out opening tags at their position in the paragraph', async () => {
	const source = 'foo bar<span title="baz" data-qux="quux">corge</span>\n';
	const { fragment, layout } = await parseParagraph(source);

	await formatInlineHTML(
		[fragment],
		layout,
		new Set(),
		{ ...OPTIONS, originalText: source, printWidth: 40 },
		new WeakSet()
	);

	expect(fragment.node.value).toBe(
		'<span title="baz" data-qux="quux"\n    >'
	);
});

test('lays out final opening tags without content after them', async () => {
	const source = '<rt\ntitle="foo" data-bar="baz">\n';
	const { fragment, layout } = await parseParagraph(source);

	await formatInlineHTML(
		[fragment],
		layout,
		new Set(),
		{ ...OPTIONS, originalText: source, printWidth: 32 },
		new WeakSet()
	);

	expect(fragment.node.value).toBe(
		'<rt\n    title="foo"\n    data-bar="baz">'
	);
});

test('rejoins brackets whose lines would start block quotes', async () => {
	const source = 'foo bar<span title="baz" data-qux="quux">corge</span>\n';
	const { fragment, layout } = await parseParagraph(source);

	await formatInlineHTML(
		[fragment],
		layout,
		new Set(),
		{ ...OPTIONS, originalText: source, printWidth: 40, tabWidth: 2 },
		new WeakSet()
	);

	expect(fragment.node.value).toBe('<span title="baz" data-qux="quux">');
});

test('keeps one-line forms where attribute lines would start HTML blocks', async () => {
	const source = 'foo bar <img srcset="<source 1x, baz.png 2x" alt="qux">\n';
	const { fragment, layout } = await parseParagraph(source);

	await formatInlineHTML(
		[fragment],
		layout,
		new Set(),
		{ ...OPTIONS, originalText: source, tabWidth: 1 },
		new WeakSet()
	);

	expect(fragment.node.value).toBe(
		'<img srcset="<source 1x, baz.png 2x" alt="qux" />'
	);
});

test('keeps brackets on the last attribute line where value lines would start with block tags', async () => {
	const source = 'foo <img title="bar\n<meta baz" alt="qux">\n';
	const { fragment, layout } = await parseParagraph(source);

	await formatInlineHTML(
		[fragment],
		layout,
		new Set(),
		{ ...OPTIONS, originalText: source, tabWidth: 2 },
		new WeakSet()
	);

	expect(fragment.node.value).toBe(
		'<img\n  title="bar\n<meta baz"\n  alt="qux" />'
	);
});

test.each([
	{
		input: 'foo bar baz <abbr  title="qux" lang="quux">corge</abbr> grault garply waldo\n',
		output: 'foo bar baz\n<abbr title="qux" lang="quux">corge</abbr>\ngrault garply waldo\n',
		place: 'at the document root',
	},
	{
		input: '> foo bar baz <abbr  title="qux">quux</abbr> corge grault garply\n',
		output: '> foo bar baz\n> <abbr title="qux">quux</abbr>\n> corge grault garply\n',
		place: 'in block quotes',
	},
	{
		input: '- foo\n  - bar baz qux <abbr  title="quux">corge</abbr> grault garply waldo\n',
		output: '- foo\n  - bar baz qux\n    <abbr title="quux">corge</abbr>\n    grault garply waldo\n',
		place: 'in nested lists',
	},
])(
	'formats wrapped paragraphs with inline HTML $place',
	async ({ input, output: expectedOutput }) => {
		const options = {
			parser: 'markdown',
			plugins: [pluginMarkdownHTML],
			printWidth: 30,
			proseWrap: 'always' as const,
		};

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test('lays out tags after lazy lines of equals signs that Prettier joins', async () => {
	const options = {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
		printWidth: 42,
		proseWrap: 'never' as const,
	};

	const output = await format(
		'> foo\n===\nbar <abbr  title="baz" lang="qux">quux</abbr>\n',
		options
	);

	expect(output).toBe(
		'> foo === bar <abbr title="baz" lang="qux">quux</abbr>\n'
	);
	await expect(format(output, options)).resolves.toBe(output);
});

test('lays out tags after no-break spaces that end lines Prettier joins', async () => {
	const options = {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
		printWidth: 40,
		proseWrap: 'never' as const,
	};

	const output = await format(
		'foo \nbar <span title="baz qux" lang="qux">quux</span>\n',
		options
	);

	expect(output).toBe(
		'foo  bar <span\n  title="baz qux"\n  lang="qux">quux</span>\n'
	);
	await expect(format(output, options)).resolves.toBe(output);
});

test('reports wrapping that would open a math block on a later line', async () => {
	await expect(
		format('foo <b   >bar</b> $$\n', {
			parser: 'markdown',
			plugins: [pluginMarkdownHTML],
			printWidth: 14,
			proseWrap: 'always',
		})
	).rejects.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

		After formatting, this paragraph’s lines would no longer read as one paragraph, which would change the context of its HTML]
	`);
});

test('keeps one-line forms where tag layouts would wrap math blocks onto later lines', async () => {
	const options = {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
		printWidth: 14,
		proseWrap: 'always' as const,
	};

	const output = await format(
		'> foo <abbr  title="bar" lang="baz">qux</abbr> corge $$\n',
		options
	);

	expect(output).toBe(
		'> foo\n> <abbr title="bar" lang="baz">qux</abbr>\n> corge $$\n'
	);
	await expect(format(output, options)).resolves.toBe(output);
});

test('formats task list paragraphs whose indented later lines can’t open math blocks', async () => {
	const options = {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
		printWidth: 20,
		proseWrap: 'always' as const,
	};

	const output = await format('- [ ] foo <b   >bar</b> $$\n', options);

	expect(output).toBe('- [ ] foo <b>bar</b>\n      $$\n');
	await expect(format(output, options)).resolves.toBe(output);
});

test.each([
	{
		context: 'in task list paragraphs',
		input: '- [ ] foo <b  :--- title="bar">baz</b>\n',
		output: '- [ ] foo <b :--- title="bar">baz</b>\n',
		tabWidth: 2,
	},
	{
		context: 'in paragraphs that can’t be measured on their own',
		input: '<span  :--- title="longer"> ![qux <i>quux</i>][r]</span>\n\n[r]: /x\n',
		output: '<span :--- title="longer"> ![qux <i>quux</i>][r]</span>\n\n[r]: /x\n',
		tabWidth: 4,
	},
])(
	'keeps one-line forms where indented tag lines would have the syntax of delimiter rows $context',
	async ({ input, output: expectedOutput, tabWidth }) => {
		const options = {
			parser: 'markdown',
			plugins: [pluginMarkdownHTML],
			printWidth: 20,
			tabWidth,
		};

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test('lays out leading tags in paragraphs that can’t be measured on their own', async () => {
	const input =
		'<span  title="foo" data-bar="baz"> ![qux <i>quux</i>][corge]</span>\n\n[corge]: /grault\n';
	const options = {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
		printWidth: 30,
	};

	const output = await format(input, options);

	expect(output).toBe(
		'<span\n  title="foo"\n  data-bar="baz"> ![qux <i>quux</i>][corge]</span>\n\n[corge]: /grault\n'
	);
	await expect(format(output, options)).resolves.toBe(output);
});

test.each([
	{
		input: 'foo <span   title="bar">baz</span> qux\n',
		output: 'foo <span title="bar">baz</span> qux\n',
		type: 'sentence',
	},
	{
		input: 'foo bar<span   title="baz" data-qux="quux">corge</span>\n',
		output: 'foo bar<span title="baz" data-qux="quux">corge</span>\n',
		type: 'html',
	},
])(
	'formats paragraphs whose first `$type` node has no position',
	async ({ input, output: expectedOutput, type }) => {
		const options = {
			parser: 'markdown',
			plugins: [createPositionStrippingPlugin(type), pluginMarkdownHTML],
			printWidth: 30,
		};

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test('lays out leading tags before hard line breaks without positions', async () => {
	const source = '<img\nsrc="foo.png"   alt="bar">\\\nbaz\n';
	const { fragment, layout } = await parseParagraph(source);
	delete layout.paragraph.children![1]!.position;

	await formatInlineHTML(
		[fragment],
		layout,
		new Set(),
		{ ...OPTIONS, originalText: source },
		new WeakSet()
	);

	expect(fragment.node.value).toBe(
		'<img\n    src="foo.png"\n    alt="bar"\n/>'
	);
});

test('keeps tags on one line without a paragraph layout', async () => {
	const fragment = createFragment(
		'<span title="foo" data-bar="baz" data-qux="quux">'
	);

	await formatInlineHTML(
		[fragment],
		undefined,
		new Set(),
		OPTIONS,
		new WeakSet()
	);

	expect(fragment.node.value).toBe(
		'<span title="foo" data-bar="baz" data-qux="quux">'
	);
});

test('keeps tags on one line in headings and table cells', async () => {
	const fragment = createFragment(
		'<span title="foo" data-bar="baz|qux" data-quux="corge">',
		{ isInTableCell: true, isSingleLine: true }
	);
	fragment.node.value = String.raw`<span title="foo" data-bar="baz\|qux" data-quux="corge">`;

	await formatInlineHTML(
		[fragment],
		undefined,
		new Set(),
		{ ...OPTIONS, singleAttributePerLine: true },
		new WeakSet()
	);

	expect(fragment.node.value).toBe(
		String.raw`<span title="foo" data-bar="baz\|qux" data-quux="corge">`
	);
});

test('keeps protected tags at the start of paragraphs as written', async () => {
	const input =
		'<div><pre>\n\n<span  title = "foo"> bar</span>\n\n</pre>\n</div>\n';
	const options = { parser: 'markdown', plugins: [pluginMarkdownHTML] };

	const output = await format(input, options);

	expect(output).toBe(
		'<div>\n  <pre>\n\n<span  title = "foo"> bar</span>\n\n</pre>\n</div>\n'
	);
	await expect(format(output, options)).resolves.toBe(output);
});

test('keeps the names of tags that inline formatting preserves', async () => {
	await expect(
		formatInlineTagName('über', false, OPTIONS, undefined)
	).resolves.toBe('über');
	await expect(
		formatInlineTagName('über', true, OPTIONS, undefined)
	).resolves.toBe('über');
});
