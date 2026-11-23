import type { Options, Plugin } from 'prettier';
import { format } from 'prettier';
import { describe, expect, onTestFinished, test, vi } from 'vite-plus/test';
import * as pluginMarkdownHTML from './index.ts';

const MARKDOWN_PARSER_NAMES = ['markdown', 'remark'] as const;

const SPEC_EXAMPLE_OPTIONS = {
	parser: 'markdown',
	plugins: [pluginMarkdownHTML],
	printWidth: 80,
	tabWidth: 4,
} satisfies Options;

const WRAPPING_OPTIONS = {
	...SPEC_EXAMPLE_OPTIONS,
	proseWrap: 'always',
} satisfies Options;

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

describe('Overview', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'formats a project README header with the `%s` parser',
		async (parser) => {
			const input = `<p align="center"><img src="https://prettier.io/icon.png" alt=""></p>
<h1 align="center">Prettier</h1>
<p align="center">Format code in your editor.<br>Check it on the command line.</p>
`;
			const expectedOutput = `<p align="center"><img src="https://prettier.io/icon.png" alt="" /></p>
<h1 align="center">Prettier</h1>
<p align="center">
    Format code in your editor.<br />Check it on the command line.
</p>
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);
});

describe('Formatting Scope', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'formats raw HTML at any nesting depth while leaving code spans literal with the `%s` parser',
		async (parser) => {
			const input = `Press <kbd class='key'>⌘</kbd>+<kbd class='key'>S</kbd> to save the file.

> <p align='center'><b>Tip:</b> enable format on save in your editor.</p>

Write \`<kbd class='key'>\` to style a key.
`;
			const expectedOutput = `Press <kbd class="key">⌘</kbd>+<kbd class="key">S</kbd> to save the file.

> <p align="center"><b>Tip:</b> enable format on save in your editor.</p>

Write \`<kbd class='key'>\` to style a key.
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);

	test('formats inline and block HTML while leaving code spans literal', async () => {
		const input = `foo <span   title = "bar">**baz**</span>

> <div   class = "qux">
> <p>quux</p>
> </div>

\`<span title = "corge">grault</span>\`
`;
		const expectedOutput = `foo <span title="bar">**baz**</span>

> <div class="qux">
>     <p>quux</p>
> </div>

\`<span title = "corge">grault</span>\`
`;

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('leaves HTML that the reference renderer reads in math to Prettier', async () => {
		const input = '$$\n<b   >foo</b>\n$$\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(
			await format(input, { ...SPEC_EXAMPLE_OPTIONS, plugins: [] })
		);
	});

	test('leaves HTML that the reference renderer reads in frontmatter to Prettier', async () => {
		const input = '---\ntitle: <b   >foo</b>\n---\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(
			await format(input, { ...SPEC_EXAMPLE_OPTIONS, plugins: [] })
		);
	});

	test('formats raw HTML in a document whose frontmatter Prettier changes', async () => {
		const input = "---\ntitle: 'foo'\n---\n\n<div   >bar</div>\n";
		const expectedOutput = '---\ntitle: "foo"\n---\n\n<div>bar</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps raw HTML in image text with nested brackets', async () => {
		const input = '![[foo] <b   >bar</b>](baz.png)\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('formats raw HTML between single dollar signs as inline HTML', async () => {
		const input = 'foo $<b   >bar</b>$ baz\n';
		const expectedOutput = 'foo $<b>bar</b>$ baz\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('leaves HTML that the reference renderer reads in Liquid tags to Prettier', async () => {
		const input = '{% <b   >foo</b> %}\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(
			await format(input, { ...SPEC_EXAMPLE_OPTIONS, plugins: [] })
		);
	});

	test('leaves HTML that the reference renderer reads in wiki links to Prettier', async () => {
		const input = '[[<b   >foo</b>]]\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(
			await format(input, { ...SPEC_EXAMPLE_OPTIONS, plugins: [] })
		);
	});

	test('keeps indented markup after apparent footnote definitions as literal code', async () => {
		const input = `[^foo]: bar

    <div title = "baz">qux</div>
`;
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('leaves raw HTML in footnote definitions to Prettier', async () => {
		const input = '<div></div>\n\n[^foo]: bar <b   >baz</b>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(
			await format(input, { ...SPEC_EXAMPLE_OPTIONS, plugins: [] })
		);
	});

	test('pads table columns to the width of formatted HTML', async () => {
		const input = '| foo | <b   >bar</b> |\n| --- | --- |\n';
		const expectedOutput = '| foo | <b>bar</b> |\n| --- | ---------- |\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('leaves fenced markup as Prettier prints it when Prettier rewrites the fence', async () => {
		const input = '~~~foo `bar`\n<div   >baz</div>\n~~~\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		// A second pass formats the markup that plain Prettier’s fence exposes
		expect(output).toBe(expectedOutput);
	});

	test('keeps ignored HTML in footnote definitions unchanged', async () => {
		const input =
			'[^1]: foo\n\n    <!-- prettier-ignore -->\n    <pre>\n      bar\n    </pre>\n\nbaz[^1]\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});
});

describe('Document Regions', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'formats each region around an unclosed placeholder independently with the `%s` parser',
		async (parser) => {
			const input = `<details><summary>Install Prettier</summary>

In <project-directory>, type \`npm install --save-dev --save-exact prettier\` and press <KBD>Enter</KBD>.

<div><a href='https://prettier.io/docs/install'>Installation guide</a></div>

</details>

Try the options in the <A href='https://prettier.io/playground'>playground</A>.
`;
			const expectedOutput = `<details>
    <summary>Install Prettier</summary>

In <project-directory>, type \`npm install --save-dev --save-exact prettier\` and press <KBD>Enter</KBD>.

<div><a href="https://prettier.io/docs/install">Installation guide</a></div>

</details>

Try the options in the <a href="https://prettier.io/playground">playground</a>.
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);

	test('keeps Markdown between HTML blocks inside their shared element', async () => {
		const input = `<details>
<summary>foo</summary>

**bar**

</details>
`;
		const expectedOutput = `<details>
    <summary>foo</summary>

**bar**

</details>
`;

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('accepts raw elements that enclose a Markdown container completely', async () => {
		const input = '<div   >\n\n> foo\n\n</div>\n';
		const expectedOutput = '<div>\n\n> foo\n\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects overlapping pairs across four HTML blocks as one region', async () => {
		const input =
			'<div   >\n\n<span   >\n\n</div>\n\n</span   >\n\nfoo <kbd   >bar</kbd>\n';
		const expectedOutput =
			'<div   >\n\n<span   >\n\n</div>\n\n</span   >\n\nfoo <kbd>bar</kbd>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});
});

describe('Block HTML', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'moves an indented HTML block to the content edge with the `%s` parser',
		async (parser) => {
			const input = `## Try the playground

  <p align="center">
  <a href="https://prettier.io/playground">Open the Prettier playground</a>
  </p>

Paste a snippet to compare the source with the formatted code.
`;
			const expectedOutput = `## Try the playground

<p align="center">
    <a href="https://prettier.io/playground">Open the Prettier playground</a>
</p>

Paste a snippet to compare the source with the formatted code.
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);

	test('measures bullet list markers as Prettier prints them', async () => {
		const input =
			'- <div id="foo" data-bar="baz" data-qux="quux" data-corge="grault">garply</div>\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('measures ordered list markers as Prettier prints them', async () => {
		const input =
			'1. foo\n1. bar\n1. baz\n1. qux\n1. quux\n1. corge\n1. grault\n1. garply\n1. waldo\n1. <div   id="foo" data-bar="baz" data-qux="quux" data-corge="grault">garply</div>\n';
		const expectedOutput =
			'1. foo\n1. bar\n1. baz\n1. qux\n1. quux\n1. corge\n1. grault\n1. garply\n1. waldo\n1. <div id="foo" data-bar="baz" data-qux="quux" data-corge="grault">garply</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('measures nested containers in list items as Prettier prints them', async () => {
		const input =
			'- foo\n  - <div   title="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">bar</div>\n';
		const expectedOutput =
			'- foo\n    - <div title="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">\n          bar\n      </div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('measures list numbers up to the largest that Prettier prints', async () => {
		const input = '999999999. foo\n999999999. <div   >bar</div>\n';
		const expectedOutput = '999999999. foo\n999999999. <div>bar</div>\n';

		const output = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			printWidth: 25,
		});

		expect(output).toBe(expectedOutput);
		await expect(
			format(output, { ...SPEC_EXAMPLE_OPTIONS, printWidth: 25 })
		).resolves.toBe(output);
	});

	test('formats HTML blocks at the document root as Prettier formats HTML', async () => {
		const input =
			'<div   id = "foo" class="bar baz"><p>qux <b>quux</b>   corge</p><ul><li>grault<li>garply</ul></div>\n';
		const expectedOutput = await format(input, {
			parser: 'html',
			printWidth: 80,
			tabWidth: 4,
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test.each([
		{
			context: 'after a paragraph line',
			input: "Start with the defaults and adjust them for your project.\n<div><a href='https://prettier.io/docs/options'>Formatting options</a></div>\n",
			output: 'Start with the defaults and adjust them for your project.\n<div><a href="https://prettier.io/docs/options">Formatting options</a></div>\n',
		},
		{
			context: 'beside the text of a tight list item',
			input: "1. Choose the options your project needs\n   <div><a href='https://prettier.io/docs/options'>Formatting options</a></div>\n2. Save them in `.prettierrc`\n",
			output: '1. Choose the options your project needs\n   <div><a href="https://prettier.io/docs/options">Formatting options</a></div>\n2. Save them in `.prettierrc`\n',
		},
		{
			context: 'in a loose list',
			input: "- <div   class='note'>Install Prettier</div>\n\n- Add a configuration file\n- Format on save\n",
			output: '- <div class="note">Install Prettier</div>\n\n- Add a configuration file\n- Format on save\n',
		},
		{
			context: 'before a thematic break in a list item',
			input: "- Read the <a   href='https://prettier.io/docs/options'>options</a>\n  ***\n\n- Save them\n",
			output: '- Read the <a href="https://prettier.io/docs/options">options</a>\n\n    ***\n\n- Save them\n',
		},
	])(
		'keeps the blank lines that plain Prettier prints around HTML $context',
		async ({ input, output: expectedOutput }) => {
			const output = await format(input, SPEC_EXAMPLE_OPTIONS);

			expect(output).toBe(expectedOutput);
			await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
				output
			);
		}
	);

	test.each([
		{
			context: 'beside a nested list whose marker Prettier pads',
			input: '- - Read the guide\n\n  <div   class="note">Docs</div>\n',
			position: '3:3',
		},
		{
			context: 'beside a nested ordered list whose marker Prettier pads',
			input: '* 1. Install the extension\n\n  <div   class="note">Docs</div>\n',
			position: '3:3',
		},
		{
			context:
				'after a paragraph beside a nested list whose marker Prettier pads',
			input: '- - Read the guide\n\n  More text\n\n  <div   class="note">Docs</div>\n',
			position: '5:3',
		},
	])(
		'rejects an HTML block that Prettier would print outside its list item $context',
		async ({ input, position }) => {
			// Plain Prettier can move the block on a second pass
			await expect(
				formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual({
				notices: [
					[
						`[prettier-plugin-markdown-html] Skipped HTML formatting (${position}). Prettier’s Markdown layout would change how this HTML block is nested in lists or block quotes.`,
					],
				],
				output: await format(input, {
					...SPEC_EXAMPLE_OPTIONS,
					plugins: [],
				}),
			});
		}
	);
});

describe('Fragment Indentation', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'indents tags by their raw HTML nesting across Markdown with the `%s` parser',
		async (parser) => {
			const input = `<table>
<tr>
<td>

**Before**: \`const ready=true\`

</td>
<td>

**After**: \`const ready = true;\`

</td>
</tr>
</table>
`;
			const expectedOutput = `<table>
    <tr>
        <td>

**Before**: \`const ready=true\`

</td>
        <td>

**After**: \`const ready = true;\`

</td>
    </tr>
</table>
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);

	test('keeps whitespace-only lines in preformatted content', async () => {
		const input = '<pre>   \n\tfoo   \n  bar</pre>\n';
		const expectedOutput = '<pre>\n   \n\tfoo   \n  bar</pre>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('indents later lines for raw ancestors outside their container', async () => {
		const input = `<div>

> <p>
> foo
> </p>
> <p>bar</p>

- <p>baz</p>
  <p>qux</p>

</div>
`;
		const expectedOutput = `<div>

> <p>foo</p>
>     <p>bar</p>

- <p>baz</p>
      <p>qux</p>

</div>
`;

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test.each([
		{
			context: 'after a tab-indented continuation line',
			input: '- Read the guide\n\t<details><summary>More</summary></details>\n',
			output: '- Read the guide\n  <details><summary>More</summary></details>\n',
		},
		{
			context: 'after a tab-indented line following a blank line',
			input: '- Read the guide\n\n\t<div   class="note">Docs</div>\n',
			output: '- Read the guide\n\n  <div class="note">Docs</div>\n',
		},
		{
			context: 'indented past the checkbox of a task item',
			input: '- [x] Install\n    <details><summary>More</summary></details>\n',
			output: '- [x] Install\n  <details><summary>More</summary></details>\n',
		},
		{
			context: 'after a block quote',
			input: '- > Install\n\t<ul   class="steps"></ul>\n',
			output: '- > Install\n  <ul class="steps"></ul>\n',
		},
		{
			context: 'in an ordered list item',
			input: '1. Install the extension.\n\n\t<div   class="note">Docs</div>\n',
			output: '1. Install the extension.\n\n   <div class="note">Docs</div>\n',
		},
	])(
		'starts an HTML block that follows the first child of a list item at the item’s content edge $context',
		async ({ input, output: expectedOutput }) => {
			const output = await format(input, SPEC_EXAMPLE_OPTIONS);

			expect(output).toBe(expectedOutput);
			await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
				output
			);
		}
	);
});

describe('Block Boundaries', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'keeps the complete opening tag on the first line of an HTML block with the `%s` parser',
		async (parser) => {
			const input = `<a href="https://opencollective.com/prettier" title="Support Prettier on Open Collective">
  <img src="https://prettier.io/icon.png" width="48" alt="Sponsor Prettier">
</a>
`;
			const expectedOutput = `<a href="https://opencollective.com/prettier" title="Support Prettier on Open Collective">
    <img src="https://prettier.io/icon.png" width="48" alt="Sponsor Prettier" />
</a>
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);

	test('rejects layouts that would expose HTML block content as Markdown', async () => {
		const input = '<script>\n\nfoo\n\n</script><b>bar</b>\n\nbaz\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('keeps tags that the parsers read differently on one line', async () => {
		const input =
			'<hgroup   class="foo-bar-baz-qux-quux" id="corge-grault-garply-waldo" title="fred">\n<h1>plugh</h1>\n</hgroup>\n';
		const expectedOutput =
			'<hgroup class="foo-bar-baz-qux-quux" id="corge-grault-garply-waldo" title="fred">\n    <h1>plugh</h1>\n</hgroup>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects layouts that would turn a block into a raw text block', async () => {
		const input = '<pre/>\n\nfoo\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test.each(
		MARKDOWN_PARSER_NAMES.flatMap((parser) =>
			[
				{
					input: '<!-- Badges --> <div align="center"><img src="badge.svg"></div>\nThe project formats Markdown.\n',
					output: '<!-- Badges -->\n<div align="center"><img src="badge.svg" /></div>\n\nThe project formats Markdown.\n',
				},
				{
					input: '<pre>npm install prettier</pre> <p   align="center">Ready</p>\n## Usage\n',
					output: '<pre>npm install prettier</pre>\n<p align="center">Ready</p>\n\n## Usage\n',
				},
				{
					input: '- Install Prettier.\n\n  <!-- note --><div   class="tip">Ready</div>\n  Run the formatter.\n\n- Format the project.\n',
					output: '- Install Prettier.\n\n  <!-- note -->\n  <div class="tip">Ready</div>\n\n    Run the formatter.\n\n- Format the project.\n',
				},
			].map((row) => ({ ...row, parser }))
		)
	)(
		'formats an HTML block that Prettier separates from the Markdown after it with the `$parser` parser in $input',
		async ({ input, output: expectedOutput, parser }) => {
			const options = { ...SPEC_EXAMPLE_OPTIONS, parser };

			await expect(
				formatWithNotices(input, options)
			).resolves.toStrictEqual({ notices: [], output: expectedOutput });
			await expect(format(expectedOutput, options)).resolves.toBe(
				expectedOutput
			);
		}
	);

	test('rejects an HTML block that would remain open before Markdown that Prettier prints on the next line', async () => {
		const input =
			'<!-- Badges --> <div align="center"><img src="badge.svg"></div>\n{% include footer.html %}\n';

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1). Formatting would make the next line of Markdown part of this HTML block. Add a blank line after the block.',
				],
			],
			output: await format(input, {
				...SPEC_EXAMPLE_OPTIONS,
				plugins: [],
			}),
		});
	});

	test.each([
		{
			input: '- Install the extension.\n\n  <!-- logo --> <div align="center"><img src="logo.svg"></div>\n  - Press <kbd>Enter</kbd> to run it.\n',
			notices: [
				'(3:3). Formatting would make the next line of Markdown part of this HTML block. Add a blank line after the block.',
			],
		},
		{
			input: '- Install the extension.\n\n  <!-- logo --> <div align="center"><img src="logo.svg"></div>\n  - Copyright <year> <holder>\n',
			notices: [
				'(3:3). Formatting would make the next line of Markdown part of this HTML block. Add a blank line after the block.',
				'(4:15). Close `<year>` with `</year>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
			],
		},
	])(
		'rejects an HTML block that would take in a nested list item with inline HTML in $input',
		async ({ input, notices }) => {
			const expectedOutput = await format(input, {
				...SPEC_EXAMPLE_OPTIONS,
				plugins: [],
			});

			await expect(
				formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual({
				notices: notices.map((notice) => [
					`[prettier-plugin-markdown-html] Skipped HTML formatting ${notice}`,
				]),
				output: expectedOutput,
			});
			await expect(
				format(expectedOutput, SPEC_EXAMPLE_OPTIONS)
			).resolves.toBe(expectedOutput);
		}
	);

	test('rejects HTML that GitHub Flavored Markdown reads as paragraph text', async () => {
		const input = '<search>Find the docs</search>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const result = await formatWithNotices(input, SPEC_EXAMPLE_OPTIONS);

		expect(result).toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1). GitHub Flavored Markdown reads this HTML as paragraph text. To start a block, put the first tag on its own line, separated from any preceding paragraph by a blank line.',
				],
			],
			output: expectedOutput,
		});
		await expect(format(result.output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			result.output
		);
	});

	test('rejects a one-line HTML block led by a comment when formatting would break it across lines', async () => {
		const input =
			'<!-- sponsors --><a href="https://github.com/maartene"><img src="https://github.com/maartene.png" width="60px" alt="Maarten" /></a><!-- sponsors -->\n';

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1). After formatting, GitHub Flavored Markdown would no longer recognize this as an HTML block, and some of its content would be interpreted as Markdown.',
				],
			],
			output: await format(input, {
				...SPEC_EXAMPLE_OPTIONS,
				plugins: [],
			}),
		});
	});
});

