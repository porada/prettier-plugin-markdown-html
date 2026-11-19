import type { Options, ParserOptions, Plugin } from 'prettier';
import type { AST } from '../types/index.d.ts';
import { format } from 'prettier';
import {
	parsers as markdownParsers,
	printers as markdownPrinters,
} from 'prettier/plugins/markdown';
import { expect, onTestFinished, test, vi } from 'vite-plus/test';
import * as pluginMarkdownHTML from '../index.ts';
import formatBlockHTML from './index.ts';

const OPTIONS = { printWidth: 80, tabWidth: 4 } as ParserOptions;

const FORMAT_OPTIONS = {
	parser: 'markdown',
	plugins: [pluginMarkdownHTML],
	printWidth: 80,
	tabWidth: 4,
} satisfies Options;

function createScope(
	children: AST.Node[],
	overrides: Partial<AST.BlockScope> = {}
): AST.BlockScope {
	return {
		activeIgnoreComments: new Set(),
		ancestors: [],
		blockFragments: new Set(children.filter(({ type }) => type === 'html')),
		children,
		endsOpenBlocks: true,
		formattedNodes: new WeakSet(),
		ignoredNodes: new Set(),
		inlineClosingTags: new Map(),
		inlineOpeners: new Map(),
		isListItem: false,
		isPrintedTight: false,
		isTight: false,
		prefixWidth: 0,
		protectedEnds: new Set(),
		protectedStarts: new Set(),
		trailingInlineClosingTags: [],
		...overrides,
	};
}

function html(value: string): AST.HTMLNode {
	return { type: 'html', value };
}

function point(line: number): AST.Point {
	return { column: 1, line };
}

test('lays out fragments that share elements across Markdown', async () => {
	const opening = html('<table>\n<tr>\n<td>\n<div>');
	const middle = html(
		'</div>\n</td>\n<td>\n<div>\n<div>\n<p>bar</p>\n</div>'
	);
	const closing = html('  </div>\n</td>\n</tr>\n</table>');
	const children = [
		opening,
		{ type: 'paragraph' },
		middle,
		{ type: 'paragraph' },
		closing,
	];

	const result = await formatBlockHTML(createScope(children), OPTIONS);

	expect(result).toStrictEqual(children);
	expect(opening.value).toBe(
		'<table>\n    <tr>\n        <td>\n            <div>'
	);
	expect(middle.value).toBe(
		'</div>\n        </td>\n        <td>\n            <div>\n                <div>\n                    <p>bar</p>\n                </div>'
	);
	expect(closing.value).toBe('</div>\n        </td>\n    </tr>\n</table>');
});

test('indents fragments for raw ancestors outside their container', async () => {
	const node = html('<p>\nfoo\n</p>\n<p>bar</p>');

	await formatBlockHTML(createScope([node], { ancestors: ['div'] }), OPTIONS);

	expect(node.value).toBe('<p>foo</p>\n    <p>bar</p>');
});

test('adds closing tags that Prettier supplies at the end of a scope', async () => {
	const last = html('<ul><li>foo');
	const opening = html('<div>');
	const paragraph = { type: 'paragraph' };

	const lastResult = await formatBlockHTML(createScope([last]), OPTIONS);
	const paragraphResult = await formatBlockHTML(
		createScope([opening, paragraph]),
		OPTIONS
	);

	expect(lastResult).toStrictEqual([last]);
	expect(last.value).toBe('<ul>\n    <li>foo</li>\n</ul>');
	expect(paragraphResult).toStrictEqual([
		opening,
		paragraph,
		{ position: undefined, type: 'html', value: '</div>' },
	]);
});

test('separates the first tag of a non-block HTML block from its content', async () => {
	const node = html(
		'<span   title="foo" data-bar="baz" data-qux="quux" data-corge="grault" data-garply="waldo">\n**fred**\n</span>'
	);

	await formatBlockHTML(createScope([node]), OPTIONS);

	expect(node.value).toBe(
		'<span title="foo" data-bar="baz" data-qux="quux" data-corge="grault" data-garply="waldo">\n    **fred**\n</span>'
	);
});

