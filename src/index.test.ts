import type {
	AstPath,
	Options,
	Parser,
	ParserOptions,
	Plugin,
	Printer,
} from 'prettier';
import type { PluginOptions } from './index.ts';
import type { AST } from './types/index.d.ts';
import { format, formatWithCursor } from 'prettier';
import * as pluginHTML from 'prettier/plugins/html';
import {
	parsers as markdownParsers,
	printers as markdownPrinters,
} from 'prettier/plugins/markdown';
import { format as standaloneFormat } from 'prettier/standalone';
import { expect, expectTypeOf, onTestFinished, test, vi } from 'vite-plus/test';
import * as pluginMarkdownHTML from './index.ts';

test('exposes correct public API', () => {
	expectTypeOf(pluginMarkdownHTML).toExtend<Plugin>();

	expect(pluginMarkdownHTML).toHaveProperty('options');
	expect(pluginMarkdownHTML).toHaveProperty('parsers');
	expect(pluginMarkdownHTML).toHaveProperty('printers');

	expect(pluginMarkdownHTML.parsers).toHaveProperty('markdown');
	expect(pluginMarkdownHTML.parsers).toHaveProperty('remark');
	expect(pluginMarkdownHTML.printers).toHaveProperty('mdast');

	expectTypeOf<PluginOptions>().toBeObject();
});

const MARKDOWN_PARSER_NAMES = ['markdown', 'remark'] as const;

async function formatWithNotices(
	input: string,
	options: Options
): Promise<{ notices: unknown[][]; output: string }> {
	const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);

	try {
		const output = await format(input, options);

		return { notices: [...warn.mock.calls], output };
	} finally {
		warn.mockRestore();
	}
}

// Characters that the plugin can use to mark fragments in its trial print
const MARKER_CHARACTERS = [
	...Array.from({ length: 31 }, (_, index) =>
		String.fromCodePoint(index + 1)
	).filter((character) => !/[\t\n\r]/.test(character)),
	...Array.from({ length: 32 }, (_, index) =>
		String.fromCodePoint(0x80 + index)
	),
	...Array.from({ length: 112 }, (_, index) =>
		String.fromCodePoint(0x3_00 + index)
	),
];

const TEST_MARKDOWN = `
<p align="center">
    <a href="#">
        <picture>
            <source srcset="#" media="(prefers-color-scheme: dark)" />
            <source srcset="#" media="(prefers-color-scheme: light)" />
            <img src="#" width="520" alt="" />
        </picture>
    </a>
</p>


<h1 align="center">
    prettier-plugin-markdown-html
</h1>

## Description

<p align="center">
    Format raw HTML in&nbsp;Markdown with&nbsp;Prettier.
</p>

Comes without any additional dependencies.

<p align="center">
    <a href="#"><img src="#" alt="" /></a>
    <a href="#"><img src="#" alt="" /></a>
    <a href="#"><img src="#" alt="" /></a>

</p>
<p><a href="#"><img src="#" alt="" /></a></p>

<!-- <p><a href="#">
<img src="#" alt="" /></a></p> -->

<div>
&nbsp;
</div>

## Example

<details> <summary>Show example</summary>

\`\`\`html
<p align="center">

<a href="#">
	<img src="#" alt="" title="Format raw HTML in Markdown with Prettier" />
</a>

</p>
\`\`\`

</details>
<div>
&nbsp;
</div>
`;

function createPriorParser(
	parserName: (typeof MARKDOWN_PARSER_NAMES)[number]
): Parser {
	return {
		...markdownParsers[parserName],
		preprocess: async () => {
			await Promise.resolve();
			return 'Parser <span id = "foo">baz</span>\n';
		},
	};
}

function createPriorPrinter(identifier: string): Printer {
	const nativePrinterPreprocess = markdownPrinters.mdast.preprocess;

	return {
		...markdownPrinters.mdast,
		async preprocess(ast, options) {
			const root = (
				typeof nativePrinterPreprocess === 'function'
					? await nativePrinterPreprocess.call(
							markdownPrinters.mdast,
							ast,
							options
						)
					: ast
			) as AST.RootNode;
			const htmlNode = root.children
				.flatMap((node) => node.children ?? [])
				.find(
					(node): node is AST.HTMLNode =>
						node.type === 'html' && typeof node.value === 'string'
				);

			if (!htmlNode) {
				throw new TypeError('Expected an HTML node');
			}

			htmlNode.value = htmlNode.value.replace(
				/id\s*=\s*"[^"]*"/,
				`id="${identifier}"`
			);
			return root;
		},
	};
}

function copyOwnHooks(): { parser: Parser; printer: Printer } {
	const parser = pluginMarkdownHTML.parsers?.markdown;
	const printer = pluginMarkdownHTML.printers?.mdast;

	if (!parser || !printer) {
		throw new TypeError(
			'Expected a `markdown` parser and an `mdast` printer'
		);
	}

	return { parser: { ...parser }, printer: { ...printer } };
}

function createPriorPlugin(
	parserName: (typeof MARKDOWN_PARSER_NAMES)[number]
): Plugin {
	return {
		parsers: {
			[parserName]: createPriorParser(parserName),
		},
		printers: {
			mdast: createPriorPrinter('bar'),
		},
	};
}

test('composes native parser preprocess hooks', async () => {
	const nativePreprocess = markdownParsers.markdown.preprocess;

	markdownParsers.markdown.preprocess = async (text) => {
		await Promise.resolve();
		return `Native ${text}`;
	};

	onTestFinished(() => {
		markdownParsers.markdown.preprocess = nativePreprocess;
	});

	const parser = pluginMarkdownHTML.parsers?.markdown;

	if (!parser || typeof parser === 'function' || !parser.preprocess) {
		throw new TypeError('Expected a direct `markdown` parser');
	}

	const output = await parser.preprocess('foo\n', {
		plugins: [pluginMarkdownHTML],
	} as unknown as ParserOptions);

	expect(output).toBe('Native foo\n');
});

test('formats raw HTML in Markdown', async () => {
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};

	const output = await format(TEST_MARKDOWN, options);

	expect(output).toMatchSnapshot();
	await expect(format(output, options)).resolves.toBe(output);
});

