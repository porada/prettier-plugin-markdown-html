import type { Plugin } from 'prettier';
import { format } from 'prettier';
import { expect, expectTypeOf, test } from 'vitest';
import * as pluginMarkdownHTML from './index.ts';

test('exposes correct public API', () => {
	expectTypeOf(pluginMarkdownHTML).toExtend<Plugin>();

	expect(pluginMarkdownHTML).toHaveProperty('parsers');
	expect(pluginMarkdownHTML.parsers).toHaveProperty('markdown');

	expect(pluginMarkdownHTML).toHaveProperty('printers');
	expect(pluginMarkdownHTML.printers).toHaveProperty('mdast');
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

<br />

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

\`\`\`html
<p align="center">

<a href="#">
	<img src="#" alt="" />
</a>

</p>
\`\`\`
`;

test('formats raw HTML in Markdown', async () => {
	const output = await format(TEST_MARKDOWN, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
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

test('handles empty files', async () => {
	const TEST_MARKDOWN = '\n';

	const output = await format(TEST_MARKDOWN, {
		parser: 'markdown',
		plugins: [pluginMarkdownHTML],
	});

	expect(output).toBe('');
});