describe('Inline HTML', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'keeps an inline tag with the text on either side with the `%s` parser',
		async (parser) => {
			const input = `See <a href="https://prettier.io/docs/cli" target="_blank" rel="noreferrer">the CLI reference</a> for details.
`;
			const expectedOutput = `See <a href="https://prettier.io/docs/cli" target="_blank" rel="noreferrer"
    >the CLI reference</a> for details.
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);

	test('keeps closing tags on one line when wrapping would start a block quote', async () => {
		const input =
			'foo<span title="bar" data-description="baz" data-label="qux" data-value="quux">corge</span> grault\n';
		const expectedOutput = `foo<span title="bar" data-description="baz" data-label="qux" data-value="quux"
    >corge</span> grault
`;

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lays out inline tags from the content edge of their containers', async () => {
		const input =
			'> - foo\n>\n>   bar<span   title="baz" data-description="qux" data-label="quux" data-value="corge">grault</span>\n';
		const expectedOutput = `> - foo
>
>     bar<span
>         title="baz"
>         data-description="qux"
>         data-label="quux"
>         data-value="corge"
>         >grault</span>
`;

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lays out inline tags after task list checkboxes', async () => {
		const input =
			'- [ ] foo<span   title="bar" data-description="baz" data-label="qux" data-value="qu">corge</span>\n';
		const expectedOutput = `- [ ] foo<span
          title="bar"
          data-description="baz"
          data-label="qux"
          data-value="qu"
          >corge</span>
`;

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('measures wide characters before inline tags by their display width', async () => {
		const input =
			'日本語日本語日本語 <span   title="foo" data-description="bar" data-label="baz" data-qux="quux">corge</span> grault\n';
		const expectedOutput = `日本語日本語日本語 <span
    title="foo"
    data-description="bar"
    data-label="baz"
    data-qux="quux"
    >corge</span> grault
`;

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lays out inline tags with attached text that resembles a tag', async () => {
		const input =
			'foo<span   title="bar"   class="baz"><quuxcorgegrault</span>\n';
		const expectedOutput =
			'foo<span title="bar" class="baz"\n    ><quuxcorgegrault</span>\n';

		const output = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			printWidth: 40,
		});

		expect(output).toBe(expectedOutput);
		await expect(
			format(output, { ...SPEC_EXAMPLE_OPTIONS, printWidth: 40 })
		).resolves.toBe(output);
	});

	test('keeps brackets after multi-line attribute values in their paragraph', async () => {
		const input = 'foo <span   title="bar\n    baz">qux</span>\n';
		const expectedOutput =
			'foo <span\n    title="bar\n    baz"\n    >qux</span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('counts indentation after task list checkboxes from the list item’s content', async () => {
		const options = { ...SPEC_EXAMPLE_OPTIONS, tabWidth: 2 };
		const input =
			'- [ ] foo<span   title="bar" data-description="baz" data-label="qux" data-v="q">corge</span> grault\n';
		const expectedOutput =
			'- [ ] foo<span title="bar" data-description="baz" data-label="qux" data-v="q"\n        >corge</span> grault\n';

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('lays out leading tags with a break opportunity after them', async () => {
		const input =
			'<span   title="foo" data-description="bar baz qux quux corge" data-label="grault"> **garply** waldo</span>\n';
		const expectedOutput =
			'<span title="foo" data-description="bar baz qux quux corge" data-label="grault"> **garply** waldo</span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('formats tags after task list checkboxes like tags after text', async () => {
		const input = '- [ ] <br   >\n';
		const expectedOutput = '- [ ] <br />\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lays out inline tags in task items whose text starts like a list item', async () => {
		const input =
			'- [ ] 1. foo\n      bar <span   title="baz" data-label="aaaaaaaaaaaaaaaaaaaaaaaaaaaa">qux</span>\n';
		const expectedOutput =
			'- [ ] 1. foo\n      bar <span title="baz" data-label="aaaaaaaaaaaaaaaaaaaaaaaaaaaa">qux</span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lays out inline tags in task items whose text starts with emphasis', async () => {
		const input =
			'- [ ] **foo** bar <span   title="ttttttttttttttttttttttttttttttttttttt">baz</span>\n';
		const expectedOutput =
			'- [ ] **foo** bar <span title="ttttttttttttttttttttttttttttttttttttt">baz</span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lays out inline tags in task items whose text starts on the next line', async () => {
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			printWidth: 42,
			proseWrap: 'never',
		} as const;
		const input = '- [ ] \n  **foo** <span   title="bar">baz</span>\n';
		const expectedOutput = '- [ ] **foo** <span title="bar">baz</span>\n';

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('lays out inline tags in task items with spaces after their checkboxes', async () => {
		const input =
			'- [ ]  ## foo bar <span   title="tttttttttttttttttttttttttttttttttttttt">baz</span>\n';
		const expectedOutput =
			'- [ ] ## foo bar <span title="tttttttttttttttttttttttttttttttttttttt">baz</span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('wraps inline tags in task items whose text starts like a heading', async () => {
		const input =
			'- [ ] ## foo <span   title="bar" data-description="baz qux quux corge grault garply waldo fred" data-label="plugh">xyzzy</span> thud\n';
		const expectedOutput =
			'- [ ] ## foo <span\n          title="bar"\n          data-description="baz qux quux corge grault garply waldo fred"\n          data-label="plugh"\n          >xyzzy</span> thud\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lays out inline tags in paragraphs that continue lazily with equals signs', async () => {
		const input =
			'> foo <span   title="bar" data-description="baz" data-label="qux" data-value="quux" id="corge">grault</span> garply\n===\n';
		const expectedOutput =
			'> foo <span\n>     title="bar"\n>     data-description="baz"\n>     data-label="qux"\n>     data-value="quux"\n>     id="corge"\n>     >grault</span> garply\n> \\===\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lays out inline tags with attached private use characters', async () => {
		const options = { ...SPEC_EXAMPLE_OPTIONS, printWidth: 40 };
		const input =
			'foo<span   title="bar" class="baz">\uE000quxquuxcorge</span>\n';
		const expectedOutput =
			'foo<span title="bar" class="baz"\n    >\uE000quxquuxcorge</span>\n';

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('measures tabs before inline tags as indentation levels', async () => {
		const options = { ...SPEC_EXAMPLE_OPTIONS, useTabs: true };
		const input =
			'foo<span   title="bar" data-description="baz" data-label="qux" data-value="vvvvvv">quux</span> <b   title="corge" data-label="xxxxxxxxxxxxxxxxxxxxxxx">grault</b>\n';
		const expectedOutput =
			'foo<span title="bar" data-description="baz" data-label="qux" data-value="vvvvvv"\n\t>quux</span> <b title="corge" data-label="xxxxxxxxxxxxxxxxxxxxxxx"\n\t>grault</b>\n';

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('lays out inline tags with attached elements', async () => {
		const input =
			'foo<span   title="bar" data-description="baz" data-label="qux" data-value="quux"><b>corge</b></span> grault\n';
		const expectedOutput =
			'foo<span title="bar" data-description="baz" data-label="qux" data-value="quux"\n    ><b>corge</b></span> grault\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lays out inline tags with attached tags that formatting changes', async () => {
		const input =
			'foo<span   title="bar" data-description="baz" data-value="vvvv">qux<br>quux</span> corge\n';
		const expectedOutput =
			'foo<span title="bar" data-description="baz" data-value="vvvv"\n    >qux<br />quux</span> corge\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lays out inline tags before later tags the same way on every pass', async () => {
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			proseWrap: 'always',
		} as const;
		const input =
			'foo <i   title="vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv">bar<img   src="baz.png" alt=""></i> qux quux\n';
		const expectedOutput =
			'foo <i title="vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv"\n    >bar<img src="baz.png" alt="" /></i> qux quux\n';

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('lays out inline tags with attached comments', async () => {
		const input =
			'foo<span   title="bar" data-description="baz" data-value="v">qux<!--quux corge-->grault</span> garply\n';
		const expectedOutput =
			'foo<span title="bar" data-description="baz" data-value="v"\n    >qux<!--quux corge-->grault</span> garply\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lays out leading tags with backslash hard breaks attached', async () => {
		const input =
			'<span   title="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb">\\\nfoo</span>\n';
		const expectedOutput =
			'<span title="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"\n    >\\\nfoo</span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lays out chains of inline tags that move one another', async () => {
		const input =
			'<a href="https://example.com/p0"><img   src="https://img.shields.io/b/0.svg" alt="0"></a> <a href="https://example.com/p1"><img   src="https://img.shields.io/b/1.svg" alt="1"></a> <a href="https://example.com/p2"><img   src="https://img.shields.io/b/2.svg" alt="2"></a> <a href="https://example.com/p3"><img   src="https://img.shields.io/b/3.svg" alt="3"></a> <a href="https://example.com/p4"><img   src="https://img.shields.io/b/4.svg" alt="4"></a>\n';
		const expectedOutput =
			'<a href="https://example.com/p0"><img\n    src="https://img.shields.io/b/0.svg"\n    alt="0"\n/></a> <a href="https://example.com/p1"><img\n    src="https://img.shields.io/b/1.svg"\n    alt="1"\n/></a> <a href="https://example.com/p2"><img\n    src="https://img.shields.io/b/2.svg"\n    alt="2"\n/></a> <a href="https://example.com/p3"><img\n    src="https://img.shields.io/b/3.svg"\n    alt="3"\n/></a> <a href="https://example.com/p4"><img\n    src="https://img.shields.io/b/4.svg"\n    alt="4"\n/></a>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps inline tags with whitespace before their closing tags on one line', async () => {
		const input =
			'foo<span   title="ttttttttttttttttttttttttttttttttttttttttttttttttttt">bar </span> baz\n';
		const expectedOutput =
			'foo<span title="ttttttttttttttttttttttttttttttttttttttttttttttttttt">bar </span> baz\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('wraps brackets of inline tags with whitespace before their closing tags', async () => {
		const input =
			'foo<span   title="tttttttttttttttttttttttttttttttttttttttttttttttttttt">bar </span> baz\n';
		const expectedOutput =
			'foo<span title="tttttttttttttttttttttttttttttttttttttttttttttttttttt"\n    >bar </span> baz\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps inline selects on one line when they fit', async () => {
		const input =
			'foo <select   name="bar"><option>baz</option></select> qux\n';
		const expectedOutput =
			'foo <select name="bar"><option>baz</option></select> qux\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps inline lists on one line when they fit', async () => {
		const input = '- foo <ul   class="bar"><li>baz</li></ul> qux\n';
		const expectedOutput = '- foo <ul class="bar"><li>baz</li></ul> qux\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps inline selects before whitespace on one line when their tags fit', async () => {
		const input =
			'foo <select   class="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"> <option>bar</option></select>\n';
		const expectedOutput =
			'foo <select class="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"> <option\n    >bar</option></select>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('wraps brackets of inline selects whose attributes break', async () => {
		const input =
			'foo <select   name="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"><option>bar</option></select> baz\n';
		const expectedOutput =
			'foo <select\n    name="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"\n    id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"\n    ><option>bar</option></select> baz\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('wraps brackets of inline lists whose attributes break', async () => {
		const input =
			'- foo <ol   start="3" class="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"><li>bar</li></ol>\n';
		const expectedOutput =
			'- foo <ol\n      start="3"\n      class="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"\n      ><li>bar</li></ol>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('normalizes attributes of inline selects', async () => {
		const input =
			'foo <select   NAME="bar" DISABLED><option>baz</option></select> qux\n';
		const expectedOutput =
			'foo <select name="bar" disabled><option>baz</option></select> qux\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lays out `srcset` values of inline images with multi-line attribute values', async () => {
		const input =
			'foo <img   srcset="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png 1x, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png 2x" title="bar\nbaz"> qux\n';
		const expectedOutput =
			'foo <img\n    srcset="\n        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png 1x,\n        bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png 2x\n    "\n    title="bar\nbaz"\n/> qux\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lays out `srcset` values of inline images with an attribute per line', async () => {
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			singleAttributePerLine: true,
		} satisfies Options;
		const input =
			'foo <img   srcset="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png 1x, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png 2x" alt="bar"> baz\n';
		const expectedOutput =
			'foo <img\n    srcset="\n        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png 1x,\n        bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png 2x\n    "\n    alt="bar"\n/> baz\n';

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});
});

describe('Line Breaks', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'keeps a link on the line of a leading inline image with the `%s` parser',
		async (parser) => {
			const input = `<img src="https://prettier.io/icon.png" width="16" alt=""> [Read about formatting options](https://prettier.io/docs/options)
`;
			const expectedOutput = `<img src="https://prettier.io/icon.png" width="16" alt="" /> [Read about formatting options](https://prettier.io/docs/options)
`;
			const options = {
				...WRAPPING_OPTIONS,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);

	test('formats raw HTML with `proseWrap` set to `always` before a word that could start a delimiter row', async () => {
		const input = 'foo <b   >bar</b> :---\n';
		const expectedOutput = 'foo <b>bar</b> :---\n';

		const output = await format(input, WRAPPING_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, WRAPPING_OPTIONS)).resolves.toBe(output);
	});

	test('joins line breaks after leading tags that fit on one line', async () => {
		const input = '<span\n    title="foo">\nbar</span>\n';
		const expectedOutput = '<span title="foo"> bar</span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps line breaks after leading tags that stay split', async () => {
		const input = '<span\n    title="foo"   class="bar">\nbaz</span>\n';
		const expectedOutput =
			'<span\n    title="foo"\n    class="bar">\nbaz</span>\n';

		const output = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			printWidth: 20,
		});

		expect(output).toBe(expectedOutput);
		await expect(
			format(output, { ...SPEC_EXAMPLE_OPTIONS, printWidth: 20 })
		).resolves.toBe(output);
	});

	test('rejects layouts that leave leading tags alone before hard line breaks', async () => {
		const input = '<span\n    title="foo">  \nbar</span>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('keeps backslash hard breaks after leading tags', async () => {
		const input = '<span\n    title="foo">\\\nbar</span>\n';
		const expectedOutput = '<span title="foo">\\\nbar</span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('joins soft breaks after leading tags without changing their layout', async () => {
		const options = { ...SPEC_EXAMPLE_OPTIONS, printWidth: 40 };
		const input =
			'<span\n    title="foo" class="bar">\n**baz** qux quux</span>\n';
		const expectedOutput =
			'<span title="foo" class="bar"> **baz** qux quux</span>\n';

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('lays out inline tags in task items whose text starts like a heading', async () => {
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			proseWrap: 'always',
		} as const;
		const input =
			'- [ ] ## Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor <span   title="foo" data-description="bar" data-label="baz">qux</span> quux\n';
		const expectedOutput =
			'- [ ] ## Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod\n      tempor\n      <span title="foo" data-description="bar" data-label="baz">qux</span> quux\n';

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('keeps line breaks inside links after leading tags', async () => {
		const input = '<span   >[  \nfoo](bar)</span>\n';
		const expectedOutput = '<span>[  \nfoo](bar)</span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lays out inline tags before HTML kept off line starts', async () => {
		const input =
			'foo<span   title="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">bar\n    <!-- c --> baz</span>\n';
		const expectedOutput =
			'foo<span title="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">bar <!-- c --> baz</span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lays out inline tags regardless of their line breaks in the source', async () => {
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			printWidth: 70,
			proseWrap: 'always',
		} as const;
		const expectedOutput =
			'foo bar baz qux quux corge grault garply waldo fred plugh xyzzy\n<span title="thud">foo</span>\n';

		const output = await format(
			'foo bar baz qux quux corge grault garply waldo fred plugh xyzzy <span title="thud">foo</span>\n',
			options
		);
		const splitOutput = await format(
			'foo bar baz qux quux corge grault garply waldo fred plugh xyzzy <span\n    title="thud">foo</span>\n',
			options
		);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
		expect(splitOutput).toBe(expectedOutput);
	});

	test('keeps inline comments off line starts when wrapping prose', async () => {
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			proseWrap: 'always',
		} as const;
		const input =
			'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor <!-- foo --> incididunt\n';
		const expectedOutput =
			'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod\ntempor <!-- foo --> incididunt\n';

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual({ notices: [], output: expectedOutput });
		await expect(format(expectedOutput, options)).resolves.toBe(
			expectedOutput
		);
	});

	test('keeps inline comments off line starts when wrapping prose around corrected tags', async () => {
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			proseWrap: 'always',
		} as const;
		const input =
			'Lorem ipsum dolor sit amet, consectetur <img src="a.png"></img> elit, sed do tempor <!-- foo --> incididunt\n';
		const expectedOutput =
			'Lorem ipsum dolor sit amet, consectetur <img src="a.png" /> elit, sed do\ntempor <!-- foo --> incididunt\n';

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual({ notices: [], output: expectedOutput });
		await expect(format(expectedOutput, options)).resolves.toBe(
			expectedOutput
		);
	});

	test('keeps content after leading tags when wrapping prose', async () => {
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			proseWrap: 'always',
		} as const;
		const input =
			'<span   title="foo bar baz qux quux corge grault garply waldo fred plugh"> **xyzzy** thud</span>\n';
		const expectedOutput =
			'<span title="foo bar baz qux quux corge grault garply waldo fred plugh"> **xyzzy**\nthud</span>\n';

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('keeps content after leading tags when wrapping prose around corrected tags', async () => {
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			proseWrap: 'always',
		} as const;
		const input =
			'<img src="a.png"></img> <span   title="foo bar baz qux quux corge grault garply waldo fred plugh"> **xyzzy** thud</span>\n';
		const expectedOutput =
			'<img src="a.png" /> <span\n    title="foo bar baz qux quux corge grault garply waldo fred plugh"> **xyzzy**\nthud</span>\n';

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('keeps content after leading tags and inline comments off line starts when wrapping prose', async () => {
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			proseWrap: 'always',
		} as const;
		const input =
			'<span   title="foo bar baz qux quux corge grault garply waldo fred plugh"> **xyzzy** lorem ipsum dolor sit amet, consectetur adipiscing elit, sed tempor <!-- foo --> incididunt</span>\n';
		const expectedOutput =
			'<span title="foo bar baz qux quux corge grault garply waldo fred plugh"> **xyzzy**\nlorem ipsum dolor sit amet, consectetur adipiscing elit, sed tempor <!-- foo -->\nincididunt</span>\n';

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('wraps prose around formatted tags as usual when inline HTML stays off line starts', async () => {
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			printWidth: 40,
			proseWrap: 'always',
		} as const;
		const input =
			'foo <!-- c --> bar <span class="aaaa bbbb cccc dddd eeee ffff" id="gggg">x</span> baz qux quux corge grault garply waldo\n';
		const expectedOutput =
			'foo <!-- c --> bar <span\n    class="aaaa bbbb cccc dddd eeee ffff"\n    id="gggg"\n    >x</span> baz qux quux corge grault\ngarply waldo\n';

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('keeps inline comments off line starts after CJK characters when wrapping prose', async () => {
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			printWidth: 40,
			proseWrap: 'always',
		} as const;
		const input =
			'日本語のテキストです日本語のテキストです日本語のテキスト <!-- c --> 続き\n';
		const expectedOutput =
			'日本語のテキストです日本語のテキストです日本語のテキスト <!-- c -->\n続き\n';

		const result = await formatWithNotices(input, options);

		expect(result).toStrictEqual({ notices: [], output: expectedOutput });
		await expect(format(expectedOutput, options)).resolves.toBe(
			expectedOutput
		);
	});

	test.each([
		{
			context: 'after a tag whose layout moves later lines',
			input: 'Read the <a href="https://prettier.io/docs/options" title="Formatting options">options guide</a> and <kbd   title="key">Enter</kbd> before you change <!-- note --> the configuration of your project, then run the formatter on every file.\n',
			output: 'Read the <a href="https://prettier.io/docs/options" title="Formatting options"\n    >options guide</a> and <kbd title="key">Enter</kbd> before you\nchange <!-- note --> the configuration of your project, then run the formatter\non every file.\n',
			printWidth: 80,
		},
		{
			context: 'after a tag that wraps at a narrow width',
			input: 'A few words before <span   title="something long here" id="intro">here</span> and a couple more words before the <!-- comment --> and a few more words after it.\n',
			output: 'A few words before <span\n    title="something long here"\n    id="intro"\n    >here</span> and a couple\nmore words before\nthe <!-- comment --> and a few\nmore words after it.\n',
			printWidth: 32,
		},
		{
			context: 'after a tag that wraps at a narrower width',
			input: 'A few words before <span   title="something long here" id="intro">here</span> and a couple more words before the <!-- comment --> and a few more words after it.\n',
			output: 'A few words before <span\n    title="something long here"\n    id="intro"\n    >here</span> and a\ncouple more words before\nthe <!-- comment --> and\na few more words after\nit.\n',
			printWidth: 25,
		},
		{
			context: 'before a tag that wraps to the next line',
			input: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor <!-- foo --> incididunt <a   href="https://example.com/a/b/c" title="Example">ut labore</a> et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation.\n',
			output: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod\ntempor <!-- foo --> incididunt\n<a href="https://example.com/a/b/c" title="Example">ut labore</a> et dolore\nmagna aliqua. Ut enim ad minim veniam, quis nostrud exercitation.\n',
			printWidth: 80,
		},
		{
			context: 'between CJK and other words',
			input: '中文 hello human words <!-- c --> and a few more words after it\n',
			output: '中文 hello\nhuman\nwords <!-- c -->\nand a few\nmore words\nafter it\n',
			printWidth: 12,
		},
		{
			context: 'after a line that starts with an emoji',
			input: '😀 hello human words <!-- c --> and a few more words after it\n',
			output: '😀 hello\nhuman\nwords <!-- c -->\nand a few\nmore words\nafter it\n',
			printWidth: 12,
		},
		{
			context:
				'after a line that starts with a supplementary Han character',
			input: '𠮷 hello human words <!-- c --> and a few more words after it\n',
			output: '𠮷 hello\nhuman\nwords <!-- c -->\nand a few\nmore words\nafter it\n',
			printWidth: 12,
		},
		{
			context: 'after a word with an accented letter',
			input: 'Several words with a region that has hêllo and more words <!-- c --> and a few more words after it in the same paragraph.\n',
			output: 'Several\nwords with\na region\nthat has\nhêllo and\nmore\nwords <!-- c -->\nand a few\nmore words\nafter it\nin the\nsame\nparagraph.\n',
			printWidth: 10,
		},
		{
			context: 'after a hard line break and CJK words',
			input: 'Several words before the HTML  \nMore content <!-- c --> and 中文 hello human words <!-- d --> and more after it in the same paragraph.\n',
			output: 'Several words before\nthe HTML  \nMore content <!-- c -->\nand 中文 hello human\nwords <!-- d --> and\nmore after it in the\nsame paragraph.\n',
			printWidth: 21,
		},
		{
			context: 'after a CJK sentence',
			input: '設定を保存してください。 <!-- note --> 次に <kbd   >Enter</kbd> を押します。\n',
			output: '設定を保存してください。 <!-- note -->\n次に <kbd>Enter</kbd>\nを押します。\n',
			printWidth: 30,
		},
	])(
		'keeps the separator before an inline comment from breaking $context',
		async ({ input, output: expectedOutput, printWidth }) => {
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				printWidth,
				proseWrap: 'always',
			} as const;

			const result = await formatWithNotices(input, options);

			expect(result).toStrictEqual({
				notices: [],
				output: expectedOutput,
			});
			await expect(format(expectedOutput, options)).resolves.toBe(
				expectedOutput
			);
		}
	);

	test.each(['pre', 'script', 'style', 'textarea'])(
		'keeps the line break before a `</%s>` tag in a paragraph',
		async (name) => {
			const input = `Copyright <year>\n</${name}> tail\n`;
			const expectedResult = {
				notices: [
					[
						'[prettier-plugin-markdown-html] Skipped HTML formatting (1:11). Close `<year>` with `</year>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
					],
				],
				output: input,
			};

			const result = await formatWithNotices(input, SPEC_EXAMPLE_OPTIONS);

			expect(result).toStrictEqual(expectedResult);
			await expect(
				formatWithNotices(result.output, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual(expectedResult);
		}
	);

	test('rejoins inline comments that start continuation lines', async () => {
		const input = 'foo\n    <!-- bar --> baz\n';
		const expectedOutput = 'foo <!-- bar --> baz\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps inline comments after hard line breaks inside links', async () => {
		const input = '[foo  \n](bar)<!-- baz -->\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test.each([
		{
			input: 'Use the dark logo - <source srcset="dark.png"> in the header\n',
			printWidth: 20,
		},
		{
			input: 'Use the dark logo # <source srcset="dark.png"> in the header\n',
			printWidth: 20,
		},
		{ input: 'Steps - <source srcset="dark.png">\n', printWidth: 8 },
	])(
		'rejects layouts that put a `source` tag at the start of a line in $input',
		async ({ input, printWidth }) => {
			const options = { ...WRAPPING_OPTIONS, printWidth };

			await expect(
				formatWithNotices(input, options)
			).resolves.toStrictEqual({
				notices: [
					[
						'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1). The formatted text wouldn’t read as a single Markdown paragraph with inline HTML. Check for a tag or Markdown block marker at the start of a line.',
					],
				],
				output: await format(input, { ...options, plugins: [] }),
			});
		}
	);

	test('rejects a paragraph that starts with a tag that starts an HTML block in GFM', async () => {
		const input = '<source srcset="dark.png"> in the header.\n';

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1). The formatted text wouldn’t read as a single Markdown paragraph with inline HTML. Check for a tag or Markdown block marker at the start of a line.',
				],
			],
			output: input,
		});
	});

	test('rejects a tag after a hard line break that starts an HTML block in GFM', async () => {
		const input = 'Watch the clip\\\n<source src="a.mp4"> now.\n';

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (2:1). Formatting would put this HTML at the start of a line after the hard line break, where Prettier or GitHub Flavored Markdown would read it as an HTML block.',
				],
			],
			output: input,
		});
	});
});