test('formats raw HTML with the `remark` parser', async () => {
	const input = '<div id = "foo">bar</div>\n';
	const options = {
		parser: 'remark' as const,
		plugins: [pluginMarkdownHTML],
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"<div id="foo">bar</div>
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test('formats raw HTML with compatible aliased parsers', async () => {
	const aliasPlugin: Plugin = {
		parsers: { 'markdown-alias': markdownParsers.markdown },
	};

	const input = '<div id = "foo">bar</div>\n';
	const options = {
		parser: 'markdown-alias',
		plugins: [aliasPlugin, pluginMarkdownHTML],
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"<div id="foo">bar</div>
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test('checks footnote definitions as printed with another Markdown parser', async () => {
	const parserPlugin: Plugin = {
		parsers: { markdown: { ...markdownParsers.markdown } },
	};

	const input =
		'[^foo]: bar\n\n    - [ ] baz\n\n      <div>\n      <p>qux</p>\n      </div>\n';

	await expect(
		format(input, {
			parser: 'markdown',
			plugins: [parserPlugin, pluginMarkdownHTML],
		})
	).resolves.toBe(await format(input, { parser: 'markdown' }));
});

test('checks Markdown with the last plugin that supplies the parser', async () => {
	const earlierPlugin: Plugin = {
		parsers: {
			markdown: {
				...markdownParsers.markdown,
				preprocess: (text) => text.replaceAll('foo', 'bar'),
			},
		},
	};
	const laterPlugin: Plugin = {
		parsers: { markdown: markdownParsers.markdown },
	};

	const input = '---\ntitle: foo\n---\n\nbaz\n';

	await expect(
		format(input, {
			parser: 'markdown',
			plugins: [earlierPlugin, laterPlugin, pluginMarkdownHTML],
		})
	).resolves.toBe(input);
});

test.each(MARKDOWN_PARSER_NAMES)(
	'composes prior parser and printer preprocess hooks with the `%s` parser',
	async (parserName) => {
		const priorPlugin = createPriorPlugin(parserName);
		const options = {
			parser: parserName,
			plugins: [priorPlugin, pluginMarkdownHTML],
		};

		const output = await format('ignored\n', options);

		expect(output).toMatchInlineSnapshot(`
			"Parser <span id="bar">baz</span>
			"
		`);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'skips prior `mdast` printer preprocessors with incompatible structural hooks with the `%s` parser',
	async (parserName) => {
		const priorPlugin: Plugin = {
			parsers: {
				[parserName]: markdownParsers[parserName],
			},
			printers: {
				mdast: {
					getVisitorKeys: () => [],
					preprocess: async () => {
						await Promise.resolve();
						return { type: 'custom' };
					},
					print: () => 'CUSTOM',
				},
			},
		};

		const priorOutput = await format('foo\n', {
			parser: parserName,
			plugins: [priorPlugin],
		});

		const expectedOutput = await format('foo\n', {
			parser: parserName,
			plugins: [pluginMarkdownHTML],
		});

		const output = await format('foo\n', {
			parser: parserName,
			plugins: [priorPlugin, pluginMarkdownHTML],
		});

		expect(priorOutput).toBe('CUSTOM');
		expect(output).toBe(expectedOutput);
	}
);

test('formats HTML with optional end tags', async () => {
	const input = '<ul><li id = "foo">bar<li id = "baz">qux</ul>\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"<ul>
		  <li id="foo">bar</li>
		  <li id="baz">qux</li>
		</ul>
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test('formats inline HTML in paragraphs', async () => {
	const input = 'Before <span id = "foo" class = "bar">baz</span> After\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		singleAttributePerLine: true,
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"Before <span
		  id="foo"
		  class="bar">baz</span> After
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test.each(['script', 'style', 'textarea', 'title'])(
	'rejects inline raw text `%s` elements',
	async (tagName) => {
		const input = `Before <${tagName} id = "foo" class = "bar">baz</${tagName}> After\n`;

		const result = await formatWithNotices(input, {
			parser: 'markdown',
			plugins: [pluginMarkdownHTML],
		});

		expect(result).toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (1:8): Keep both tags of this raw text element in one HTML block.',
				],
			],
			output: await format(input, { parser: 'markdown' }),
		});
	}
);

test.each(['script', 'style', 'textarea', 'title'])(
	'leaves paragraphs with inline `%s` elements to plain Prettier',
	async (tagName) => {
		const content = {
			script: `const html = "<b id='foo'>";`,
			style: `b::before { content: "<b id='foo'>"; }`,
			textarea: `<b id='foo'>bar</b>`,
			title: `<b id='foo'>bar</b>`,
		}[tagName];
		const input = `Before <${tagName} id = "foo">${content}</${tagName}> <span id = "bar">baz</span> After\n`;
		// The width keeps the line unwrapped, so only the tags change
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
			printWidth: 120,
		};

		const { output } = await formatWithNotices(input, options);
		const expectedOutput = await format(input, {
			parser: 'markdown',
			printWidth: 120,
		});

		expect(output).toBe(expectedOutput);
	}
);

test.each([
	{
		input: 'Before <title id = "foo">bar **baz</title> qux**\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:8): Keep both tags of this raw text element in one HTML block.',
		parserName: 'markdown',
	},
	{
		input: 'Before **<title id = "foo">bar** baz</title> After\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:10): Keep both tags of this raw text element in one HTML block.',
		parserName: 'markdown',
	},
	{
		input: 'Before <textarea id = "foo">bar\n\nbaz</textarea> After\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:8): Close `<textarea>` with `</textarea>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
		parserName: 'markdown',
	},
	{
		input: 'Before <textarea id = "foo">bar\n\n<b id="baz">qux</b>\n\n</textarea> After\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:8): Close `<textarea>` with `</textarea>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
		parserName: 'markdown',
	},
	{
		input: 'Before <textarea id = "foo">bar\n\n<div></textarea><section>\n\n<aside>baz</aside>\n</section>\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:8): Close `<textarea>` with `</textarea>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
		parserName: 'markdown',
	},
	{
		input: '> Before <textarea>foo\n>\n> <script>\n>\n> bar</script>\n>\n> </textarea>\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:10): Close `<textarea>` with `</textarea>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
		parserName: 'markdown',
	},
	{
		input: 'Before <title id = "foo">bar **baz</title> qux**\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:8): Keep both tags of this raw text element in one HTML block.',
		parserName: 'remark',
	},
	{
		input: 'Before **<title id = "foo">bar** baz</title> After\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:10): Keep both tags of this raw text element in one HTML block.',
		parserName: 'remark',
	},
	{
		input: 'Before <textarea id = "foo">bar\n\nbaz</textarea> After\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:8): Close `<textarea>` with `</textarea>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
		parserName: 'remark',
	},
	{
		input: 'Before <textarea id = "foo">bar\n\n<b id="baz">qux</b>\n\n</textarea> After\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:8): Close `<textarea>` with `</textarea>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
		parserName: 'remark',
	},
	{
		input: 'Before <textarea id = "foo">bar\n\n<div></textarea><section>\n\n<aside>baz</aside>\n</section>\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:8): Close `<textarea>` with `</textarea>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
		parserName: 'remark',
	},
	{
		input: '> Before <textarea>foo\n>\n> <script>\n>\n> bar</script>\n>\n> </textarea>\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:10): Close `<textarea>` with `</textarea>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
		parserName: 'remark',
	},
] as const)(
	'leaves raw text that takes in later Markdown to plain Prettier with the `$parserName` parser',
	async ({ input, notice, parserName }) => {
		const result = await formatWithNotices(input, {
			parser: parserName,
			plugins: [pluginMarkdownHTML],
		});

		expect(result).toStrictEqual({
			notices: [[notice]],
			output: await format(input, { parser: parserName }),
		});
	}
);

test.each([
	['cr', 'markdown', '<div id="foo" class="bar">baz</div>\n'],
	['cr', 'markdown', '> <div id="foo" class="bar">baz</div>\n'],
	['cr', 'markdown', '- <div id="foo" class="bar">baz</div>\n'],
	['cr', 'markdown', 'Before <span id="foo" class="bar">baz</span> After\n'],
	['cr', 'remark', '<div id="foo" class="bar">baz</div>\n'],
	['cr', 'remark', '> <div id="foo" class="bar">baz</div>\n'],
	['cr', 'remark', '- <div id="foo" class="bar">baz</div>\n'],
	['cr', 'remark', 'Before <span id="foo" class="bar">baz</span> After\n'],
	['crlf', 'markdown', '<div id="foo" class="bar">baz</div>\n'],
	['crlf', 'markdown', '> <div id="foo" class="bar">baz</div>\n'],
	['crlf', 'markdown', '- <div id="foo" class="bar">baz</div>\n'],
	[
		'crlf',
		'markdown',
		'Before <span id="foo" class="bar">baz</span> After\n',
	],
	['crlf', 'remark', '<div id="foo" class="bar">baz</div>\n'],
	['crlf', 'remark', '> <div id="foo" class="bar">baz</div>\n'],
	['crlf', 'remark', '- <div id="foo" class="bar">baz</div>\n'],
	['crlf', 'remark', 'Before <span id="foo" class="bar">baz</span> After\n'],
] as const)(
	'respects `endOfLine` set to `%s` with the `%s` parser',
	async (endOfLine, parserName, input) => {
		const options = {
			endOfLine,
			parser: parserName,
			plugins: [pluginMarkdownHTML],
			singleAttributePerLine: true,
		};
		const separator = { cr: '\r', crlf: '\r\n' }[endOfLine];
		const expectedOutput = await format(input, {
			...options,
			endOfLine: 'lf',
		});

		const output = await format(input, options);

		expect(output).toBe(expectedOutput.replaceAll('\n', separator));
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test('keeps bundled languages available inside embedded Markdown', async () => {
	const uppercase: Plugin = {
		languages: [{ name: 'uppercase', parsers: ['uppercase'] }],
		parsers: {
			uppercase: {
				astFormat: 'uppercase',
				locEnd: (value: string) => value.length,
				locStart: () => 0,
				parse: (text) => text,
			},
		},
		printers: {
			uppercase: {
				print: (path) => String(path.node).trim().toUpperCase(),
			},
		},
	};
	const bundle = {
		...pluginMarkdownHTML,
		languages: uppercase.languages,
		parsers: { ...pluginMarkdownHTML.parsers, ...uppercase.parsers },
		printers: { ...pluginMarkdownHTML.printers, ...uppercase.printers },
	};
	const input = '~~~~md\n```uppercase\nhello\n```\n~~~~\n';
	const expected = await format(input, {
		parser: 'markdown',
		plugins: [uppercase],
	});
	const options = { parser: 'markdown', plugins: [bundle] };

	expect(expected).toContain('\nHELLO\n');
	const output = await format(input, options);

	expect(output).toBe(expected);
	await expect(format(output, options)).resolves.toBe(output);
});

test('gives embedded formatters the effective `endOfLine` while checking the layout', async () => {
	const parse = vi.fn((_text: string, _options: ParserOptions) => ({
		type: 'foo',
	}));
	const fooPlugin: Plugin = {
		languages: [{ name: 'foo', parsers: ['foo'] }],
		parsers: {
			foo: {
				astFormat: 'foo',
				locEnd: () => 0,
				locStart: () => 0,
				parse,
			},
		},
		printers: { foo: { print: () => 'baz' } },
	};
	const options = {
		endOfLine: 'crlf' as const,
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML, fooPlugin],
	};

	const output = await format(
		'<div   >qux</div>\n\n```foo\nquux\n```\n',
		options
	);

	expect(output).toBe('<div>qux</div>\r\n\r\n```foo\r\nbaz\r\n```\r\n');
	await expect(format(output, options)).resolves.toBe(output);
	expect(
		new Set(parse.mock.calls.map(([, { endOfLine }]) => endOfLine))
	).toStrictEqual(new Set(['crlf']));
});

test('formats block HTML in block quotes and list items', async () => {
	const input = `> <div id = "foo" class = "bar"><span>baz</span></div>

- qux

  <div id = "foo" class = "bar"><span>baz</span></div>
`;
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		singleAttributePerLine: true,
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"> <div
		>   id="foo"
		>   class="bar"
		> >
		>   <span>baz</span>
		> </div>

		- qux

		  <div
		    id="foo"
		    class="bar"
		  >
		    <span>baz</span>
		  </div>
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test.each([
	{
		input: 'Before <center id = "foo" class = "bar">baz</center> After\n',
		output: `Before <center
  id="foo"
  class="bar">baz</center>
After
`,
	},
	{
		input: 'Before <details id = "foo" class = "bar">baz</details> After\n',
		output: `Before <details
  id="foo"
  class="bar">baz</details>
After
`,
	},
	{
		input: 'Before <meta id = "foo" class = "bar"> After\n',
		output: `Before <meta
  id="foo"
  class="bar"
/>
After
`,
	},
	{
		input: 'Before <source id = "foo" class = "bar"> After\n',
		output: `Before <source
  id="foo"
  class="bar"
/>
After
`,
	},
])(
	'keeps inline block HTML stable when wrapping prose',
	async ({ input, output: expectedOutput }) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
			printWidth: 10,
			proseWrap: 'always' as const,
		};

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test('keeps closing block HTML stable when wrapping prose', async () => {
	const input = 'Before <center>foo bar baz qux </center> After\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		printWidth: 10,
		proseWrap: 'always' as const,
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"Before <center>foo
		bar baz
		qux </center>
		After
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test('keeps inline HTML compact in headings and table cells', async () => {
	const input = `## Before <span id = "foo" class = "bar">baz</span> After

| Before <span id = "foo" class = "bar">baz</span> After |
| --- |
`;
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		singleAttributePerLine: true,
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"## Before <span id="foo" class="bar">baz</span> After

		| Before <span id="foo" class="bar">baz</span> After |
		| -------------------------------------------------- |
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test.each([
	{
		input: '<img id="foo" src="bar.png">\n',
		output: '<img id="foo" src="bar.png" />\n',
	},
	{
		input: '<a href="foo">\n<img id="bar" src="baz.png">\n</a>\n',
		output: `<a href="foo">
  <img
    id="bar"
    src="baz.png"
  />
</a>
`,
	},
	{
		input: '<a href="foo">\n\n</a>\n<img id="bar" src="baz.png">\n',
		output: `<a href="foo">

</a>
<img
  id="bar"
  src="baz.png"
/>
`,
	},
])(
	'formats HTML blocks that start with non-block tags without splitting their first line',
	async ({ input, output: expectedOutput }) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
			printWidth: 20,
		};

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test('keeps the first tag of a non-block HTML block on its own line', async () => {
	const input = '<span id="foo" class="bar">\nbaz\n</span>\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		printWidth: 20,
	};

	const output = await format(input, options);

	expect(output).toBe('<span id="foo" class="bar">\n  baz\n</span>\n');
	await expect(format(output, options)).resolves.toBe(output);
});

test('preserves blank lines between nested HTML blocks', async () => {
	const input = `> <div id="foo">bar</div>
>
> <div id="baz">qux</div>
`;

	const output = await format(input, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
	});

	expect(output).toBe(input);
});

test.each([
	{
		input: '<div>\n\nfoo\n\n</div>*bar*\n',
		output: '<div>\n\nfoo\n\n</div>\n*bar*\n',
	},
	{
		input: '<div>\n\nfoo\n\n</div>\n_bar_\n',
		output: '<div>\n\nfoo\n\n</div>\n_bar_\n',
	},
	{
		input: '<div>\n<section>\n\nfoo\n\n</section> </div> *bar*\n',
		output: '<div>\n  <section>\n\nfoo\n\n</section>\n</div>\n*bar*\n',
	},
	{
		input: '> <div>\n>\n> foo\n>\n> </div>*bar*\n',
		output: '> <div>\n>\n> foo\n>\n> </div>\n> *bar*\n',
	},
	{
		input: '- <div>\n\n  foo\n\n  </div>*bar*\n',
		output: '- <div>\n\n  foo\n\n  </div>\n  *bar*\n',
	},
])(
	'keeps text after closing tags inside its HTML block',
	async ({ input, output: expectedOutput }) => {
		for (const parserName of MARKDOWN_PARSER_NAMES) {
			const options = {
				parser: parserName,
				plugins: [pluginMarkdownHTML],
			};

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	}
);

test.each([
	{
		input: '<div title="\n\n<div>"></div>\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:1): Complete this tag, including any quoted attribute values, in the same HTML fragment.',
		parserName: 'markdown',
		prefix: '',
	},
	{
		input: '<div title="\n\n<div>"></div>\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (3:3): Complete this tag, including any quoted attribute values, in the same HTML fragment.',
		parserName: 'markdown',
		prefix: '  ',
	},
	{
		input: '<div title="\n\n<div>"></div>\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:3): Complete this tag, including any quoted attribute values, in the same HTML fragment.',
		parserName: 'markdown',
		prefix: '> ',
	},
	{
		input: '<div><textarea>foo\n\n<div>bar</textarea></div>\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:6): Keep both tags of this raw text element in one HTML block.',
		parserName: 'markdown',
		prefix: '',
	},
	{
		input: '<div><textarea>foo\n\n<div>bar</textarea></div>\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (3:8): Keep both tags of this raw text element in one HTML block.',
		parserName: 'markdown',
		prefix: '  ',
	},
	{
		input: '<div><textarea>foo\n\n<div>bar</textarea></div>\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:8): Keep both tags of this raw text element in one HTML block.',
		parserName: 'markdown',
		prefix: '> ',
	},
	{
		input: '<div title="\n\n<div>"></div>\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:1): Complete this tag, including any quoted attribute values, in the same HTML fragment.',
		parserName: 'remark',
		prefix: '',
	},
	{
		input: '<div title="\n\n<div>"></div>\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (3:3): Complete this tag, including any quoted attribute values, in the same HTML fragment.',
		parserName: 'remark',
		prefix: '  ',
	},
	{
		input: '<div title="\n\n<div>"></div>\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:3): Complete this tag, including any quoted attribute values, in the same HTML fragment.',
		parserName: 'remark',
		prefix: '> ',
	},
	{
		input: '<div><textarea>foo\n\n<div>bar</textarea></div>\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:6): Keep both tags of this raw text element in one HTML block.',
		parserName: 'remark',
		prefix: '',
	},
	{
		input: '<div><textarea>foo\n\n<div>bar</textarea></div>\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (3:8): Keep both tags of this raw text element in one HTML block.',
		parserName: 'remark',
		prefix: '  ',
	},
	{
		input: '<div><textarea>foo\n\n<div>bar</textarea></div>\n',
		notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (1:8): Keep both tags of this raw text element in one HTML block.',
		parserName: 'remark',
		prefix: '> ',
	},
] as const)(
	'leaves HTML that blank lines split inside a tag or raw text to plain Prettier with the `$parserName` parser',
	async ({ input, notice, parserName, prefix }) => {
		const content = input
			.trimEnd()
			.split('\n')
			.map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()))
			.join('\n');
		const markdown = `${prefix === '  ' ? '- baz\n\n' : ''}${content}\n`;

		const result = await formatWithNotices(markdown, {
			parser: parserName,
			plugins: [pluginMarkdownHTML],
		});

		expect(result).toStrictEqual({
			notices: [[notice]],
			output: await format(markdown, { parser: parserName }),
		});
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'leaves attribute values that whitespace-only lines split to plain Prettier with the `%s` parser',
	async (parserName) => {
		const input = '<div title="\n  \n<div>"></div>\n';

		const result = await formatWithNotices(input, {
			parser: parserName,
			plugins: [pluginMarkdownHTML],
		});

		expect(result).toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1): Complete this tag, including any quoted attribute values, in the same HTML fragment.',
				],
			],
			output: await format(input, { parser: parserName }),
		});
	}
);

test.each([
	{
		embeddedLanguageFormatting: 'auto',
		input: '- foo\n\n  <script>\n  foo()\n\n  bar()\n  </script>\n',
		output: '- foo\n\n  <script>\n    foo();\n\n    bar();\n  </script>\n',
		parserName: 'markdown',
	},
	{
		embeddedLanguageFormatting: 'auto',
		input: '> - foo\n>\n>   <script>\n>   foo()\n>\n>   bar()\n>   </script>\n',
		output: '> - foo\n>\n>   <script>\n>     foo();\n>\n>     bar();\n>   </script>\n',
		parserName: 'markdown',
	},
	{
		embeddedLanguageFormatting: 'auto',
		input: '> <script>\n> foo()\n>\n> bar()\n> </script>\n',
		output: '> <script>\n>   foo();\n>\n>   bar();\n> </script>\n',
		parserName: 'markdown',
	},
	{
		embeddedLanguageFormatting: 'auto',
		input: '> > <script>\n> > foo()\n> >\n> > bar()\n> > </script>\n',
		output: '> > <script>\n> >   foo();\n> >\n> >   bar();\n> > </script>\n',
		parserName: 'markdown',
	},
	{
		embeddedLanguageFormatting: 'off',
		input: '- foo\n\n  <script>\n  foo()\n\n  bar()\n  </script>\n',
		output: '- foo\n\n  <script>\n    foo()\n\n    bar()\n  </script>\n',
		parserName: 'markdown',
	},
	{
		embeddedLanguageFormatting: 'off',
		input: '> - foo\n>\n>   <script>\n>   foo()\n>\n>   bar()\n>   </script>\n',
		output: '> - foo\n>\n>   <script>\n>     foo()\n>\n>     bar()\n>   </script>\n',
		parserName: 'markdown',
	},
	{
		embeddedLanguageFormatting: 'off',
		input: '> <script>\n> foo()\n>\n> bar()\n> </script>\n',
		output: '> <script>\n>   foo()\n>\n>   bar()\n> </script>\n',
		parserName: 'markdown',
	},
	{
		embeddedLanguageFormatting: 'off',
		input: '> > <script>\n> > foo()\n> >\n> > bar()\n> > </script>\n',
		output: '> > <script>\n> >   foo()\n> >\n> >   bar()\n> > </script>\n',
		parserName: 'markdown',
	},
	{
		embeddedLanguageFormatting: 'auto',
		input: '- foo\n\n  <script>\n  foo()\n\n  bar()\n  </script>\n',
		output: '- foo\n\n  <script>\n    foo();\n\n    bar();\n  </script>\n',
		parserName: 'remark',
	},
	{
		embeddedLanguageFormatting: 'auto',
		input: '> - foo\n>\n>   <script>\n>   foo()\n>\n>   bar()\n>   </script>\n',
		output: '> - foo\n>\n>   <script>\n>     foo();\n>\n>     bar();\n>   </script>\n',
		parserName: 'remark',
	},
	{
		embeddedLanguageFormatting: 'auto',
		input: '> <script>\n> foo()\n>\n> bar()\n> </script>\n',
		output: '> <script>\n>   foo();\n>\n>   bar();\n> </script>\n',
		parserName: 'remark',
	},
	{
		embeddedLanguageFormatting: 'auto',
		input: '> > <script>\n> > foo()\n> >\n> > bar()\n> > </script>\n',
		output: '> > <script>\n> >   foo();\n> >\n> >   bar();\n> > </script>\n',
		parserName: 'remark',
	},
	{
		embeddedLanguageFormatting: 'off',
		input: '- foo\n\n  <script>\n  foo()\n\n  bar()\n  </script>\n',
		output: '- foo\n\n  <script>\n    foo()\n\n    bar()\n  </script>\n',
		parserName: 'remark',
	},
	{
		embeddedLanguageFormatting: 'off',
		input: '> - foo\n>\n>   <script>\n>   foo()\n>\n>   bar()\n>   </script>\n',
		output: '> - foo\n>\n>   <script>\n>     foo()\n>\n>     bar()\n>   </script>\n',
		parserName: 'remark',
	},
	{
		embeddedLanguageFormatting: 'off',
		input: '> <script>\n> foo()\n>\n> bar()\n> </script>\n',
		output: '> <script>\n>   foo()\n>\n>   bar()\n> </script>\n',
		parserName: 'remark',
	},
	{
		embeddedLanguageFormatting: 'off',
		input: '> > <script>\n> > foo()\n> >\n> > bar()\n> > </script>\n',
		output: '> > <script>\n> >   foo()\n> >\n> >   bar()\n> > </script>\n',
		parserName: 'remark',
	},
] as const)(
	'prints empty HTML lines without trailing container whitespace when `embeddedLanguageFormatting` is `$embeddedLanguageFormatting` with the `$parserName` parser',
	async ({
		embeddedLanguageFormatting,
		input,
		output: expectedOutput,
		parserName,
	}) => {
		const options = {
			embeddedLanguageFormatting,
			parser: parserName,
			plugins: [pluginMarkdownHTML],
		};

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'leaves tags that blank lines split across variable block quote prefixes to plain Prettier with the `%s` parser',
	async (parserName) => {
		const input = '> > <div title="\n> >\n>><div>"></div>\n';

		const result = await formatWithNotices(input, {
			parser: parserName,
			plugins: [pluginMarkdownHTML],
		});

		expect(result).toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (1:5): Complete this tag, including any quoted attribute values, in the same HTML fragment.',
				],
			],
			output: await format(input, { parser: parserName }),
		});
	}
);

test('leaves elements around a tag split across HTML nodes to plain Prettier', async () => {
	const input = `<section>
<div title="

<aside>">

</div>
</section>

<p>foo</p>
`;

	const result = await formatWithNotices(input, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
	});

	expect(result).toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (2:1): Complete this tag, including any quoted attribute values, in the same HTML fragment.',
			],
		],
		output: await format(input, { parser: 'markdown' }),
	});
});

