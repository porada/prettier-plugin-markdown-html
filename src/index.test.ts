import type { Parser, ParserOptions, Plugin, Printer } from 'prettier';
import type { PluginOptions } from './index.ts';
import type { AST } from './types/index.d.ts';
import { format, formatWithCursor } from 'prettier';
import * as pluginHTML from 'prettier/plugins/html';
import {
	parsers as markdownParsers,
	printers as markdownPrinters,
} from 'prettier/plugins/markdown';
import { format as standaloneFormat } from 'prettier/standalone';
import { expect, expectTypeOf, onTestFinished, test } from 'vite-plus/test';
import * as pluginMarkdownHTML from './index.ts';

test('exposes correct public API', () => {
	expectTypeOf(pluginMarkdownHTML).toExtend<Plugin>();

	expect(pluginMarkdownHTML).toHaveProperty('options');
	expect(pluginMarkdownHTML).toHaveProperty('parsers');
	expect(pluginMarkdownHTML.parsers).toHaveProperty('markdown');
	expect(pluginMarkdownHTML.parsers).toHaveProperty('remark');

	expect(pluginMarkdownHTML).toHaveProperty('printers');
	expect(pluginMarkdownHTML.printers).toHaveProperty('mdast');

	expectTypeOf<PluginOptions>().toBeObject();
});