describe('Single Lines', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'keeps tags on one line in headings and table rows with the `%s` parser',
		async (parser) => {
			const input = `# <img src="https://prettier.io/icon.png" width="32" alt=""> Editor setup

| Editor | Setup |
| --- | --- |
| VS Code | <a href='https://prettier.io/docs/editors' title='Editor integration'>Setup guide</a> |
`;
			const expectedOutput = `# <img src="https://prettier.io/icon.png" width="32" alt="" /> Editor setup

| Editor  | Setup                                                                                 |
| ------- | ------------------------------------------------------------------------------------- |
| VS Code | <a href="https://prettier.io/docs/editors" title="Editor integration">Setup guide</a> |
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				htmlFragmentSingleAttributePerLine: true,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);

	test('keeps inline HTML in headings and table rows on one line', async () => {
		const input = `# foo <span   title="bar"   class="baz">qux</span>

| quux |
| - |
| <span   title="corge grault"   class="garply">waldo</span> |

![fred <span title = "plugh">xyzzy</span>](thud)
`;

		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			htmlFragmentSingleAttributePerLine: true,
		} satisfies Options;

		const expectedOutput = `# foo <span title="bar" class="baz">qux</span>

| quux                                                   |
| ------------------------------------------------------ |
| <span title="corge grault" class="garply">waldo</span> |

![fred <span title = "plugh">xyzzy</span>](thud)
`;

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});
});

describe('Content Preservation', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'keeps text in an HTML block literal with the `%s` parser',
		async (parser) => {
			const input = `<a href="https://prettier.io/docs/install">
**Install Prettier locally**
</a>
`;
			const expectedOutput = `<a href="https://prettier.io/docs/install">
    **Install Prettier locally**
</a>
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);

	test('keeps table syntax inside an HTML block that continues past a closing tag until a blank line', async () => {
		const input =
			'<div>\n</div>\n| bar | baz |\n|---|---|\n| <b   >qux</b> | quux |\n';
		const expectedOutput =
			'<div></div>\n| bar | baz | |---|---| | <b>qux</b> | quux |\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps lone brackets inside comments in HTML blocks', async () => {
		const input = '<div><span>\n\n<!-- foo\n>\nbar --></span></div>\n';
		const expectedOutput =
			'<div>\n    <span>\n\n<!-- foo\n>\nbar --></span>\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps the opening tag of an HTML block on its own line', async () => {
		const input = `<span   title = "foo"   class = "bar">
**baz**
</span>
`;
		const expectedOutput = `<span title="foo" class="bar">
    **baz**
</span>
`;

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects a region where Prettier’s HTML formatter adds a blank line inside a comment', async () => {
		const input =
			'<!--[if IE]>\n<script type="text/markdown">\n# Heading\nText.\n</script>\n<![endif]-->\n';

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1). Removing the blank line that Prettier’s HTML formatter adds would change a comment or other markup.',
				],
			],
			output: input,
		});
	});

	test.each([
		{
			context: 'after the checkbox paragraph',
			input: '- [ ] Note\n\n  <pre   title="Setup" class="output">one\n  two\n  </pre>\n',
			notice: '(3:3). Prettier’s Markdown layout would change the indentation inside the formatted HTML block.',
			options: { singleAttributePerLine: true },
		},
		{
			context: 'between Markdown blocks',
			input: '- [x] Install\n\n  <div   class="note">\n  <pre>npm install\n    --save-dev prettier</pre>\n  </div>\n\n  Then format.\n',
			notice: '(3:3). Prettier’s Markdown layout would change the indentation inside the formatted HTML block.',
			options: {},
		},
	])(
		'rejects an HTML block of a task list item whose later lines Prettier indents by the checkbox width $context',
		async ({ input, notice, options: rowOptions }) => {
			const options = { ...SPEC_EXAMPLE_OPTIONS, ...rowOptions };

			// Plain Prettier changes this output again on a second pass
			await expect(
				formatWithNotices(input, options)
			).resolves.toStrictEqual({
				notices: [
					[
						`[prettier-plugin-markdown-html] Skipped HTML formatting ${notice}`,
					],
				],
				output: await format(input, { ...options, plugins: [] }),
			});
		}
	);
});