test('narrows the print width by the container prefix', async () => {
	const node = html('<p title="foo">bar baz qux</p>');

	await formatBlockHTML(createScope([node], { prefixWidth: 10 }), {
		...OPTIONS,
		printWidth: 34,
	});

	expect(node.value).toBe('<p title="foo">\n    bar baz qux\n</p>');
});

test('keeps ignored fragments unchanged', async () => {
	const ignored = html('<div   id="foo">');
	const closing = html('</div>');

	await formatBlockHTML(
		createScope([ignored, { type: 'paragraph' }, closing], {
			ignoredNodes: new Set([ignored]),
		}),
		OPTIONS
	);

	expect(ignored.value).toBe('<div   id="foo">');
	expect(closing.value).toBe('</div>');
});

test('keeps whitespace that starts or ends inside preformatted content', async () => {
	const opening = html('<div><pre>\n  foo  ');
	const closing = html('  <div>bar</div>\n</pre></div>');

	await formatBlockHTML(
		createScope([opening, { type: 'paragraph' }, closing], {
			protectedEnds: new Set([opening]),
			protectedStarts: new Set([closing]),
		}),
		OPTIONS
	);

	expect(opening.value).toBe('<div>\n    <pre>\n  foo  ');
	expect(closing.value).toBe('  <div>bar</div>\n</pre>\n</div>');
});

test('rejects HTML blocks that GFM reads as Markdown', async () => {
	const node = html('<hgroup>foo</hgroup>');

	await expect(
		formatBlockHTML(createScope([node]), { ...OPTIONS, filepath: 'foo.md' })
	).rejects.toThrow(
		'[prettier-plugin-markdown-html] Unsupported Markdown in `foo.md`'
	);
});

test('rejects HTML blocks that interrupt a paragraph only for Prettier', async () => {
	const paragraph = {
		position: { end: point(1), start: point(1) },
		type: 'paragraph',
	};
	const node: AST.HTMLNode = {
		position: { end: point(2), start: point(2) },
		type: 'html',
		value: '<search>',
	};

	await expect(
		formatBlockHTML(createScope([paragraph, node]), OPTIONS)
	).rejects.toThrow('[prettier-plugin-markdown-html] Unsupported Markdown');
});

test('reports HTML around Markdown blocks that Prettier’s HTML parser rejects', async () => {
	const opening = html('<p>');
	const closing = html('</p>');

	await expect(
		formatBlockHTML(
			createScope([opening, { type: 'code' }, closing]),
			OPTIONS
		)
	).rejects.toThrowErrorMatchingInlineSnapshot(`
		[SyntaxError: [prettier-plugin-markdown-html] Failed to format HTML with Prettier:

		Unexpected closing tag "p". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags]
	`);
});