const MARKDOWN_PARSER_NAMES = ['markdown', 'remark'] as const;

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
	'formats inline raw text `%s` elements',
	async (tagName) => {
		const input = `Before <${tagName} id = "foo" class = "bar">baz</${tagName}> After\n`;
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
		};

		const output = await format(input, options);

		expect(output).toBe(
			`Before <${tagName} id="foo" class="bar">baz</${tagName}> After\n`
		);
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test.each([
	['script', 'auto', 'markdown'],
	['script', 'auto', 'remark'],
	['script', 'off', 'markdown'],
	['script', 'off', 'remark'],
	['style', 'auto', 'markdown'],
	['style', 'auto', 'remark'],
	['style', 'off', 'markdown'],
	['style', 'off', 'remark'],
	['textarea', 'auto', 'markdown'],
	['textarea', 'auto', 'remark'],
	['textarea', 'off', 'markdown'],
	['textarea', 'off', 'remark'],
	['title', 'auto', 'markdown'],
	['title', 'auto', 'remark'],
	['title', 'off', 'markdown'],
	['title', 'off', 'remark'],
] as const)(
	'preserves inline `%s` contents when `embeddedLanguageFormatting` is `%s` with the `%s` parser',
	async (tagName, embeddedLanguageFormatting, parserName) => {
		const content = {
			script: `const html = "<b id='foo'>";`,
			style: `b::before { content: "<b id='foo'>"; }`,
			textarea: `<b id='foo'>bar</b>`,
			title: `<b id='foo'>bar</b>`,
		}[tagName];
		const input = `Before <${tagName} id = "foo">${content}</${tagName}> <span id = "bar">baz</span> After\n`;
		const options = {
			embeddedLanguageFormatting,
			parser: parserName,
			plugins: [pluginMarkdownHTML],
		};

		const output = await format(input, options);
		const expectedOutput = await format(input, {
			embeddedLanguageFormatting,
			parser: parserName,
		});

		expect(output).toBe(
			expectedOutput
				.replace('id = "foo"', 'id="foo"')
				.replace('id = "bar"', 'id="bar"')
		);
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test.each([
	['markdown', 'Before <title id = "foo">bar **baz</title> qux**\n'],
	['markdown', 'Before **<title id = "foo">bar** baz</title> After\n'],
	['markdown', 'Before <textarea id = "foo">bar\n\nbaz</textarea> After\n'],
	[
		'markdown',
		'Before <textarea id = "foo">bar\n\n<b id="baz">qux</b>\n\n</textarea> After\n',
	],
	[
		'markdown',
		'Before <textarea id = "foo">bar\n\n<div></textarea><section>\n\n<aside>baz</aside>\n</section>\n',
	],
	['remark', 'Before <title id = "foo">bar **baz</title> qux**\n'],
	['remark', 'Before **<title id = "foo">bar** baz</title> After\n'],
	['remark', 'Before <textarea id = "foo">bar\n\nbaz</textarea> After\n'],
	[
		'remark',
		'Before <textarea id = "foo">bar\n\n<b id="baz">qux</b>\n\n</textarea> After\n',
	],
	[
		'remark',
		'Before <textarea id = "foo">bar\n\n<div></textarea><section>\n\n<aside>baz</aside>\n</section>\n',
	],
] as const)(
	'formats raw text tags across Markdown parents with the `%s` parser',
	async (parserName, input) => {
		const options = {
			parser: parserName,
			plugins: [pluginMarkdownHTML],
		};

		const output = await format(input, options);
		const expectedOutput = await format(input, { parser: parserName });

		expect(output).toBe(expectedOutput.replace('id = "foo"', 'id="foo"'));
		await expect(format(output, options)).resolves.toBe(output);
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
		input: 'Before <address id = "foo" class = "bar">baz</address> After\n',
		output: `Before <address
  id="foo"
  class="bar">baz</address>
After
`,
	},
	{
		input: 'Before <hgroup id = "foo" class = "bar">baz</hgroup> After\n',
		output: `Before <hgroup
  id="foo"
  class="bar">baz</hgroup>
After
`,
	},
	{
		input: 'Before <meta id = "foo" class = "bar"> After\n',
		output: `Before <meta
  id="foo"
  class="bar" />
After
`,
	},
	{
		input: 'Before <source id = "foo" class = "bar"> After\n',
		output: `Before <source
  id="foo"
  class="bar" />
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
	const input = 'Before <div>foo bar baz qux </div> After\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		printWidth: 10,
		proseWrap: 'always' as const,
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"Before <div>foo
		bar baz
		qux </div>
		After
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test('keeps closing raw text HTML stable when wrapping prose', async () => {
	const input = 'Before <title>foo bar baz qux </title> After\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		printWidth: 10,
		proseWrap: 'always' as const,
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"Before <title>foo
		bar baz
		qux </title>
		After
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test.each(MARKDOWN_PARSER_NAMES)(
	'keeps raw text HTML tokens inline when wrapping prose with the `%s` parser',
	async (parserName) => {
		const input =
			'Before <title>foo bar baz qux <div>quux</div></title> **after**\n';
		const options = {
			parser: parserName,
			plugins: [pluginMarkdownHTML],
			printWidth: 10,
			proseWrap: 'always' as const,
		};

		const output = await format(input, options);

		expect(output).toBe(
			'Before <title>foo\nbar baz\nqux <div>quux</div></title>\n**after**\n'
		);
		await expect(format(output, options)).resolves.toBe(output);
	}
);

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
	['markdown', '<div>\n\nfoo\n\n</div>*bar*\n'],
	['markdown', '<div>\n\nfoo\n\n</div>\n_bar_\n'],
	['markdown', '<div>\n<section>\n\nfoo\n\n</section> </div> *bar*\n'],
	['markdown', '> <div>\n>\n> foo\n>\n> </div>*bar*\n'],
	['markdown', '- <div>\n\n  foo\n\n  </div>*bar*\n'],
	['remark', '<div>\n\nfoo\n\n</div>*bar*\n'],
	['remark', '<div>\n\nfoo\n\n</div>\n_bar_\n'],
	['remark', '<div>\n<section>\n\nfoo\n\n</section> </div> *bar*\n'],
	['remark', '> <div>\n>\n> foo\n>\n> </div>*bar*\n'],
	['remark', '- <div>\n\n  foo\n\n  </div>*bar*\n'],
] as const)(
	'preserves raw block text after closing tags with the `%s` parser',
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

test.each([
	['markdown', '<div title="\n\n<div>"></div>\n', ''],
	['markdown', '<div title="\n\n<div>"></div>\n', '  '],
	['markdown', '<div title="\n\n<div>"></div>\n', '> '],
	['markdown', '<div title="\n  \n<div>"></div>\n', ''],
	['markdown', '<div title="\n  \n<div>"></div>\n', '  '],
	['markdown', '<div title="\n  \n<div>"></div>\n', '> '],
	['markdown', '<div><textarea>foo\n\n<div>bar</textarea></div>\n', ''],
	['markdown', '<div><textarea>foo\n\n<div>bar</textarea></div>\n', '  '],
	['markdown', '<div><textarea>foo\n\n<div>bar</textarea></div>\n', '> '],
	['remark', '<div title="\n\n<div>"></div>\n', ''],
	['remark', '<div title="\n\n<div>"></div>\n', '  '],
	['remark', '<div title="\n\n<div>"></div>\n', '> '],
	['remark', '<div title="\n  \n<div>"></div>\n', ''],
	['remark', '<div title="\n  \n<div>"></div>\n', '  '],
	['remark', '<div title="\n  \n<div>"></div>\n', '> '],
	['remark', '<div><textarea>foo\n\n<div>bar</textarea></div>\n', ''],
	['remark', '<div><textarea>foo\n\n<div>bar</textarea></div>\n', '  '],
	['remark', '<div><textarea>foo\n\n<div>bar</textarea></div>\n', '> '],
] as const)(
	'preserves significant blank lines across HTML nodes with the `%s` parser',
	async (parserName, input, prefix) => {
		const options = {
			parser: parserName,
			plugins: [pluginMarkdownHTML],
		};

		const wrap = (text: string): string => {
			const content = text
				.trimEnd()
				.split('\n')
				.map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()))
				.join('\n');
			return `${prefix === '  ' ? '- baz\n\n' : ''}${content}\n`;
		};

		const htmlOutput = await format(input, { parser: 'html' });

		const output = await format(wrap(input), options);
		const expectedOutput = wrap(htmlOutput);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test.each([
	{
		embeddedLanguageFormatting: 'auto',
		input: '- foo\n\n  <div title="\n\n  <div>"></div>\n',
		output: '- foo\n\n  <div\n    title="\n\n  <div>"\n  ></div>\n',
		parserName: 'markdown',
	},
	{
		embeddedLanguageFormatting: 'auto',
		input: '> - foo\n>\n>   <div title="\n>\n>   <div>"></div>\n',
		output: '> - foo\n>\n>   <div\n>     title="\n>\n>   <div>"\n>   ></div>\n',
		parserName: 'markdown',
	},
	{
		embeddedLanguageFormatting: 'auto',
		input: '> <div title="\n>\n> <div>"></div>\n',
		output: '> <div\n>   title="\n>\n> <div>"\n> ></div>\n',
		parserName: 'markdown',
	},
	{
		embeddedLanguageFormatting: 'auto',
		input: '> > <div title="\n> >\n> > <div>"></div>\n',
		output: '> > <div\n> >   title="\n> >\n> > <div>"\n> > ></div>\n',
		parserName: 'markdown',
	},
	{
		embeddedLanguageFormatting: 'off',
		input: '- foo\n\n  <div title="\n\n  <div>"></div>\n',
		output: '- foo\n\n  <div\n    title="\n\n  <div>"\n  ></div>\n',
		parserName: 'markdown',
	},
	{
		embeddedLanguageFormatting: 'off',
		input: '> - foo\n>\n>   <div title="\n>\n>   <div>"></div>\n',
		output: '> - foo\n>\n>   <div\n>     title="\n>\n>   <div>"\n>   ></div>\n',
		parserName: 'markdown',
	},
	{
		embeddedLanguageFormatting: 'off',
		input: '> <div title="\n>\n> <div>"></div>\n',
		output: '> <div\n>   title="\n>\n> <div>"\n> ></div>\n',
		parserName: 'markdown',
	},
	{
		embeddedLanguageFormatting: 'off',
		input: '> > <div title="\n> >\n> > <div>"></div>\n',
		output: '> > <div\n> >   title="\n> >\n> > <div>"\n> > ></div>\n',
		parserName: 'markdown',
	},
	{
		embeddedLanguageFormatting: 'auto',
		input: '- foo\n\n  <div title="\n\n  <div>"></div>\n',
		output: '- foo\n\n  <div\n    title="\n\n  <div>"\n  ></div>\n',
		parserName: 'remark',
	},
	{
		embeddedLanguageFormatting: 'auto',
		input: '> - foo\n>\n>   <div title="\n>\n>   <div>"></div>\n',
		output: '> - foo\n>\n>   <div\n>     title="\n>\n>   <div>"\n>   ></div>\n',
		parserName: 'remark',
	},
	{
		embeddedLanguageFormatting: 'auto',
		input: '> <div title="\n>\n> <div>"></div>\n',
		output: '> <div\n>   title="\n>\n> <div>"\n> ></div>\n',
		parserName: 'remark',
	},
	{
		embeddedLanguageFormatting: 'auto',
		input: '> > <div title="\n> >\n> > <div>"></div>\n',
		output: '> > <div\n> >   title="\n> >\n> > <div>"\n> > ></div>\n',
		parserName: 'remark',
	},
	{
		embeddedLanguageFormatting: 'off',
		input: '- foo\n\n  <div title="\n\n  <div>"></div>\n',
		output: '- foo\n\n  <div\n    title="\n\n  <div>"\n  ></div>\n',
		parserName: 'remark',
	},
	{
		embeddedLanguageFormatting: 'off',
		input: '> - foo\n>\n>   <div title="\n>\n>   <div>"></div>\n',
		output: '> - foo\n>\n>   <div\n>     title="\n>\n>   <div>"\n>   ></div>\n',
		parserName: 'remark',
	},
	{
		embeddedLanguageFormatting: 'off',
		input: '> <div title="\n>\n> <div>"></div>\n',
		output: '> <div\n>   title="\n>\n> <div>"\n> ></div>\n',
		parserName: 'remark',
	},
	{
		embeddedLanguageFormatting: 'off',
		input: '> > <div title="\n> >\n> > <div>"></div>\n',
		output: '> > <div\n> >   title="\n> >\n> > <div>"\n> > ></div>\n',
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
	'keeps native printing for preserved raw text contents with the `%s` parser',
	async (parserName) => {
		const input =
			'> Before <textarea>foo\n>\n> <script>\n>\n> bar</script>\n>\n> </textarea>\n';
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

test.each(MARKDOWN_PARSER_NAMES)(
	'preserves HTML content across variable blockquote prefixes with the `%s` parser',
	async (parserName) => {
		const input = '> > <div title="\n> >\n>><div>"></div>\n';
		const options = {
			parser: parserName,
			plugins: [pluginMarkdownHTML],
		};

		const output = await format(input, options);
		const htmlOutput = await format('<div title="\n\n<div>"></div>\n', {
			parser: 'html',
		});

		const expectedOutput = htmlOutput
			.trimEnd()
			.split('\n')
			.map((line) => (line ? `> > ${line}` : '> >'))
			.join('\n');

		expect(output).toBe(`${expectedOutput}\n`);
		await expect(format(output, options)).resolves.toBe(output);
	}
);

test('preserves blank lines after a tag split across HTML nodes', async () => {
	const input = `<section>
<div title="

<aside>">

</div>
</section>

<p>foo</p>
`;
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"<section>
		  <div
		    title="

		<aside>"
		  ></div>
		</section>

		<p>foo</p>
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
});

test('formats a root tag split across HTML nodes', async () => {
	const input = `<div title="

<aside>">

</div>
`;
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};

	const output = await format(input, options);

	expect(output).toMatchInlineSnapshot(`
		"<div
		  title="

		<aside>"
		></div>
		"
	`);
	await expect(format(output, options)).resolves.toBe(output);
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

test('reports formatting errors', async () => {
	const input = '<div><p></div></p>';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};

	const errorWithSource = (await format(input, {
		filepath: 'foo/bar.md',
		...options,
	}).catch((error: unknown) => error)) as Error;

	const errorWithoutSource = (await format(input, options).catch(
		(error: unknown) => error
	)) as Error;

	expect(errorWithSource).toBeInstanceOf(Error);
	expect(errorWithSource.cause).toBeInstanceOf(Error);
	expect(errorWithSource.message.split('\n')[0]).toMatchInlineSnapshot(
		`"[prettier-plugin-markdown-html] Failed to format HTML fragment in \`foo/bar.md\`:"`
	);

	expect(errorWithoutSource).toBeInstanceOf(Error);
	expect(errorWithoutSource.cause).toBeInstanceOf(Error);
	expect(errorWithoutSource.message.split('\n')[0]).toMatchInlineSnapshot(
		`"[prettier-plugin-markdown-html] Failed to format HTML fragment:"`
	);
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