describe('Normalization', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'makes omitted closing tags explicit with the `%s` parser',
		async (parser) => {
			const input = `<ul><li>CSS<li>JavaScript<li>Markdown</ul>
`;
			const expectedOutput = `<ul>
    <li>CSS</li>
    <li>JavaScript</li>
    <li>Markdown</li>
</ul>
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);

	test('makes omitted list item closing tags explicit', async () => {
		const input = '<ul><li>foo<li>bar</ul>\n';
		const expectedOutput = `<ul>
    <li>foo</li>
    <li>bar</li>
</ul>
`;

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('lowercases inline tag names', async () => {
		const input = 'foo <SPAN   title="bar">baz</SPAN  >\n';
		const expectedOutput = 'foo <span title="bar">baz</span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps the case of custom element names', async () => {
		const input = 'foo <MyTag   >bar</MyTag>\n';
		const expectedOutput = 'foo <MyTag>bar</MyTag>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps the case of SVG element names', async () => {
		const input =
			'<div><svg><clipPath   id="bar"></clipPath></svg></div>\n';
		const expectedOutput =
			'<div>\n    <svg><clipPath id="bar"></clipPath></svg>\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});
});

describe('Corrections', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'rewrites a lone `</br>` as `<br />` with the `%s` parser',
		async (parser) => {
			const input = `Install the extension.</br>Restart your editor.
`;
			const expectedOutput = `Install the extension.<br />Restart your editor.
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);

	test.each(MARKDOWN_PARSER_NAMES)(
		'drops a closing `img` tag directly after its opening tag with the `%s` parser',
		async (parser) => {
			const input = `<p><img src="prettier.svg" alt="Prettier"></img></p>
`;
			const expectedOutput = `<p><img src="prettier.svg" alt="Prettier" /></p>
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);

	test('keeps both line breaks of `<br></br>`', async () => {
		const input = 'Install the extension.<br></br>Restart your editor.\n';
		const expectedOutput =
			'Install the extension.<br /><br />Restart your editor.\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('drops an inline closing `img` tag directly after its opening tag', async () => {
		const input =
			'See the <img src="prettier.svg" alt="Prettier"></img> logo.\n';
		const expectedOutput =
			'See the <img src="prettier.svg" alt="Prettier" /> logo.\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test.each([
		{
			input: '<p><img src="prettier.svg" alt="Prettier"> </img></p>\n',
			notice: '(1:44). No opening `<img>` matches this `</img>` in the same Markdown region.',
		},
		{
			input: '<img src="logo.png" width=200></img>\n',
			notice: '(1:1). Formatting would leave this tag alone on the paragraph’s first line, where Prettier or GitHub Flavored Markdown would read it as an HTML block.',
		},
		{
			input: '<div align="center">\n\n**[Support Prettier](https://opencollective.com/prettier)**\n',
			notice: '(1:1). Close `<div>` with `</div>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
		},
		{
			input: '<p align="center">Prettier</p>\n</section>\n',
			notice: '(2:1). No opening `<section>` matches this `</section>` in the same Markdown region.',
		},
	])(
		'rejects the region that a correction can’t fix in $input',
		async ({ input, notice }) => {
			const expectedResult = {
				notices: [
					[
						`[prettier-plugin-markdown-html] Skipped HTML formatting ${notice}`,
					],
				],
				output: await format(input, {
					...SPEC_EXAMPLE_OPTIONS,
					plugins: [],
				}),
			};

			await expect(
				formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual(expectedResult);
		}
	);

	test('keeps a paired `</br>` in SVG content as written', async () => {
		const input = '<div><svg width=16><br></br></svg></div>\n';
		const expectedOutput =
			'<div>\n    <svg width="16"><br></br></svg>\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test.each([
		{
			input: '<div><svg width="16"></br></svg></div>\n',
			notice: '(1:22). No opening `<br>` matches this `</br>` in the same Markdown region.',
		},
		{
			input: '<div><svg width="16"><source /></source></svg></div>\n',
			notice: '(1:32). No opening `<source>` matches this `</source>` in the same Markdown region.',
		},
		{
			input: '<div><math><source /></source></math></div>\n',
			notice: '(1:22). No opening `<source>` matches this `</source>` in the same Markdown region.',
		},
	])(
		'rejects an unpaired closing tag in SVG or MathML content in $input',
		async ({ input, notice }) => {
			await expect(
				formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual({
				notices: [
					[
						`[prettier-plugin-markdown-html] Skipped HTML formatting ${notice}`,
					],
				],
				output: input,
			});
		}
	);

	test('rewrites a `</br>` after an attribute ignore directive', async () => {
		const input =
			'Install <!-- prettier-ignore-attribute --> </br> Prettier\n';
		const expectedOutput =
			'Install <!-- prettier-ignore-attribute --> <br /> Prettier\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('corrects nothing in opaque content', async () => {
		const input =
			'<!-- Install the extension.</br>Restart your editor. -->\n';

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({ notices: [], output: input });
	});

	test.each([
		{
			input: '<div>Before</ br>After</div>\n',
			notice: '(1:12). No opening `<br>` matches this `</ br>` in the same Markdown region.',
		},
		{
			input: '<p><img src="a.png"></ img></p>\n',
			notice: '(1:21). No opening `<img>` matches this `</ img>` in the same Markdown region.',
		},
	])(
		'leaves a void closing tag with whitespace after `</` uncorrected in $input',
		async ({ input, notice }) => {
			await expect(
				formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual({
				notices: [
					[
						`[prettier-plugin-markdown-html] Skipped HTML formatting ${notice}`,
					],
				],
				output: await format(input, {
					...SPEC_EXAMPLE_OPTIONS,
					plugins: [],
				}),
			});
		}
	);

	test.each(['</br >', '</BR>'])('rewrites %s as `<br />`', async (tag) => {
		const input = `<div>Before${tag}After</div>\n`;
		const expectedOutput = '<div>Before<br />After</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});
});

describe('Rejected Regions', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'falls back to plain Prettier for a region with unclosed placeholders with the `%s` parser',
		async (parser) => {
			const input = `Copyright © <year> <copyright-holder>.  <a href='LICENSE'>MIT License</a>.

Read the <a href='CONTRIBUTING.md'>contributing guide</a> before opening a pull request.
`;
			const expectedOutput = `Copyright © <year> <copyright-holder>. <a href='LICENSE'>MIT License</a>.

Read the <a href="CONTRIBUTING.md">contributing guide</a> before opening a pull request.
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);

	test.each([
		{
			context: 'a declaration',
			input: '<!DOCTYPE html>\n\nRead the <A   href="guide.html">guide</A> first.\n',
			notice: '(1:1). This region contains a markup declaration, which the plugin doesn’t support.',
			output: '<!DOCTYPE html>\n\nRead the <a href="guide.html">guide</a> first.\n',
		},
		{
			context: 'a processing instruction with `>` before its end',
			input: '<?xml-stylesheet href="style.css" > ?>\n\nPress <KBD>Enter</KBD>.\n',
			notice: '(1:1). This region contains a processing instruction, which the plugin doesn’t support.',
			output: '<?xml-stylesheet href="style.css" > ?>\n\nPress <kbd>Enter</kbd>.\n',
		},
		{
			context: 'an `svg` element split across HTML blocks',
			input: '<svg viewBox="0 0 16 16">\n<path d="M8 0"/>\n\n</svg>\n\nPress <KBD>Enter</KBD>.\n',
			notice: '(1:1). Close `<svg>` with `</svg>` in the same HTML block, before any enclosing element closes.',
			output: '<svg viewBox="0 0 16 16">\n<path d="M8 0"/>\n\n</svg>\n\nPress <kbd>Enter</kbd>.\n',
		},
	])(
		'formats the Markdown after the region rejected for $context',
		async ({ input, notice, output: expectedOutput }) => {
			await expect(
				formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual({
				notices: [
					[
						`[prettier-plugin-markdown-html] Skipped HTML formatting ${notice}`,
					],
				],
				output: expectedOutput,
			});
			await expect(
				format(expectedOutput, SPEC_EXAMPLE_OPTIONS)
			).resolves.toBe(expectedOutput);
		}
	);

	test('rejects through the end of the container after a raw text element whose closing tag is in a later heading', async () => {
		const input =
			'<div>\n<script>\n\n## Usage </script>\n\n</div>\n\nPress <KBD>Enter</KBD>.\n';

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (2:1). Close `<script>` with `</script>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
				],
			],
			output: input,
		});
	});
});

