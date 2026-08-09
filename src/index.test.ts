import type { Parser, ParserOptions, Plugin, Printer } from 'prettier';
import type { PluginOptions } from './index.ts';
import type { AST } from './types/index.d.ts';
import { format, formatWithCursor } from 'prettier';
import {
	parsers as markdownParsers,
	printers as markdownPrinters,
} from 'prettier/plugins/markdown';
import { format as standaloneFormat } from 'prettier/standalone';
import { expect, expectTypeOf, test } from 'vite-plus/test';
import * as pluginMarkdownHTML from './index.ts';

test('exposes correct public API', () => {
	expectTypeOf(pluginMarkdownHTML).toExtend<Plugin>();

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
			return 'Parser <span id = "foo">value</span>\n';
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

	const parser = pluginMarkdownHTML.parsers?.markdown;

	if (!parser || typeof parser === 'function' || !parser.preprocess) {
		throw new TypeError('Expected a direct `markdown` parser');
	}

	let output: string;

	try {
		output = await parser.preprocess('value\n', {
			plugins: [pluginMarkdownHTML],
		} as ParserOptions);
	} finally {
		markdownParsers.markdown.preprocess = nativePreprocess;
	}

	expect(output).toBe('Native value\n');
});

test('formats raw HTML in Markdown', async () => {
	const output = await format(TEST_MARKDOWN, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
	});

	expect(output).toMatchSnapshot();
});

test('formats raw HTML with the `remark` parser', async () => {
	const output = await format('<div id = "foo">value</div>\n', {
		parser: 'remark',
		plugins: [pluginMarkdownHTML],
	});

	expect(output).toMatchInlineSnapshot(`
		"<div id="foo">value</div>
		"
	`);
});

test('formats raw HTML with compatible aliased parsers', async () => {
	const aliasPlugin: Plugin = {
		parsers: { 'markdown-alias': markdownParsers.markdown },
	};

	const output = await format('<div id = "foo">value</div>\n', {
		parser: 'markdown-alias',
		plugins: [aliasPlugin, pluginMarkdownHTML],
	});

	expect(output).toMatchInlineSnapshot(`
		"<div id="foo">value</div>
		"
	`);
});

test.each(MARKDOWN_PARSER_NAMES)(
	'composes prior `%s` parser and printer preprocess hooks',
	async (parserName) => {
		const priorPlugin = createPriorPlugin(parserName);

		const output = await format('ignored\n', {
			parser: parserName,
			plugins: [priorPlugin, pluginMarkdownHTML],
		});

		expect(output).toMatchInlineSnapshot(`
			"Parser <span id="bar">value</span>
			"
		`);
	}
);