test('leaves a root tag split across HTML nodes to plain Prettier', async () => {
	const input = `<div title="

<aside>">

</div>
`;

	const result = await formatWithNotices(input, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
	});

	expect(result).toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1): Complete this tag, including any quoted attribute values, in the same HTML fragment.',
			],
		],
		output: await format(input, { parser: 'markdown' }),
	});
});

test('leaves HTML blocks after tabs in list items to plain Prettier', async () => {
	const input = '- foo\n\t<details><span>\n\tbar\n';

	const result = await formatWithNotices(input, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
	});

	expect(result).toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (2:2): Close `<details>` with `</details>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
			],
		],
		output: await format(input, { parser: 'markdown' }),
	});
});

test('respects `bracketSameLine`', async () => {
	const input = '<div id="foo" class="bar" title="baz">qux</div>\n';
	const options = {
		bracketSameLine: false,
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		printWidth: 20,
		singleAttributePerLine: true,
	};
	const bracketSameLineOptions = { ...options, bracketSameLine: true };

	const outputs = {
		false: await format(input, options),
		true: await format(input, bracketSameLineOptions),
	};

	expect(outputs).toMatchInlineSnapshot(`
		{
		  "false": "<div
		  id="foo"
		  class="bar"
		  title="baz"
		>
		  qux
		</div>
		",
		  "true": "<div
		  id="foo"
		  class="bar"
		  title="baz">
		  qux
		</div>
		",
		}
	`);
	await expect(format(outputs.false, options)).resolves.toBe(outputs.false);
	await expect(format(outputs.true, bracketSameLineOptions)).resolves.toBe(
		outputs.true
	);
});

test('respects `checkIgnorePragma`', async () => {
	const input = `<!-- @noformat -->

<div id = "foo" class = "bar">baz</div>
`;
	const options = {
		checkIgnorePragma: true,
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"<!-- @noformat -->

		<div id = "foo" class = "bar">baz</div>
		"
	`);
});

test.each([
	['markdown', ''],
	['markdown', '> '],
	['markdown', '- quux\n\n  '],
	['remark', ''],
	['remark', '> '],
	['remark', '- quux\n\n  '],
] as const)(
	'respects `cursorOffset` with the `%s` parser',
	async (parserName, prefix) => {
		const input = `${prefix}<div id = "foo" class = "bar"><span>baz|qux</span></div>\n`;
		const cursorOffset = input.indexOf('|');

		const { cursorOffset: formattedCursorOffset, formatted } =
			await formatWithCursor(input, {
				cursorOffset,
				parser: parserName,
				plugins: [pluginMarkdownHTML],
				singleAttributePerLine: true,
			});

		expect(formatted).not.toBe(input);
		expect(formatted[formattedCursorOffset]).toBe('|');
		expect(formattedCursorOffset).toBe(formatted.indexOf('|'));
	}
);

test('respects `embeddedLanguageFormatting`', async () => {
	const input = `<script>const foo={bar:1,baz:2}</script>

<style>.foo{display:block;color:red;}</style>
`;
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};
	const autoOptions = {
		...options,
		embeddedLanguageFormatting: 'auto' as const,
	};
	const offOptions = {
		...options,
		embeddedLanguageFormatting: 'off' as const,
	};

	const outputs = {
		auto: await format(input, autoOptions),
		off: await format(input, offOptions),
	};

	expect(outputs).toMatchInlineSnapshot(`
		{
		  "auto": "<script>
		  const foo = { bar: 1, baz: 2 };
		</script>

		<style>
		  .foo {
		    display: block;
		    color: red;
		  }
		</style>
		",
		  "off": "<script>
		  const foo={bar:1,baz:2}
		</script>

		<style>
		  .foo{display:block;color:red;}
		</style>
		",
		}
	`);
	await expect(format(outputs.auto, autoOptions)).resolves.toBe(outputs.auto);
	await expect(format(outputs.off, offOptions)).resolves.toBe(outputs.off);
});

test.each([
	'<!-- prettier-ignore-start -->\n   - foo\n   <br>\n<!-- prettier-ignore-end -->\n',
	'<!-- prettier-ignore -->\n   - foo\n   <br>\n',
])(
	'keeps lazy lines in protected source where plain Prettier prints them',
	async (input) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual({
			notices: [],
			output: await format(input, { parser: 'markdown' }),
		});
		await expect(format(result.output, options)).resolves.toBe(
			result.output
		);
	}
);

test.each([
	{
		input: '<div><svg></div>\n\n<p   >foo</p>\n',
		notices: [
			'(1:6): Close `<svg>` with `</svg>` in the same HTML block, before any enclosing element closes.',
		],
		output: '<div><svg></div>\n\n<p>foo</p>\n',
	},
	{
		input: '<div><math></div>\n\n<p   >foo</p>\n',
		notices: [
			'(1:6): Close `<math>` with `</math>` in the same HTML block, before any enclosing element closes.',
		],
		output: '<div><math></div>\n\n<p>foo</p>\n',
	},
	{
		input: '<div><object><svg></div>\n\n<source>\n<circle></circle>\n',
		notices: [
			'(1:14): Close `<svg>` with `</svg>` in the same HTML block, before any enclosing element closes.',
		],
		output: '<div><object><svg></div>\n\n<source />\n<circle></circle>\n',
	},
	{
		input: '<svg>\n\n</svg>\n\n<p   >foo</p>\n',
		notices: [
			'(1:1): Close `<svg>` with `</svg>` in the same HTML block, before any enclosing element closes.',
		],
		output: '<svg>\n\n</svg>\n\n<p>foo</p>\n',
	},
	{
		input: 'foo <span><svg></span></svg> bar.\n\n<p   >baz</p>\n',
		notices: [
			'(1:11): Close `<svg>` with `</svg>` in the same HTML block, before any enclosing element closes.',
		],
		output: 'foo <span><svg></span></svg> bar.\n\n<p>baz</p>\n',
	},
	{
		input: '<div><svg><title>foo</title></svg></div>\n\n<p   >bar</p>\n',
		notices: [],
		output: '<div>\n  <svg><title>foo</title></svg>\n</div>\n\n<p>bar</p>\n',
	},
])(
	'rejects only the region of an SVG or MathML element that its own closing tag doesn’t end where it opens',
	async ({ input, notices, output: expectedOutput }) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual({
			notices: notices.map((notice) => [
				`[prettier-plugin-markdown-html] Skipped HTML formatting ${notice}`,
			]),
			output: expectedOutput,
		});
		await expect(format(result.output, options)).resolves.toBe(
			result.output
		);
	}
);

