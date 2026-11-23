import type { Options, ParserOptions, Plugin } from 'prettier';
import type { AST } from '../types/index.d.ts';
import { format } from 'prettier';
import * as pluginHTML from 'prettier/plugins/html';
import { expect, onTestFinished, test, vi } from 'vite-plus/test';
import * as pluginMarkdownHTML from '../index.ts';
import formatBlockHTML from './index.ts';

const OPTIONS = { printWidth: 80, tabWidth: 4 } as ParserOptions;

async function formatWithNotices(
	input: string
): Promise<{ notices: unknown[][]; output: string }> {
	const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);

	try {
		const output = await format(input, FORMAT_OPTIONS);

		return { notices: [...warn.mock.calls], output };
	} finally {
		warn.mockRestore();
	}
}

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
		isListItem: false,
		isPrintedTight: false,
		prefixWidth: 0,
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

test('formats HTML after an ignore comment that trailing whitespace keeps from being a directive', async () => {
	// Plain Prettier’s own second pass changes this input
	await expect(
		formatWithNotices('<!-- prettier-ignore -->  \n\n<p   >x</p>\n')
	).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1): Formatting would put this `prettier-ignore` comment on its own line and change which HTML it ignores on the next pass. Keep the HTML you want to ignore in one Markdown block, with a blank line after it.',
			],
		],
		output: '<!-- prettier-ignore -->\n\n<p>x</p>\n',
	});
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

test('reports HTML around Markdown blocks that Prettier’s HTML parser rejects', async () => {
	const opening = html('<div>');
	const closing = html('</span>');

	await expect(
		formatBlockHTML(
			createScope([opening, { type: 'code' }, closing]),
			OPTIONS
		)
	).rejects.toThrowErrorMatchingInlineSnapshot(`
		[SyntaxError: [prettier-plugin-markdown-html] Failed to format HTML with Prettier:

		Unexpected closing tag "span". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags]
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

test('rejects elements that ignored fragments leave open', async () => {
	const input =
		'<ul   class="foo">\n\n<!-- prettier-ignore -->\n<li><li>bar\n\n</ul>\n';

	await expect(formatWithNotices(input)).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (4:5): Close `<li>` with `</li>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
			],
		],
		output: input,
	});
});

test('rejects elements that end their HTML block open after HTML ignore directives', async () => {
	const input =
		'<ul><li><!-- prettier-ignore --><SPAN   >foo</SPAN><!-- prettier-ignore -->\n\n<li>bar</ul>\n';

	await expect(formatWithNotices(input)).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (1:5): Close `<li>` with `</li>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
			],
		],
		output: input,
	});
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

test('rejects elements that close only through Prettier’s supplied closing tags across HTML blocks', async () => {
	const input = '<ruby>\nfoo\n\n<rp>\n\n<rt>\nbar\n</rt>\n</ruby>\n';

	await expect(formatWithNotices(input)).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (4:1): Close `<rp>` with `</rp>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
			],
		],
		output: input,
	});
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

test('rejects HTML paragraphs that their HTML blocks leave open before footnote definitions', async () => {
	const input = '<div   id="foo"><p>bar\n\n[^1]: baz\n\n    qux\n\n</div>\n';

	await expect(formatWithNotices(input)).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (1:17): Close `<p>` with `</p>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
			],
		],
		output: input,
	});
});

test('acknowledges elements that close in HTML that a Markdown ignore directive protects when an HTML ignore directive protects the whole element', async () => {
	const input =
		'<!-- prettier-ignore --><DIV   class="foo">\n\nbar\n\n<!-- prettier-ignore -->\n</DIV>\n';

	await expect(formatWithNotices(input)).resolves.toStrictEqual({
		notices: [],
		output: input,
	});
});

test('rejects elements that close in HTML that a Markdown ignore directive protects', async () => {
	const input =
		'<DIV   class="foo">\n\nbar\n\n<!-- prettier-ignore -->\n</DIV>\n';

	await expect(formatWithNotices(input)).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1): An ignore directive covers only part of this `<DIV>` element. Keep the whole element inside or outside the ignored source.',
			],
		],
		output: input,
	});
});

test.each(['<!-- bar -->', '<!-- bar --><!-- foo -->'])(
	'rejects a region whose comment the configured HTML printer prints as `%s`',
	async (printedComment) => {
		const { html: parser } = pluginHTML.parsers;
		const { html: printer } = pluginHTML.printers;
		const commentRewritingPlugin: Plugin = {
			parsers: { html: parser },
			printers: {
				html: {
					...printer,
					print(path, options, print, args) {
						return (path.node as { value?: string }).value ===
							' foo '
							? printedComment
							: printer.print(path, options, print, args);
					},
				},
			},
		};
		const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);

		onTestFinished(() => {
			warn.mockRestore();
		});

		const output = await format('<!-- foo -->\n\n<div   >baz</div>\n', {
			...FORMAT_OPTIONS,
			plugins: [commentRewritingPlugin, pluginMarkdownHTML],
		});

		expect(output).toBe('<!-- foo -->\n\n<div>baz</div>\n');
		expect(warn.mock.calls).toStrictEqual([
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1): The plugin can’t restore the Markdown between these HTML blocks to its original place after Prettier formats the HTML.',
			],
		]);
	}
);

test('rejects a region whose Markdown markers the configured HTML printer reorders', async () => {
	const { html: parser } = pluginHTML.parsers;
	const { html: printer } = pluginHTML.printers;
	const markerSwappingPlugin: Plugin = {
		parsers: { html: parser },
		printers: {
			html: {
				...printer,
				print(path, options, print, args) {
					const { name } = path.node as { name?: string };

					if (!/^data-prettier-markdown-html-\d+$/.test(name ?? '')) {
						return printer.print(path, options, print, args);
					}

					// Each marker takes the id of its mirror in the skeleton
					const names = options.originalText.match(
						/data-prettier-markdown-html-\d+/g
					)!;

					return names.at(-1 - names.indexOf(name!))!;
				},
			},
		},
	};
	const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);

	onTestFinished(() => {
		warn.mockRestore();
	});

	const input = '<div   >\n\nfoo\n\n<hr   >\n\nbar\n\n</div>\n';

	const output = await format(input, {
		...FORMAT_OPTIONS,
		plugins: [markerSwappingPlugin, pluginMarkdownHTML],
	});

	expect(output).toBe(input);
	expect(warn.mock.calls).toStrictEqual([
		[
			'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1): The plugin can’t restore the Markdown between these HTML blocks to its original place after Prettier formats the HTML.',
		],
	]);
});