test('rejects Markdown whose place Prettier’s HTML output loses', async () => {
	const opening = html('<div><script>');
	const closing = html('</script>\n</div>');

	await expect(
		formatBlockHTML(
			createScope([opening, { type: 'paragraph' }, closing], {
				protectedEnds: new Set([opening]),
			}),
			OPTIONS
		)
	).rejects.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout:

		The plugin can’t restore the Markdown between these HTML blocks to its original place after Prettier formats the HTML]
	`);
});

test.each([
	{
		input: '<!--[if IE]><p   class="foo">bar</p><![endif]-->\n\n<div   >baz</div>\n',
		output: '<!--[if IE]><p class="foo">bar</p><![endif]-->\n\n<div>baz</div>\n',
	},
	{
		input: '<div   >foo</div>\n\n<!--<!  [endif]-->\n\n<div   >bar</div>\n',
		output: '<div>foo</div>\n\n<!--<![endif]-->\n\n<div>bar</div>\n',
	},
])(
	'formats conditional comments directly before other HTML blocks',
	async ({ input, output: expectedOutput }) => {
		const output = await format(input, FORMAT_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, FORMAT_OPTIONS)).resolves.toBe(output);
	}
);

test('keeps omitted closing tags of elements that close in ignored fragments', async () => {
	const input =
		'<ul   class="foo">\n\n<!-- prettier-ignore -->\n<li><li>bar\n\n</ul>\n';

	const output = await format(input, FORMAT_OPTIONS);

	expect(output).toBe(
		'<ul class="foo">\n\n<!-- prettier-ignore -->\n<li><li>bar\n\n</ul>\n'
	);
	await expect(format(output, FORMAT_OPTIONS)).resolves.toBe(output);
});

test('rejects renamed tags after HTML ignore directives in fragments that end with another directive', async () => {
	await expect(
		format(
			'<ul><li><!-- prettier-ignore --><SPAN   >foo</SPAN><!-- prettier-ignore -->\n\n<li>bar</ul>\n',
			FORMAT_OPTIONS
		)
	).rejects.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

		Formatting would give this \`<SPAN>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
	`);
});

test('keeps Markdown inside CDATA sections that span HTML blocks', async () => {
	const input = '<div   class="foo"><![CDATA[ bar\n\nbaz\n\n<div>]]></div>\n';

	const output = await format(input, FORMAT_OPTIONS);

	expect(output).toBe(
		'<div class="foo">\n    <![CDATA[ bar\n\nbaz\n\n<div>]]>\n</div>\n'
	);
	await expect(format(output, FORMAT_OPTIONS)).resolves.toBe(output);
});

test('keeps processing instructions that Prettier ends in the next HTML block', async () => {
	const input = '<div   class="foo"><?bar\n\n<!-- baz -->\n';

	const output = await format(input, FORMAT_OPTIONS);

	expect(output).toBe(
		'<div class="foo">\n    <?bar\n\n<!-- baz -->\n</div>\n'
	);
	await expect(format(output, FORMAT_OPTIONS)).resolves.toBe(output);
});

test('keeps less-than signs that start no markup', async () => {
	const input = '<div   class="foo">bar < baz</div>\n';

	const output = await format(input, FORMAT_OPTIONS);

	expect(output).toBe('<div class="foo">bar < baz</div>\n');
	await expect(format(output, FORMAT_OPTIONS)).resolves.toBe(output);
});

test('keeps HTML paragraphs open around link reference definitions', async () => {
	const input = '<p   id="foo">\n\n[bar]: /baz\n\n</p>\n';

	const output = await format(input, FORMAT_OPTIONS);

	expect(output).toBe('<p id="foo">\n\n[bar]: /baz\n\n</p>\n');
	await expect(format(output, FORMAT_OPTIONS)).resolves.toBe(output);
});

test('keeps opening tags on their own lines when Prettier adds closing tags after them', async () => {
	const input = '<ruby>\nfoo\n\n<rp>\n\n<rt>\nbar\n</rt>\n</ruby>\n';

	const output = await format(input, FORMAT_OPTIONS);

	expect(output).toBe(
		'<ruby>\n    foo\n\n<rp>\n    </rp>\n\n<rt>\n        bar\n    </rt>\n</ruby>\n'
	);
	await expect(format(output, FORMAT_OPTIONS)).resolves.toBe(output);
});

test('keeps first tags on one line when Prettier breaks their attribute values', async () => {
	const input =
		'<span style="color: red; background: blue; font-size: 12px; font-family: sans-serif; margin: 0 auto;">\nfoo\n</span>\n';

	const output = await format(input, FORMAT_OPTIONS);

	expect(output).toBe(
		'<span style="color: red; background: blue; font-size: 12px; font-family: sans-serif; margin: 0 auto">\n    foo\n</span>\n'
	);
	await expect(format(output, FORMAT_OPTIONS)).resolves.toBe(output);
});