test.each(MARKDOWN_PARSER_NAMES)(
	'skips prior `%s` printer preprocessors with incompatible structural hooks',
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

		const priorOutput = await format('value\n', {
			parser: parserName,
			plugins: [priorPlugin],
		});

		const expectedOutput = await format('value\n', {
			parser: parserName,
			plugins: [pluginMarkdownHTML],
		});

		const output = await format('value\n', {
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

test('formats inline raw-text HTML elements', async () => {
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};

	for (const tagName of ['script', 'style', 'textarea', 'title']) {
		const input = `Before <${tagName} id = "foo" class = "bar">baz</${tagName}> After\n`;
		const output = await format(input, options);

		expect(output).toBe(
			`Before <${tagName} id="foo" class="bar">baz</${tagName}> After\n`
		);

		await expect(format(output, options)).resolves.toBe(output);
	}
});

test('formats block HTML in block quotes and list items', async () => {
	const input = `> <div id = "foo" class = "bar"><span>baz</span></div>

- Item

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

		- Item

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

test('keeps inline block HTML stable when wrapping prose', async () => {
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		printWidth: 10,
		proseWrap: 'always' as const,
	};

	const cases = [
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
	];

	for (const { input, output: expectedOutput } of cases) {
		const output = await format(input, options);

		expect(output).toBe(expectedOutput);

		await expect(format(output, options)).resolves.toBe(output);
	}
});

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

test('keeps closing raw-text HTML stable when wrapping prose', async () => {
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

test('preserves blank lines after a tag split across HTML nodes', async () => {
	const input = `<section>
<div title="

<aside>">

</div>
</section>

<p>separate</p>
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

		<p>separate</p>
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
	const input = '<div first="one" second="two" third="three">value</div>\n';

	const outputs: string[] = [];

	for (const bracketSameLine of [false, true]) {
		outputs.push(
			await format(input, {
				bracketSameLine,
				parser: 'markdown',
				plugins: [pluginMarkdownHTML],
				printWidth: 20,
				singleAttributePerLine: true,
			})
		);
	}

	expect(outputs).toMatchInlineSnapshot(`
		[
		  "<div
		  first="one"
		  second="two"
		  third="three"
		>
		  value
		</div>
		",
		  "<div
		  first="one"
		  second="two"
		  third="three">
		  value
		</div>
		",
		]
	`);
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

	await expect(format(output, options)).resolves.toBe(output);
});

test.each(MARKDOWN_PARSER_NAMES)(
	'respects `cursorOffset` with the `%s` parser',
	async (parser) => {
		const htmlFragment =
			'<div id = "foo" class = "bar"><span>alpha§omega</span></div>';

		const inputs = [
			`${htmlFragment}\n`,
			`> ${htmlFragment}\n`,
			`- Item\n\n  ${htmlFragment}\n`,
		];

		for (const input of inputs) {
			const cursorOffset = input.indexOf('§');

			const { cursorOffset: formattedCursorOffset, formatted } =
				await formatWithCursor(input, {
					cursorOffset,
					parser,
					plugins: [pluginMarkdownHTML],
					singleAttributePerLine: true,
				});

			expect(formatted).not.toBe(input);
			expect(formatted[formattedCursorOffset]).toBe('§');
			expect(formattedCursorOffset).toBe(formatted.indexOf('§'));
		}
	}
);

test('respects `embeddedLanguageFormatting`', async () => {
	const input = `<script>const value={foo:1,bar:2}</script>

<style>.foo{display:block;color:red;}</style>
`;

	const outputs: string[] = [];

	for (const embeddedLanguageFormatting of ['auto', 'off'] as const) {
		outputs.push(
			await format(input, {
				embeddedLanguageFormatting,
				parser: 'markdown',
				plugins: [pluginMarkdownHTML],
			})
		);
	}

	expect(outputs).toMatchInlineSnapshot(`
		[
		  "<script>
		  const value = { foo: 1, bar: 2 };
		</script>

		<style>
		  .foo {
		    display: block;
		    color: red;
		  }
		</style>
		",
		  "<script>
		  const value={foo:1,bar:2}
		</script>

		<style>
		  .foo{display:block;color:red;}
		</style>
		",
		]
	`);
});

test('respects `htmlWhitespaceSensitivity`', async () => {
	const output = await format(TEST_MARKDOWN, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
		htmlWhitespaceSensitivity: 'strict',
	});

	expect(output).toMatchSnapshot();
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

test('respects `prettier-ignore` comments', async () => {
	const inputs = [
		`<!-- prettier-ignore -->
<div id = "foo" class = "bar">value</div>
`,
		`<div>
<!-- prettier-ignore -->
<span id = "foo" class = "bar">value</span>
</div>
`,
	];

	const outputs: string[] = [];

	for (const input of inputs) {
		outputs.push(
			await format(input, {
				parser: 'markdown',
				plugins: [pluginMarkdownHTML],
			})
		);
	}

	expect(outputs).toMatchInlineSnapshot(`
		[
		  "<!-- prettier-ignore -->
		<div id = "foo" class = "bar">value</div>
		",
		  "<div>
		  <!-- prettier-ignore -->
		  <span id = "foo" class = "bar">value</span>
		</div>
		",
		]
	`);
});

test('respects `printWidth`', async () => {
	const output = await format(TEST_MARKDOWN, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
		printWidth: Number.POSITIVE_INFINITY,
	});

	expect(output).toMatchSnapshot();
});

test('respects `rangeStart` and `rangeEnd`', async () => {
	const input = `<div id = "before" class = "alpha">before</div>

<div id = "selected" class = "beta">selected</div>

<div id = "after" class = "gamma">after</div>
`;

	const selectedInput = '<div id = "selected" class = "beta">selected</div>';

	const rangeStart = input.indexOf(selectedInput);
	const rangeEnd = rangeStart + selectedInput.length;

	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};

	const [expectedFullOutput, fullRangeOutput] = await Promise.all([
		format(input, options),
		format(input, {
			...options,
			rangeEnd: input.length,
			rangeStart: 0,
		}),
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
	const standaloneInput = '<div id = "foo" class = "bar">value</div>\n';

	for (const singleAttributePerLine of [true, false]) {
		const options = {
			parser: 'markdown' as const,
			plugins: [pluginMarkdownHTML],
			singleAttributePerLine,
		};

		const output = await format(TEST_MARKDOWN, options);
		const expectedStandaloneOutput = await format(standaloneInput, options);
		const standaloneOutput = await standaloneFormat(
			standaloneInput,
			options
		);

		expect(output).toMatchSnapshot();
		expect(standaloneOutput).toBe(expectedStandaloneOutput);
	}
});

test('respects `tabWidth`', async () => {
	const output = await format(TEST_MARKDOWN, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
		tabWidth: 4,
	});

	expect(output).toMatchSnapshot();
});

test('respects `useTabs`', async () => {
	const output = await format(TEST_MARKDOWN, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
		useTabs: true,
	});

	expect(output).toMatchSnapshot();
});

test('supports `htmlFragmentBracketSameLine`', async () => {
	const input = `<div first="one" second="two" third="three">value</div>

\`\`\`html
<section first="one" second="two" third="three">value</section>
\`\`\`
`;

	const outputs: string[] = [];

	for (const htmlFragmentBracketSameLine of [false, true]) {
		outputs.push(
			await format(input, {
				bracketSameLine: !htmlFragmentBracketSameLine,
				htmlFragmentBracketSameLine,
				parser: 'markdown',
				plugins: [pluginMarkdownHTML],
				printWidth: 20,
				singleAttributePerLine: true,
			})
		);
	}

	expect(outputs).toMatchInlineSnapshot(`
		[
		  "<div
		  first="one"
		  second="two"
		  third="three"
		>
		  value
		</div>

		\`\`\`html
		<section
		  first="one"
		  second="two"
		  third="three">
		  value
		</section>
		\`\`\`
		",
		  "<div
		  first="one"
		  second="two"
		  third="three">
		  value
		</div>

		\`\`\`html
		<section
		  first="one"
		  second="two"
		  third="three"
		>
		  value
		</section>
		\`\`\`
		",
		]
	`);
});

test('supports `htmlFragmentEmbeddedLanguageFormatting`', async () => {
	const input = `<script>const value={foo:1,bar:2}</script>

\`\`\`js
const value={foo:1,bar:2}
\`\`\`
`;

	const outputs: string[] = [];

	for (const htmlFragmentEmbeddedLanguageFormatting of [
		'auto',
		'off',
	] as const) {
		outputs.push(
			await format(input, {
				embeddedLanguageFormatting:
					htmlFragmentEmbeddedLanguageFormatting === 'auto'
						? 'off'
						: 'auto',
				htmlFragmentEmbeddedLanguageFormatting,
				parser: 'markdown',
				plugins: [pluginMarkdownHTML],
			})
		);
	}

	expect(outputs).toMatchInlineSnapshot(`
		[
		  "<script>
		  const value = { foo: 1, bar: 2 };
		</script>

		\`\`\`js
		const value={foo:1,bar:2}
		\`\`\`
		",
		  "<script>
		  const value={foo:1,bar:2}
		</script>

		\`\`\`js
		const value = { foo: 1, bar: 2 };
		\`\`\`
		",
		]
	`);
});

test('supports `htmlFragmentPrintWidth`', async () => {
	const output = await format(TEST_MARKDOWN, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
		htmlFragmentPrintWidth: 80,
		printWidth: 40,
	});

	expect(output).toMatchSnapshot();
});