test('formats embedded code once in documents without HTML', async () => {
	const parse = vi.fn(() => ({ type: 'foo' }));
	const fooPlugin: Plugin = {
		languages: [{ name: 'foo', parsers: ['foo'] }],
		parsers: {
			foo: {
				astFormat: 'foo',
				locEnd: () => 0,
				locStart: () => 0,
				parse,
			},
		},
		printers: { foo: { print: () => 'bar' } },
	};

	const output = await format('```foo\nbaz\n```\n', {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML, fooPlugin],
	});

	expect(output).toBe('```foo\nbar\n```\n');
	expect(parse).toHaveBeenCalledTimes(1);
});

test.each([
	{
		input: '<div>foo</div>\n<x:y></x:y>\n\nbar\n\t```\n\n<div   >foo</div>\n',
		notices: [
			'(7:1): Formatting would change whether Prettier reads this as inline HTML, an HTML block, or text. Check nearby line breaks, indentation, and code fences.',
		],
	},
	{
		input: 'foo\n\t```\n\n<div   >bar</div>\n\nbaz\n\t```\n\n<div>bar</div>\n',
		notices: [
			'(4:1): Formatting would change whether Prettier reads this as inline HTML, an HTML block, or text. Check nearby line breaks, indentation, and code fences.',
		],
	},
])(
	'rejects the region whose fragment changes role among identical fragments',
	async ({ input, notices }) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};

		await expect(formatWithNotices(input, options)).resolves.toStrictEqual({
			notices: notices.map((notice) => [
				`[prettier-plugin-markdown-html] Skipped HTML formatting ${notice}`,
			]),
			output: await format(input, { parser: 'markdown' }),
		});
	}
);

test.each([
	MARKER_CHARACTERS.slice(0, 26).join(''),
	MARKER_CHARACTERS.slice(0, -1).join(''),
])(
	'marks every fragment while the source leaves a marker character free',
	async (characters) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};

		const result = await formatWithNotices(
			`\`\`\`\n${characters}\n\`\`\`\n\n<div   >foo</div>\n\nbar <b   >baz</b> <i   >qux</i>\n`,
			options
		);

		expect(result).toStrictEqual({
			notices: [],
			output: `\`\`\`\n${characters}\n\`\`\`\n\n<div>foo</div>\n\nbar <b>baz</b> <i>qux</i>\n`,
		});
		await expect(format(result.output, options)).resolves.toBe(
			result.output
		);
	}
);

test.each(
	MARKDOWN_PARSER_NAMES.flatMap((parser) =>
		[
			{
				input: '<!-- foo --><div>\n<!-- bar -->\n\n</div>\n',
				position: '1:1',
			},
			{
				input: '- <!-- foo --><div>\n  <!-- bar -->\n\n  </div>\n',
				position: '1:3',
			},
			{
				input: "<!-- foo --><div>\n<p data-x='bar'>baz</p>\n\n</div>\n",
				position: '1:1',
			},
			{
				input: '<!-- foo --><div>\n</div>\n',
				position: '1:1',
			},
		].map((row) => ({ ...row, parser }))
	)
)(
	'rejects an HTML block whose join with the following HTML block would change on the next pass with the `$parser` parser ($input)',
	async ({ input, parser, position }) => {
		const options = { parser, plugins: [pluginMarkdownHTML] };
		const expectedOutput = await format(input, { parser });
		const expectedResult = {
			notices: [
				[
					`[prettier-plugin-markdown-html] Skipped HTML formatting (${position}): After formatting, this HTML block would combine with the HTML block after it, so formatting the result again would change it.`,
				],
			],
			output: expectedOutput,
		};

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual(expectedResult);
		await expect(
			formatWithNotices(result.output, options)
		).resolves.toStrictEqual(expectedResult);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'rejects only the nested HTML block whose join would change on the next pass with the `%s` parser',
	async (parser) => {
		const input =
			'<div>\n\n<!-- foo --><p   >bar</p>\n<p   >baz</p>\n\n</div>\n';
		const options = { parser, plugins: [pluginMarkdownHTML] };
		const expectedResult = {
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (3:1): After formatting, this HTML block would combine with the HTML block after it, so formatting the result again would change it.',
				],
			],
			output: '<div>\n\n<!-- foo --><p   >bar</p>\n<p>baz</p>\n\n</div>\n',
		};

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual(expectedResult);
		await expect(
			formatWithNotices(result.output, options)
		).resolves.toStrictEqual(expectedResult);
	}
);

test.each(
	MARKDOWN_PARSER_NAMES.flatMap((parser) =>
		[
			{
				input: '<!-- foo -->\n<!-- bar -->\n',
				output: '<!-- foo -->\n<!-- bar -->\n',
			},
			{
				input: '<!-- foo --><div   >bar</div>\n<!-- baz -->\n',
				output: '<!-- foo -->\n<div>bar</div>\n<!-- baz -->\n',
			},
			{
				input: '<div></div><div>\n<!-- foo -->\n\n</div>\n',
				output: '<div></div>\n<div>\n  <!-- foo -->\n\n</div>\n',
			},
			{
				input: '<!-- prettier-ignore --><div>\n<!-- foo -->\n\n</div>\n',
				output: '<!-- prettier-ignore --><div>\n<!-- foo -->\n\n</div>\n',
			},
		].map((row) => ({ ...row, parser }))
	)
)(
	'keeps stable controls around consecutive comments, leading elements, and ignore directives formatted with the `$parser` parser',
	async ({ input, output: expectedOutput, parser }) => {
		const options = { parser, plugins: [pluginMarkdownHTML] };

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual({ notices: [], output: expectedOutput });
		await expect(
			formatWithNotices(result.output, options)
		).resolves.toStrictEqual({ notices: [], output: expectedOutput });
	}
);

test.each([
	{
		input: '<div   >foo</div>\n\n```bar\nbaz\n```\n',
		output: `<div>foo</div>\n\n\`\`\`bar\n${MARKER_CHARACTERS[0]}\n\`\`\`\n`,
	},
	{
		input: '```bar\nbaz\n```\n\n<div   >foo</div>\n',
		output: `\`\`\`bar\n${MARKER_CHARACTERS[0]}\n\`\`\`\n\n<div>foo</div>\n`,
	},
])(
	'tells markers apart from marker characters that embedded formatters print',
	async ({ input, output }) => {
		const barPlugin: Plugin = {
			languages: [{ name: 'bar', parsers: ['bar'] }],
			parsers: {
				bar: {
					astFormat: 'bar',
					locEnd: () => 0,
					locStart: () => 0,
					parse: () => ({ type: 'bar' }),
				},
			},
			printers: { bar: { print: () => MARKER_CHARACTERS[0]! } },
		};
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML, barPlugin],
		};
		const expectedResult = { notices: [], output };

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual(expectedResult);
		await expect(
			formatWithNotices(result.output, options)
		).resolves.toStrictEqual(expectedResult);
	}
);

test('reports a notice for each region that marker characters running out reject', async () => {
	const input = `\`\`\`\n${MARKER_CHARACTERS.join('')}\n\`\`\`\n\n<div   >foo</div>\n\nbar <b   >baz</b>\n`;
	const notice = (position: string) => [
		`[prettier-plugin-markdown-html] Skipped HTML formatting (${position}): The plugin can’t check this document’s HTML layout because every character it can use as a marker already appears in the text.`,
	];

	await expect(
		formatWithNotices(input, {
			parser: 'markdown',
			plugins: [pluginMarkdownHTML],
		})
	).resolves.toStrictEqual({
		notices: [notice('5:1'), notice('7:5')],
		output: await format(input, { parser: 'markdown' }),
	});
});

test('reports plain Prettier’s error before marker characters run out when `PRETTIER_DEBUG` is set', async () => {
	vi.stubEnv('PRETTIER_DEBUG', '1');
	onTestFinished(() => {
		vi.unstubAllEnvs();
	});
	const input = `\`\`\`\n${MARKER_CHARACTERS.join('')}\n\`\`\`\n\n<div>foo</div>\n\n\`\`\`js\nconst =\n\`\`\`\n`;
	let error: unknown;

	try {
		await format(input, { parser: 'markdown' });
	} catch (caughtError: unknown) {
		error = caughtError;
	}

	expect(error).toBeInstanceOf(Error);
	await expect(
		format(input, { parser: 'markdown', plugins: [pluginMarkdownHTML] })
	).rejects.toThrow((error as Error).message);
});

test('reports plain Prettier’s error for fenced code in a span preserved after an empty list marker when `PRETTIER_DEBUG` is set', async () => {
	vi.stubEnv('PRETTIER_DEBUG', '1');
	onTestFinished(() => {
		vi.unstubAllEnvs();
	});
	const input =
		'    npm install\n-\n  ```js\n  const a=\n  ```\n  <div>Docs</div>\n';
	let error: unknown;

	try {
		await format(input, { parser: 'markdown' });
	} catch (caughtError: unknown) {
		error = caughtError;
	}

	expect(error).toBeInstanceOf(Error);
	await expect(
		format(input, { parser: 'markdown', plugins: [pluginMarkdownHTML] })
	).rejects.toThrow((error as Error).message);
});

test('formats the table cells before a cell that leaves `pre` open', async () => {
	const input =
		'| foo | bar |\n| --- | --- |\n| <KBD   >baz</KBD> | qux <pre> |\n\n<p   >quux</p>\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};

	await expect(formatWithNotices(input, options)).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (3:27): Close `<pre>` with `</pre>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
			],
		],
		output: '| foo            | bar       |\n| -------------- | --------- |\n| <kbd>baz</kbd> | qux <pre> |\n\n<p   >quux</p>\n',
	});
});

test.each([
	{
		input: '- <div   >foo</div>\n\n- [bar]: baz\n\n  "qux"\n- <span   >quux</span>\n',
		kind: 'loose',
		output: '- <div>foo</div>\n\n- [bar]: baz\n\n  "qux"\n\n- <span>quux</span>\n',
	},
	{
		input: '- [foo]: bar\n\n  "baz"\n- <span   >qux</span>\n',
		kind: 'tight',
		output: '- [foo]: bar\n\n  "baz"\n\n- <span>qux</span>\n',
	},
])(
	'keeps the blank line after a link reference definition in $kind lists',
	async ({ input, output }) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};
		const expectedResult = { notices: [], output };

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual(expectedResult);
		await expect(
			formatWithNotices(result.output, options)
		).resolves.toStrictEqual(expectedResult);
	}
);

test('restores plain Prettier’s blank line after a link reference definition when a later layout check rejects the region', async () => {
	const input =
		'<div>\n\n[guide]: /guide\n</x-callout> <br>\n\n<!-- prettier-ignore --><p>Example</p><b>Text</b></div>\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};
	const output = await format(input, { parser: 'markdown' });
	const notices = (line: number) => [
		[
			`[prettier-plugin-markdown-html] Skipped HTML formatting (${line}:1): Formatting would put this \`prettier-ignore\` comment on its own line and change which HTML it ignores on the next pass. Keep the HTML you want to ignore in one Markdown block, with a blank line after it.`,
		],
	];

	expect(output).toContain('[guide]: /guide\n\n</x-callout> <br>');
	await expect(formatWithNotices(input, options)).resolves.toStrictEqual({
		notices: notices(6),
		output,
	});
	await expect(formatWithNotices(output, options)).resolves.toStrictEqual({
		notices: notices(7),
		output,
	});
});

test.each([
	{ input: '```md\nfoo\n```\n', parser: 'mdx' },
	{
		input: '<script type="text/markdown">\nfoo\n</script>\n',
		parser: 'html',
	},
])(
	'leaves Markdown embedded in `$parser` to a parser with its own syntax tree',
	async ({ input, parser }) => {
		vi.stubEnv('PRETTIER_DEBUG', '1');
		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		const fooPlugin: Plugin = {
			parsers: {
				markdown: {
					astFormat: 'foo',
					locEnd: (node: { text: string }) => node.text.length,
					locStart: () => 0,
					parse: (text, { parentParser }) => ({
						parentParser,
						text,
						type: 'foo',
					}),
				},
			},
			printers: {
				foo: {
					print: (path) => {
						const { parentParser, text } = path.node as {
							parentParser: string;
							text: string;
						};

						return `${parentParser} ${text.trim().toUpperCase()}`;
					},
				},
			},
		};

		await expect(
			format(input, { parser, plugins: [fooPlugin, pluginMarkdownHTML] })
		).resolves.toBe(await format(input, { parser, plugins: [fooPlugin] }));
	}
);