test('leaves blocks open when the HTML they take in reads the same after a blank line', async () => {
	const node: AST.HTMLNode = {
		position: { end: point(1), start: point(1) },
		type: 'html',
		value: '<!-- foo --><div>bar</div>',
	};
	const next: AST.HTMLNode = {
		position: { end: point(4), start: point(2) },
		type: 'html',
		value: '<!-- baz -->\n\n<div>qux</div>',
	};

	await formatBlockHTML(createScope([node, next]), OPTIONS);

	expect(node.value).toBe('<!-- foo -->\n<div>bar</div>');
	expect(next.value).toBe('<!-- baz -->\n\n<div>qux</div>');
});

test.each([
	{
		input: '<p   id="foo">\n\n[^1]: bar\n\n</p>\n',
		output: '<p id="foo">\n\n[^1]: bar\n\n</p>\n',
	},
	{
		input: '> <p   id="foo">\n>\n> [^1]: bar\n>\n> </p>\n',
		output: '> <p id="foo">\n>\n> [^1]: bar\n>\n> </p>\n',
	},
	{
		input: '- <p   id="foo">\n\n  [^1]: bar\n\n  </p>\n',
		output: '- <p id="foo">\n\n    [^1]: bar\n\n  </p>\n',
	},
	{
		input: '1.  > <p   id="foo">\n    >\n    > [^1]: bar\n    >\n    > </p>\n',
		output: '1.  > <p id="foo">\n    >\n    > [^1]: bar\n    >\n    > </p>\n',
	},
])(
	'keeps HTML paragraphs open around footnote definitions',
	async ({ input, output: expectedOutput }) => {
		const output = await format(input, FORMAT_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, FORMAT_OPTIONS)).resolves.toBe(output);
	}
);

test('closes HTML paragraphs before footnote definition content that GFM reads as code', async () => {
	const input = '<div   id="foo"><p>bar\n\n[^1]: baz\n\n    qux\n\n</div>\n';

	const output = await format(input, FORMAT_OPTIONS);

	expect(output).toBe(
		'<div id="foo">\n    <p>bar</p>\n\n[^1]: baz\n\n    qux\n\n</div>\n'
	);
	await expect(format(output, FORMAT_OPTIONS)).resolves.toBe(output);
});

test('treats footnote definitions without source positions as rendering content', async () => {
	const opening = html('<div   id="foo"><p>bar');
	const closing = html('</div>');

	await formatBlockHTML(
		createScope([
			opening,
			{ children: [{ type: 'paragraph' }], type: 'footnoteDefinition' },
			closing,
		]),
		OPTIONS
	);

	expect(opening.value).toBe('<div id="foo">\n    <p>bar</p>');
	expect(closing.value).toBe('</div>');
});

test('treats footnote definitions without an end offset as rendering content', async () => {
	const priorPlugin: Plugin = {
		parsers: { markdown: markdownParsers.markdown },
		printers: {
			mdast: {
				...markdownPrinters.mdast,
				async preprocess(ast, options) {
					const root = (await markdownPrinters.mdast.preprocess!.call(
						markdownPrinters.mdast,
						ast,
						options
					)) as AST.RootNode;
					const footnote = root.children.find(
						({ type }) => type === 'footnoteDefinition'
					)!;

					delete footnote.position!.end.offset;
					return root;
				},
			},
		},
	};
	const options = {
		...FORMAT_OPTIONS,
		plugins: [priorPlugin, pluginMarkdownHTML],
	};
	const input = '<div   >\n\n[^foo]: bar\n\n</div>\n';

	const output = await format(input, options);

	expect(output).toBe('<div>\n\n[^foo]: bar\n\n</div>\n');
	await expect(format(output, options)).resolves.toBe(output);
});