test('supports `htmlFragmentSingleAttributePerLine`', async () => {
	for (const [htmlFragmentSingleAttributePerLine, singleAttributePerLine] of [
		[true, false],
		[false, true],
	] as const) {
		const output = await format(TEST_MARKDOWN, {
			parser: 'markdown',
			plugins: [pluginMarkdownHTML],
			htmlFragmentSingleAttributePerLine,
			singleAttributePerLine,
		});

		expect(output).toMatchSnapshot();
	}
});

test('supports `htmlFragmentWhitespaceSensitivity`', async () => {
	const output = await format(TEST_MARKDOWN, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
		htmlFragmentWhitespaceSensitivity: 'css',
		htmlWhitespaceSensitivity: 'strict',
	});

	expect(output).toMatchSnapshot();
});

test('handles empty files', async () => {
	const input = '\n';

	const output = await format(input, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
	});

	expect(output).toBe('');
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

	const [errorMessageWithSource] = errorWithSource.message.split('\n');
	const [errorMessageWithoutSource] = errorWithoutSource.message.split('\n');

	expect(errorWithSource).toBeInstanceOf(Error);
	expect(errorWithSource.cause).toBeInstanceOf(Error);
	expect(errorMessageWithSource).toMatchInlineSnapshot(
		`"[prettier-plugin-markdown-html] Failed to format HTML fragment in \`foo/bar.md\`:"`
	);

	expect(errorWithoutSource).toBeInstanceOf(Error);
	expect(errorWithoutSource.cause).toBeInstanceOf(Error);
	expect(errorMessageWithoutSource).toMatchInlineSnapshot(
		`"[prettier-plugin-markdown-html] Failed to format HTML fragment:"`
	);
});

test('formats in standalone mode', async () => {
	const output = await standaloneFormat(
		'<div id = "foo" class = "bar">value</div>\n',
		{
			parser: 'markdown',
			plugins: [pluginMarkdownHTML],
		}
	);

	expect(output).toMatchInlineSnapshot(`
		"<div id="foo" class="bar">value</div>
		"
	`);
});