test('leaves Markdown embedded in MDX to a parser with its own syntax tree when a later plugin supplies a Markdown printer', async () => {
	vi.stubEnv('PRETTIER_DEBUG', '1');
	onTestFinished(() => {
		vi.unstubAllEnvs();
	});
	const input = '```md\nfoo\n```\n';
	const fooPlugin: Plugin = {
		parsers: {
			markdown: {
				astFormat: 'foo',
				locEnd: (node: { text: string }) => node.text.length,
				locStart: () => 0,
				parse: (text) => ({ text, type: 'foo' }),
			},
		},
		printers: {
			foo: {
				print: (path) =>
					(path.node as { text: string }).text.trim().toUpperCase(),
			},
		},
	};
	const printerPlugin: Plugin = {
		printers: { mdast: markdownPrinters.mdast },
	};
	const expectedOutput = await format(input, {
		parser: 'mdx',
		plugins: [fooPlugin, printerPlugin],
	});

	expect(expectedOutput).toContain('\nFOO\n');
	await expect(
		format(input, {
			parser: 'mdx',
			plugins: [fooPlugin, pluginMarkdownHTML, printerPlugin],
		})
	).resolves.toBe(expectedOutput);
});

test('leaves Markdown embedded in code blocks to plain Prettier', async () => {
	const input =
		'<p   align="center">foo</p>\n\n```markdown\n<script>alert(3)</script>\n\n<div   >\n\nbar\n```\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};

	await expect(formatWithNotices(input, options)).resolves.toStrictEqual({
		notices: [],
		output: '<p align="center">foo</p>\n\n```markdown\n<script>alert(3)</script>\n\n<div   >\n\nbar\n```\n',
	});
});

test.each([
	{
		hooks: 'a copy of this plugin’s Markdown parser',
		output: '<p   align="center">foo</p>\n\n```markdown\n- bar\n\n<div   >baz</div>\n```\n',
		plugins: [
			{
				parsers: { markdown: copyOwnHooks().parser },
			},
		],
	},
	{
		hooks: 'this plugin and a copy of its Markdown parser',
		output: '<p align="center">foo</p>\n\n```markdown\n- bar\n\n<div   >baz</div>\n```\n',
		plugins: [
			pluginMarkdownHTML,
			{
				parsers: { markdown: copyOwnHooks().parser },
			},
		],
	},
])(
	'leaves Markdown embedded in code blocks to plain Prettier with $hooks',
	async ({ output: expectedOutput, plugins }) => {
		const options = { parser: 'markdown' as const, plugins };

		const output = await format(
			'<p   align="center">foo</p>\n\n```markdown\n*   bar\n\n<div   >baz</div>\n```\n',
			options
		);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test('leaves Markdown embedded in code blocks to plain Prettier with copies of this plugin’s Markdown parser and printer', async () => {
	const { printer } = copyOwnHooks();
	let rootEmbedCallCount = 0;
	const options = {
		parser: 'markdown' as const,
		plugins: [
			{
				parsers: { markdown: copyOwnHooks().parser },
				printers: {
					mdast: {
						...printer,
						embed(path: AstPath, embedOptions: Options) {
							if (
								path.node.type === 'root' &&
								++rootEmbedCallCount > 10
							) {
								throw new Error('Repeated embedded Markdown');
							}

							return printer.embed!(path, embedOptions);
						},
					},
				},
			},
		],
	};

	const output = await format(
		'<p   align="center">foo</p>\n\n```markdown\n*   bar\n\n<div   >baz</div>\n```\n',
		options
	);

	expect(output).toBe(
		'<p align="center">foo</p>\n\n```markdown\n- bar\n\n<div   >baz</div>\n```\n'
	);
	await expect(format(output, options)).resolves.toBe(output);
});

test('leaves Markdown embedded in code blocks to plain Prettier with the Markdown parser of an independently loaded instance', async () => {
	vi.resetModules();
	const independentPlugin = await import('./index.ts');
	const options = {
		parser: 'markdown' as const,
		plugins: [
			pluginMarkdownHTML,
			{ parsers: { markdown: independentPlugin.parsers!.markdown! } },
		],
	};

	const output = await format(
		'<p   align="center">foo</p>\n\n```markdown\n*   bar\n\n<div   >baz</div>\n```\n',
		options
	);

	expect(output).toBe(
		'<p align="center">foo</p>\n\n```markdown\n- bar\n\n<div   >baz</div>\n```\n'
	);
	await expect(format(output, options)).resolves.toBe(output);
});

test.each(['parser', 'printer'] as const)(
	'gives Markdown embedded in code blocks plain Prettier’s output with a copy of this plugin’s Markdown parser and another plugin’s %s',
	async (hook) => {
		const input =
			'<p   align="center">foo</p>\n\n```markdown\n*   bar\n\n<div   >baz</div>\n```\n';
		const copyPlugin: Plugin = {
			parsers: { markdown: copyOwnHooks().parser },
		};
		const parserPlugin: Plugin = {
			parsers: {
				markdown: {
					...markdownParsers.markdown,
					preprocess: (text) => text.replace('bar', 'qux'),
				},
			},
		};
		const printerPlugin: Plugin = {
			printers: {
				mdast: {
					...markdownPrinters.mdast,
					print: (path, options, print, args) =>
						path.node.type === 'word'
							? String(path.node.value).toUpperCase()
							: markdownPrinters.mdast.print(
									path,
									options,
									print,
									args
								),
				},
			},
		};
		const { effect, plugins, reference } = {
			parser: {
				effect: '\n- qux\n',
				plugins: [parserPlugin, copyPlugin],
				reference: [parserPlugin],
			},
			printer: {
				effect: '\n- BAR\n',
				plugins: [pluginMarkdownHTML, printerPlugin, copyPlugin],
				reference: [
					printerPlugin,
					{ parsers: { markdown: markdownParsers.markdown } },
				],
			},
		}[hook];
		const options = { parser: 'markdown' as const, plugins };
		const expectedOutput = await format(input, {
			parser: 'markdown',
			plugins: reference,
		});

		expect(expectedOutput).toContain(effect);
		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test('respects `htmlWhitespaceSensitivity`', async () => {
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		htmlWhitespaceSensitivity: 'strict' as const,
	};

	const output = await format(TEST_MARKDOWN, options);

	expect(output).toMatchSnapshot();
	await expect(format(output, options)).resolves.toBe(output);
});

test('respects `insertPragma`', async () => {
	const input = '<div id = "foo" class = "bar">baz</div>\n';
	const options = {
		insertPragma: true,
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"<!-- @format -->

		<div id="foo" class="bar">baz</div>
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test('respects `prettier-ignore` comments before HTML blocks', async () => {
	const input = `<!-- prettier-ignore -->
<div id = "foo" class = "bar">baz</div>
`;

	const output = await format(input, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
	});

	expect(output).toMatchInlineSnapshot(`
		"<!-- prettier-ignore -->
		<div id = "foo" class = "bar">baz</div>
		"
	`);
});

test('drops trailing whitespace of ignored HTML in list items as plain Prettier does', async () => {
	const input =
		'-   <!-- prettier-ignore -->\n    <div>foo</div>  \n\n    bar\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};
	const expectedOutput = await format(input, { parser: 'markdown' });

	const output = await format(input, options);

	expect(output).toBe(expectedOutput);
	await expect(format(output, options)).resolves.toBe(output);
});

test.each([
	{
		input: '<!-- prettier-ignore-start -->\n[foo]: #bar\n<!-- prettier-ignore-end -->\n',
		output: '<!-- prettier-ignore-start -->\n[foo]: #bar\n<!-- prettier-ignore-end -->\n',
	},
	{
		input: "<!-- prettier-ignore-start -->\n| foo | bar |\n|--|--|\n<!-- prettier-ignore-end -->\n\nbaz <b   class='qux'>quux</b>\n",
		output: '<!-- prettier-ignore-start -->\n| foo | bar |\n|--|--|\n<!-- prettier-ignore-end -->\n\nbaz <b class="qux">quux</b>\n',
	},
	{
		input: '<!-- prettier-ignore-start -->\n<div   >foo</div>\n\n<!-- prettier-ignore-end -->\n',
		output: '<!-- prettier-ignore-start -->\n<div   >foo</div>\n\n<!-- prettier-ignore-end -->\n',
	},
	{
		input: '- <!-- prettier-ignore-start -->\n  <div   >foo</div>\n\n  <!-- prettier-ignore-end -->\n',
		output: '- <!-- prettier-ignore-start -->\n  <div>foo</div>\n\n  <!-- prettier-ignore-end -->\n',
	},
	{
		input: '> <!-- prettier-ignore-start -->\n> <div   >foo</div>\n>\n> <!-- prettier-ignore-end -->\n',
		output: '> <!-- prettier-ignore-start -->\n> <div>foo</div>\n>\n> <!-- prettier-ignore-end -->\n',
	},
])(
	'reports nothing for the comments of ignored ranges',
	async ({ input, output }) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};

		await expect(formatWithNotices(input, options)).resolves.toStrictEqual({
			notices: [],
			output,
		});
	}
);

test('formats ignored ranges without errors when `PRETTIER_DEBUG` is set', async () => {
	vi.stubEnv('PRETTIER_DEBUG', '1');
	onTestFinished(() => {
		vi.unstubAllEnvs();
	});
	const input =
		'<!-- prettier-ignore-start -->\n<div   >foo</div>\n\n<!-- prettier-ignore-end -->\n';

	await expect(
		format(input, { parser: 'markdown', plugins: [pluginMarkdownHTML] })
	).resolves.toBe(input);
});

test.each([
	{
		input: '<!-- prettier-ignore --><p>foo</p><div   >\n\nbar\n\n</div>\n',
		position: '1:1',
	},
	{
		input: '<!-- prettier-ignore --><p   >foo</p><b   >bar</b>\n',
		position: '1:1',
	},
	{
		input: '<pre   >foo</pre><!-- prettier-ignore --><p   >bar</p><div   >\n\nbaz\n\n</div>\n',
		position: '1:18',
	},
	{
		input: '<pre title="<!-- prettier-ignore -->">foo</pre><!-- prettier-ignore --><p   >bar</p><div   >\n\nbaz\n\n</div>\n',
		position: '1:48',
	},
	{
		input: '<pre>foo <!-- prettier-ignore --> bar</pre><!-- prettier-ignore --><p   >baz</p><div   >\n\nqux\n\n</div>\n',
		position: '1:44',
	},
	{
		input: '<script>foo("<!-- prettier-ignore -->")</script><!-- prettier-ignore --><p   >bar</p><div   >\n\nbaz\n\n</div>\n',
		position: '1:49',
	},
	{
		input: '<pre   >foo</pre><!-- prettier-ignore --><hr   ><div   >\n\nbar\n\n</div>\n',
		position: '1:18',
	},
	{
		input: '<pre>foo</pre><!-- prettier-ignore --><p>bar</p><div   >\n\n<pre>baz</pre><!-- prettier-ignore --><p>qux</p></div>\n',
		position: '1:15',
	},
	{
		input: '<pre   >foo</pre><!-- prettier-ignore --><p   >bar<div>baz</div>\n',
		position: '1:18',
	},
])(
	'rejects a region whose formatted ignore comment would protect different HTML on the next pass',
	async ({ input, position }) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};
		const expectedResult = {
			notices: [
				[
					`[prettier-plugin-markdown-html] Skipped HTML formatting (${position}): Formatting would put this \`prettier-ignore\` comment on its own line and change which HTML it ignores on the next pass. Keep the HTML you want to ignore in one Markdown block, with a blank line after it.`,
				],
			],
			output: await format(input, { parser: 'markdown' }),
		};

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual(expectedResult);
		await expect(
			formatWithNotices(result.output, options)
		).resolves.toStrictEqual(expectedResult);
	}
);

test('rejects a region that an ignore comment covers without a notice when the comment would join the next block', async () => {
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};
	const expectedResult = {
		notices: [],
		output: '<!-- prettier-ignore --><p   >foo</p>\n<div>\n\nbar\n\n</div>\n',
	};

	const result = await formatWithNotices(
		'<!-- prettier-ignore --><p   >foo</p>\n<div   >\n\nbar\n\n</div>\n',
		options
	);

	expect(result).toStrictEqual(expectedResult);
	await expect(
		formatWithNotices(result.output, options)
	).resolves.toStrictEqual(expectedResult);
});