test('reads footnote definitions again when another formatting run reuses them', async () => {
	const footnote: AST.Node = {};
	const priorPlugin: Plugin = {
		parsers: { markdown: markdownParsers.markdown },
		printers: {
			mdast: {
				...markdownPrinters.mdast,
				async preprocess(ast, options) {
					const root = (await markdownPrinters.mdast.preprocess!.call(
						markdownPrinters.mdast,
						ast,
						options
					)) as AST.RootNode;
					const index = root.children.findIndex(
						({ type }) => type === 'footnoteDefinition'
					);

					// Only the documents under test share the node, while readings of
					// single constructs keep their own
					if (
						index === -1 ||
						!root.children.some(({ type }) => type === 'html')
					) {
						return root;
					}

					Object.assign(footnote, root.children[index]);
					root.children[index] = footnote;
					return root;
				},
			},
		},
	};
	const options = {
		...FORMAT_OPTIONS,
		plugins: [priorPlugin, pluginMarkdownHTML],
	};
	await format('<div   ><p>foo\n\n[^x]: bar\n\n</div>\n', options);
	const input = '<div   ><p>foo\n\n[^x]: bar\n\n    baz\n\n</div>\n';

	const output = await format(input, options);

	expect(output).toBe(
		'<div>\n    <p>foo</p>\n\n[^x]: bar\n\n    baz\n\n</div>\n'
	);
	await expect(format(output, options)).resolves.toBe(output);
});

test('reads the document once for any number of footnote definitions', async () => {
	const parse = vi.spyOn(markdownParsers.markdown, 'parse');
	onTestFinished(() => {
		parse.mockRestore();
	});

	async function countDocumentParses(input: string): Promise<number> {
		parse.mockClear();
		await format(input, FORMAT_OPTIONS);
		return parse.mock.calls.filter(([text]) => text === input).length;
	}

	const expectedParseCount = await countDocumentParses(
		'<div>\n\n[^1]: foo\n\n</div>\n'
	);
	const parseCount = await countDocumentParses(
		'<div>\n\n[^1]: foo\n\n[^2]: bar\n\n[^3]: baz\n\n</div>\n'
	);

	expect(parseCount).toBe(expectedParseCount);
});

test('reads each document once when formatting documents at the same time', async () => {
	const parse = vi.spyOn(markdownParsers.markdown, 'parse');
	onTestFinished(() => {
		parse.mockRestore();
	});

	function createInput(name: string, quoteCount: number): string {
		return Array.from(
			{ length: quoteCount },
			(_, index) => `> <div>\n>\n> [^${name}${index}]: foo\n>\n> </div>\n`
		).join('\n');
	}

	function countDocumentParses(input: string): number {
		return parse.mock.calls.filter(([text]) => text === input).length;
	}

	const baseInput = createInput('foo', 1);
	await format(baseInput, FORMAT_OPTIONS);
	const expectedParseCount = countDocumentParses(baseInput);
	const inputs = [createInput('bar', 5), createInput('baz', 5)];

	await Promise.all(
		inputs.map(async (input) => format(input, FORMAT_OPTIONS))
	);

	expect(inputs.map(countDocumentParses)).toStrictEqual([
		expectedParseCount,
		expectedParseCount,
	]);
});

test('reads footnote definitions as written where Prettier’s Markdown parser finds none', async () => {
	const originalText = '<p>\n\n    [^1]: foo\n\n</p>\n';
	const opening = html('<p>');
	const closing = html('</p>');

	await formatBlockHTML(
		createScope([
			opening,
			{
				children: [{ type: 'paragraph' }],
				position: {
					end: { column: 14, line: 3, offset: 18 },
					start: { column: 5, line: 3, offset: 9 },
				},
				type: 'footnoteDefinition',
			},
			closing,
		]),
		{ ...OPTIONS, originalText }
	);

	expect(opening.value).toBe('<p>');
	expect(closing.value).toBe('</p>');
});

