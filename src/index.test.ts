import type { Plugin } from 'prettier';
import type { PluginOptions } from './index.ts';
import { format } from 'prettier';
import { expect, expectTypeOf, test } from 'vitest';
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