test.each([
	{
		input: '<!-- prettier-ignore --><p   >foo</p>\n',
		output: '<!-- prettier-ignore -->\n<p   >foo</p>\n',
	},
	{
		input: '<!-- prettier-ignore --><pre>foo</pre><div   >\n\nbar\n\n</div>\n',
		output: '<!-- prettier-ignore -->\n<pre>foo</pre>\n<div>\n\nbar\n\n</div>\n',
	},
	{
		input: '<pre   >foo</pre><!-- prettier-ignore --><p   >bar</p>\n',
		output: '<pre>foo</pre>\n<!-- prettier-ignore -->\n<p   >bar</p>\n',
	},
	{
		input: '<pre   >foo</pre><!-- prettier-ignore --><p   >bar</p>\n\nbaz\n',
		output: '<pre>foo</pre>\n<!-- prettier-ignore -->\n<p   >bar</p>\n\nbaz\n',
	},
	{
		input: '<pre   >foo</pre><!-- prettier-ignore --><pre   >bar</pre>\n',
		output: '<pre>foo</pre>\n<!-- prettier-ignore -->\n<pre   >bar</pre>\n',
	},
	{
		input: '<script>foo()</script><!-- prettier-ignore --><p   >bar</p>\n',
		output: '<script>\n  foo();\n</script>\n<!-- prettier-ignore -->\n<p   >bar</p>\n',
	},
	{
		input: '<pre title="<!-- prettier-ignore -->">foo</pre><!-- prettier-ignore --><p   >bar</p>\n',
		output: '<pre title="<!-- prettier-ignore -->">foo</pre>\n<!-- prettier-ignore -->\n<p   >bar</p>\n',
	},
	{
		input: '<pre>foo <!-- prettier-ignore --> bar</pre><!-- prettier-ignore --><p   >baz</p>\n',
		output: '<pre>foo <!-- prettier-ignore --> bar</pre>\n<!-- prettier-ignore -->\n<p   >baz</p>\n',
	},
	{
		input: '<script>foo("<!-- prettier-ignore -->")</script><!-- prettier-ignore --><p   >bar</p>\n',
		output: '<script>\n  foo("<!-- prettier-ignore -->");\n</script>\n<!-- prettier-ignore -->\n<p   >bar</p>\n',
	},
	{
		input: '<pre   >foo</pre><!-- prettier-ignore --><hr   >\n',
		output: '<pre>foo</pre>\n<!-- prettier-ignore -->\n<hr   >\n',
	},
	{
		input: '- <p   >foo</p><!-- prettier-ignore --><p   >bar</p><div   >\n\n  baz\n\n  </div>\n',
		output: '- <p>foo</p>\n  <!-- prettier-ignore -->\n  <p   >bar</p>\n  <div>\n\n  baz\n\n  </div>\n',
	},
	{
		input: '<p   >foo</p><!-- prettier-ignore --><p   >bar</p><!-- prettier-ignore --><p   >baz</p><b   >qux</b>\n',
		output: '<p>foo</p>\n<!-- prettier-ignore -->\n<p   >bar</p>\n<!-- prettier-ignore -->\n<p   >baz</p>\n<b>qux</b>\n',
	},
])(
	'formats HTML after an ignore comment that a formatted block starts with when the comment would protect the same HTML',
	async ({ input, output }) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};
		const expectedResult = { notices: [], output };

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual(expectedResult);
		await expect(
			formatWithNotices(result.output, options)
		).resolves.toStrictEqual(expectedResult);
	}
);

test.each([
	{
		input: 'foo <!-- prettier-ignore --><b   >bar</b> baz\n',
		name: 'b',
		position: '1:29',
	},
	{
		input: '<span></span><!-- prettier-ignore --><p   >foo</p>\n',
		name: 'p',
		position: '1:38',
	},
	{
		input: '# foo <!-- prettier-ignore --><b   >bar</b>\n',
		name: 'b',
		position: '1:31',
	},
	{
		input: '| foo <!-- prettier-ignore --><b   >bar</b> |\n| ----------------------------------------- |\n| baz                                       |\n',
		name: 'b',
		position: '1:31',
	},
	{
		input: '| foo                                       |\n| ----------------------------------------- |\n| bar <!-- prettier-ignore --><b   >baz</b> |\n',
		name: 'b',
		position: '3:31',
	},
])(
	'rejects an element whose opening tag alone an inline ignore comment protects',
	async ({ input, name, position }) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};
		const expectedResult = {
			notices: [
				[
					`[prettier-plugin-markdown-html] Skipped HTML formatting (${position}): An ignore directive covers only part of this \`<${name}>\` element. Keep the whole element inside or outside the ignored source.`,
				],
			],
			output: input,
		};

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual(expectedResult);
		await expect(
			formatWithNotices(result.output, options)
		).resolves.toStrictEqual(expectedResult);
	}
);

test('keeps the general notice when an inline ignore comment also protects the closing tag', async () => {
	const input =
		'foo <!-- prettier-ignore --><b   >bar<!-- prettier-ignore --></b> baz\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};
	const expectedResult = {
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (1:29): An ignore directive covers only part of this `<b>` element. Keep the whole element inside or outside the ignored source.',
			],
		],
		output: input,
	};

	const result = await formatWithNotices(input, options);

	expect(result).toStrictEqual(expectedResult);
	await expect(
		formatWithNotices(result.output, options)
	).resolves.toStrictEqual(expectedResult);
});

test.each([
	{
		input: '<!-- prettier-ignore -->\nfoo <b   >bar</b> baz\n',
		output: '<!-- prettier-ignore -->\nfoo <b   >bar</b> baz\n',
	},
	{
		input: 'foo <b   >bar</b> baz\n',
		output: 'foo <b>bar</b> baz\n',
	},
	{
		input: '<!-- prettier-ignore -->\n<span></span><p   >foo</p>\n',
		output: '<!-- prettier-ignore -->\n<span></span><p   >foo</p>\n',
	},
	{
		input: '<span></span><p   >foo</p>\n',
		output: '<span></span><p>foo</p>\n',
	},
	{
		input: '<!-- prettier-ignore -->\n# foo <b   >bar</b>\n',
		output: '<!-- prettier-ignore -->\n# foo <b   >bar</b>\n',
	},
	{
		input: '# foo <b   >bar</b>\n',
		output: '# foo <b>bar</b>\n',
	},
	{
		input: '<!-- prettier-ignore -->\n| foo <b   >bar</b> |\n| --- |\n| baz |\n',
		output: '<!-- prettier-ignore -->\n| foo <b   >bar</b> |\n| --- |\n| baz |\n',
	},
	{
		input: '| foo <b   >bar</b> |\n| --- |\n| baz |\n',
		output: '| foo <b>bar</b> |\n| -------------- |\n| baz            |\n',
	},
])(
	'formats a paragraph, heading, or table whose inline ignore comment moves above it or goes',
	async ({ input, output }) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};
		const expectedResult = { notices: [], output };

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual(expectedResult);
		await expect(
			formatWithNotices(result.output, options)
		).resolves.toStrictEqual(expectedResult);
	}
);

test('checks separators for many rejected closing tags without reparsing the whole document per tag', async () => {
	const padding = Array.from(
		{ length: 40 },
		(_, index) =>
			`Paragraph ${index} with ordinary prose and **bold** text.`
	).join('\n\n');
	const keptQuote = [
		'> text',
		...Array.from({ length: 20 }, () => '> </section>\n> *text*'),
		'> <!-- prettier-ignore-start -->',
	].join('\n');
	const plainQuote = [
		'text',
		...Array.from({ length: 20 }, () => '> - &</aside>amp;'),
	].join('\n');
	const input = `${padding}\n\n${keptQuote}\n\n${plainQuote}\n\n${padding}\n`;
	const expectedOutput = `${padding}\n\n${keptQuote}\n\ntext\n\n${Array.from({ length: 20 }, () => '> - &</aside>amp;').join('\n')}\n\n${padding}\n`;
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};
	const parse = vi.spyOn(markdownParsers.markdown, 'parse');

	onTestFinished(() => {
		parse.mockRestore();
	});

	const first = await formatWithNotices(input, options);
	const fullDocumentParses = parse.mock.calls.filter(
		([text]) => text.length > padding.length
	).length;
	const parsedBytes = parse.mock.calls.reduce(
		(total, [text]) => total + text.length,
		0
	);

	expect(first.output).toBe(expectedOutput);
	expect(fullDocumentParses).toBeLessThanOrEqual(8);
	expect(parsedBytes).toBeLessThan(12 * input.length);

	const second = await formatWithNotices(first.output, options);

	expect(second.output).toBe(expectedOutput);
});

test('formats inline HTML on an indented continuation line of a genuine paragraph after indented code', async () => {
	const input = "    npm install\ntext\n    <img src='icon.png' alt=''>\n";
	const output = '    npm install\n\ntext\n<img src="icon.png" alt="" />\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};
	const expectedResult = { notices: [], output };

	await expect(formatWithNotices(input, options)).resolves.toStrictEqual(
		expectedResult
	);
	await expect(formatWithNotices(output, options)).resolves.toStrictEqual(
		expectedResult
	);
});

test('formats an indented continuation line in a block quote paragraph that does not start with an empty list item', async () => {
	const input = "Install:\n> text\n    <img src=x alt=''>\n";
	const output = 'Install:\n\n> text\n> <img src="x" alt="" />\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};
	const expectedResult = { notices: [], output };

	await expect(formatWithNotices(input, options)).resolves.toStrictEqual(
		expectedResult
	);
	await expect(formatWithNotices(output, options)).resolves.toStrictEqual(
		expectedResult
	);
});

test.each([
	"    npm install\n-\n<span class='tip'>Install</span> it\n",
	"    npm install\n-\nRun <img src='icon.png'>\n",
])(
	'formats inline HTML after the reference renderer’s empty list item when it starts no block in %j',
	async (input) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};
		const result = await formatWithNotices(input, options);

		expect(result.notices).toStrictEqual([]);
		expect(result.output).not.toContain("'");
		await expect(
			formatWithNotices(result.output, options)
		).resolves.toStrictEqual(result);
	}
);

test.each([
	{
		input: "Learn <b class='tip'>Prettier</b>\n      -\n",
		options: {},
		output: 'Learn <b class="tip">Prettier</b>\n\\-\n',
	},
	{
		input: "- [ ] Learn <b class='tip'>Prettier</b>  \n        -\n",
		options: {},
		output: '- [ ] Learn <b class="tip">Prettier</b>  \n      -\n',
	},
])(
	'lays out the inline HTML of a paragraph that plain Prettier keeps a paragraph in $input',
	async ({ input, options: rowOptions, output }) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
			...rowOptions,
		};
		const expectedResult = { notices: [], output };

		await expect(formatWithNotices(input, options)).resolves.toStrictEqual(
			expectedResult
		);
		await expect(formatWithNotices(output, options)).resolves.toStrictEqual(
			expectedResult
		);
	}
);

test.each([
	{
		blocks: ['paragraph'],
		input: 'Learn <b class=tip>Prettier</b> abcd ===\n',
		options: { printWidth: 40, proseWrap: 'always' as const },
		output: 'Learn <b class=tip>Prettier</b> abcd ===\n',
		secondOutput: 'Learn <b class=tip>Prettier</b> abcd ===\n',
	},
	{
		blocks: ['paragraph'],
		input: '<b class=tip> foo</b> ===\n',
		options: { printWidth: 25, proseWrap: 'always' as const },
		output: '<b class=tip> foo</b> ===\n',
		secondOutput: '<b class=tip> foo</b> ===\n',
	},
	{
		blocks: ['paragraph', 'list'],
		input: "Learn <b class='tip'>Prettier</b>  \n      - item\n",
		options: {},
		output: "Learn <b class='tip'>Prettier</b>  \n- item\n",
		secondOutput: 'Learn <b class="tip">Prettier</b>\n\n- item\n',
	},
])(
	'rejects a paragraph whose formatted HTML would print it as more or other than one paragraph, and formats only the blocks that plain Prettier splits it into on the next pass, in $input',
	async ({ blocks, input, options: rowOptions, output, secondOutput }) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
			...rowOptions,
		};
		const plainOptions = { parser: 'markdown' as const, ...rowOptions };
		const rejection = [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1): The formatted text wouldn’t read as a single Markdown paragraph with inline HTML. Check for a tag or Markdown block marker at the start of a line.',
			],
		];
		const plainRoot = (await markdownParsers.markdown.parse(
			output,
			{} as ParserOptions
		)) as AST.Node;

		await expect(format(input, plainOptions)).resolves.toBe(output);
		expect(plainRoot.children!.map(({ type }) => type)).toStrictEqual(
			blocks
		);
		await expect(formatWithNotices(input, options)).resolves.toStrictEqual({
			notices: rejection,
			output,
		});
		await expect(formatWithNotices(output, options)).resolves.toStrictEqual(
			{
				notices: blocks.length > 1 ? [] : rejection,
				output: secondOutput,
			}
		);
	}
);