test('keeps protected content in other fragments when checking the next pass', async () => {
	const separated = html(
		'<!-- foo --><!-- prettier-ignore --><div>bar</div>'
	);
	const opening = html('<div><pre>\n  baz  ');
	const closing = html('  <div>qux</div>\n</pre></div>');

	await formatBlockHTML(
		createScope(
			[
				separated,
				{ type: 'paragraph' },
				opening,
				{ type: 'paragraph' },
				closing,
			],
			{
				protectedEnds: new Set([opening]),
				protectedStarts: new Set([closing]),
			}
		),
		OPTIONS
	);

	expect(separated.value).toBe(
		'<!-- foo --><!-- prettier-ignore -->\n<div>bar</div>'
	);
	expect(opening.value).toBe('<div>\n    <pre>\n  baz  ');
	expect(closing.value).toBe('  <div>qux</div>\n</pre>\n</div>');
});

test('rejects HTML ignore directives that formatting would separate from what they protect', async () => {
	await expect(
		format(
			'<!-- foo --><!-- prettier-ignore --><div   >bar</div>\n',
			FORMAT_OPTIONS
		)
	).rejects.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

		After formatting, the HTML that an ignore directive in this HTML block protects would start an HTML block of its own, so formatting the result again would change it]
	`);
	await expect(
		format(
			'<!-- foo --><!-- prettier-ignore-attribute foo > class --><div class="bar  baz">qux</div>\n',
			FORMAT_OPTIONS
		)
	).rejects.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

		After formatting, the HTML that an ignore directive in this HTML block protects would start an HTML block of its own, so formatting the result again would change it]
	`);
	await expect(
		format(
			'<!-- prettier-ignore --><div   >\n\nfoo\n\n<p   >bar</p></div>\n',
			FORMAT_OPTIONS
		)
	).rejects.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

		After formatting, the HTML that an ignore directive in this HTML block protects would start an HTML block of its own, so formatting the result again would change it]
	`);
	await expect(
		format(
			'<!-- foo --><!-- prettier-ignore --><div>\n\nbar\n',
			FORMAT_OPTIONS
		)
	).rejects.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

		After formatting, the HTML that an ignore directive in this HTML block protects would start an HTML block of its own, so formatting the result again would change it]
	`);
});

test('rejects HTML ignore directives that formatting would separate from split elements with uppercase names', async () => {
	await expect(
		format(
			'<!-- prettier-ignore --><DIV   class="foo"><!-- prettier-ignore -->\n\nbar\n\n</DIV>\n',
			FORMAT_OPTIONS
		)
	).rejects.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

		Formatting would give this \`<DIV>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
	`);
	await expect(
		format(
			'<!-- prettier-ignore\n--><DIV   >\n\nfoo\n\n</DIV>\n',
			FORMAT_OPTIONS
		)
	).rejects.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

		Formatting would give this \`<DIV>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
	`);
});