describe('Tag Matching', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'formats tags that enclose Markdown links and images with the `%s` parser',
		async (parser) => {
			const input = `<a href='https://prettier.io'>![Prettier](https://prettier.io/icon.png)</a>

Run Prettier locally<SUP>[install guide](https://prettier.io/docs/install)</SUP>.
`;
			const expectedOutput = `<a href="https://prettier.io">![Prettier](https://prettier.io/icon.png)</a>

Run Prettier locally<sup>[install guide](https://prettier.io/docs/install)</sup>.
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);

	test.each(MARKDOWN_PARSER_NAMES)(
		'falls back to plain Prettier for an element open across HTML blocks with the `%s` parser',
		async (parser) => {
			const input = `<ul>
<li>Editor setup

Enable **format on save** for this project.

</ul>

On macOS, press <KBD>⌘</KBD>+<KBD>S</KBD> to save the file.
`;
			const expectedOutput = `<ul>
<li>Editor setup

Enable **format on save** for this project.

</ul>

On macOS, press <kbd>⌘</kbd>+<kbd>S</kbd> to save the file.
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);

	test('formats raw HTML around elements generated from Markdown', async () => {
		const input = `foo <b >_bar_</b>

<a   href = "baz">[qux](quux)</a>
`;
		const expectedOutput = `foo <b>_bar_</b>

<a href="baz">[qux](quux)</a>
`;

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('formats block elements inside paragraphs', async () => {
		const input = 'foo <div   >bar</div> baz\n';
		const expectedOutput = 'foo <div>bar</div> baz\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('pairs raw paragraph tags around Markdown paragraphs', async () => {
		const input = '<p   >\n\nfoo\n\n</p>\n';
		const expectedOutput = '<p>\n\nfoo\n\n</p>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test.each([
		{
			context: 'block quotes',
			input: '<p   >\n\n> <div   >bar</div>\n\n</p>\n',
			output: '<p>\n\n> <div>bar</div>\n\n</p>\n',
		},
		{
			context: 'list items',
			input: '<p   >\n\n- <div   >bar</div>\n\n</p>\n',
			output: '<p>\n\n- <div>bar</div>\n\n</p>\n',
		},
	])(
		'formats HTML blocks in $context inside raw paragraph tags',
		async ({ input, output: expectedOutput }) => {
			const result = await formatWithNotices(input, SPEC_EXAMPLE_OPTIONS);

			expect(result).toStrictEqual({
				notices: [],
				output: expectedOutput,
			});
			await expect(
				format(expectedOutput, SPEC_EXAMPLE_OPTIONS)
			).resolves.toBe(expectedOutput);
		}
	);

	test('rejects inline closing tags for elements that an HTML block opens', async () => {
		const input = '<div><a href="foo">\n\nbar\n\n</a></div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects closing tags that don’t match the open element in block quotes', async () => {
		const input = '> <div>\n><span></div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('pairs tags across emphasis', async () => {
		const input = '_Press <KBD>Enter_ twice</KBD>.\n';
		const expectedOutput = '_Press <kbd>Enter_ twice</kbd>.\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('formats block tags in paragraphs of loose lists in block quotes', async () => {
		const input = '> - foo <div   >bar</div>\n>   - baz\n>\n> - qux\n';
		const expectedOutput = '> - foo <div>bar</div>\n>     - baz\n> - qux\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('formats block tags in paragraphs of lists that open blocks make loose', async () => {
		const input = '- <?foo >\n\n- bar <p   >baz</p>\n';
		const expectedOutput = '- <?foo >\n  \n\n- bar <p>baz</p>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		// Plain Prettier changes this output again on a second pass
		expect(output).toBe(expectedOutput);
	});

	test('rejects HTML blocks that close elements inline HTML opens', async () => {
		const input = '- foo <span>\n  <div   >bar</div>\n  </span>\n- baz\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects each element that inline HTML leaves open before an HTML block', async () => {
		const input =
			'- foo <span>\n  <!-- bar --></span>\n  baz <b>\n  <div   >qux</div>\n  </b>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects elements with uppercase names that inline HTML leaves open', async () => {
		const input = '- foo <SPAN>\n  <div   >bar</div>\n  </SPAN>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects closing tags that Markdown separates from their elements', async () => {
		const input =
			'- <span>foo\n  <!-- bar -->\n  </span><b>baz\n  <div   >qux</div>\n  </b>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('formats HTML blocks without closing elements that rejected inline regions leave open', async () => {
		const input =
			'- foo <p>bar\n  <!-- baz --><div   >qux</div>\n  <!-- quux -->\n';
		const expectedOutput =
			'- foo <p>bar\n  <!-- baz -->\n  <div>qux</div>\n  <!-- quux -->\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects end tags in HTML blocks for elements that inline HTML opens', async () => {
		const input =
			'- foo <ul><li>bar\n  <!-- baz --></ul>\n  qux\n  <!-- quux -->\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('adds no closing tags to inline elements that generated elements close', async () => {
		const input =
			'- foo <p>bar\n  <!-- baz -->\n  - qux\n  <!-- quux -->\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects implicitly closed elements across HTML blocks', async () => {
		const input =
			'<ul>\n<li>foo\n\n<li>bar\n</ul>\n\n<p>baz\n\n<div>qux</div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects inline elements with uppercase names that close across HTML blocks', async () => {
		const input = '- foo <SPAN>\n  <!-- bar -->\n  baz </SPAN>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects inline SVG elements that close in a later HTML block', async () => {
		const input = '- foo <svg><A>\n  <!-- bar --></A></svg>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects inline SVG elements with void element names that close in a later HTML block', async () => {
		const input = '- foo <svg><COL>\n  <!-- bar --></COL></svg>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects elements that HTML blocks open and later inline HTML closes', async () => {
		const input = '- <!-- foo --><span   >\n  bar </span>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects HTML blocks after elements that HTML blocks open and inline HTML closes', async () => {
		const input =
			'- <!-- foo --><span>\n  bar </span>\n  <div   >baz</div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects inline elements with omitted closing tags across HTML blocks', async () => {
		const input = '- foo <p   >bar\n  <!-- baz -->\n  qux\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects elements that HTML blocks open inside elements that inline HTML opens', async () => {
		const input =
			'- foo <span>\n  <!-- bar --><b   >\n  baz </b>\n  <!-- qux -->\n  quux</span>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects closing tags that don’t match the open element', async () => {
		const input = '<div><span></div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects closing tags inside elements Prettier still has open', async () => {
		const input = '<pre><code>foo</pre>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects a `pre` element that only self-closing syntax closes', async () => {
		const input = '<pre/>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects self-closing syntax on a non-void element even with a matching closing tag', async () => {
		const input = '<div><div   />foo</div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('keeps the closing tag Prettier supplies when a later tag in the same HTML block closes the element', async () => {
		const input = '<p   >foo\n<div   >bar</div>\n';
		const expectedOutput = '<p>foo</p>\n<div>bar</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test.each([
		{
			context: 'an `svg` `title`',
			input: '<div><svg><title>Network map</ title></svg></div>\n\nPress <KBD>Enter</KBD>.\n',
			output: '<div>\n    <svg><title>Network map</title></svg>\n</div>\n\nPress <kbd>Enter</kbd>.\n',
		},
		{
			context: 'a `div`',
			input: '<div>Network map</ div>\n\nPress <KBD>Enter</KBD>.\n',
			output: '<div>Network map</div>\n\nPress <kbd>Enter</kbd>.\n',
		},
	])(
		'reads a closing tag with whitespace after `</` as Prettier’s HTML parser does for $context',
		async ({ input, output: expectedOutput }) => {
			await expect(
				formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual({ notices: [], output: expectedOutput });
			await expect(
				format(expectedOutput, SPEC_EXAMPLE_OPTIONS)
			).resolves.toBe(expectedOutput);
		}
	);

	test.each(MARKDOWN_PARSER_NAMES)(
		'rejects a closing tag whose name follows a space that Prettier’s HTML lexer reads as part of the name with the `%s` parser',
		async (parser) => {
			const input = '<div>Before</ br>After</div>\n';
			const options = { ...SPEC_EXAMPLE_OPTIONS, parser };

			await expect(
				formatWithNotices(input, options)
			).resolves.toStrictEqual({
				notices: [
					[
						'[prettier-plugin-markdown-html] Skipped HTML formatting (1:12). No opening `< br>` matches this `</ br>` in the same Markdown region.',
					],
				],
				output: await format(input, { ...options, plugins: [] }),
			});
		}
	);

	test('ends a tag name where Prettier’s HTML lexer ends it', async () => {
		const input =
			'<div>\n<span=x>Network map</span>\n</div>\n\nPress <KBD>Enter</KBD>.\n';
		const expectedOutput =
			'<div>\n    <span ="x">Network map</span>\n</div>\n\nPress <kbd>Enter</kbd>.\n';

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({ notices: [], output: expectedOutput });
		await expect(
			format(expectedOutput, SPEC_EXAMPLE_OPTIONS)
		).resolves.toBe(expectedOutput);
	});

	test('reads a closing tag whose name starts with a digit as Prettier’s HTML lexer does', async () => {
		const input =
			'<div>Network map</1div></div>\n\nPress <KBD>Enter</KBD>.\n';

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (1:17). No opening `<1div>` matches this `</1div>` in the same Markdown region.',
				],
			],
			output: '<div>Network map</1div></div>\n\nPress <kbd>Enter</kbd>.\n',
		});
	});

	test.each([
		{
			input: '<div>Before</br=foo>After</div>\n',
			notice: '(1:16). Prettier can’t format this HTML:\n\nUnexpected character "="',
		},
		{
			input: '<div>Before</img=foo>After</div>\n',
			notice: '(1:17). Prettier can’t format this HTML:\n\nUnexpected character "="',
		},
		{
			input: '<div>Before</br x>After</div>\n',
			notice: '(1:17). Prettier can’t format this HTML:\n\nUnexpected character "x"',
		},
	])(
		'corrects nothing in text that starts with `</` without the form of a closing tag in $input',
		async ({ input, notice }) => {
			await expect(
				formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual({
				notices: [
					[
						`[prettier-plugin-markdown-html] Skipped HTML formatting ${notice}`,
					],
				],
				output: input,
			});
		}
	);

	test.each([
		{
			context: 'that text without the form of a closing tag leaves open',
			input: "<div>Before</div=foo>\n\nSee <a href='x'>docs</a>.\n",
			notice: '(1:1). Close `<div>` with `</div>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
		},
		{
			context: 'whose closing tag its HTML block cuts off',
			input: "<div>\n<p>Before</p></div\n\nSee <a href='x'>docs</a>.\n",
			notice: '(2:14). Complete this tag, including any quoted attribute values, in the same HTML fragment.',
		},
	])(
		'rejects through the end of the container after an element $context',
		async ({ input, notice }) => {
			await expect(
				formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual({
				notices: [
					[
						`[prettier-plugin-markdown-html] Skipped HTML formatting ${notice}`,
					],
				],
				output: input,
			});
		}
	);

	test.each([
		{ input: '<div align="center">a </3 b</div>', position: '1:27' },
		{ input: '<div align="center">a </ - b</div>', position: '1:28' },
		{ input: '<div align="center">a </x b</div>', position: '1:27' },
	])(
		'reads the tags after text that starts with `</` without the form of a closing tag in $input',
		async ({ input, position }) => {
			const markdown = `${input}\n\nSee <a href='x'>docs</a>.\n`;

			await expect(
				formatWithNotices(markdown, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual({
				notices: [
					[
						`[prettier-plugin-markdown-html] Skipped HTML formatting (${position}). Prettier can’t format this HTML:\n\nUnexpected character "b"`,
					],
				],
				output: `${input}\n\nSee <a href="x">docs</a>.\n`,
			});
		}
	);
});

describe('Comments, Scripts, Preformatted Text', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'falls back to plain Prettier for a `pre` that a blank line splits with the `%s` parser',
		async (parser) => {
			const input = `<table>
<tr>
<td>
<pre>

npm install --save-dev --save-exact prettier

</pre>
</td>
</tr>
</table>

Press <KBD>Enter</KBD> to run it.
`;
			const expectedOutput = `<table>
<tr>
<td>
<pre>

npm install --save-dev --save-exact prettier

</pre>
</td>
</tr>
</table>

Press <kbd>Enter</kbd> to run it.
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
			} satisfies Options;

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
			await expect(format(output, options)).resolves.toBe(output);
		}
	);

	test('rejects an open `pre` element at the document root', async () => {
		const input = '<pre>foo\n\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects unterminated comments', async () => {
		const input = 'foo\n\n<!-- bar\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects unterminated raw text elements', async () => {
		const input = 'foo\n\n<script>\nbar\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects comments that continue into a later HTML block', async () => {
		const input =
			'<div   ></div>\n<!-- Comment\n\n**foo**\n\n<div>bar -->\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test.each([
		{
			context: 'that Prettier ends before `?>`',
			input: '<?foo </div> ?>\n',
		},
		{
			context: 'with quotes that Prettier ends before `?>`',
			input: '<?foo ">\n<script type="text/markdown">\n# foo\n* bar\n</script>\n?>\n',
		},
	])('rejects processing instructions $context', async ({ input }) => {
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects comments that continue past the end of a block quote', async () => {
		const input = '> <!-- foo\n\n<div   >--></div>\n';
		const expectedOutput = '> <!-- foo\n\n<div>--></div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects comments that end in Markdown text', async () => {
		const input = '<div></div>\n<!-- Comment\n\n**foo**\n\nbar -->\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects processing instructions that continue past their HTML block', async () => {
		const input = '<div></div><?foo\n\nbar ?>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('keeps comments that span adjacent HTML blocks intact', async () => {
		const input = '<div></div>\n<!-- foo\n\n<div>   -->\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('keeps tags in nested Markdown inside a comment as comment content', async () => {
		const input = '<div></div>\n<!--\n\n> <span   >\n> foo\n\n<div>-->\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects a comment that continues past its HTML block', async () => {
		const input = '<div></div>\n<!-- Comment\n\nfoo  bar\n\n<div>baz -->\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects a raw text element inside a paragraph', async () => {
		const input = 'foo <textarea>bar  baz</textarea>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects inline `title` elements as raw text', async () => {
		const input = 'foo <title   >bar  baz</title>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects from an inline raw text element left open through the end of its container', async () => {
		const input =
			'> foo <textarea>bar\n>\n> </textarea>\n>\n> <p   >baz</p>\n\n<p   >qux</p>\n';
		const expectedOutput =
			'> foo <textarea>bar\n>\n> </textarea>\n>\n> <p   >baz</p>\n\n<p>qux</p>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects open processing instructions that make a list loose', async () => {
		const input = '- <?foo >\n\n- bar\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		// Plain Prettier changes this output again on a second pass
		expect(output).toBe(expectedOutput);
	});

	test('rejects open processing instructions that take in blank lines between list items', async () => {
		const input = '- <?foo >\n\n\n\n- bar\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		// Plain Prettier changes this output again on a second pass
		expect(output).toBe(expectedOutput);
	});

	test('rejects open processing instructions in nested lists that take in blank lines', async () => {
		const input = '- foo\n  - <?bar >\n\n\n- baz\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		// Plain Prettier changes this output again on a second pass
		expect(output).toBe(expectedOutput);
	});

	test('rejects open processing instructions in nested lists before paragraphs', async () => {
		const input = '- foo\n  - <?bar >\n\n\n  baz\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects open processing instructions that take in blank lines at the end of a list', async () => {
		const input = '- foo\n- <?bar >\n\n\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		// Plain Prettier changes this output again on a second pass
		expect(output).toBe(expectedOutput);
	});

	test('rejects HTML after a tag that its HTML block leaves incomplete', async () => {
		const input = '<div class="foo\n\n<p   >bar</p>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects the enclosing regions whose closing tags an open inline raw text element takes in', async () => {
		const input =
			'<details   >\n\nSee <textarea>Preview.\n\n</details>\n\n<div   >x</div>\n';

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (3:5). Close `<textarea>` with `</textarea>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
				],
			],
			output: await format(input, {
				...SPEC_EXAMPLE_OPTIONS,
				plugins: [],
			}),
		});
	});

	test('reads the content of an SVG `title` as raw text', async () => {
		const input =
			'<svg viewBox="0 0 4 4">\n<title>Literal <!-- inside title</title>\n<path d="M0 0"/>\n</svg>\n\nPress <KBD>Enter</KBD>.\n';
		const expectedOutput =
			'<svg viewBox="0 0 4 4">\n    <title>Literal <!-- inside title</title>\n    <path d="M0 0" />\n</svg>\n\nPress <kbd>Enter</kbd>.\n';

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({ notices: [], output: expectedOutput });
		await expect(
			format(expectedOutput, SPEC_EXAMPLE_OPTIONS)
		).resolves.toBe(expectedOutput);
	});

	test('names a raw text element whose closing tag only inline text supplies', async () => {
		const input =
			'<div>\n<textarea>Logo\n\nmark</textarea>\n</div>\n\nPress <KBD>Enter</KBD>.\n';

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (2:1). Close `<textarea>` with `</textarea>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
				],
			],
			output: await format(input, {
				...SPEC_EXAMPLE_OPTIONS,
				plugins: [],
			}),
		});
	});

	test.each(MARKDOWN_PARSER_NAMES)(
		'keeps a closing tag after a space that Prettier’s HTML lexer doesn’t read as whitespace in an SVG `title` with the `%s` parser',
		async (parser) => {
			const input =
				'<div><svg><title>Network map</ title> <!-- literal</title></svg></div>\n\nPress <KBD>Enter</KBD>.\n';
			const expectedOutput =
				'<div>\n    <svg><title>Network map</ title> <!-- literal</title></svg>\n</div>\n\nPress <kbd>Enter</kbd>.\n';
			const options = { ...SPEC_EXAMPLE_OPTIONS, parser };

			await expect(
				formatWithNotices(input, options)
			).resolves.toStrictEqual({ notices: [], output: expectedOutput });
			await expect(format(expectedOutput, options)).resolves.toBe(
				expectedOutput
			);
		}
	);

	test('ends raw text at a closing tag after a control character that Prettier’s HTML lexer reads as whitespace', async () => {
		const input =
			'<div><svg><title>Network map</\u001Ftitle></svg></div>\n\nPress <KBD>Enter</KBD>.\n';
		const expectedOutput =
			'<div>\n    <svg><title>Network map</title></svg>\n</div>\n\nPress <kbd>Enter</kbd>.\n';

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({ notices: [], output: expectedOutput });
		await expect(
			format(expectedOutput, SPEC_EXAMPLE_OPTIONS)
		).resolves.toBe(expectedOutput);
	});

	test.each(['<!-->', '<!--->'])(
		'rejects only the inline region of a comment that its fragment leaves unfinished in %s',
		async (comment) => {
			const input = `Read ${comment} for details.\n\nPress <KBD>Enter</KBD>.\n`;

			await expect(
				formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual({
				notices: [
					[
						'[prettier-plugin-markdown-html] Skipped HTML formatting (1:6). Close this comment with `-->` in the same HTML fragment.',
					],
				],
				output: `Read ${comment} for details.\n\nPress <kbd>Enter</kbd>.\n`,
			});
		}
	);

	test.each([
		{
			context: 'a comment',
			input: '<details>\n<summary>Changelog</summary>\n<!-- TODO: add older entries\n\n- 1.0.0\n-->\n\n- 2.0.0: Initial release\n\n</details>\n',
			notice: '(3:1). Close this comment with `-->` in the same HTML fragment.',
		},
		{
			context: 'a tag',
			input: '<div>\n<span title="Release\n\nnotes">Changelog</span>\n</div>\n',
			notice: '(2:1). Complete this tag, including any quoted attribute values, in the same HTML fragment.',
		},
	])(
		'names $context that its HTML block leaves unfinished inside an element',
		async ({ input, notice }) => {
			await expect(
				formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual({
				notices: [
					[
						`[prettier-plugin-markdown-html] Skipped HTML formatting ${notice}`,
					],
				],
				output: await format(input, {
					...SPEC_EXAMPLE_OPTIONS,
					plugins: [],
				}),
			});
		}
	);
});

describe('Notices', () => {
	test('reports rejected regions on standard error in document order', async () => {
		const input = `Copyright © <year> <copyright-holder>.

<div></em></div>

Read the <a href='CONTRIBUTING.md'>contributing guide</a>.
`;

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (1:13). Close `<year>` with `</year>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
				],
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (3:6). No opening `<em>` matches this `</em>` in the same Markdown region.',
				],
			],
			output: `Copyright © <year> <copyright-holder>.

<div></em></div>

Read the <a href="CONTRIBUTING.md">contributing guide</a>.
`,
		});
	});

	test('reports a rejected region inside a larger rejected region only once', async () => {
		const input =
			'<details><span>\n\nIn <project-directory>, run it.\n\n</details>\n';

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (1:10). Close `<span>` with `</span>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
				],
			],
			output: input,
		});
	});

	test('reports each rejection once when a layout failure restarts formatting', async () => {
		const input =
			'<div   >foo</div>\n\n<script>\n\nfoo\n\n</script><b>bar</b>\n\nbaz\n';

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (3:1). After formatting, GitHub Flavored Markdown would no longer recognize this as an HTML block, and some of its content would be interpreted as Markdown.',
				],
			],
			output: '<div>foo</div>\n\n<script>\n\nfoo\n\n</script><b>bar</b>\n\nbaz\n',
		});
	});

	test('lists the first five notices individually and counts the rest', async () => {
		const input =
			'<a>foo\n\n<a>bar\n\n<a>baz\n\n<a>qux\n\n<a>quux\n\n<a>corge\n\n<a>grault\n';

		const { notices } = await formatWithNotices(
			input,
			SPEC_EXAMPLE_OPTIONS
		);

		expect(notices).toStrictEqual([
			...[1, 3, 5, 7, 9].map((line) => [
				`[prettier-plugin-markdown-html] Skipped HTML formatting (${line}:1). Close \`<a>\` with \`</a>\` in the same Markdown region, or escape \`<\` as \`&lt;\` if the tag is meant as text.`,
			]),
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting. 2 more regions.',
			],
		]);
	});

	test('names the file in each notice', async () => {
		const { notices } = await formatWithNotices('<a>foo\n', {
			...SPEC_EXAMPLE_OPTIONS,
			filepath: 'docs/foo.md',
		});

		expect(notices).toStrictEqual([
			[
				'[prettier-plugin-markdown-html] Skipped HTML formatting in `docs/foo.md` (1:1). Close `<a>` with `</a>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
			],
		]);
	});

	test.each([
		{
			context: 'in task list items',
			input: '- [ ] foo\n\n  <!-- bar\n',
			notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (3:3). Close this comment with `-->` in the same HTML fragment.',
			options: SPEC_EXAMPLE_OPTIONS,
		},
		{
			context: 'after tabs',
			input: '- <div>\n\t<span></div>\n',
			notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (2:8). Prettier can’t format this HTML:\n\nUnexpected closing tag "div". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags',
			options: { ...SPEC_EXAMPLE_OPTIONS, tabWidth: 2 },
		},
		{
			context: 'after frontmatter',
			input: '---\na: b\n---\n\n<div><p></div></p>\n',
			notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (5:15). No opening `<p>` matches this `</p>` in the same Markdown region.',
			options: SPEC_EXAMPLE_OPTIONS,
		},
		{
			context: 'with CRLF line endings',
			input: 'foo\r\n\r\n<div>\r\n<span></div>\r\n',
			notice: '[prettier-plugin-markdown-html] Skipped HTML formatting (4:7). Prettier can’t format this HTML:\n\nUnexpected closing tag "div". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags',
			options: SPEC_EXAMPLE_OPTIONS,
		},
	])(
		'reports positions in the original Markdown $context',
		async ({ input, notice, options }) => {
			const { notices } = await formatWithNotices(input, options);

			expect(notices).toStrictEqual([[notice]]);
		}
	);

	test('gives no notice for a region that an ignore directive acknowledges', async () => {
		const input = '<!-- prettier-ignore -->\n<div></span></div>\n';

		await expect(
			formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual({ notices: [], output: input });
	});

	test('raises the first rejection as an error when `PRETTIER_DEBUG` is set', async () => {
		vi.stubEnv('PRETTIER_DEBUG', '1');
		onTestFinished(() => {
			vi.unstubAllEnvs();
		});

		await expect(
			format('<a>foo\n\n<b>bar\n', {
				...SPEC_EXAMPLE_OPTIONS,
				filepath: 'docs/foo.md',
			})
		).rejects.toThrowErrorMatchingInlineSnapshot(
			`[Error: [prettier-plugin-markdown-html] \`PRETTIER_DEBUG\` stopped formatting (1:1). Close \`<a>\` with \`</a>\` in the same Markdown region, or escape \`<\` as \`&lt;\` if the tag is meant as text.]`
		);
	});

	test('formats regions that ignore directives acknowledge when `PRETTIER_DEBUG` is set', async () => {
		vi.stubEnv('PRETTIER_DEBUG', '1');
		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		const input = '<!-- prettier-ignore -->\n<div></span></div>\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});
});

describe('Effective HTML Options', () => {
	test('leaves Markdown wrapping to the Prettier print width', async () => {
		const input =
			'Foo bar baz qux quux corge grault garply waldo fred plugh xyzzy thud.\n\n<div id="foo" class="bar" title="baz qux quux corge">grault</div>\n';
		const expectedOutput =
			'Foo bar baz qux quux corge grault garply\nwaldo fred plugh xyzzy thud.\n\n<div id="foo" class="bar" title="baz qux quux corge">grault</div>\n';
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			htmlFragmentPrintWidth: 100,
			printWidth: 40,
			proseWrap: 'always',
		} satisfies Options;

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('applies the fragment print width to inline tags', async () => {
		const input =
			'foo <span id="foo" class="bar" title="baz qux">grault</span> garply\n';
		const expectedOutput =
			'foo <span\n    id="foo"\n    class="bar"\n    title="baz qux"\n    >grault</span> garply\n';
		const options = { ...SPEC_EXAMPLE_OPTIONS, htmlFragmentPrintWidth: 30 };

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('leaves fenced HTML code to the Markdown formatting options', async () => {
		const input =
			'<p   >garply</p>\n\n```html\n<div id="foo" class="bar" title="baz qux quux corge">grault <b>waldo</b>   </div>\n```\n';
		const expectedOutput =
			'<p>garply</p>\n\n```html\n<div id="foo" class="bar" title="baz qux quux corge">grault <b>waldo</b></div>\n```\n';
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			htmlFragmentPrintWidth: 20,
			htmlFragmentSingleAttributePerLine: true,
			htmlFragmentWhitespaceSensitivity: 'ignore',
		} satisfies Options;

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('narrows the fragment print width by container prefixes', async () => {
		const input = '> - <div id="foo" class="bar">baz qux</div>\n';
		const expectedOutput =
			'> - <div id="foo" class="bar">\n>       baz qux\n>   </div>\n';
		const options = { ...SPEC_EXAMPLE_OPTIONS, htmlFragmentPrintWidth: 30 };

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('breaks attributes when container prefixes leave too little width', async () => {
		const input = '> - <div id="foo" class="bar">baz qux</div>\n';
		const expectedOutput =
			'> - <div\n>       id="foo"\n>       class="bar"\n>   >\n>       baz qux\n>   </div>\n';
		const options = { ...SPEC_EXAMPLE_OPTIONS, htmlFragmentPrintWidth: 29 };

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('indents HTML with tabs without creating indented code', async () => {
		const input =
			'<div>\n<section>\n\nfoo\n\n<p   >bar</p>\n\n</section>\n</div>\n';
		const expectedOutput =
			'<div>\n\t<section>\n\nfoo\n\n<p>bar</p>\n\n</section>\n</div>\n';
		const options = { ...SPEC_EXAMPLE_OPTIONS, useTabs: true };

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});
});

describe('Embedded Languages', () => {
	test('keeps blank lines that embedded formatting adds in raw text blocks', async () => {
		const input =
			'<script type="text/markdown">\n# foo\n*   bar\n</script>\n';
		const expectedOutput =
			'<script type="text/markdown">\n    # foo\n\n    - bar\n</script>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps blank lines that embedded formatting adds in raw text with similar closing tags', async () => {
		const input =
			'<script type="text/markdown">\n`</scripture>`\n# foo\n</script>\n';
		const expectedOutput =
			'<script type="text/markdown">\n    `</scripture>`\n\n    # foo\n</script>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects blank lines that embedded formatting adds in other HTML blocks', async () => {
		const input =
			'<div>\n<script type="text/markdown">\n# foo\n*   bar\n</script>\n</div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('formats embedded styles in attributes', async () => {
		const input = '<div style="color:red;display:block">foo</div>\n';
		const expectedOutput =
			'<div style="color: red; display: block">foo</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('leaves embedded styles in attributes unformatted when embedded language formatting is off', async () => {
		const input = '<div style="color:red;display:block">foo</div>\n';

		await expect(
			format(input, {
				...SPEC_EXAMPLE_OPTIONS,
				embeddedLanguageFormatting: 'off',
			})
		).resolves.toBe(input);
	});

	test('keeps the content of scripts in languages that Prettier doesn’t recognize', async () => {
		const input = '<script type="text/x-foo">  bar   =   baz  </script>\n';
		const expectedOutput =
			'<script type="text/x-foo">\n    bar   =   baz\n</script>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps the content of scripts that fail to format', async () => {
		const input = '<script>let foo = ;  bar( 1 )</script>\n';
		const expectedOutput =
			'<script>\n    let foo = ;  bar( 1 )\n</script>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});
});

describe('Ignore Directives', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'leaves source in an ignored range unchanged with the `%s` parser',
		async (parser) => {
			const input = `<!-- prettier-ignore-start -->
<table><tr><th>Install</th><th>Try online</th></tr><tr><td><a href="https://prettier.io/docs/install">Local setup</a></td><td><a href="https://prettier.io/playground">Playground</a></td></tr></table>

<!-- prettier-ignore-end -->

See the <a href='https://prettier.io/docs/cli'>CLI reference</a> for options.
`;
			const expectedOutput = `<!-- prettier-ignore-start -->
<table><tr><th>Install</th><th>Try online</th></tr><tr><td><a href="https://prettier.io/docs/install">Local setup</a></td><td><a href="https://prettier.io/playground">Playground</a></td></tr></table>

<!-- prettier-ignore-end -->

See the <a href="https://prettier.io/docs/cli">CLI reference</a> for options.
`;
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
			} satisfies Options;

			const result = await formatWithNotices(input, options);

			expect(result).toStrictEqual({
				notices: [],
				output: expectedOutput,
			});
			await expect(format(result.output, options)).resolves.toBe(
				result.output
			);
		}
	);

	test('keeps the closing tags of custom elements that ignore directives protect', async () => {
		const input =
			'<!-- prettier-ignore -->\n<Foo-Bar   >\n\nbaz\n\n</Foo-Bar>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('keeps the closing tags of elements with uppercase names that HTML ignore directives protect', async () => {
		const input =
			'<!-- prettier-ignore -->\n<div>\n<!-- prettier-ignore -->\n<DIV>\n\nfoo\n\n</DIV>\n</div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects SVG elements whose opening tags ignore directives protect', async () => {
		const input =
			'<!-- prettier-ignore -->\n<div><svg><linearGradient>\n\nfoo\n\n</linearGradient>\n</svg>\n</div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects elements whose closing tags ignore directives protect', async () => {
		const input = '<DIV>\n\nfoo\n\n<!-- prettier-ignore -->\n</DIV>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects elements whose opening tags ignore directives protect', async () => {
		const input = '<!-- prettier-ignore -->\n<DIV   >\n\nfoo\n\n</DIV>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects inline closing tags after inline opening tags that ignore directives protect', async () => {
		const input =
			'- <!-- prettier-ignore -->\n  foo <SPAN>\n  <!-- bar -->\n  baz </SPAN>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects inline opening tags before inline closing tags that ignore directives protect', async () => {
		const input =
			'- foo <SPAN>\n  <!-- bar -->\n  <!-- prettier-ignore -->\n  baz </SPAN>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects inline opening tags before closing tags in HTML blocks that ignore directives protect', async () => {
		const input =
			'- foo <Span>\n  <!-- prettier-ignore -->\n  <p   >bar\n  baz </Span>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects inline SVG closing tags after opening tags that ignore directives protect', async () => {
		const input =
			'- <!-- prettier-ignore -->\n  foo <svg><A>\n  <!-- bar -->\n  baz </A></svg>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps both tags of uppercase elements that ignore directives protect in HTML blocks and inline HTML', async () => {
		const input =
			'- <!-- prettier-ignore -->\n  <!-- foo --><SPAN>\n  <!-- prettier-ignore -->\n  bar </SPAN>\n';
		const expectedOutput =
			'- <!-- prettier-ignore -->\n  <!-- foo --><SPAN>\n  <!-- prettier-ignore -->\n    bar </SPAN>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps inline tags with lowercase names when ignore directives protect only one of them', async () => {
		const input =
			'- <!-- prettier-ignore -->\n  foo <span>\n  <!-- bar -->\n  baz </span>\n';
		const expectedOutput =
			'- <!-- prettier-ignore -->\n    foo <span>\n  <!-- bar -->\n    baz </span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects uppercase opening tags that Prettier lowercases after HTML ignore directives without whitespace', async () => {
		const input =
			'<div><!-- prettier-ignore --><SPAN   >foo</SPAN></div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects uppercase opening tags that Prettier lowercases after HTML ignore directives without whitespace beside identical protected tags', async () => {
		const input =
			'<div><!-- prettier-ignore --><SPAN   >foo</SPAN><!-- prettier-ignore --> <SPAN   >bar</SPAN></div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects uppercase opening tags that Prettier lowercases after HTML ignore directives without whitespace beside copies in comments', async () => {
		const input =
			'<div><!-- prettier-ignore --><SPAN   >foo</SPAN><!-- <SPAN   > --></div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('keeps uppercase opening tags in preformatted content after HTML ignore directives without whitespace beside lowercase copies', async () => {
		const input =
			'<pre><!-- prettier-ignore --><SPAN   >foo</SPAN></pre>\n\n<div><!-- prettier-ignore --><span   >bar</span></div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects uppercase opening tags that Prettier lowercases after HTML ignore directives without whitespace beside copies in attributes', async () => {
		const input =
			'<div class="<!-- prettier-ignore --><span   >"><!-- prettier-ignore --><SPAN   >foo</SPAN></div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('keeps uppercase opening tags in preformatted content after HTML ignore directives without whitespace beside Markdown-ignored copies', async () => {
		const input =
			'<!-- prettier-ignore -->\n<div><!-- prettier-ignore --><SPAN   >foo</SPAN></div>\n\n<pre><!-- prettier-ignore --><SPAN   >bar</SPAN></pre>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('keeps uppercase opening tags in preformatted content after HTML ignore directives without whitespace beside protected inline closing tags', async () => {
		const input =
			'- <!-- prettier-ignore -->\n  <!-- foo --><SPAN>\n  <!-- prettier-ignore -->\n  bar </SPAN>\n  <pre><!-- prettier-ignore --><B   >baz</B></pre>\n';
		const expectedOutput =
			'- <!-- prettier-ignore -->\n  <!-- foo --><SPAN>\n  <!-- prettier-ignore -->\n    bar </SPAN>\n  <pre><!-- prettier-ignore --><B   >baz</B></pre>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects closing tags beside ignored preformatted content for elements that inline HTML opens', async () => {
		const input =
			'- foo <SPAN>\n  <div   >bar</div>\n  </SPAN>\n  <pre><!-- prettier-ignore --><B   >baz</B></pre>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects uppercase opening tags that Prettier lowercases after HTML ignore directives without whitespace when it breaks the line after them', async () => {
		const input = `<div><!-- prettier-ignore --><SPAN   >foo</SPAN><b>${'bar '.repeat(20)}</b></div>\n`;
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects uppercase opening tags that Prettier lowercases after HTML ignore directives without whitespace beside renamed copies in attributes', async () => {
		const input =
			'<div class="<!-- prettier-ignore --><span   >foo</SPAN>"><!-- prettier-ignore --><SPAN   >foo</SPAN></div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('keeps void elements that Prettier lowercases after HTML ignore directives without whitespace beside protected uppercase elements', async () => {
		const input =
			'<div><!-- prettier-ignore --><IMG   src="foo"><section><!-- prettier-ignore --><DIV   >bar</DIV></section></div>\n';
		const expectedOutput =
			'<div>\n    <!-- prettier-ignore --><img   src="foo">\n    <section>\n        <!-- prettier-ignore -->\n        <DIV   >bar</DIV>\n    </section>\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects uppercase opening tags that Prettier lowercases after HTML ignore directives without whitespace after self-closing preformatted elements', async () => {
		const input =
			'<div><pre /><!-- prettier-ignore --><SPAN   >foo</SPAN></div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('keeps void elements that Prettier lowercases after HTML ignore directives without whitespace beside protected uppercase elements in preformatted content', async () => {
		const input =
			'<div><pre><!-- prettier-ignore --><SPAN   >foo</SPAN></pre><!-- prettier-ignore --><IMG   src="bar"></div>\n';
		const expectedOutput =
			'<div>\n    <pre><!-- prettier-ignore --><SPAN   >foo</SPAN></pre>\n    <!-- prettier-ignore --><img   src="bar">\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps omitted closing tags of elements that range ignore directives protect before closing tags', async () => {
		const input =
			'<ul>\n\n<!-- prettier-ignore-start -->\n\n<li   >foo\n\n<!-- prettier-ignore-end -->\n\n</ul>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects closing elements around ignored elements with omitted closing tags', async () => {
		const input = '<div>\n\n<!-- prettier-ignore -->\n\n<div>\n\nfoo\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects fragments after elements left open in source that ignore directives protect', async () => {
		const input =
			'<!-- prettier-ignore -->\n<ul><p>foo\n\n<!-- prettier-ignore -->\n<li><p>bar\n\n<div   >baz</div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('leaves elements unclosed around elements that ignored source leaves open', async () => {
		const input = '<div   >\n\n<!-- prettier-ignore -->\n<p   >foo\n';
		const expectedResult = {
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1). Close `<div>` with `</div>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
				],
			],
			output: await format(input, {
				...SPEC_EXAMPLE_OPTIONS,
				plugins: [],
			}),
		};

		const result = await formatWithNotices(input, SPEC_EXAMPLE_OPTIONS);

		expect(result).toStrictEqual(expectedResult);
		await expect(
			formatWithNotices(result.output, SPEC_EXAMPLE_OPTIONS)
		).resolves.toStrictEqual(expectedResult);
	});

	test('keeps HTML attribute ignore directives with their targets', async () => {
		const input =
			'<section>\n<!-- prettier-ignore-attribute -->\n<div   title = "foo">bar</div>\n</section>\n';
		const expectedOutput =
			'<section>\n    <!-- prettier-ignore-attribute -->\n    <div title = "foo">bar</div>\n</section>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps lists with link reference definitions unchanged after ignore directives', async () => {
		const input =
			'<!-- prettier-ignore -->\n- [foo]: bar\n\n  "baz"\n- <span   >qux</span>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('keeps lists with link reference definitions unchanged in ignored ranges', async () => {
		const input =
			'<!-- prettier-ignore-start -->\n\n- [foo]: bar\n\n  "baz"\n- <span   >qux</span>\n\n<!-- prettier-ignore-end -->\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('formats HTML after unclosed ignore ranges', async () => {
		const input = '<!-- prettier-ignore-start -->\n\n<div   >foo</div>\n';
		const expectedOutput =
			'<!-- prettier-ignore-start -->\n\n<div>foo</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('formats HTML in ignore ranges inside block quotes', async () => {
		const input =
			'> <!-- prettier-ignore-start -->\n>\n> <div   >foo</div>\n>\n> <!-- prettier-ignore-end -->\n';
		const expectedOutput =
			'> <!-- prettier-ignore-start -->\n>\n> <div>foo</div>\n>\n> <!-- prettier-ignore-end -->\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test.each([
		{
			input: '# Foo <!-- prettier-ignore -->\n\n<div   >bar</div>\n',
			output: '# Foo <!-- prettier-ignore -->\n\n<div>bar</div>\n',
		},
		{
			input: '| foo | bar <!-- prettier-ignore --> |\n| --- | --- |\n\n<div   >baz</div>\n',
			output: '| foo | bar <!-- prettier-ignore --> |\n| --- | ---------------------------- |\n\n<div>baz</div>\n',
		},
	])(
		'stops the reach of HTML ignore directives at the end of headings and table cells',
		async ({ input, output: expectedOutput }) => {
			const output = await format(input, SPEC_EXAMPLE_OPTIONS);

			expect(output).toBe(expectedOutput);
			await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
				output
			);
		}
	);

	test('stops the reach of HTML ignore directives that paragraph content follows', async () => {
		const input =
			"See *foo <!-- prettier-ignore -->*\n\n<DIV class='bar'>baz</DIV>\n";
		const expectedOutput =
			'See _foo <!-- prettier-ignore -->_\n\n<div class="bar">baz</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('prints blank lines after ignored open preformatted content as plain Prettier does', async () => {
		const input = '<!-- prettier-ignore -->\n<pre>\nfoo\n\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		// Plain Prettier changes this output again on a second pass
		expect(output).toBe(expectedOutput);
	});

	test('prints ignored open preformatted content with trailing whitespace as plain Prettier does', async () => {
		const input = '<!-- prettier-ignore -->\n<pre>foo  \n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		// Plain Prettier changes this output again on a second pass
		expect(output).toBe(expectedOutput);
	});

	test('keeps ignored lists with HTML in block quotes unchanged', async () => {
		const input =
			'> <!-- prettier-ignore -->\n> - <div>foo</div>\n>\n> bar\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('prints code blocks that end ignored lists with HTML in block quotes as plain Prettier does', async () => {
		const input =
			'> <!-- prettier-ignore -->\n> - <div>foo</div>\n>\n>   ```\n>   bar\n>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('removes whitespace from the blank line after ignored lists with HTML in block quotes', async () => {
		const input =
			'> <!-- prettier-ignore -->\n> - <div>foo</div>\n>   \n> bar\n';
		const expectedOutput =
			'> <!-- prettier-ignore -->\n> - <div>foo</div>\n>\n> bar\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('drops trailing whitespace of ignored HTML at the end of block quotes as plain Prettier does', async () => {
		const input = '> <!-- prettier-ignore -->\n> <div>foo</div>  \n\nbar\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps links with inline HTML that ignore directives protect unchanged', async () => {
		const input =
			'<!-- prettier-ignore -->\n[<b>foo</b>](https://example.com)\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('keeps preformatted content that ignore directives protect in list items whose marker lines end after the marker', async () => {
		const input =
			'-\n  <!-- prettier-ignore -->\n  <pre>\n  foo\n  </pre>\n';
		const expectedOutput =
			'- <!-- prettier-ignore -->\n  <pre>\n  foo\n  </pre>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps partly covered tabs in ignored preformatted content when the prefix doesn’t change', async () => {
		const input =
			'- foo\n\n  <!-- prettier-ignore -->\n  <pre>\n\t x</pre>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('protects only the attributes that a named attribute ignore directive selects', async () => {
		const input =
			'<section>\n<!-- prettier-ignore-attribute style -->\n<div   style="foo:bar;baz:qux"   class = "quux">corge</div>\n</section>\n';
		const expectedOutput =
			'<section>\n    <!-- prettier-ignore-attribute style -->\n    <div style="foo:bar;baz:qux" class="quux">corge</div>\n</section>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('limits HTML attribute ignore directives to their own HTML block', async () => {
		const input =
			'<!-- prettier-ignore-attribute -->\n<div   title = "foo">bar</div>\n\n<!-- prettier-ignore-attribute -->\n\n<div   title = "baz">qux</div>\n';
		const expectedOutput =
			'<!-- prettier-ignore-attribute -->\n<div title="foo">bar</div>\n\n<!-- prettier-ignore-attribute -->\n\n<div title="baz">qux</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test.each([
		{
			context: 'inside a container element',
			input: '<div   class="note">\n<!-- prettier-ignore -->\n<section   >\n\nRun `prettier --write .` to format the project.\n\n</section>\n</div>\n',
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (3:1). An ignore directive covers only part of this `<section>` element. Keep the whole element inside or outside the ignored source.',
				],
			],
		},
		{
			context: 'that covers the entire region',
			input: '<!-- prettier-ignore --><details   open>\n\nRun `prettier --write .` to format the project.\n\n</details>\n',
			notices: [],
		},
	])(
		'rejects an element that continues past the HTML block of its HTML ignore directive $context',
		async ({ input, notices }) => {
			await expect(
				formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual({
				notices,
				output: await format(input, {
					...SPEC_EXAMPLE_OPTIONS,
					plugins: [],
				}),
			});
		}
	);

	test.each([
		{
			input: "<div>\n</br>\n<!-- prettier-ignore -->\n<p class='foo'>bar</p>\n</div>\n",
			output: "<div>\n    <br />\n    <!-- prettier-ignore -->\n    <p class='foo'>bar</p>\n</div>\n",
		},
	])(
		'corrects closing tags outside the element that an HTML ignore directive protects in $input',
		async ({ input, output: expectedOutput }) => {
			const result = await formatWithNotices(input, SPEC_EXAMPLE_OPTIONS);

			expect(result).toStrictEqual({
				notices: [],
				output: expectedOutput,
			});
			await expect(
				formatWithNotices(expectedOutput, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual({ notices: [], output: expectedOutput });
		}
	);

	test.each([
		{
			input: '<div>\n<!-- prettier-ignore -->\n</img>\n<p   >Install</p>\n</div>\n',
			output: '<div>\n<!-- prettier-ignore -->\n</img>\n<p   >Install</p>\n</div>\n',
			positions: ['3:1', '3:1'],
			tag: 'img',
		},
		{
			input: '<div>\n<!-- prettier-ignore -->\n</br>\n<p   >Install</p>\n</div>\n',
			output: '<div>\n<!-- prettier-ignore -->\n</br>\n<p   >Install</p>\n</div>\n',
			positions: ['3:1', '3:1'],
			tag: 'br',
		},
		{
			input: 'Install <!-- prettier-ignore -->\n</img>\n\n<div   >Prettier</div>\n',
			output: 'Install <!-- prettier-ignore -->\n</img>\n\n<div>Prettier</div>\n',
			positions: ['2:1', '2:1'],
			tag: 'img',
		},
		{
			input: "<div>\n<!-- prettier-ignore-attribute -->\n</img>\n<p   class='tip'  id='install'>Install</p>\n</div>\n",
			output: "<div>\n<!-- prettier-ignore-attribute -->\n</img>\n<p   class='tip'  id='install'>Install</p>\n</div>\n",
			positions: ['3:1', '3:1'],
			tag: 'img',
		},
	])(
		'keeps a closing tag that an HTML ignore directive targets directly in $input',
		async ({ input, output, positions, tag }) => {
			const notices = (position: string) => [
				[
					`[prettier-plugin-markdown-html] Skipped HTML formatting (${position}). No opening \`<${tag}>\` matches this \`</${tag}>\` in the same Markdown region.`,
				],
			];

			await expect(
				formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual({
				notices: notices(positions[0]!),
				output,
			});
			await expect(
				formatWithNotices(output, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual({
				notices: notices(positions[1]!),
				output,
			});
		}
	);

	test.each([
		{
			context: 'a void element',
			input: '- <!-- prettier-ignore --><img src="a"><div   >\n  x\n- y\n',
			output: '- <!-- prettier-ignore --><img src="a"><div   >\n    x\n- y\n',
			position: '1:40',
		},
		{
			context: 'an element with a closing tag',
			input: '- <!-- prettier-ignore --><b>x</b><div   >\n  x\n- y\n',
			output: '- <!-- prettier-ignore --><b>x</b><div   >\n    x\n- y\n',
			position: '1:35',
		},
	])(
		'reads an element that starts where an HTML ignore directive’s protection of $context ends as unprotected',
		async ({ input, output: expectedOutput, position }) => {
			const expectedResult = {
				notices: [
					[
						expect.stringContaining(
							`(${position}). Close \`<div>\` with \`</div>\``
						),
					],
				],
				output: expectedOutput,
			};

			const result = await formatWithNotices(input, SPEC_EXAMPLE_OPTIONS);

			expect(result).toStrictEqual(expectedResult);
			await expect(
				formatWithNotices(expectedOutput, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual(expectedResult);
		}
	);

	test('reports container elements left open whose HTML ignore directives protect only part of their region', async () => {
		const input =
			'<p   class="a">Intro</p>\n<!-- prettier-ignore -->\n<div>\n\nText\n';

		const result = await formatWithNotices(input, SPEC_EXAMPLE_OPTIONS);

		expect(result).toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (3:1). Close `<div>` with `</div>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
				],
			],
			output: input,
		});
	});

	test('keeps omitted closing tags at the end of the document for elements that Markdown ignore directives protect', async () => {
		const input = '<!-- prettier-ignore -->\n<div   >\n\nfoo\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects fragments inside elements whose opening tags range ignore directives protect', async () => {
		const input =
			'<!-- prettier-ignore-start -->\n\n<div   >\n\n<!-- prettier-ignore-end -->\n\n<p   >foo</p>\n\n</div   >\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects invalid HTML that Markdown ignore directives protect', async () => {
		const input = '<!-- prettier-ignore -->\n<div><p></div></p>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('rejects invalid HTML that range ignore directives protect', async () => {
		const input =
			'<!-- prettier-ignore-start -->\n\n<div><span></div>\n\n<!-- prettier-ignore-end -->\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
	});

	test('normalizes line endings in protected HTML', async () => {
		const input =
			'<!-- prettier-ignore -->\r\n<div   >\r\n  foo</div>\r\n\r\n<pre>\r\nbar\r\n</pre>\r\n';
		const expectedOutput =
			'<!-- prettier-ignore -->\n<div   >\n  foo</div>\n\n<pre>\nbar\n</pre>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('applies the selected line endings to protected HTML', async () => {
		const input = '<!-- prettier-ignore -->\n<div   >\n  foo</div>\n';
		const expectedOutput =
			'<!-- prettier-ignore -->\r\n<div   >\r\n  foo</div>\r\n';
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			endOfLine: 'crlf',
		} satisfies Options;

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('skips validation in files without a required pragma', async () => {
		const input = '<div><p></div></p>\n';

		await expect(
			formatWithNotices(input, {
				...SPEC_EXAMPLE_OPTIONS,
				requirePragma: true,
			})
		).resolves.toStrictEqual({ notices: [], output: input });
	});

	test('skips validation in files with an ignore pragma', async () => {
		const input = '<!-- @noformat -->\n\n<div><p></div></p>\n';

		await expect(
			formatWithNotices(input, {
				...SPEC_EXAMPLE_OPTIONS,
				checkIgnorePragma: true,
			})
		).resolves.toStrictEqual({ notices: [], output: input });
	});

	test('rejects invalid HTML in files with a required pragma', async () => {
		const input = '<!-- @format -->\n\n<div><p></div></p>\n';
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			requirePragma: true,
		} satisfies Options;

		await expect(formatWithNotices(input, options)).resolves.toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (3:15). No opening `<p>` matches this `</p>` in the same Markdown region.',
				],
			],
			output: await format(input, { ...options, plugins: [] }),
		});
	});

	test('applies pragmas to the Markdown document rather than to fragments', async () => {
		const input = 'foo\n\n<!-- @noformat --><div   id = "bar">baz</div>\n';
		const expectedOutput =
			'foo\n\n<!-- @noformat -->\n<div id="bar">baz</div>\n';
		const options = { ...SPEC_EXAMPLE_OPTIONS, checkIgnorePragma: true };

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});
});

describe('Range Formatting', () => {
	test.each(MARKDOWN_PARSER_NAMES)(
		'returns accepted input unchanged when Prettier makes no edits in the range with the `%s` parser',
		async (parser) => {
			const input = '<div   >foo</div>\n\n<div   >bar</div>\n';
			const options = {
				...SPEC_EXAMPLE_OPTIONS,
				parser,
				rangeEnd: 5,
				rangeStart: 0,
			} satisfies Options;
			const expectedOutput = await format(input, {
				...options,
				plugins: [],
			});

			const output = await format(input, options);

			expect(output).toBe(expectedOutput);
		}
	);

	test('returns input unchanged in a range when formatting the complete document would reject a region', async () => {
		const input =
			'foo\n\n<div>\n<script type="text/markdown">\n# foo\n* bar\n</script>\n</div>\n';
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			rangeEnd: 3,
			rangeStart: 0,
		} satisfies Options;
		const expectedOutput = await format(input, { ...options, plugins: [] });

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
	});

	test('returns accepted input unchanged when formatting would change protected content outside the range', async () => {
		const input =
			'foo\n\n<div><pre>\n\nfoo  bar\n\n<div></div></pre></div>\n';
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			rangeEnd: 3,
			rangeStart: 0,
		} satisfies Options;
		const expectedOutput = await format(input, { ...options, plugins: [] });

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
	});

	test('returns plain Prettier’s output for a range when invalid HTML lies outside it', async () => {
		const input = 'foo\n\n<div><p></div></p>\n\nbar\n';
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			rangeEnd: 3,
			rangeStart: 0,
		} satisfies Options;
		const expectedOutput = await format(input, {
			...options,
			plugins: [],
		});

		await expect(formatWithNotices(input, options)).resolves.toStrictEqual({
			notices: [],
			output: expectedOutput,
		});
	});

	test('returns plain Prettier’s output for a range that starts after invalid HTML', async () => {
		const input = '<div><p></div></p>\n\nfoo\n';
		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			rangeStart: 20,
		} satisfies Options;
		const expectedOutput = await format(input, {
			...options,
			plugins: [],
		});

		await expect(formatWithNotices(input, options)).resolves.toStrictEqual({
			notices: [],
			output: expectedOutput,
		});
	});
});

describe('Baseline', () => {
	test('formats raw HTML in a paragraph before a line with the syntax of a delimiter row', async () => {
		const input = 'foo <b   >bar</b>\n|---|---|\n';
		const expectedOutput = 'foo <b>bar</b>\n|---|---|\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('leaves Markdown inside a raw element to Prettier even when Prettier changes its meaning', async () => {
		const input = '<div>\n\n[^foo]:\n\n    bar  baz\n\n</div>\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [],
		});

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test.each<{
		context: string;
		input: string;
		notice: string;
		options: Options;
	}>([
		{
			context:
				'after a paragraph line that formatting turns into a fence opening',
			input: 'foo\n\t```\n\n<div   >bar</div>\n',
			notice: '(4:1). Formatting would change whether Prettier reads this as inline HTML, an HTML block, or text. Check nearby line breaks, indentation, and code fences.',
			options: SPEC_EXAMPLE_OPTIONS,
		},
		{
			context:
				'after a setext heading line that formatting turns into a fence opening',
			input: 'foo\n\t```\n---\n\n<div   >bar</div>\n',
			notice: '(5:1). Formatting would change whether Prettier reads this as inline HTML, an HTML block, or text. Check nearby line breaks, indentation, and code fences.',
			options: SPEC_EXAMPLE_OPTIONS,
		},
		{
			context:
				'after a setext heading that wrapping can turn into a fence opening',
			input: 'foo ~~~bar baz qux\n---\n\n<div   >quux</div>\n',
			notice: '(4:1). Formatting would change whether Prettier reads this as inline HTML, an HTML block, or text. Check nearby line breaks, indentation, and code fences.',
			options: {
				...SPEC_EXAMPLE_OPTIONS,
				printWidth: 8,
				proseWrap: 'always',
			},
		},
		{
			context:
				'on a paragraph line that formatting turns into a fence opening',
			input: 'foo\n    ```<span   >bar</span>\n',
			notice: '(1:1). The formatted text wouldn’t read as a single Markdown paragraph with inline HTML. Check for a tag or Markdown block marker at the start of a line.',
			options: SPEC_EXAMPLE_OPTIONS,
		},
		{
			context: 'that wrapping moves into a fence',
			input: 'foo\n```bar `baz`\n<span   >qux</span>\n',
			notice: '(1:1). The formatted text wouldn’t read as a single Markdown paragraph with inline HTML. Check for a tag or Markdown block marker at the start of a line.',
			options: {
				...SPEC_EXAMPLE_OPTIONS,
				printWidth: 8,
				proseWrap: 'always',
			},
		},
		{
			context:
				'with `proseWrap` set to `always` after tildes in the visible text of a reference link',
			input: 'foo [bar ~~~ baz][qux]\n\n<b>quux</b>\n\n[qux]: /corge\n',
			notice: '(3:1). Formatting would change whether Prettier reads this as inline HTML, an HTML block, or text. Check nearby line breaks, indentation, and code fences.',
			options: {
				...SPEC_EXAMPLE_OPTIONS,
				printWidth: 1,
				proseWrap: 'always',
			},
		},
	])('rejects raw HTML $context', async ({ input, notice, options }) => {
		const expectedOutput = await format(input, { ...options, plugins: [] });

		// Plain Prettier changes this output again on a second pass
		await expect(formatWithNotices(input, options)).resolves.toStrictEqual({
			notices: [
				[
					`[prettier-plugin-markdown-html] Skipped HTML formatting ${notice}`,
				],
			],
			output: expectedOutput,
		});
	});
});

describe('Supported Syntax', () => {
	test.each([
		{
			construct: 'declarations',
			input: '<!DOCTYPE html>\n\n<p   align="center">Docs</p>\n',
			notice: '(1:1). This region contains a markup declaration, which the plugin doesn’t support.',
			output: '<!DOCTYPE html>\n\n<p align="center">Docs</p>\n',
		},
		{
			construct: 'processing instructions',
			input: '<?xml version="1.0" encoding="UTF-8"?>\n\n<p   align="center">Docs</p>\n',
			notice: '(1:1). This region contains a processing instruction, which the plugin doesn’t support.',
			output: '<?xml version="1.0" encoding="UTF-8"?>\n\n<p align="center">Docs</p>\n',
		},
		{
			construct: 'CDATA sections',
			input: '<div   class="note"><![CDATA[ x < y ]]></div>\n\n<p   align="center">Docs</p>\n',
			notice: '(1:21). This region contains a CDATA section, which the plugin doesn’t support.',
			output: '<div   class="note"><![CDATA[ x < y ]]></div>\n\n<p align="center">Docs</p>\n',
		},
		{
			construct: 'inline SVG',
			input: 'Click <svg   width="16" height="16"><use href="#gear"/></svg> to open <b   >Settings</b>.\n',
			notice: '(1:7). To format this inline `<svg>`, put the whole element in one HTML block.',
			output: 'Click <svg   width="16" height="16"><use href="#gear"/></svg> to open <b   >Settings</b>.\n',
		},
		{
			construct: 'inline MathML',
			input: 'The area is <math   ><mi>r</mi></math> squared.\n',
			notice: '(1:13). To format this inline `<math>`, put the whole element in one HTML block.',
			output: 'The area is <math   ><mi>r</mi></math> squared.\n',
		},
		{
			construct: 'a foreign element that extends beyond its HTML block',
			input: '<svg   viewBox="0 0 16 16">\n<path d="M8 0"/>\n\n</svg>\n',
			notice: '(1:1). Close `<svg>` with `</svg>` in the same HTML block, before any enclosing element closes.',
			output: '<svg   viewBox="0 0 16 16">\n<path d="M8 0"/>\n\n</svg>\n',
		},
		{
			construct: 'a table cell whose raw HTML contains an escaped pipe',
			input: '| Key | Action |\n| --- | --- |\n| <kbd   title="Pipe \\| key">\\|</kbd> | Splits cells |\n',
			notice: '(3:3). The raw HTML in this table cell contains an escaped pipe (`\\|`).',
			output: '| Key                                 | Action       |\n| ----------------------------------- | ------------ |\n| <kbd   title="Pipe \\| key">\\|</kbd> | Splits cells |\n',
		},
	])(
		'rejects $construct',
		async ({ input, notice, output: expectedOutput }) => {
			await expect(
				formatWithNotices(input, SPEC_EXAMPLE_OPTIONS)
			).resolves.toStrictEqual({
				notices: [
					[
						`[prettier-plugin-markdown-html] Skipped HTML formatting ${notice}`,
					],
				],
				output: expectedOutput,
			});
			await expect(
				format(expectedOutput, SPEC_EXAMPLE_OPTIONS)
			).resolves.toBe(expectedOutput);
		}
	);

	test('rejects regions whose HTML Prettier fails to parse', async () => {
		const pluginThrowingHTML = {
			parsers: {
				html: {
					astFormat: 'html',
					locEnd: () => 0,
					locStart: () => 0,
					parse: () => {
						throw new Error('foo');
					},
				},
			},
		} satisfies Plugin;
		const input =
			'<div   >bar</div>\n\nSee the <a   href="#usage">usage</a>.\n';
		const expectedOutput = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			plugins: [pluginThrowingHTML],
		});

		await expect(
			formatWithNotices(input, {
				...SPEC_EXAMPLE_OPTIONS,
				plugins: [pluginMarkdownHTML, pluginThrowingHTML],
			})
		).resolves.toStrictEqual({
			notices: [
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (1:1). Prettier can’t format this HTML:\n\nfoo',
				],
				[
					'[prettier-plugin-markdown-html] Skipped HTML formatting (3:9). Prettier can’t format this HTML:\n\nfoo',
				],
			],
			output: expectedOutput,
		});
	});
});

describe('Stability', () => {
	test('formats documents without depending on earlier calls', async () => {
		const input = '- <div   >foo\n  <p   >bar</p></div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);
		await format('> <span   >baz</span>\n', {
			...SPEC_EXAMPLE_OPTIONS,
			parser: 'remark',
			tabWidth: 2,
			useTabs: true,
		});

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(output);
	});
});

describe('Output', () => {
	test('adds a final newline after HTML', async () => {
		const input = '<div   >foo</div>';
		const expectedOutput = '<div>foo</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('removes blank lines at the end of the document after HTML', async () => {
		const input = '<div   >foo</div>\n\n\n\n';
		const expectedOutput = '<div>foo</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('removes blank lines at the end of the document after HTML in list items', async () => {
		const input = '- <div   >foo\n  </div>\n\n\n';
		const expectedOutput = '- <div>foo</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps text that looks like internal markers', async () => {
		const input =
			'<div data-prettier-markdown-html-1>\n\nfoo\n\n<p   >bar</p>\n\n</div>\n';
		const expectedOutput =
			'<div data-prettier-markdown-html-1>\n\nfoo\n\n<p>bar</p>\n\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});
});

describe('Errors', () => {
	test('reports Markdown parsers whose syntax trees the plugin can’t format', async () => {
		const priorPlugin: Plugin = {
			parsers: {
				markdown: {
					...pluginMarkdownHTML.parsers!.markdown!,
					astFormat: 'foo',
				},
			},
		};

		await expect(
			format('foo\n', {
				...SPEC_EXAMPLE_OPTIONS,
				filepath: 'docs/foo.md',
				plugins: [priorPlugin, pluginMarkdownHTML],
			})
		).rejects.toThrowErrorMatchingInlineSnapshot(
			`[TypeError: [prettier-plugin-markdown-html] Unsupported AST format for the \`markdown\` parser. Expected \`mdast\`, received \`foo\`]`
		);
	});

	test('keeps the underlying error and the Markdown position in debug mode', async () => {
		vi.stubEnv('PRETTIER_DEBUG', '1');
		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		let result: unknown;

		try {
			await format('---\na: b\n---\n\n<p><div></div></p>\n', {
				...SPEC_EXAMPLE_OPTIONS,
			});
		} catch (error: unknown) {
			result = error;
		}

		expect(result).toBeInstanceOf(Error);
		expect((result as Error).cause).toBeInstanceOf(SyntaxError);
		expect((result as { loc?: unknown }).loc).toStrictEqual({
			start: { column: 15, line: 5 },
		});
	});
});