test('keeps a genuine title on the line after a titleless link reference definition untouched', async () => {
	const input = '[ref]: /\n"foo <b class=\'tip\'>bar</b>"  \n      -\n';
	const output = '[ref]: / "foo <b class=\'tip\'>bar</b>"\n\n-\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};
	const expectedResult = { notices: [], output };

	await expect(formatWithNotices(input, options)).resolves.toStrictEqual(
		expectedResult
	);
	await expect(formatWithNotices(output, options)).resolves.toStrictEqual(
		expectedResult
	);
});

test('rejects a quoted paragraph after a titled link reference definition when formatting widens it into a setext heading', async () => {
	const input = '[ref]: / "title"\n"foo <b class=tip>bar</b>" ===\n';
	const output = '[ref]: / "title"\n\n"foo\n<b class=tip>bar</b>" ===\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		printWidth: 25,
		proseWrap: 'always' as const,
	};
	const notices = (line: number) => [
		[
			`[prettier-plugin-markdown-html] Skipped HTML formatting (${line}:1): The formatted text wouldn’t read as a single Markdown paragraph with inline HTML. Check for a tag or Markdown block marker at the start of a line.`,
		],
	];

	await expect(formatWithNotices(input, options)).resolves.toStrictEqual({
		notices: notices(2),
		output,
	});
	await expect(formatWithNotices(output, options)).resolves.toStrictEqual({
		notices: notices(3),
		output,
	});
});

test.each<{
	input: string;
	notices: string[][];
	options?: Record<string, unknown>;
	output: string;
	parser: 'markdown' | 'remark';
	secondNotices: string[][];
}>(
	MARKDOWN_PARSER_NAMES.flatMap((parser) => {
		const notice = (position: string, message: string) => [
			`[prettier-plugin-markdown-html] Skipped HTML formatting (${position}): ${message}`,
		];
		const unclosedNotice = (position: string, name: string) =>
			notice(
				position,
				`Close \`<${name}>\` with \`</${name}>\` in the same Markdown region, or escape \`<\` as \`&lt;\` if the tag is meant as text.`
			);

		return [
			{
				input: 'Some text\n    <hr>\n    ---\n',
				notices: [],
				output: 'Some text <hr />\n\\---\n',
				parser,
				secondNotices: [],
			},
			{
				input: '- foo\n \t<pre>\n   a\n    b <x\n  </pre>\n\nafter\n',
				notices: [unclosedNotice('2:3', 'pre')],
				output: '- foo\n    <pre>\n   a\n    b <x\n  </pre>\n\nafter\n',
				parser,
				secondNotices: [unclosedNotice('2:5', 'pre')],
			},
			{
				input: "- [ ]  <div class='note'>Docs</div>\n",
				notices: [],
				output: '- [ ] <div class="note">Docs</div>\n',
				parser,
				secondNotices: [],
			},
			{
				input: 'foo <b   >x</b>\n===\n',
				notices: [],
				output: 'foo <b>x</b>\n===\n',
				parser,
				secondNotices: [],
			},
			{
				input: '  1.\tk  \n    <b>x</b>\n',
				notices: [],
				output: '1. k  \n   <b>x</b>\n',
				parser,
				secondNotices: [],
			},
			{
				input: '<script>a</scripts>b</script>\n',
				notices: [],
				output: '<script>\n  a</scripts>b\n</script>\n',
				parser,
				secondNotices: [],
			},
			{
				input: '>\n    l\n- <hr>\n',
				notices: [],
				output: '>\n\n    l\n\n- <hr />\n',
				parser,
				secondNotices: [],
			},
		];
	})
)(
	'keeps the Markdown around HTML reading as in the source with $parser in $input ($options)',
	async ({
		input,
		notices,
		options: rowOptions,
		output,
		parser,
		secondNotices,
	}) => {
		const options = {
			parser,
			plugins: [pluginMarkdownHTML],
			...rowOptions,
		};

		await expect(formatWithNotices(input, options)).resolves.toStrictEqual({
			notices,
			output,
		});
		await expect(formatWithNotices(output, options)).resolves.toStrictEqual(
			{
				notices: secondNotices,
				output,
			}
		);
	}
);

test.each([
	{
		input: '1. -\n      <div>Install</div>\n',
		output: '1. - <div>Install</div>\n',
	},
	{
		input: 'Steps:\n1. - item\n\n     <div>Install</div>\n',
		output: 'Steps:\n\n1. - item\n\n     <div>Install</div>\n',
	},
	{
		input: 'Steps:\n1. -\n   <div>Install</div>\n',
		output: 'Steps:\n\n1. -\n   <div>Install</div>\n',
	},
])(
	'formats an HTML block alongside a nested list when both parsers agree on its container in $input',
	async ({ input, output }) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};
		const expectedResult = { notices: [], output };

		await expect(formatWithNotices(input, options)).resolves.toStrictEqual(
			expectedResult
		);
		await expect(formatWithNotices(output, options)).resolves.toStrictEqual(
			expectedResult
		);
	}
);

test.each([
	'-   foo\n\n    <!-- prettier-ignore -->\n    bar   *baz*\n\n    <div>qux</div>\n',
	'>foo\n>\n><!-- prettier-ignore -->\n>bar   *baz*\n>\n><div>qux</div>\n',
])(
	'prints an ignored paragraph in a container whose prefix changes as plain Prettier does',
	async (input) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};

		const output = await format(input, options);

		expect(output).toBe(await format(input, { parser: 'markdown' }));
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test.each([
	{
		context: 'after a hard line break in a list item',
		input: '- a\n\n  Text  \n  \t<!-- c --> after\n',
		position: '4:3',
	},
	{
		context: 'as the first block after a list item’s blank line',
		input: '- a\n\n  \t<!-- c --> after\n',
		position: '3:3',
	},
	{
		context: 'after a hard line break in a block quote',
		input: '> Text  \n> \t<!-- c --> after\n',
		position: '2:3',
	},
	{
		context: 'with a tab that starts partway through a tab stop',
		input: '- a\n\n   \t<!-- c --> after\n',
		position: '3:3',
	},
	{
		context: 'on a later line of a list item’s HTML',
		input: '- <!-- a -->\n  \t<!-- b --> after\n',
		position: '2:3',
	},
	{
		context: 'on a later line of a block quote’s HTML',
		input: '> <!-- a -->\n> \t<!-- b --> after\n',
		position: '2:3',
	},
])(
	'rejects a tab-indented HTML block that formatting would split, as with spaces covering the same columns, $context',
	async ({ input, position }) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};
		const expectedResult = {
			notices: [
				[
					`[prettier-plugin-markdown-html] Skipped HTML formatting (${position}): After formatting, GitHub Flavored Markdown would no longer recognize this as an HTML block, and some of its content would be interpreted as Markdown.`,
				],
			],
			output: await format(input, { parser: 'markdown' }),
		};

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual(expectedResult);
		await expect(
			formatWithNotices(result.output, options)
		).resolves.toStrictEqual(expectedResult);
	}
);

test.each(
	MARKDOWN_PARSER_NAMES.flatMap((parser) =>
		[
			{
				input: '- [ ] [ref]: <div   >foo</div> bar\n  baz\n\nSee [ref].\n',
				output: '- [ ] [ref]:\n      <div>foo</div>\n      bar baz\n\nSee [ref].\n',
				printWidth: 20,
				proseWrap: 'always' as const,
			},
			{
				input: '- [ ] foo\\\n      <p   >bar</p> baz\n',
				output: '- [ ] foo\\\n      <p>bar</p> baz\n',
			},
			{
				input: '- [ ] foo\\\n  \t\t<p   >bar</p> baz\n',
				output: '- [ ] foo\\\n      <p>bar</p> baz\n',
			},
		].map((row) => ({ ...row, parser }))
	)
)(
	'formats block-shaped inline HTML on a task item’s indented continuation line with the `$parser` parser ($input)',
	async ({ input, output, parser, printWidth, proseWrap }) => {
		const options = {
			parser,
			plugins: [pluginMarkdownHTML],
			...(printWidth === undefined ? {} : { printWidth }),
			...(proseWrap === undefined ? {} : { proseWrap }),
		};
		const expectedResult = { notices: [], output };

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual(expectedResult);
		await expect(
			formatWithNotices(result.output, options)
		).resolves.toStrictEqual(expectedResult);
	}
);

test.each([
	'[guide]: /guide\n[logo]: ./logo.png\n<img src="logo.png" alt="">\n===\n',
	'- [logo]: ./logo.png\n  <img src="logo.png" alt="">\n  ===\n',
])(
	'formats a setext heading with HTML after a link reference definition that plain Prettier keeps on its line in %j',
	async (input) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};
		const output = input.replace('alt="">', 'alt="" />');

		await expect(formatWithNotices(input, options)).resolves.toStrictEqual({
			notices: [],
			output,
		});
		await expect(formatWithNotices(output, options)).resolves.toStrictEqual(
			{
				notices: [],
				output,
			}
		);
	}
);

test.each([
	{
		input: '- foo\n\n  bar\\\n  \t<p>baz</p> qux\n',
		tabWidth: 2,
		twin: '- foo\n\n  bar\\\n    <p>baz</p> qux\n',
	},
	{
		input: '- foo\n\n  \t<div   >bar</div>\n',
		tabWidth: 4,
		twin: '- foo\n\n    <div   >bar</div>\n',
	},
	{
		input: '1. foo\n\n   \t<div   >bar</div>\n',
		tabWidth: 4,
		twin: '1. foo\n\n    <div   >bar</div>\n',
	},
	{
		input: '> foo\n>\n>\t<div   >bar</div>\n',
		tabWidth: 4,
		twin: '> foo\n>\n>   <div   >bar</div>\n',
	},
])(
	'formats an HTML block indented with a tab in a container like the block indented with spaces covering the same columns, with `tabWidth` set to $tabWidth',
	async ({ input, tabWidth, twin }) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
			tabWidth,
		};
		const expectedResult = await formatWithNotices(twin, options);

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual(expectedResult);
		await expect(
			formatWithNotices(result.output, options)
		).resolves.toStrictEqual(expectedResult);
	}
);

test.each([
	{
		input: '-   foo\n\n    <!-- prettier-ignore -->\n    bar <b   >baz</b>\n===\n',
		output: '- foo\n\n  <!-- prettier-ignore -->\n    bar <b   >baz</b>\n===\n',
		tabWidth: 4,
	},
	{
		input: '- foo\n\n  <!-- prettier-ignore -->\n  bar <b   >baz</b>\n===\n',
		output: '- foo\n\n  <!-- prettier-ignore -->\n  bar <b   >baz</b>\n===\n',
		tabWidth: 2,
	},
	{
		input: '>foo\n>\n><!-- prettier-ignore -->\n>bar <b   >baz</b>\n===\n',
		output: '> foo\n>\n> <!-- prettier-ignore -->\n> bar <b   >baz</b>\n===\n',
		tabWidth: 2,
	},
	{
		input: '- foo\n\n  <!-- prettier-ignore -->\n  bar <b   >baz</b>\nqux\n',
		output: '- foo\n\n  <!-- prettier-ignore -->\n    bar <b   >baz</b>\nqux\n',
		tabWidth: 4,
	},
])(
	'keeps the lines of an ignored block whose container prefixes change that lack those prefixes at their own start, with `tabWidth` set to $tabWidth',
	async ({ input, output: expectedOutput, tabWidth }) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
			tabWidth,
		};
		const expectedResult = { notices: [], output: expectedOutput };

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual(expectedResult);
		await expect(
			formatWithNotices(result.output, options)
		).resolves.toStrictEqual(expectedResult);
	}
);

test('keeps plain Prettier’s indentation for a rejected HTML block that stays in its container', async () => {
	const input = '- bar\n\n </div>\n- [ ] task\n';

	await expect(
		formatWithNotices(input, {
			parser: 'markdown',
			plugins: [pluginMarkdownHTML],
		})
	).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (3:2): No opening `<div>` matches this `</div>` in the same Markdown region.',
			],
		],
		output: input,
	});
});

test('reads HTML on a lazy continuation line as text of the paragraph it continues', async () => {
	const input = '  1) bar\n    <p   >x</p>\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};
	const expectedResult = { notices: [], output: '1. bar <p>x</p>\n' };

	const result = await formatWithNotices(input, options);

	expect(result).toStrictEqual(expectedResult);
	await expect(
		formatWithNotices(result.output, options)
	).resolves.toStrictEqual(expectedResult);
});

