import type { Plugin } from 'prettier';
import type { PluginOptions } from './index.ts';
import { format } from 'prettier';
import { expect, expectTypeOf, test } from 'vite-plus/test';
import * as pluginMarkdownHTML from './index.ts';

test('exposes correct public API', () => {
	expectTypeOf(pluginMarkdownHTML).toExtend<Plugin>();

	expect(pluginMarkdownHTML).toHaveProperty('parsers');
	expect(pluginMarkdownHTML.parsers).toHaveProperty('markdown');

	expect(pluginMarkdownHTML).toHaveProperty('printers');
	expect(pluginMarkdownHTML.printers).toHaveProperty('mdast');

	expectTypeOf<PluginOptions>().toBeObject();
});

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

test('formats raw HTML in Markdown', async () => {
	const output = await format(TEST_MARKDOWN, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
	});

	expect(output).toMatchSnapshot();
});

test('formats inline HTML in paragraphs', async () => {
	const input = 'Before <span id = "foo" class = "bar">baz</span> After\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		singleAttributePerLine: true,
	};

	const output = await format(input, options);

	expect(output).toBe(`Before <span
  id="foo"
  class="bar">baz</span> After
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

	expect(output).toBe(`> <div
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
`);
	await expect(format(output, options)).resolves.toBe(output);
});

test('keeps inline block HTML stable when wrapping prose', async () => {
	const input =
		'> Before <address id = "foo" class = "bar">baz</address> After\n';
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		printWidth: 10,
		proseWrap: 'always' as const,
	};

	const output = await format(input, options);

	expect(output).toBe(`> Before <address
>   id="foo"
>   class="bar">baz</address>
> After
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

	expect(output).toBe(`## Before <span id="foo" class="bar">baz</span> After

| Before <span id="foo" class="bar">baz</span> After |
| -------------------------------------------------- |
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

test('supports `requirePragma`', async () => {
	const input = `<!-- @format -->

<div id = "foo" class = "bar">baz</div>
`;
	const options = {
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
		requirePragma: true,
	};

	const output = await format(input, options);

	expect(output).toBe(`<!-- @format -->

<div id="foo" class="bar">baz</div>
`);
	await expect(format(output, options)).resolves.toBe(output);
});

test('supports `insertPragma`', async () => {
	const input = '<div id = "foo" class = "bar">baz</div>\n';
	const options = {
		insertPragma: true,
		parser: 'markdown' as const,
		plugins: [pluginMarkdownHTML],
	};

	const output = await format(input, options);

	expect(output).toBe(`<!-- @format -->

<div id="foo" class="bar">baz</div>
`);
	await expect(format(output, options)).resolves.toBe(output);
});

test('respects `htmlWhitespaceSensitivity`', async () => {
	const output = await format(TEST_MARKDOWN, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
		htmlWhitespaceSensitivity: 'strict',
	});

	expect(output).toMatchSnapshot();
});

test('respects `printWidth`', async () => {
	const output = await format(TEST_MARKDOWN, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
		printWidth: Number.POSITIVE_INFINITY,
	});

	expect(output).toMatchSnapshot();
});

test('respects `singleAttributePerLine`', async () => {
	for (const singleAttributePerLine of [true, false]) {
		const output = await format(TEST_MARKDOWN, {
			parser: 'markdown',
			plugins: [pluginMarkdownHTML],
			singleAttributePerLine,
		});

		expect(output).toMatchSnapshot();
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
	const TEST_MARKDOWN = '\n';

	const output = await format(TEST_MARKDOWN, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
	});

	expect(output).toBe('');
});

test('reports formatting errors', async () => {
	const TEST_MARKDOWN = '<div><p></div></p>';

	const output = (await format(TEST_MARKDOWN, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
	}).catch((error: unknown) => error)) as Error;

	expect(output).toBeInstanceOf(Error);
	expect(output.cause).toBeInstanceOf(Error);
	expect(output.message).toContain(
		'[prettier-plugin-markdown-html] Failed to format HTML fragment'
	);
});