test.each([
	{
		input: '<!-- foo --><!-- prettier-ignore --><div>bar</div>\n',
		output: '<!-- foo --><!-- prettier-ignore -->\n<div>bar</div>\n',
	},
	{
		input: '<!-- prettier_ignore --><!-- prettier-ignore --><div>bar</div>\n',
		output: '<!-- prettier_ignore --><!-- prettier-ignore -->\n<div>bar</div>\n',
	},
	{
		input: '<!-- foo --><!-- prettier-ignore --><b   >bar</b><div   >baz</div>\n',
		output: '<!-- foo --><!-- prettier-ignore --><b   >bar</b>\n<div>baz</div>\n',
	},
	{
		input: '<!-- prettier-ignore --><div   >foo</div>\n',
		output: '<!-- prettier-ignore -->\n<div   >foo</div>\n',
	},
	{
		input: '<!-- prettier-ignore --><DIV   >foo</DIV>\n',
		output: '<!-- prettier-ignore -->\n<DIV   >foo</DIV>\n',
	},
	{
		input: '<!-- prettier-ignore --><DIV   class="foo">\n\nbar\n\n<!-- prettier-ignore -->\n</DIV>\n',
		output: '<!-- prettier-ignore -->\n<DIV   class="foo">\n\nbar\n\n<!-- prettier-ignore -->\n</DIV>\n',
	},
	{
		input: '<!-- prettier-ignore --><p   >foo</p><section><!-- prettier-ignore --><DIV   class="bar">\n\nbaz\n\n</DIV></section>\n',
		output: '<!-- prettier-ignore -->\n<p   >foo</p>\n<section>\n    <!-- prettier-ignore -->\n    <DIV   class="bar">\n\nbaz\n\n</DIV>\n</section>\n',
	},
	{
		input: '<!-- prettier-ignore-attribute --><div   class="foo  bar">baz</div>\n',
		output: '<!-- prettier-ignore-attribute -->\n<div class="foo  bar">baz</div>\n',
	},
	{
		input: '<div><!-- prettier-ignore --><DIV   class="foo">\n\nbar\n\n</DIV></div>\n',
		output: '<div>\n    <!-- prettier-ignore -->\n    <DIV   class="foo">\n\nbar\n\n</DIV>\n</div>\n',
	},
	{
		input: '<pre>foo</pre><!-- prettier-ignore --><div   >bar</div><SECTION   class="baz">\n\nqux\n\n</SECTION>\n',
		output: '<pre>foo</pre>\n<!-- prettier-ignore -->\n<div   >bar</div>\n<section class="baz">\n\nqux\n\n</section>\n',
	},
	{
		input: '<pre>foo</pre><!-- prettier-ignore --><div   >bar</div><ul><li>baz\n\nqux\n\n</ul>\n',
		output: '<pre>foo</pre>\n<!-- prettier-ignore -->\n<div   >bar</div>\n<ul>\n    <li>\n        baz\n\nqux\n\n</li>\n</ul>\n',
	},
	{
		input: '<pre>foo</pre><!-- prettier-ignore-start --><div   >bar</div><SECTION   class="baz">\n\nqux\n\n</SECTION>\n\n<!-- prettier-ignore-end -->\n',
		output: '<pre>foo</pre>\n<!-- prettier-ignore-start -->\n<div>bar</div>\n<section class="baz">\n\nqux\n\n</section>\n\n<!-- prettier-ignore-end -->\n',
	},
	{
		input: '- foo <span>\n  <!-- bar --><!-- prettier-ignore --><div>baz</div>\n  </span>\n',
		output: '- foo <span>\n  <!-- bar --><!-- prettier-ignore -->\n  <div>baz</div>\n  </span>\n',
	},
	{
		input: '- <!-- foo --><span>\n  bar </span>\n  <!-- baz --><!-- prettier-ignore --><div>qux</div>\n',
		output: '- <!-- foo --><span>\n    bar </span>\n  <!-- baz --><!-- prettier-ignore -->\n  <div>qux</div>\n',
	},
	{
		input: '- foo <ul><li>bar\n  <!-- baz --></ul>\n  qux\n  <!-- quux --><!-- prettier-ignore --><div>corge</div>\n',
		output: '- foo <ul><li>bar\n  <!-- baz --> </li> </ul>\n    qux\n  <!-- quux --><!-- prettier-ignore -->\n  <div>corge</div>\n',
	},
	{
		input: '<!-- foo --><!-- prettier-ignore --><div>bar</div>\n\n<!-- prettier-ignore-start -->\n\n<div   >baz</div>\n\n<!-- prettier-ignore-end -->\n',
		output: '<!-- foo --><!-- prettier-ignore -->\n<div>bar</div>\n\n<!-- prettier-ignore-start -->\n\n<div   >baz</div>\n\n<!-- prettier-ignore-end -->\n',
	},
])(
	'keeps HTML ignore directives whose layout formats the same on the next pass',
	async ({ input, output: expectedOutput }) => {
		const output = await format(input, FORMAT_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, FORMAT_OPTIONS)).resolves.toBe(output);
	}
);