test('rejects an unclosed tag on a lazy continuation line only for its tag matching', async () => {
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};

	const result = await formatWithNotices(
		'  1) bar\n    <span>\n- [ ] task\n',
		options
	);

	expect(result).toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (2:5): Close `<span>` with `</span>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
			],
		],
		output: '1. bar\n   <span>\n\n- [ ] task\n',
	});
	await expect(
		formatWithNotices(result.output, options)
	).resolves.toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (2:4): Close `<span>` with `</span>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
			],
		],
		output: result.output,
	});
});

test.each([
	'- foo\n\n  <!-- prettier-ignore -->\n  * bar   baz\n',
	'1. foo\n\n   <!-- prettier-ignore -->\n   - bar   baz\n',
	'- foo\n  <!-- prettier-ignore -->\n  * bar   baz\n',
	'> <!-- prettier-ignore -->\n> * foo   bar\n',
	'<!-- prettier-ignore -->\n* foo   bar\n',
	'- foo\n\n  - bar\n\n    <!-- prettier-ignore -->\n    * baz   qux\n',
	'- foo\n\n  <!--prettier-ignore-->\n  * bar   baz\n',
])(
	'prints a Markdown ignore directive and the list it protects as plain Prettier does',
	async (input) => {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};

		const output = await format(input, options);

		expect(output).toBe(await format(input, { parser: 'markdown' }));
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test('keeps plain Prettier’s indentation for indented code after a nested list without an HTML block before it in its list item', async () => {
	const input =
		'<p>Run the formatter:</p>\n\n- - Install Prettier\n\n  Then:\n\n      *b*\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		tabWidth: 4,
	};
	const plainOptions = { parser: 'markdown' as const, tabWidth: 4 };

	const result = await formatWithNotices(input, options);

	expect(result).toStrictEqual({
		notices: [],
		output: await format(input, plainOptions),
	});
	await expect(
		formatWithNotices(result.output, options)
	).resolves.toStrictEqual({
		notices: [],
		output: await format(result.output, plainOptions),
	});
});

test('leaves Markdown embedded in MDX to plain Prettier when a later plugin supplies the Markdown parser', async () => {
	const input = '```md\n<div   >foo</div>\n```\n';
	const parserPlugin: Plugin = {
		parsers: { markdown: markdownParsers.markdown },
	};

	await expect(
		format(input, {
			parser: 'mdx',
			plugins: [pluginMarkdownHTML, parserPlugin],
		})
	).resolves.toBe(await format(input, { parser: 'mdx' }));
});

test('respects `prettier-ignore` comments inside HTML blocks', async () => {
	const input = `<div>
<!-- prettier-ignore -->
<span id = "foo" class = "bar">baz</span>
</div>
`;
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"<div>
		  <!-- prettier-ignore -->
		  <span id = "foo" class = "bar">baz</span>
		</div>
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test.each([
	['markdown', '<!-- prettier-ignore -->\n\n<div>\n\n<p>foo</p>\n</div>\n'],
	[
		'markdown',
		'> <!-- prettier-ignore -->\n>\n> <div>\n>\n> <p>foo</p>\n> </div>\n',
	],
	[
		'markdown',
		'- <!-- prettier-ignore -->\n\n  <div>\n\n  <p>foo</p>\n  </div>\n',
	],
	['remark', '<!-- prettier-ignore -->\n\n<div>\n\n<p>foo</p>\n</div>\n'],
	[
		'remark',
		'> <!-- prettier-ignore -->\n>\n> <div>\n>\n> <p>foo</p>\n> </div>\n',
	],
	[
		'remark',
		'- <!-- prettier-ignore -->\n\n  <div>\n\n  <p>foo</p>\n  </div>\n',
	],
] as const)(
	'preserves ignored HTML groups with the `%s` parser',
	async (parserName, input) => {
		const options = {
			parser: parserName,
			plugins: [pluginMarkdownHTML],
		};

		const output = await format(input, options);
		const expectedOutput = await format(input, { parser: parserName });

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test('respects `printWidth`', async () => {
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		printWidth: Number.POSITIVE_INFINITY,
	};

	const output = await format(TEST_MARKDOWN, options);

	expect(output).toMatchSnapshot();
	await expect(format(output, options)).resolves.toBe(output);
});

test('respects `rangeStart` and `rangeEnd`', async () => {
	const input = `<div id = "before" class = "foo">before</div>

<div id = "selected" class = "bar">selected</div>

<div id = "after" class = "baz">after</div>
`;

	const selectedInput = '<div id = "selected" class = "bar">selected</div>';

	const rangeStart = input.indexOf(selectedInput);
	const rangeEnd = rangeStart + selectedInput.length;

	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};
	const fullRangeOptions = {
		...options,
		rangeEnd: input.length,
		rangeStart: 0,
	};

	const [expectedFullOutput, fullRangeOutput] = await Promise.all([
		format(input, options),
		format(input, fullRangeOptions),
	]);

	const [expectedPartialOutput, partialRangeOutput] = await Promise.all([
		format(input, { parser: 'markdown', rangeEnd, rangeStart }),
		format(input, { ...options, rangeEnd, rangeStart }),
	]);

	expect(fullRangeOutput).toBe(expectedFullOutput);
	expect(partialRangeOutput).toBe(expectedPartialOutput);
});

test('respects `requirePragma`', async () => {
	const input = `<!-- @format -->

<div id = "foo" class = "bar">baz</div>
`;
	const unformattedInput = '<div id = "foo" class = "bar">baz</div>\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		requirePragma: true,
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"<!-- @format -->

		<div id="foo" class="bar">baz</div>
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
	await expect(format(unformattedInput, options)).resolves.toBe(
		unformattedInput
	);
});

test('respects `singleAttributePerLine`', async () => {
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		singleAttributePerLine: false,
	};
	const singleAttributePerLineOptions = {
		...options,
		singleAttributePerLine: true,
	};

	const outputs = {
		false: await format(TEST_MARKDOWN, options),
		true: await format(TEST_MARKDOWN, singleAttributePerLineOptions),
	};

	expect(outputs).toMatchSnapshot();
	await expect(format(outputs.false, options)).resolves.toBe(outputs.false);
	await expect(
		format(outputs.true, singleAttributePerLineOptions)
	).resolves.toBe(outputs.true);
});

test('respects `tabWidth`', async () => {
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		tabWidth: 4,
	};

	const output = await format(TEST_MARKDOWN, options);

	expect(output).toMatchSnapshot();
	await expect(format(output, options)).resolves.toBe(output);
});

test('respects `useTabs`', async () => {
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		useTabs: true,
	};

	const output = await format(TEST_MARKDOWN, options);

	expect(output).toMatchSnapshot();
	await expect(format(output, options)).resolves.toBe(output);
});

test('supports `htmlFragmentBracketSameLine`', async () => {
	const input = `<div id="foo" class="bar" title="baz">qux</div>

\`\`\`html
<section id="foo" class="bar" title="baz">qux</section>
\`\`\`
`;
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		printWidth: 20,
		singleAttributePerLine: true,
	};
	const bracketSameLineOptions = {
		...options,
		bracketSameLine: true,
		htmlFragmentBracketSameLine: false,
	};
	const htmlFragmentBracketSameLineOptions = {
		...options,
		bracketSameLine: false,
		htmlFragmentBracketSameLine: true,
	};

	const outputs = {
		false: await format(input, bracketSameLineOptions),
		true: await format(input, htmlFragmentBracketSameLineOptions),
	};

	expect(outputs).toMatchInlineSnapshot(`
		{
		  "false": "<div
		  id="foo"
		  class="bar"
		  title="baz"
		>
		  qux
		</div>

		\`\`\`html
		<section
		  id="foo"
		  class="bar"
		  title="baz">
		  qux
		</section>
		\`\`\`
		",
		  "true": "<div
		  id="foo"
		  class="bar"
		  title="baz">
		  qux
		</div>

		\`\`\`html
		<section
		  id="foo"
		  class="bar"
		  title="baz"
		>
		  qux
		</section>
		\`\`\`
		",
		}
	`);
	await expect(format(outputs.false, bracketSameLineOptions)).resolves.toBe(
		outputs.false
	);
	await expect(
		format(outputs.true, htmlFragmentBracketSameLineOptions)
	).resolves.toBe(outputs.true);
});

test('supports `htmlFragmentEmbeddedLanguageFormatting`', async () => {
	const input = `<script>const foo={bar:1,baz:2}</script>

\`\`\`js
const foo={bar:1,baz:2}
\`\`\`
`;
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};
	const autoOptions = {
		...options,
		embeddedLanguageFormatting: 'off' as const,
		htmlFragmentEmbeddedLanguageFormatting: 'auto' as const,
	};
	const offOptions = {
		...options,
		embeddedLanguageFormatting: 'auto' as const,
		htmlFragmentEmbeddedLanguageFormatting: 'off' as const,
	};

	const outputs = {
		auto: await format(input, autoOptions),
		off: await format(input, offOptions),
	};

	expect(outputs).toMatchInlineSnapshot(`
		{
		  "auto": "<script>
		  const foo = { bar: 1, baz: 2 };
		</script>

		\`\`\`js
		const foo={bar:1,baz:2}
		\`\`\`
		",
		  "off": "<script>
		  const foo={bar:1,baz:2}
		</script>

		\`\`\`js
		const foo = { bar: 1, baz: 2 };
		\`\`\`
		",
		}
	`);
	await expect(format(outputs.auto, autoOptions)).resolves.toBe(outputs.auto);
	await expect(format(outputs.off, offOptions)).resolves.toBe(outputs.off);
});

test('supports `htmlFragmentPrintWidth`', async () => {
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		htmlFragmentPrintWidth: 80,
		printWidth: 40,
	};

	const output = await format(TEST_MARKDOWN, options);

	expect(output).toMatchSnapshot();
	await expect(format(output, options)).resolves.toBe(output);
});

test('supports `htmlFragmentSingleAttributePerLine`', async () => {
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};
	const htmlFragmentSingleAttributePerLineOptions = {
		...options,
		htmlFragmentSingleAttributePerLine: true,
		singleAttributePerLine: false,
	};
	const singleAttributePerLineOptions = {
		...options,
		htmlFragmentSingleAttributePerLine: false,
		singleAttributePerLine: true,
	};

	const outputs = {
		false: await format(TEST_MARKDOWN, singleAttributePerLineOptions),
		true: await format(
			TEST_MARKDOWN,
			htmlFragmentSingleAttributePerLineOptions
		),
	};

	expect(outputs).toMatchSnapshot();
	await expect(
		format(outputs.false, singleAttributePerLineOptions)
	).resolves.toBe(outputs.false);
	await expect(
		format(outputs.true, htmlFragmentSingleAttributePerLineOptions)
	).resolves.toBe(outputs.true);
});

test('supports `htmlFragmentWhitespaceSensitivity`', async () => {
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		htmlFragmentWhitespaceSensitivity: 'css' as const,
		htmlWhitespaceSensitivity: 'strict' as const,
	};

	const output = await format(TEST_MARKDOWN, options);

	expect(output).toMatchSnapshot();
	await expect(format(output, options)).resolves.toBe(output);
});

test('formats newline-only files as empty', async () => {
	const input = '\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};

	const output = await format(input, options);

	expect(output).toBe('');
	await expect(format(output, options)).resolves.toBe(output);
});

test('reports rejected regions with the file and the Markdown position', async () => {
	const input = '<div><p></div></p>';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};

	const resultWithSource = await formatWithNotices(input, {
		filepath: 'foo/bar.md',
		...options,
	});
	const resultWithoutSource = await formatWithNotices(input, options);

	expect(resultWithSource).toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting in `foo/bar.md` (1:15): No opening `<p>` matches this `</p>` in the same Markdown region.',
			],
		],
		output: '<div><p></div></p>\n',
	});
	expect(resultWithoutSource).toStrictEqual({
		notices: [
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting (1:15): No opening `<p>` matches this `</p>` in the same Markdown region.',
			],
		],
		output: '<div><p></div></p>\n',
	});
});

test('formats in standalone mode', async () => {
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginHTML, pluginMarkdownHTML],
	};

	const expectedOutput = await format(TEST_MARKDOWN, options);
	const output = await standaloneFormat(TEST_MARKDOWN, options);

	expect(output).toBe(expectedOutput);
});

test('formats in standalone mode when `singleAttributePerLine` is `true`', async () => {
	const input = '<div id = "foo" class = "bar">baz</div>\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		singleAttributePerLine: true,
	};

	const expectedOutput = await format(input, options);
	const output = await standaloneFormat(input, options);

	expect(output).toBe(expectedOutput);
});
