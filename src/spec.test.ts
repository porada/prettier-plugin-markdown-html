import type { Options, Plugin } from 'prettier';
import { format } from 'prettier';
import { parsers as markdownParsers } from 'prettier/plugins/markdown';
import { describe, expect, test } from 'vite-plus/test';
import * as pluginMarkdownHTML from './index.ts';

const SPEC_EXAMPLE_OPTIONS = {
	parser: 'markdown',
	plugins: [pluginMarkdownHTML],
	printWidth: 80,
	tabWidth: 4,
} satisfies Options;

// Prettier adds code frames to parse error messages when a location is
// available, using ANSI colors when supported
async function getUncoloredErrorMessage(
	promise: Promise<unknown>
): Promise<string> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof Error) {
			/* oxlint-disable-next-line eslint/no-control-regex */
			return error.message.replaceAll(/\u001B\[[\d;]*m/g, '');
		}

		throw error;
	}

	throw new Error('Expected the promise to reject');
}

describe('Formatting Scope', () => {
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
});

describe('Parser Disagreement', () => {
	test('rejects raw HTML that only the reference renderer reads in math', async () => {
		await expect(format('$$\n<span>\n$$\n', SPEC_EXAMPLE_OPTIONS)).rejects
			.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown recognizes raw HTML within it]
		`);
	});

	test('leaves math with text that resembles HTML to Prettier', async () => {
		const input = '$$\n<!doctype html>\n$$\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(
			await format(input, { ...SPEC_EXAMPLE_OPTIONS, plugins: [] })
		);
	});

	test('rejects raw HTML that only the reference renderer reads in frontmatter', async () => {
		await expect(
			format('---\ntitle: <b>foo</b>\n---\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as frontmatter, but GitHub Flavored Markdown recognizes raw HTML within it]
		`);
	});

	test('follows Prettier’s formatting of frontmatter', async () => {
		const input = "---\ntitle: 'foo'\n---\n\nbar\n";

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

	test('rejects raw HTML after frontmatter that leaves a backtick fence open', async () => {
		await expect(
			format(
				'---\nfoo: |\n  ```\n---\n\n<div   >bar</div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as frontmatter, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('rejects raw HTML after math that leaves a tilde fence open', async () => {
		await expect(
			format('$$\n~~~\n$$\n\n<div   >foo</div>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('rejects raw HTML after math that leaves a fence open in a block quote', async () => {
		await expect(
			format(
				'> $$\n> ```\n> $$\n>\n> <div   >foo</div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:3):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('rejects raw HTML after math whose fence stays open in a list item', async () => {
		await expect(
			format(
				'$$\n- ```\n  $$\n  <div   >foo</div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('rejects raw HTML after math whose fence reopens after a list item', async () => {
		await expect(
			format(
				'$$\n- ```\n  ```\n```\n$$\n\n<div   >foo</div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('rejects raw HTML after math that leaves a fence with a code span open', async () => {
		await expect(
			format(
				'$$\n```\n`foo`\n$$\n\n<div   >bar</div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('rejects raw HTML after math that leaves a fence open in text that only Prettier reads as HTML', async () => {
		await expect(
			format(
				'$$\n<!foo\n```\n>\n$$\n\n<div   >bar</div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('rejects raw HTML after frontmatter that leaves a fence open in text that only Prettier reads as HTML', async () => {
		await expect(
			format(
				'---\nfoo: |\n  <!bar\n  ```\n  >\n---\n\n<div   >baz</div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as frontmatter, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('rejects raw HTML after frontmatter whose formatting leaves a fence open in text that only Prettier reads as HTML', async () => {
		await expect(
			format(
				'---\nfoo: |\n    <!bar\n    ```\n    >\n---\n\n<div   >baz</div>\n',
				{ ...SPEC_EXAMPLE_OPTIONS, tabWidth: 2 }
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Formatting this frontmatter can leave a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('formats raw HTML after math that closes a fence in text that only Prettier reads as HTML', async () => {
		const input = '$$\n<!foo\n```\n```\n>\n$$\n\n<div   >bar</div>\n';
		const expectedOutput = '$$\n<!foo\n```\n```\n>\n$$\n\n<div>bar</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects raw HTML after inline math whose line opens a fence when wrapped', async () => {
		await expect(
			format('foo $$bar\n```$$ `baz`\n<span   >qux</span>\n', {
				...SPEC_EXAMPLE_OPTIONS,
				printWidth: 10,
				proseWrap: 'always',
			})
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:5):

			Formatting this math can leave a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('rejects raw HTML after inline math whose line opens a fence when its list item is reindented', async () => {
		await expect(
			format(
				'- foo\n  - bar $$baz\n        ```$$\n    <span   >qux</span>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (2:9):

			Formatting this math can leave a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('formats raw HTML after inline math whose line can’t open a fence', async () => {
		const input = 'foo $$bar\n```$$ `baz`\n<span   >qux</span>\n';
		const expectedOutput = 'foo $$bar\n```$$ `baz`\n<span>qux</span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects raw HTML after math that leaves a fence open even past a later closing fence', async () => {
		await expect(
			format(
				'$$\n```\n$$\n```\n\n<div   >foo</div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('rejects literal HTML syntax after math that leaves a fence open', async () => {
		await expect(
			format('$$\n```\n$$\n\nfoo `<b>` bar\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('rejects an unfinished HTML block start in a later list item after math that leaves a fence open', async () => {
		await expect(format('$$\n```\n$$\n\n- <div\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('rejects an unfinished HTML block start in a later list item in a block quote after math that leaves a fence open', async () => {
		await expect(format('$$\n```\n$$\n\n> 1. <div\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('rejects a later tag across block quote lines after math that leaves a fence open', async () => {
		await expect(
			format(
				'$$\n```\n$$\n\n> foo <img alt=\n> "bar"> baz\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('rejects raw HTML after unclosed math that leaves a fence open in a list item', async () => {
		await expect(
			format('- $$\n  ```\n\n<div   >foo</div>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:3):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('formats raw HTML after unclosed math whose fence closes at the end of a list item', async () => {
		const input = '- $$\n  ```\n  ```\n\n<div   >foo</div>\n';
		const expectedOutput = '- $$\n  ```\n  ```\n  $$\n\n<div>foo</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects raw HTML after unclosed math that leaves a fence open in a block quote in a list item', async () => {
		await expect(
			format('- $$\n  > ```\n\n<div   >foo</div>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:3):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('formats raw HTML after unclosed math whose fence closes in a block quote in a list item', async () => {
		const input = '- $$\n  > ```\n  > ```\n\n<div   >foo</div>\n';
		const expectedOutput =
			'- $$\n  > ```\n  > ```\n  $$\n\n<div>foo</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('formats raw HTML after unclosed math whose fence closes at the end of a block quote', async () => {
		const input = '> $$\n> ```\n> ```\n\n<div   >foo</div>\n';
		const expectedOutput = '> $$\n> ```\n> ```\n> $$\n\n<div>foo</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects raw HTML after frontmatter that leaves a fence open after math syntax', async () => {
		await expect(
			format(
				'---\nfoo: |\n  $$\n  ```\n---\n\n<div   >bar</div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as frontmatter, but GitHub Flavored Markdown leaves a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('formats raw HTML after frontmatter that closes a fence after math syntax', async () => {
		const input =
			'---\nfoo: |\n  $$\n  ```\n  $$\n  ```\n---\n\n<div   >bar</div>\n';
		const expectedOutput =
			'---\nfoo: |\n    $$\n    ```\n    $$\n    ```\n---\n\n<div>bar</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects raw HTML after frontmatter whose formatting leaves a fence open after math syntax', async () => {
		await expect(
			format(
				'---\nfoo: |\n    $$\n    ```\n    $$\n---\n\n<div   >bar</div>\n',
				{
					...SPEC_EXAMPLE_OPTIONS,
					tabWidth: 2,
				}
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Formatting this frontmatter can leave a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('rejects raw HTML after frontmatter whose formatting leaves a fence open', async () => {
		await expect(
			format('---\nfoo: |\n    ```\n---\n\n<div   >bar</div>\n', {
				...SPEC_EXAMPLE_OPTIONS,
				tabWidth: 2,
			})
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Formatting this frontmatter can leave a code fence in it open, so later raw HTML can render as code]
		`);
	});

	test('formats raw HTML after frontmatter with four-space fence indentation', async () => {
		const input = '---\nfoo: |\n    ```\n---\n\n<div   >bar</div>\n';
		const expectedOutput = '---\nfoo: |\n    ```\n---\n\n<div>bar</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('formats raw HTML after math that closes its fence', async () => {
		const input = '$$\n```\n```\n$$\n\n<div   >foo</div>\n';
		const expectedOutput = '$$\n```\n```\n$$\n\n<div>foo</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('follows Prettier’s formatting of frontmatter that leaves a fence open without later raw HTML', async () => {
		const input = '---\nfoo: |\n  ```\n---\n\nbar\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(
			await format(input, { ...SPEC_EXAMPLE_OPTIONS, plugins: [] })
		);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('formats raw HTML after frontmatter whose fence closes with its list item', async () => {
		const input = '---\n- |\n  ```js\n---\n\n<div   >bar</div>\n';
		const expectedOutput = '---\n- |\n    ```js\n---\n\n<div>bar</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps inline syntax specific to Prettier in its paragraph', async () => {
		const input = 'foo [[bar]] {% baz %}\n\n<div   ></div>\n';
		const expectedOutput = 'foo [[bar]] {% baz %}\n\n<div></div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects raw HTML that only the reference renderer reads in inline math', async () => {
		await expect(format('foo $$<b>bar</b>$$ baz\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:5):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown recognizes raw HTML within it]
		`);
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

	test('rejects raw HTML that only the reference renderer reads in Liquid tags', async () => {
		await expect(format('{% <b>foo</b> %}\n', SPEC_EXAMPLE_OPTIONS)).rejects
			.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as a Liquid tag, but GitHub Flavored Markdown recognizes raw HTML within it]
		`);
	});

	test('rejects raw HTML that only the reference renderer reads in wiki links', async () => {
		await expect(format('[[<b>foo</b>]]\n', SPEC_EXAMPLE_OPTIONS)).rejects
			.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as a wiki link, but GitHub Flavored Markdown recognizes raw HTML within it]
		`);
	});

	test('keeps indented markup after apparent footnote definitions as literal code', async () => {
		const input = `[^foo]: bar

    <div title = "baz">qux</div>
`;

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('formats raw HTML in apparent footnote definitions that read as paragraphs', async () => {
		const input = '<div></div>\n\n[^foo]: bar <b   >baz</b>\n';
		const expectedOutput = '<div></div>\n\n[^foo]: bar <b>baz</b>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects raw HTML that ends a paragraph in an apparent footnote definition', async () => {
		await expect(format('[^foo]: bar </p><p>baz\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (1:1):

			A closing tag in raw HTML ends this paragraph before its Markdown content ends]
		`);
	});

	test('rejects HTML blocks that only the reference renderer starts in apparent footnote definitions', async () => {
		await expect(format('[^foo]: bar\n<source>\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as a footnote definition, but GitHub Flavored Markdown recognizes raw HTML within it]
		`);
	});

	test('follows Prettier’s formatting of apparent footnote definitions without raw HTML', async () => {
		const input = '[^foo]:\n\n    bar  baz\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(
			await format(input, { ...SPEC_EXAMPLE_OPTIONS, plugins: [] })
		);
	});

	test('follows Prettier’s formatting of literal code in apparent footnote definitions with raw HTML', async () => {
		const input = '[^foo]: bar <b   >baz</b>\n\n    qux  quux\n';
		const expectedOutput = '[^foo]: bar <b>baz</b>\n\n    qux quux\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('follows Prettier’s formatting of literal code in apparent footnote definitions with comments', async () => {
		const input = '[^foo]: bar <!-- baz -->\n\n    qux  quux\n';
		const expectedOutput = '[^foo]: bar <!-- baz -->\n\n    qux quux\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects footnote formatting that moves raw HTML into code', async () => {
		await expect(
			format(
				'[^foo]: bar <b>baz</b>\n    - <i>qux</i>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			Formatting this footnote definition would change how GitHub Flavored Markdown renders the raw HTML in it]
		`);
	});

	test('rejects footnote formatting that moves raw HTML into code in a block quote', async () => {
		await expect(
			format(
				'> [^foo]: bar <b>baz</b>\n>     - <i>qux</i>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:3):

			Formatting this footnote definition would change how GitHub Flavored Markdown renders the raw HTML in it]
		`);
	});

	test('rejects footnote formatting that moves raw HTML into code after tabs', async () => {
		await expect(
			format(
				'- [^foo]: bar <b>baz</b>\n\t  - <i>qux</i>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:3):

			Formatting this footnote definition would change how GitHub Flavored Markdown renders the raw HTML in it]
		`);
	});

	test('rejects footnote formatting that moves raw HTML into code in a block quote inside a list', async () => {
		await expect(
			format(
				'- > [^foo]: bar <b>baz</b>\n  >     - <i>qux</i>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:5):

			Formatting this footnote definition would change how GitHub Flavored Markdown renders the raw HTML in it]
		`);
	});

	test('rejects footnote formatting that turns code into raw HTML', async () => {
		await expect(
			format(
				'[^foo]:\n\n    x <div>\n\n<b   >y</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			Formatting this footnote definition would change how GitHub Flavored Markdown renders the raw HTML in it]
		`);
	});

	test('rejects footnote formatting that turns code into raw HTML in documents without raw HTML', async () => {
		await expect(
			format('[^foo]:\n\n    bar <b   >baz</b>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			Formatting this footnote definition would change how GitHub Flavored Markdown renders the raw HTML in it]
		`);
	});

	test('keeps ignored apparent footnote definitions unchanged', async () => {
		const input =
			'<!-- prettier-ignore -->\n\n[^foo]: bar\n\n    baz  qux\n';
		const expectedOutput =
			'<!-- prettier-ignore -->\n[^foo]: bar\n\n    baz  qux\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps HTML in task list items of apparent footnote definitions as literal code', async () => {
		const input =
			'[^foo]: bar\n\n    - [ ] baz\n\n      <div>\n      <p>qux</p>\n      </div>\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('leaves inline declarations that GFM reads as text to Prettier', async () => {
		const input = 'foo <!DOCTYPE> bar\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(
			await format(input, { ...SPEC_EXAMPLE_OPTIONS, plugins: [] })
		);
	});

	test('leaves inline declarations with whitespace that GFM doesn’t accept to Prettier', async () => {
		const input = 'foo <!DOCTYPE\u00A0HTML> bar\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(
			await format(input, { ...SPEC_EXAMPLE_OPTIONS, plugins: [] })
		);
	});

	test('rejects inline declarations that GFM reads as text around raw HTML', async () => {
		await expect(
			format(
				'foo <!doctype <pre>\n\nbar    <b   >baz</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:5):

			Prettier’s Markdown parser reads this as a declaration, but GitHub Flavored Markdown reads it as text with raw HTML inside]
		`);
	});

	test('leaves declarations that only Prettier reads as HTML blocks to Prettier', async () => {
		const input = '<div   ></div>\n\n<!doctype   html>\n';
		const expectedOutput = '<div></div>\n\n<!doctype   html>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('leaves text that only Prettier reads as HTML in paragraphs without raw HTML to Prettier', async () => {
		const input = 'foo\n<!doctype html>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(
			await format(input, { ...SPEC_EXAMPLE_OPTIONS, plugins: [] })
		);
	});

	test('leaves text on several lines that only Prettier reads as HTML to Prettier', async () => {
		const input = '<!doctype\nhtml>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(
			await format(input, { ...SPEC_EXAMPLE_OPTIONS, plugins: [] })
		);
	});

	test('rejects HTML blocks that only Prettier reads around raw HTML', async () => {
		await expect(
			format('<!doctype html> <b>foo</b>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML when GFM continues its paragraph', async () => {
		await expect(
			format('<!doctype html>\n<b   >foo</b>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML when GFM continues a paragraph into it', async () => {
		await expect(
			format('- <b>foo</b>\n<!doctype html>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (2:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML before lines that start HTML blocks', async () => {
		await expect(
			format(
				'<!doctype\n<pre "x"\n>\n\nfoo    <b   >bar</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML before lines that start Markdown blocks', async () => {
		await expect(
			format('<!doctype\n```\n>\n\n<b   >x</b>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML before lazy continuation lines', async () => {
		await expect(
			format('- <!doctype html>\nfoo <b   >x</b>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:3):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML before lines with only nonbreaking spaces', async () => {
		await expect(
			format(
				'- <!doctype html>\n\u00A0\nfoo <b   >bar</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:3):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML before lines with only form feeds', async () => {
		await expect(
			format(
				'- <!doctype html>\n\f\nfoo <b   >bar</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:3):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML before indented quote markers', async () => {
		await expect(
			format(
				'<!doctype html>\n    >\n<b   >x</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('leaves text that only Prettier reads as HTML before quote markers in list items to Prettier', async () => {
		const input = '- <!doctype html>\n    >\n    <b   >x</b>\n';
		const expectedOutput = '- <!doctype html>\n    >\n    <b>x</b>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('leaves text that only Prettier reads as HTML before quote markers in lists in block quotes to Prettier', async () => {
		const input = '> - <!doctype html>\n>   >\n>   <b   >x</b>\n';
		const expectedOutput = '> - <!doctype html>\n>     >\n>     <b>x</b>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('leaves text that only Prettier reads as HTML before empty quote markers in nested block quotes to Prettier', async () => {
		const input = '> > <!doctype html>\n>\n> <b>x</b>\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('leaves text that only Prettier reads as HTML before unindented quote markers in list items to Prettier', async () => {
		const input = '- <!doctype html>\n>\n<b   >x</b>\n';
		const expectedOutput = '- <!doctype html>\n\n>\n\n<b>x</b>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('leaves text that only Prettier reads as HTML before underindented quote markers in list items to Prettier', async () => {
		const input = '123. <!doctype html>\n   >\n<b   >x</b>\n';
		const expectedOutput = '123. <!doctype html>\n\n>\n\n<b>x</b>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('leaves text that only Prettier reads as HTML before padded blank lines in lists in block quotes to Prettier', async () => {
		const input = '> - <!doctype html>\n>   \n>   <b   >x</b>\n';
		const expectedOutput = '> - <!doctype html>\n>\n>     <b>x</b>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects text that only Prettier reads as HTML before quote markers that continue lazily', async () => {
		await expect(
			format(
				'> <!doctype html>\n    >\n> <b   >x</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:3):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML before quote markers that continue lazily in lists', async () => {
		await expect(
			format(
				'> - <!doctype html>\n     >\n>   <b   >x</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:5):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML before quote markers with too little list indentation', async () => {
		await expect(
			format(
				'123. <!doctype html>\n    >\n<b   >x</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:6):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML inside raw HTML elements', async () => {
		await expect(
			format(
				'<div>\n\n<!doctype html>\nfoo\n\n</div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (3:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML inside comments', async () => {
		await expect(
			format(
				'<div></div>\n<!-- c\n\n<!doctype html>\nfoo\n\n<div>-->\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (4:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('leaves text that only Prettier reads as HTML between blank lines inside raw HTML elements to Prettier', async () => {
		const input = '<div>\n\n<!doctype html>\n\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(
			await format(input, { ...SPEC_EXAMPLE_OPTIONS, plugins: [] })
		);
	});

	test('rejects text that only Prettier reads as HTML next to tags on several lines', async () => {
		await expect(
			format(
				'<!doctype html>\nfoo <img\nsrc="x">\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML beside HTML-like text in code spans', async () => {
		await expect(
			format(
				'<!doctype html>\n`<span>foo</span>`\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects HTML blocks that only Prettier lets interrupt a paragraph', async () => {
		await expect(
			format('foo\n<search>\nbar\n</search>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (2:1):

			Prettier’s Markdown parser starts an HTML block here, but GitHub Flavored Markdown continues the paragraph above]
		`);
	});

	test('formats raw HTML after text on several lines that only Prettier reads as HTML', async () => {
		const input = '<!doctype\nhtml>\n\nfoo <b   >bar</b>\n';
		const expectedOutput = '<!doctype\nhtml>\n\nfoo <b>bar</b>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('formats raw HTML after text on several lines that only Prettier reads as HTML in block quotes', async () => {
		const input = '> <!doctype\n> html>\n\nfoo <b   >bar</b>\n';
		const expectedOutput = '> <!doctype\n> html>\n\nfoo <b>bar</b>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('formats raw HTML in later list items after text on several lines that only Prettier reads as HTML', async () => {
		const input = '- <!doctype\n  html>\n\n- foo <b   >bar</b>\n';
		const expectedOutput = '- <!doctype\n  html>\n\n- foo <b>bar</b>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('formats raw HTML after text on several lines that only Prettier reads as HTML with fences that close inside it', async () => {
		const input = '<!doctype\n```\n```\nhtml>\n\nfoo <b   >bar</b>\n';
		const expectedOutput = '<!doctype\n```\n```\nhtml>\n\nfoo <b>bar</b>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('formats raw HTML after text on several lines that only Prettier reads as HTML with list markers inside fences that close inside it', async () => {
		const input =
			'<!doctype\n```\n- foo\n```\nhtml>\n\nbar <b   >baz</b>\n';
		const expectedOutput =
			'<!doctype\n```\n- foo\n```\nhtml>\n\nbar <b>baz</b>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects text on several lines that only Prettier reads as HTML when GFM continues its paragraph into raw HTML', async () => {
		await expect(
			format('<!doctype\nhtml>\nfoo <b>bar</b>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text on several lines that only Prettier reads as HTML when a fence it opens reaches raw HTML', async () => {
		await expect(
			format(
				'<!doctype\n```\nhtml>\n\n<b>foo</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text on several lines that only Prettier reads as HTML when a fence it opens closes before raw HTML', async () => {
		await expect(
			format(
				'<!doctype\n```\nhtml>\n\n```\n\n<b>foo</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text on several lines that only Prettier reads as HTML when a later line starts with a block quote marker', async () => {
		await expect(
			format('<!doctype\n> foo\n\n<b>bar</b>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text on several lines that only Prettier reads as HTML when a list item it starts reaches raw HTML', async () => {
		await expect(
			format(
				'<!doctype\n- foo\nhtml>\n\n  <b   >bar</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text on several lines that only Prettier reads as HTML when an ordered list item it starts reaches raw HTML', async () => {
		await expect(
			format(
				'<!doctype\n1. foo\nhtml>\n\n   <b   >bar</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text on several lines that only Prettier reads as HTML when a tilde fence it opens reaches raw HTML', async () => {
		await expect(
			format(
				'<!doctype\n~~~\nhtml>\n\n<b>foo</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text on several lines that only Prettier reads as HTML when a fence it opens follows a line with a backtick in its info string', async () => {
		await expect(
			format(
				'<!doctype\n```foo`bar\n```\nhtml>\n\nbaz <b   >qux</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
		await expect(
			format(
				'<!doctype\n```foo\u2028`bar\n```\nhtml>\n\nbaz <b   >qux</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text on several lines that only Prettier reads as HTML between blank lines inside raw HTML elements', async () => {
		await expect(
			format(
				'<div>\n\n<!doctype\nhtml>\n\n</div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (3:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML when it continues a list item that reaches raw HTML', async () => {
		await expect(
			format(
				'- foo\n<!doctype html>\n\n  <b   >bar</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (2:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text on several lines that only Prettier reads as HTML when it continues a list item that reaches raw HTML', async () => {
		await expect(
			format(
				'- foo\n<!doctype\nhtml>\n\n  <b   >bar</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (2:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text on several lines that only Prettier reads as HTML when it continues a block quote that reaches raw HTML', async () => {
		await expect(
			format(
				'> foo\n<!doctype\nhtml>\n>\n> <b   >bar</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (2:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML when it continues a list item in a block quote that reaches raw HTML', async () => {
		await expect(
			format(
				'> - foo\n> <!doctype html>\n>\n>   <b   >bar</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (2:3):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML when it continues a list item ending with such text and reaches raw HTML', async () => {
		await expect(
			format(
				'- <!doctype html>\n<!doctype html>\n\n  <b   >foo</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (2:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML when it continues a list item ending with a link reference definition and reaches raw HTML', async () => {
		await expect(
			format(
				'- [foo]: bar\n<!doctype html>\n\n  <b   >baz</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (2:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('rejects text that only Prettier reads as HTML directly after a list item ending with a fence when later lines contain raw HTML', async () => {
		await expect(
			format(
				'- ```\n  foo\n  ```\n<!doctype html>\n\n  <b   >bar</b>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (4:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
	});

	test('formats raw HTML after text that only Prettier reads as HTML when a blank line separates it from a preceding list item', async () => {
		const input = '- foo\n\n<!doctype html>\n\n  <b   >bar</b>\n';
		const expectedOutput = '- foo\n\n<!doctype html>\n\n<b>bar</b>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});
});

describe('HTML in Document Context', () => {
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
		const input = `<div>

> foo

</div>
`;

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('rejects raw elements left open at the end of a paragraph', async () => {
		await expect(format('foo <span>bar\n', SPEC_EXAMPLE_OPTIONS)).rejects
			.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (1:5):

			This \`<span>\` element is still open when the surrounding paragraph ends]
		`);
	});

	test('rejects raw elements left open at the end of a block quote', async () => {
		await expect(format('> <div>\n> foo\n', SPEC_EXAMPLE_OPTIONS)).rejects
			.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (1:3):

			This \`<div>\` element is still open when the surrounding block quote ends]
		`);
	});

	test('rejects block elements inside paragraphs', async () => {
		await expect(format('foo <div>bar</div> baz\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (1:5):

			This \`<div>\` element can’t be inside a paragraph, so it ends the paragraph before its Markdown content ends]
		`);
	});

	test('rejects raw paragraph elements around Markdown paragraphs', async () => {
		await expect(format('<p>\n\nfoo\n\n</p>\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (3:1):

			The HTML generated for this paragraph can’t be inside a \`<p>\` element, so it closes that element before its \`</p>\` tag]
		`);
	});

	test('rejects raw closing tags inside paragraphs generated from Markdown', async () => {
		await expect(
			format(
				'<div><a href="foo">\n\nbar\n\n</a></div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (5:1):

			This \`</a>\` tag is inside a paragraph, so it can’t close the \`<a>\` element outside it. GitHub Flavored Markdown reads this line as a paragraph because more content follows \`</a>\` on the same line]
		`);
	});

	test('rejects block quote prefixes that misplace raw closing tags', async () => {
		await expect(format('> <div>\n><span></div>\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (2:8):

			This \`</div>\` tag doesn’t match the \`<span>\` element that is still open]
		`);
	});

	test('rejects raw closing tags inside emphasis generated from Markdown', async () => {
		await expect(
			format('<div><b>\n\n*foo </b>*\n\n</div>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (3:6):

			This \`</b>\` tag is inside emphasized text, so it can’t close the \`<b>\` element outside it]
		`);
	});

	test('keeps lists with raw HTML loose when Prettier’s parser misses their blank lines', async () => {
		const input = '> - foo\n>   - <!--   bar   -->\n>\n> - baz\n';
		const expectedOutput =
			'> - foo\n>     - <!--   bar   -->\n>\n> - baz\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps lists with raw HTML tight after thematic breaks', async () => {
		const input = '- foo <div>bar</div>\n  ***\n\n- baz\n';
		const expectedOutput = '- foo <div>bar</div>\n    ***\n- baz\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('accepts block tags in tight lists after link reference definitions', async () => {
		const input = '- [foo]: bar\n\n  baz <div>qux</div>\n- quux\n';
		const expectedOutput = '- [foo]: bar\n    baz <div>qux</div>\n- quux\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects tight layouts that turn paragraphs into link titles', async () => {
		await expect(
			format(
				'- [foo]: bar\n\n  "baz"\n- <span>qux</span>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (3:3):

			Formatting would remove the blank line before this paragraph, which GitHub Flavored Markdown could then read as the preceding link reference definition’s title]
		`);
	});

	test('rejects tight layouts that turn headings into link titles', async () => {
		await expect(
			format(
				'- [foo]: bar\n\n  "baz"\n  ===\n- <span>qux</span>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (3:3):

			Formatting would remove the blank line before this heading, which GitHub Flavored Markdown could then read as the preceding link reference definition’s title]
		`);
	});

	test('rejects block tags in paragraphs of loose lists in block quotes', async () => {
		await expect(
			format(
				'> - foo <div>bar</div>\n>   - baz\n>\n> - qux\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (1:9):

			This \`<div>\` element can’t be inside a paragraph, so it ends the paragraph before its Markdown content ends]
		`);
	});

	test('rejects block tags in paragraphs of lists that open blocks make loose', async () => {
		await expect(
			format('- <?foo >\n\n- bar <p>baz</p>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (3:7):

			This \`<p>\` element can’t be inside a paragraph, so it ends the paragraph before its Markdown content ends]
		`);
	});

	test('formats HTML blocks inside elements that inline HTML opens in tight list items', async () => {
		const input = '- foo <span>\n  <div   >bar</div>\n  </span>\n- baz\n';
		const expectedOutput =
			'- foo <span>\n  <div>bar</div>\n  </span>\n- baz\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('opens each element that inline HTML leaves open before an HTML block', async () => {
		const input =
			'- foo <span>\n  <!-- bar --></span>\n  baz <b>\n  <div   >qux</div>\n  </b>\n';
		const expectedOutput =
			'- foo <span>\n  <!-- bar --></span>\n    baz <b>\n  <div>qux</div>\n  </b>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('opens elements with uppercase names that inline HTML leaves open', async () => {
		const input = '- foo <SPAN>\n  <div   >bar</div>\n  </SPAN>\n';
		const expectedOutput = '- foo <span>\n  <div>bar</div>\n  </span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('closes elements that Markdown closes between HTML blocks', async () => {
		const input =
			'- <span>foo\n  <!-- bar -->\n  </span><b>baz\n  <div   >qux</div>\n  </b>\n';
		const expectedOutput =
			'- <span>foo\n  <!-- bar -->\n    </span><b>baz\n  <div>qux</div>\n  </b>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('closes elements that an HTML block closes implicitly only once', async () => {
		const input =
			'- foo <p>bar\n  <!-- baz --><div   >qux</div>\n  <!-- quux -->\n';
		const expectedOutput =
			'- foo <p>bar\n  <!-- baz -->\n  </p>\n  <div>qux</div>\n  <!-- quux -->\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('closes elements that an end tag closes implicitly only once', async () => {
		const input =
			'- foo <ul><li>bar\n  <!-- baz --></ul>\n  qux\n  <!-- quux -->\n';
		const expectedOutput =
			'- foo <ul><li>bar\n  <!-- baz --> </li> </ul>\n    qux\n  <!-- quux -->\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('closes elements that generated elements close implicitly only once', async () => {
		const input =
			'- foo <p>bar\n  <!-- baz -->\n  - qux\n  <!-- quux -->\n';
		const expectedOutput =
			'- foo <p>bar\n  <!-- baz --> </p>\n    - qux\n  <!-- quux -->\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});
});

describe('Normalization and Closing Tags', () => {
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

	test('closes an open element at the end of the document after Markdown', async () => {
		const input = `<div   id="foo">

bar
`;
		const expectedOutput = `<div id="foo">

bar

</div>
`;

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('closes implicitly closed elements where their content ends', async () => {
		const input =
			'<ul>\n<li>foo\n\n<li>bar\n</ul>\n\n<p>baz\n\n<div>qux</div>\n';
		const expectedOutput =
			'<ul>\n    <li>foo</li>\n\n<li>bar</li>\n</ul>\n\n<p>baz</p>\n\n<div>qux</div>\n';

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
		const input = 'foo <svg><clipPath   id="a"></clipPath></svg>\n';
		const expectedOutput = 'foo <svg><clipPath id="a"></clipPath></svg>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('adds closing tags to elements with uppercase names', async () => {
		const input = '<DIV   >\n\nfoo\n';
		const expectedOutput = '<div>\n\nfoo\n\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('closes inline elements with uppercase names across HTML blocks', async () => {
		const input = '- foo <SPAN>\n  <!-- bar -->\n  baz </SPAN>\n';
		const expectedOutput =
			'- foo <span>\n  <!-- bar -->\n    baz </span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects inline SVG opening tags that formatting would lowercase before closing tags in HTML blocks', async () => {
		await expect(
			format(
				'- foo <svg><A>\n  <!-- bar --></A></svg>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:12):

			Formatting would give this \`<A>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
		`);
	});

	test('rejects inline SVG opening tags with void element names before closing tags in HTML blocks', async () => {
		await expect(
			format(
				'- foo <svg><COL>\n  <!-- bar --></COL></svg>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:12):

			Formatting would give this \`<COL>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
		`);
	});

	test('adds no closing tags to elements that HTML blocks open and later inline HTML closes', async () => {
		const input = '- <!-- foo --><span   >\n  bar </span>\n';
		const expectedOutput = '- <!-- foo --><span>\n    bar </span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps HTML blocks outside elements that inline HTML closes before them', async () => {
		const input =
			'- <!-- foo --><span>\n  bar </span>\n  <div   >baz</div>\n';
		const expectedOutput =
			'- <!-- foo --><span>\n    bar </span>\n  <div>baz</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('adds no closing tags to elements that inline HTML opens with omitted closing tags across HTML blocks', async () => {
		const input = '- foo <p   >bar\n  <!-- baz -->\n  qux\n';
		const expectedOutput = '- foo <p>bar\n  <!-- baz -->\n    qux\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('closes elements that HTML blocks open inside elements that inline HTML opens', async () => {
		const input =
			'- foo <span>\n  <!-- bar --><b   >\n  baz </b>\n  <!-- qux -->\n  quux</span>\n';
		const expectedOutput =
			'- foo <span>\n  <!-- bar --><b>\n    baz </b>\n  <!-- qux -->\n    quux</span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});
});

describe('Malformed HTML', () => {
	test('accepts an open `pre` element at the document root', async () => {
		const input = `<pre>
foo
`;
		const expectedOutput = `<pre>
foo
</pre>
`;

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects closing tags that don’t match the open element', async () => {
		await expect(format('<div><span></div>\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (1:12):

			This \`</div>\` tag doesn’t match the \`<span>\` element that is still open]
		`);
	});

	test('rejects closing tags inside elements Prettier still has open', async () => {
		await expect(format('<pre><code>foo</pre>\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (1:15):

			This \`</pre>\` tag doesn’t match the \`<code>\` element that is still open]
		`);
	});

	test('rejects unterminated comments', async () => {
		await expect(format('foo\n\n<!-- bar\n', SPEC_EXAMPLE_OPTIONS)).rejects
			.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (3:1):

			This comment isn’t closed before the end of the document]
		`);
	});

	test('rejects unterminated raw text elements', async () => {
		await expect(format('foo\n\n<script>\nbar\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (3:1):

			This \`<script>\` element isn’t closed before the end of the document]
		`);
	});
});

describe('Non-Element Markup', () => {
	test('preserves HTML generated from Markdown as comment content', async () => {
		const input = `<div   ></div>
<!-- Comment

**foo**

<div>bar -->
`;
		const expectedOutput = `<div></div>
<!-- Comment

**foo**

<div>bar -->
`;

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('reads apparent tags inside processing instructions as token content', async () => {
		const input = '<?foo </div> ?>\n';
		const expectedOutput = '<?foo </div>\n?>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps the letter case of doctype keywords', async () => {
		const input = '<!DOCTYPE   html>\n\nfoo\n';
		const expectedOutput = '<!DOCTYPE html>\n\nfoo\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps the letter case of doctype keywords in files with HTML extensions', async () => {
		const input = '<!DOCTYPE   html>\n\nfoo\n';
		const expectedOutput = '<!DOCTYPE html>\n\nfoo\n';
		const options = { ...SPEC_EXAMPLE_OPTIONS, filepath: 'foo.html' };

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('normalizes inline doctypes while keeping their uppercase keywords', async () => {
		const input = 'foo <!DOCTYPE   HTML> bar\n';
		const expectedOutput = 'foo <!DOCTYPE html> bar\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects comments that take in the end of a generated block quote', async () => {
		await expect(format('> <!-- foo\n\n<div>-->\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (1:3):

			This comment starts inside the block quote and continues past its end]
		`);
	});

	test('rejects Markdown text that resembles a comment’s closing marker', async () => {
		await expect(
			format(
				'<div></div>\n<!-- Comment\n\n**foo**\n\nbar -->\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (2:1):

			This comment isn’t closed before the end of the document. A \`-->\` in Markdown text doesn’t close it, because Markdown escapes the \`>\`]
		`);
	});

	test('rejects processing instructions that take in generated tags', async () => {
		await expect(
			format('<div></div><?foo\n\nbar ?>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (1:12):

			This processing instruction contains the start of the paragraph but not its end]
		`);
	});

	test('keeps comments that span adjacent HTML blocks intact', async () => {
		const input = '<div></div>\n<!-- foo\n\n<div>   -->\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('keeps tags in nested Markdown inside a comment as comment content', async () => {
		const input = '<div></div>\n<!--\n\n> <span   >\n> foo\n\n<div>-->\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
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
});

describe('Content and Whitespace', () => {
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

	test('rejects formatting that changes Markdown inside a comment', async () => {
		await expect(
			format(
				'<div></div>\n<!-- Comment\n\nfoo  bar\n\n<div>baz -->\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (4:1):

			Formatting this Markdown would change the content of the comment that contains it]
		`);
	});

	test('rejects formatting that changes Markdown inside preformatted content', async () => {
		await expect(
			format(
				'<div><pre>\n\nfoo  bar\n\n<div></div></pre></div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (3:1):

			Formatting this Markdown would change the content of the \`<pre>\` element that contains it]
		`);
	});

	test('accepts Markdown changes inside a comment that render identically', async () => {
		const input = '<div></div>\n<!-- Comment\n\n*foo*\n\n<div>bar -->\n';
		const expectedOutput =
			'<div></div>\n<!-- Comment\n\n_foo_\n\n<div>bar -->\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects formatting that changes an apparent footnote definition inside a comment', async () => {
		await expect(
			format(
				'<div></div>\n<!-- Comment\n\n[^foo]: bar  baz\n\n<div>-->\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (4:1):

			Formatting this Markdown would change the content of the comment that contains it]
		`);
	});

	test('rejects formatting that changes literal code after an apparent footnote definition inside a comment', async () => {
		await expect(
			format(
				'<div></div>\n<!-- Comment\n\n[^foo]:\n\n    bar  baz\n\n<div>-->\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (4:1):

			Formatting this footnote definition would change the content of the comment that contains it]
		`);
	});

	test('rejects formatting that changes literal code in an apparent footnote definition with raw HTML inside a comment', async () => {
		await expect(
			format(
				'<div></div>\n<!-- Comment\n\n[^foo]: bar <b>baz</b>\n\n    qux  quux\n\n<div>-->\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (4:1):

			Formatting this footnote definition would change the content of the comment that contains it]
		`);
	});

	test('rejects formatting that changes literal code after an apparent footnote definition inside a raw element', async () => {
		await expect(
			format(
				'<div>\n\n[^foo]:\n\n    bar  baz\n\n</div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (3:1):

			Formatting this footnote definition would change the content of the \`<div>\` element that contains it]
		`);
	});

	test('accepts Markdown inside a comment that the effective options leave unchanged', async () => {
		const input =
			'<div></div>\n<!--\n\n```js\nlet foo=1\n```\n\n<div>-->\n';

		await expect(
			format(input, {
				...SPEC_EXAMPLE_OPTIONS,
				embeddedLanguageFormatting: 'off' as const,
			})
		).resolves.toBe(input);
	});

	test('accepts ignored Markdown inside preformatted content', async () => {
		const input =
			'<div><pre>\n\n<!-- prettier-ignore -->\nfoo  bar\n\n<div></div></pre></div>\n';
		const expectedOutput =
			'<div>\n    <pre>\n\n<!-- prettier-ignore -->\nfoo  bar\n\n<div></div></pre>\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects formatting that changes raw text inside a paragraph', async () => {
		await expect(
			format('foo <textarea>bar  baz</textarea>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:5):

			Formatting this Markdown would change the content of the \`<textarea>\` element that contains it]
		`);
	});

	test('accepts whitespace changes around raw text inside a paragraph', async () => {
		const input = 'foo  bar <textarea>baz</textarea>\n';
		const expectedOutput = 'foo bar <textarea>baz</textarea>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects formatting that changes spaces between tags inside raw text', async () => {
		await expect(
			format('foo <textarea><b>  </b></textarea>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:5):

			Formatting this Markdown would change the content of the \`<textarea>\` element that contains it]
		`);
	});

	test('normalizes raw text that consists only of whitespace', async () => {
		const input = 'foo <textarea>  </textarea>\n';
		const expectedOutput = 'foo <textarea> </textarea>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('normalizes whitespace in raw text that Prettier doesn’t protect', async () => {
		const input = 'foo <title>bar  baz</title>\n';
		const expectedOutput = 'foo <title>bar baz</title>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects formatting that adds a space to empty raw text', async () => {
		await expect(
			format('foo <textarea>\n</textarea> bar\n', {
				...SPEC_EXAMPLE_OPTIONS,
				proseWrap: 'never',
			})
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:5):

			Formatting this Markdown would change the content of the \`<textarea>\` element that contains it]
		`);
	});

	test('accepts whitespace changes beside syntax specific to Prettier around raw text', async () => {
		const input = 'foo  bar [[baz]] {{ qux }} <textarea>quux</textarea>\n';
		const expectedOutput =
			'foo bar [[baz]] {{ qux }} <textarea>quux</textarea>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects formatting that changes Markdown inside preformatted content in a block quote', async () => {
		await expect(
			format(
				'> <div><pre>\n>\n> foo\n> bar\n>\n> <div></div></pre></div>\n',
				{ ...SPEC_EXAMPLE_OPTIONS, proseWrap: 'never' as const }
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (3:3):

			Formatting this Markdown would change the content of the \`<pre>\` element that contains it]
		`);
	});

	test('keeps the blank line that ends an open `pre`', async () => {
		const input = '<pre>foo\n\n';
		const expectedOutput = '<pre>\nfoo\n\n</pre>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps whitespace-only lines in preformatted content', async () => {
		const input = '<pre>   \n\tx   \n  y</pre>\n';
		const expectedOutput = '<pre>\n   \n\tx   \n  y</pre>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});
});

describe('Indentation Across Fragments', () => {
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

	test('keeps HTML blocks inside task list items', async () => {
		const input = '- [ ] foo\n\n  <div>\n  <p>bar</p>\n  </div>\n';
		const expectedOutput =
			'- [ ] foo\n\n  <div>\n      <p>bar</p>\n  </div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps preformatted content in task list items', async () => {
		const input = '- [ ] foo\n\n  <pre>\n  bar\n  </pre>\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('measures bullet list markers as Prettier prints them', async () => {
		const input =
			'- <div title="foo" data-bar="baz" data-qux="quux" data-corge="graultxx">x</div>\n';
		const expectedOutput =
			'- <div title="foo" data-bar="baz" data-qux="quux" data-corge="graultxx">x</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('measures ordered list markers as Prettier prints them', async () => {
		const input =
			'1. foo\n1. bar\n1. baz\n1. qux\n1. quux\n1. corge\n1. grault\n1. garply\n1. waldo\n1. <div   title="foo" data-bar="baz" data-qux="quux" data-corge="graulttt">x</div>\n';
		const expectedOutput =
			'1. foo\n1. bar\n1. baz\n1. qux\n1. quux\n1. corge\n1. grault\n1. garply\n1. waldo\n1. <div title="foo" data-bar="baz" data-qux="quux" data-corge="graulttt">x</div>\n';

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

	test('wraps attributes of preformatted elements in task list items', async () => {
		const input = '- [ ] foo\n\n  <pre   title="bar" class="baz"></pre>\n';
		const expectedOutput =
			'- [ ] foo\n\n  <pre\n      title="bar"\n      class="baz"\n  ></pre>\n';

		const output = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			singleAttributePerLine: true,
		});

		expect(output).toBe(expectedOutput);
		await expect(
			format(output, {
				...SPEC_EXAMPLE_OPTIONS,
				singleAttributePerLine: true,
			})
		).resolves.toBe(output);
	});

	test('reports positions in task list HTML in source columns', async () => {
		await expect(format('- [ ] foo\n\n  <!-- bar\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (3:3):

			This comment isn’t closed before the end of the document]
		`);
	});

	test('keeps the indentation of ignore comments that Prettier doesn’t honor', async () => {
		const input = ' <!-- prettier-ignore -->\n<div   >foo</div>\n';
		const expectedOutput = ' <!-- prettier-ignore -->\n<div>foo</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps the indentation of range ignore comments that Prettier doesn’t honor', async () => {
		const input =
			' <!-- prettier-ignore-start -->\n\n<div   >foo</div>\n\n <!-- prettier-ignore-end -->\n';
		const expectedOutput =
			' <!-- prettier-ignore-start -->\n\n<div>foo</div>\n\n <!-- prettier-ignore-end -->\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});
});

describe('Blank Lines at Boundaries', () => {
	test('keeps one blank line around Markdown paragraphs inside nested HTML', async () => {
		const input = `<table>
<tr>
<td>
<div>

**foo**

   </div>
</td>
<td>
<div>
<div>
<p>bar</p>
</div>

baz

  </div>
</td>
</tr>
</table>
`;
		const expectedOutput = `<table>
    <tr>
        <td>
            <div>

**foo**

</div>
        </td>
        <td>
            <div>
                <div>
                    <p>bar</p>
                </div>

baz

</div>
        </td>
    </tr>
</table>
`;

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps tight lists tight around HTML blocks', async () => {
		const input = `- foo
  <div   >bar</div>
- baz
`;
		const expectedOutput = `- foo
  <div>bar</div>
- baz
`;

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps the blank line that a raw block uses to make a list loose', async () => {
		const input = '- <?foo >\n\n- bar\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('keeps lists with open raw blocks tight', async () => {
		const input = '- <?foo >\n- bar\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('collapses blank lines that an open raw block takes in between list items', async () => {
		const input = '- <?foo >\n\n\n\n- bar\n';
		const expectedOutput = '- <?foo >\n\n- bar\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps lists loose when an open raw block in a nested list takes in a blank line', async () => {
		const input = '- foo\n  - <?bar >\n\n\n- baz\n';
		const expectedOutput = '- foo\n    - <?bar >\n\n- baz\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps lists loose when a blank line follows an open raw block in a nested list', async () => {
		const input = '- foo\n  - <?bar >\n\n\n  baz\n';
		const expectedOutput = '- foo\n    - <?bar >\n\n    baz\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('removes blank lines that an open raw block takes in at the end of a list', async () => {
		const input = '- foo\n- <?bar >\n\n\n';
		const expectedOutput = '- foo\n- <?bar >\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps tight lists tight inside preformatted content', async () => {
		const input =
			'<div><pre>\n\n- <div   >bar</div>\n- baz\n\n<div></div></pre></div>\n';
		const expectedOutput =
			'<div>\n    <pre>\n\n- <div   >bar</div>\n- baz\n\n<div></div></pre>\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('separates HTML blocks from the paragraphs above them', async () => {
		const input = 'foo\n<div   >bar</div>\n\n> baz\n> <div   >qux</div>\n';
		const expectedOutput =
			'foo\n\n<div>bar</div>\n\n> baz\n>\n> <div>qux</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('separates HTML blocks from the paragraphs above them in loose lists', async () => {
		const input = '- foo\n  <div   >bar</div>\n\n- baz\n';
		const expectedOutput = '- foo\n\n  <div>bar</div>\n\n- baz\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects HTML blocks that formatting would extend into the Markdown after them', async () => {
		await expect(
			format(
				'- foo\n  <!-- bar --><div><b>baz</b> <i>qux</i></div>\n  quux\n',
				{ ...SPEC_EXAMPLE_OPTIONS, printWidth: 25 }
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (2:3):

			After formatting, this HTML block would remain open in GitHub Flavored Markdown and include the Markdown that follows]
		`);
	});

	test('lets HTML blocks that formatting leaves open take in the HTML after them', async () => {
		const input =
			'- foo\n  <!-- bar --><div   >baz</div>\n  <!-- qux -->\n';
		const expectedOutput =
			'- foo\n  <!-- bar -->\n  <div>baz</div>\n  <!-- qux -->\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects HTML blocks that formatting would extend through HTML into Markdown', async () => {
		await expect(
			format(
				'- foo\n  <!-- bar --><div>baz</div>\n  <!-- qux -->\n  **quux**\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (2:3):

			After formatting, this HTML block would remain open in GitHub Flavored Markdown and include the Markdown that follows]
		`);
	});

	test('rejects HTML blocks that formatting would extend into Markdown in tight items of loose lists', async () => {
		await expect(
			format(
				'- foo\n  <!-- bar --><div>baz</div>\n  **qux**\n- quux\n\n- corge\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (2:3):

			After formatting, this HTML block would remain open in GitHub Flavored Markdown and include the Markdown that follows]
		`);
	});

	test('rejects HTML blocks that formatting would end partway through the HTML after them', async () => {
		await expect(
			format(
				'<!-- foo --><div>bar</div>\n<pre>\n\nbaz\n</pre>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			After formatting, this HTML block would remain open in GitHub Flavored Markdown and end partway through an HTML block that follows]
		`);
	});

	test('rejects HTML blocks that formatting would extend over Prettier ignore comments', async () => {
		await expect(
			format(
				'<!-- foo --><div>bar</div>\n<!-- prettier-ignore -->\n\n<p   >baz</p>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			After formatting, this HTML block would remain open in GitHub Flavored Markdown and include the Prettier ignore comment that follows, preventing Prettier’s Markdown printer from honoring it]
		`);
	});

	test('lets HTML blocks that formatting leaves open take in inactive ignore comments', async () => {
		const input =
			'<!-- foo --><div   >bar</div>\n<!-- prettier-ignore-end -->\n';
		const expectedOutput =
			'<!-- foo -->\n<div>bar</div>\n<!-- prettier-ignore-end -->\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('separates HTML blocks from the lists nested after them', async () => {
		const input = '- foo\n\n  <!-- bar --><div   >baz</div>\n  - qux\n';
		const expectedOutput =
			'- foo\n\n  <!-- bar -->\n  <div>baz</div>\n\n    - qux\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('separates HTML blocks from adjacent Liquid tags', async () => {
		const input =
			'<!-- foo --><div   >bar</div>\n{% baz %}\n\n{{ qux }}\n<p   >quux</p>\n';
		const expectedOutput =
			'<!-- foo -->\n<div>bar</div>\n\n{% baz %}\n\n{{ qux }}\n\n<p>quux</p>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('separates HTML blocks from the paragraphs after them at the document root', async () => {
		const input = '<!-- foo --><div   >bar</div>\nbaz\n';
		const expectedOutput = '<!-- foo -->\n<div>bar</div>\n\nbaz\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});
});

describe('Block Boundaries', () => {
	test('rejects layouts that would expose HTML block content as Markdown', async () => {
		await expect(
			format(
				'<script>\n\nfoo\n\n</script><b>bar</b>\n\nbaz\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			After formatting, GitHub Flavored Markdown would no longer recognize this as an HTML block, and some of its content would be interpreted as Markdown]
		`);
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

	test('accepts raw text blocks that Prettier leaves open at the end of their container', async () => {
		const input = '<pre/>\n';
		const expectedOutput = '<pre />\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('accepts raw text blocks that Prettier leaves open at the end of block quotes', async () => {
		const input = '> <pre/>\n\nfoo\n';
		const expectedOutput = '> <pre />\n\nfoo\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects layouts that would turn a block into a raw text block', async () => {
		await expect(format('<pre/>\n\nfoo\n', SPEC_EXAMPLE_OPTIONS)).rejects
			.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			After formatting, this HTML block would remain open in GitHub Flavored Markdown and include the Markdown that follows]
		`);
	});

	test('rejects raw text blocks that Prettier leaves open in block quotes inside list items', async () => {
		await expect(format('- > <pre/>\n- foo\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:5):

			After formatting, this HTML block would remain open in GitHub Flavored Markdown and include the Markdown that follows]
		`);
	});

	test('rejects raw text blocks that Prettier leaves open inside list items', async () => {
		await expect(format('- <pre/>\n- foo\n', SPEC_EXAMPLE_OPTIONS)).rejects
			.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:3):

			After formatting, this HTML block would remain open in GitHub Flavored Markdown and include the Markdown that follows]
		`);
	});
});

describe('Inline HTML', () => {
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

	test('keeps inline HTML in headings and table rows on one line', async () => {
		const input = `# foo <span   title="bar"   class="baz">qux</span>

| quux |
| - |
| <span   title="corge\\|grault"   class="garply">waldo</span> |

![fred <span title = "plugh">xyzzy</span>](thud)
`;

		const options = {
			...SPEC_EXAMPLE_OPTIONS,
			htmlFragmentSingleAttributePerLine: true,
		} satisfies Options;

		const expectedOutput = `# foo <span title="bar" class="baz">qux</span>

| quux                                                    |
| ------------------------------------------------------- |
| <span title="corge\\|grault" class="garply">waldo</span> |

![fred <span title = "plugh">xyzzy</span>](thud)
`;

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
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
		await expect(
			format(
				'<span\n    title="foo">  \nbar</span>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			Formatting would leave this tag alone on the paragraph’s first line, where Prettier or GitHub Flavored Markdown would read it as an HTML block]
		`);
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

	test('keeps backslash hard breaks after leading tags', async () => {
		const input = '<span\n    title="foo">\\\nbar</span>\n';
		const expectedOutput = '<span title="foo">\\\nbar</span>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
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

	test('formats tags after task list checkboxes like tags after text', async () => {
		const input = '- [ ] <br   >\n';
		const expectedOutput = '- [ ] <br />\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
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
			'> foo <span   title="bar" data-description="baz" data-label="qux" data-value="quux" data-x="y">corge</span> grault\n===\n';
		const expectedOutput =
			'> foo <span\n>     title="bar"\n>     data-description="baz"\n>     data-label="qux"\n>     data-value="quux"\n>     data-x="y"\n>     >corge</span> grault\n> \\===\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
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
		const input =
			'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor <!-- foo --> incididunt\n';
		const expectedOutput =
			'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod\ntempor <!-- foo --> incididunt\n';

		const output = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			proseWrap: 'always',
		});

		expect(output).toBe(expectedOutput);
		await expect(
			format(output, { ...SPEC_EXAMPLE_OPTIONS, proseWrap: 'always' })
		).resolves.toBe(output);
	});

	test('keeps processing instructions off line starts when wrapping prose', async () => {
		const input =
			'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor <?foo bar?> baz\n';
		const expectedOutput =
			'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod\ntempor <?foo bar?> baz\n';

		const output = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			proseWrap: 'always',
		});

		expect(output).toBe(expectedOutput);
		await expect(
			format(output, { ...SPEC_EXAMPLE_OPTIONS, proseWrap: 'always' })
		).resolves.toBe(output);
	});

	test('keeps content after leading tags when wrapping prose', async () => {
		const input =
			'<span   title="foo bar baz qux quux corge grault garply waldo fred plugh"> **xyzzy** thud</span>\n';
		const expectedOutput =
			'<span title="foo bar baz qux quux corge grault garply waldo fred plugh"> **xyzzy**\nthud</span>\n';

		const output = await format(input, {
			...SPEC_EXAMPLE_OPTIONS,
			proseWrap: 'always',
		});

		expect(output).toBe(expectedOutput);
		await expect(
			format(output, { ...SPEC_EXAMPLE_OPTIONS, proseWrap: 'always' })
		).resolves.toBe(output);
	});

	test('rejoins inline comments that start continuation lines', async () => {
		const input = 'foo\n    <!-- bar --> baz\n';
		const expectedOutput = 'foo <!-- bar --> baz\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects hard line breaks before inline HTML that would start HTML blocks', async () => {
		await expect(
			format('foo  \n    <!-- bar --> baz\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (2:5):

			Formatting would put this HTML at the start of a line after the hard line break, where Prettier or GitHub Flavored Markdown would read it as an HTML block]
		`);
	});

	test('keeps inline comments after hard line breaks inside links', async () => {
		const input = '[foo  \n](bar)<!-- baz -->\n';

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
			'<p   >x</p>\n\n```html\n<div id="foo" class="bar" title="baz qux quux corge">grault <b>x</b>   </div>\n```\n';
		const expectedOutput =
			'<p>x</p>\n\n```html\n<div id="foo" class="bar" title="baz qux quux corge">grault <b>x</b></div>\n```\n';
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

	test('removes blank lines that formatting adds after attribute values that mention raw text tags', async () => {
		const input =
			'- <ul>\n  <li title="<script>">foo\n  bar\n  <li>baz\n  </ul>\n- qux\n';
		const expectedOutput =
			'- <ul>\n      <li title="<script>">foo bar</li>\n      <li>baz</li>\n  </ul>\n- qux\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('removes blank lines that formatting adds after comments that mention raw text tags', async () => {
		const input =
			'- <ul>\n  <!-- <script> --><li>foo\n  bar\n  <li>baz\n  </ul>\n- qux\n';
		const expectedOutput =
			'- <ul>\n      <!-- <script> -->\n      <li>foo bar</li>\n      <li>baz</li>\n  </ul>\n- qux\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('removes blank lines that formatting adds after CDATA sections that mention raw text tags', async () => {
		const input =
			'- <ul>\n  <![CDATA[> <script>]]><li>foo\n  bar\n  <li>baz\n  </ul>\n- qux\n';
		const expectedOutput =
			'- <ul>\n      <![CDATA[> <script>]]>\n      <li>foo bar</li>\n      <li>baz</li>\n  </ul>\n- qux\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps blank lines that embedded formatting adds in raw text after processing instructions with quotes', async () => {
		const input =
			'<?foo ">\n<script type="text/markdown">\n# foo\n* bar\n</script>\n?>\n';
		const expectedOutput =
			'<?foo ">\n<script type="text/markdown">\n    # foo\n\n    - bar\n</script>\n?>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects blank lines that embedded formatting adds in other HTML blocks', async () => {
		await expect(
			format(
				'<div>\n<script type="text/markdown">\n# foo\n*   bar\n</script>\n</div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			After formatting, GitHub Flavored Markdown would no longer recognize this as an HTML block, and some of its content would be interpreted as Markdown]
		`);
	});

	test('formats embedded styles in attributes', async () => {
		const input = '<div style="color:red;display:block">x</div>\n';
		const expectedOutput =
			'<div style="color: red; display: block">x</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('leaves embedded styles in attributes unformatted when embedded language formatting is off', async () => {
		const input = '<div style="color:red;display:block">x</div>\n';

		await expect(
			format(input, {
				...SPEC_EXAMPLE_OPTIONS,
				embeddedLanguageFormatting: 'off',
			})
		).resolves.toBe(input);
	});

	test('keeps the content of scripts in languages that Prettier doesn’t recognize', async () => {
		const input = '<script type="text/x-foo">  a   =   b  </script>\n';
		const expectedOutput =
			'<script type="text/x-foo">\n    a   =   b\n</script>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps the content of scripts that fail to format', async () => {
		const input = '<script>let x = ;  foo( 1 )</script>\n';
		const expectedOutput = '<script>\n    let x = ;  foo( 1 )\n</script>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps errors that Prettier throws as the cause', async () => {
		const error = new Error('foo');
		const pluginThrowingHTML = {
			parsers: {
				html: {
					astFormat: 'html',
					locEnd: () => 0,
					locStart: () => 0,
					parse: () => {
						throw error;
					},
				},
			},
		} satisfies Plugin;
		let result: unknown;

		try {
			await format('<div   >foo</div>\n', {
				...SPEC_EXAMPLE_OPTIONS,
				plugins: [pluginMarkdownHTML, pluginThrowingHTML],
			});
		} catch (caughtError) {
			result = caughtError;
		}

		expect(result).toBeInstanceOf(Error);
		expect((result as Error).message).toMatchInlineSnapshot(`
			"[prettier-plugin-markdown-html] Failed to format HTML with Prettier (1:1):

			foo"
		`);
		expect((result as Error).cause).toBe(error);
	});
});

describe('Ignore Directives', () => {
	test('keeps omitted closing tags of elements that ignore directives protect', async () => {
		const input =
			'<ul>\n<!-- prettier-ignore -->\n<li   >foo\n\n<li>bar\n</ul>\n';
		const expectedOutput =
			'<ul>\n    <!-- prettier-ignore -->\n    <li   >foo\n\n<li>bar</li>\n</ul>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps omitted closing tags of elements that Markdown ignore directives protect', async () => {
		const input =
			'<ul>\n\n<!-- prettier-ignore -->\n<li   >foo\n\n<li>bar\n</ul>\n';
		const expectedOutput =
			'<ul>\n\n<!-- prettier-ignore -->\n<li   >foo\n\n<li>bar</li>\n</ul>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps omitted closing tags of elements that Markdown ignore directives protect around Markdown', async () => {
		const input =
			'<ul>\n\n<!-- prettier-ignore -->\n<li   >foo\n\nbaz\n\n<li>bar\n</ul>\n';
		const expectedOutput =
			'<ul>\n\n<!-- prettier-ignore -->\n<li   >foo\n\nbaz\n\n<li>bar</li>\n</ul>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps omitted closing tags of nested elements that Markdown ignore directives protect', async () => {
		const input =
			'<!-- prettier-ignore -->\n<ul><li><p>\n\n<li>bar\n</ul>\n';
		const expectedOutput =
			'<!-- prettier-ignore -->\n<ul><li><p>\n\n<li>bar</li>\n</ul>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps omitted closing tags of elements that Markdown ignore directives protect around open elements', async () => {
		const input =
			'<ul>\n\n<!-- prettier-ignore -->\n<li   >foo\n\n<p>bar\n<li>baz\n</ul>\n';
		const expectedOutput =
			'<ul>\n\n<!-- prettier-ignore -->\n<li   >foo\n\n<p>\n            bar\n            <li>baz</li>\n        </p>\n</ul>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps omitted closing tags of elements that Markdown ignore directives protect inside later fragments', async () => {
		const input =
			'<ul>\n\n<!-- prettier-ignore -->\n<li   >foo\n\n<p   >x</p>\n<li   >bar\n</ul>\n';
		const expectedOutput =
			'<ul>\n\n<!-- prettier-ignore -->\n<li   >foo\n\n<p>x</p>\n    <li>bar</li>\n</ul>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps the closing tags of custom elements that ignore directives protect', async () => {
		const input =
			'<!-- prettier-ignore -->\n<Foo-Bar   >\n\nbaz\n\n</Foo-Bar>\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('keeps the closing tags of elements with uppercase names that HTML ignore directives protect', async () => {
		const input =
			'<!-- prettier-ignore -->\n<div>\n<!-- prettier-ignore -->\n<DIV>\n\nfoo\n\n</DIV>\n</div>\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('keeps the closing tags of SVG elements that ignore directives protect', async () => {
		const input =
			'<!-- prettier-ignore -->\n<div><svg><linearGradient>\n\nfoo\n\n</linearGradient>\n</svg>\n</div>\n';
		const expectedOutput =
			'<!-- prettier-ignore -->\n<div><svg><linearGradient>\n\nfoo\n\n</linearGradient>\n    </svg>\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects opening tags that formatting would lowercase before uppercase closing tags that ignore directives protect', async () => {
		await expect(
			format(
				'<DIV>\n\nfoo\n\n<!-- prettier-ignore -->\n</DIV>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			Formatting would give this \`<DIV>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
		`);
	});

	test('adds no closing tags inside elements that HTML ignore directives protect', async () => {
		const input =
			'<ul>\n<!-- prettier-ignore -->\n<li   ><p>foo\n\n</ul>\n';
		const expectedOutput =
			'<ul>\n    <!-- prettier-ignore -->\n    <li   ><p>foo\n\n</ul>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects closing tags that formatting would lowercase after uppercase opening tags that ignore directives protect', async () => {
		await expect(
			format(
				'<!-- prettier-ignore -->\n<DIV   >\n\nfoo\n\n</DIV>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (2:1):

			Formatting would give this \`<DIV>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
		`);
	});

	test('rejects inline closing tags that formatting would lowercase after uppercase inline opening tags that ignore directives protect', async () => {
		await expect(
			format(
				'- <!-- prettier-ignore -->\n  foo <SPAN>\n  <!-- bar -->\n  baz </SPAN>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (2:7):

			Formatting would give this \`<SPAN>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
		`);
	});

	test('rejects inline opening tags that formatting would lowercase before uppercase inline closing tags that ignore directives protect', async () => {
		await expect(
			format(
				'- foo <SPAN>\n  <!-- bar -->\n  <!-- prettier-ignore -->\n  baz </SPAN>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:7):

			Formatting would give this \`<SPAN>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
		`);
	});

	test('rejects inline opening tags that formatting would lowercase before uppercase closing tags in HTML blocks that ignore directives protect', async () => {
		await expect(
			format(
				'- foo <Span>\n  <!-- prettier-ignore -->\n  <p   >bar\n  baz </Span>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:7):

			Formatting would give this \`<Span>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
		`);
	});

	test('rejects inline SVG closing tags that formatting would lowercase after opening tags that ignore directives protect', async () => {
		await expect(
			format(
				'- <!-- prettier-ignore -->\n  foo <svg><A>\n  <!-- bar -->\n  baz </A></svg>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (2:12):

			Formatting would give this \`<A>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
		`);
	});

	test('keeps inline tags in preformatted content when ignore directives protect only one of them', async () => {
		const input =
			'<div><pre>\n\n- <!-- prettier-ignore -->\n    foo <B>\n  <!-- bar -->\n    baz </B>\n\n</pre>\n</div>\n';
		const expectedOutput =
			'<div>\n    <pre>\n\n- <!-- prettier-ignore -->\n    foo <B>\n  <!-- bar -->\n    baz </B>\n\n</pre>\n</div>\n';

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
		await expect(
			format(
				'<div><!-- prettier-ignore --><SPAN   >foo</SPAN></div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			Formatting would give this \`<SPAN>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
		`);
	});

	test('rejects uppercase opening tags that Prettier lowercases after HTML ignore directives without whitespace beside identical protected tags', async () => {
		await expect(
			format(
				'<div><!-- prettier-ignore --><SPAN   >foo</SPAN><!-- prettier-ignore --> <SPAN   >bar</SPAN></div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			Formatting would give this \`<SPAN>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
		`);
	});

	test('rejects uppercase opening tags that Prettier lowercases after HTML ignore directives without whitespace beside copies in comments', async () => {
		await expect(
			format(
				'<div><!-- prettier-ignore --><SPAN   >foo</SPAN><!-- <SPAN   > --></div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			Formatting would give this \`<SPAN>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
		`);
	});

	test('keeps uppercase opening tags after HTML ignore directives with whitespace beside Markdown-ignored copies', async () => {
		const input =
			'<!-- prettier-ignore -->\n<div><!-- prettier-ignore --><SPAN   >foo</SPAN></div>\n\n<div><!-- prettier-ignore --> <SPAN   >bar</SPAN></div>\n';
		const expectedOutput =
			'<!-- prettier-ignore -->\n<div><!-- prettier-ignore --><SPAN   >foo</SPAN></div>\n\n<div>\n    <!-- prettier-ignore -->\n    <SPAN   >bar</SPAN>\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps uppercase opening tags in preformatted content after HTML ignore directives without whitespace beside lowercase copies', async () => {
		const input =
			'<pre><!-- prettier-ignore --><SPAN   >foo</SPAN></pre>\n\n<div><!-- prettier-ignore --><span   >bar</span></div>\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('rejects uppercase opening tags that Prettier lowercases after HTML ignore directives without whitespace beside copies in attributes', async () => {
		await expect(
			format(
				'<div class="<!-- prettier-ignore --><span   >"><!-- prettier-ignore --><SPAN   >foo</SPAN></div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			Formatting would give this \`<SPAN>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
		`);
	});

	test('keeps uppercase opening tags in preformatted content after HTML ignore directives without whitespace beside Markdown-ignored copies', async () => {
		const input =
			'<!-- prettier-ignore -->\n<div><!-- prettier-ignore --><SPAN   >foo</SPAN></div>\n\n<pre><!-- prettier-ignore --><SPAN   >bar</SPAN></pre>\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
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

	test('keeps uppercase opening tags in preformatted content after HTML ignore directives without whitespace beside elements that inline HTML opens', async () => {
		const input =
			'- foo <SPAN>\n  <div   >bar</div>\n  </SPAN>\n  <pre><!-- prettier-ignore --><B   >baz</B></pre>\n';
		const expectedOutput =
			'- foo <span>\n  <div>bar</div>\n  </span>\n  <pre><!-- prettier-ignore --><B   >baz</B></pre>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects uppercase opening tags that Prettier lowercases after HTML ignore directives without whitespace when it breaks the line after them', async () => {
		await expect(
			format(
				`<div><!-- prettier-ignore --><SPAN   >foo</SPAN><b>${'bar '.repeat(20)}</b></div>\n`,
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			Formatting would give this \`<SPAN>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
		`);
	});

	test('rejects uppercase opening tags that Prettier lowercases after HTML ignore directives without whitespace beside renamed copies in attributes', async () => {
		await expect(
			format(
				'<div class="<!-- prettier-ignore --><span   >foo</SPAN>"><!-- prettier-ignore --><SPAN   >foo</SPAN></div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			Formatting would give this \`<SPAN>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
		`);
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
		await expect(
			format(
				'<div><pre /><!-- prettier-ignore --><SPAN   >foo</SPAN></div>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			Formatting would give this \`<SPAN>\` element different opening and closing tag names, which Prettier’s HTML parser would not match]
		`);
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

	test('keeps omitted closing tags of ignored elements with uppercase names', async () => {
		const input =
			'<UL>\n\n<!-- prettier-ignore -->\n<LI   >foo\n\n<LI>bar\n</UL>\n';
		const expectedOutput =
			'<ul>\n\n<!-- prettier-ignore -->\n<LI   >foo\n\n<li>bar</li>\n</ul>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps omitted closing tags of elements that range ignore directives protect', async () => {
		const input =
			'<ul>\n\n<!-- prettier-ignore-start -->\n\n<li   >foo\n\n<!-- prettier-ignore-end -->\n\n<li>bar\n</ul>\n';
		const expectedOutput =
			'<ul>\n\n<!-- prettier-ignore-start -->\n\n<li   >foo\n\n<!-- prettier-ignore-end -->\n\n<li>bar</li>\n</ul>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps omitted closing tags of elements that range ignore directives protect before closing tags', async () => {
		const input =
			'<ul>\n\n<!-- prettier-ignore-start -->\n\n<li   >foo\n\n<!-- prettier-ignore-end -->\n\n</ul>\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('rejects closing elements around ignored elements with omitted closing tags', async () => {
		await expect(
			format(
				'<div>\n\n<!-- prettier-ignore -->\n\n<div>\n\nfoo\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			The \`<div>\` element can’t close because an ignore directive prevents adding a closing tag to the \`<div>\` element inside it]
		`);
	});

	test('keeps omitted closing tags of ignored elements inside ignored elements with the same names', async () => {
		const input =
			'<!-- prettier-ignore -->\n<ul><p>foo\n\n<!-- prettier-ignore -->\n<li><p>bar\n\n<div   >baz</div>\n';
		const expectedOutput =
			'<!-- prettier-ignore -->\n<ul><p>foo\n\n<!-- prettier-ignore -->\n<li><p>bar\n\n<div>baz</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('closes elements around ignored elements whose omitted closing tags their closing tags imply', async () => {
		const input =
			'<ul>\n\n<li>bar\n\n<!-- prettier-ignore -->\n<p   >baz\n\n</ul>\n';
		const expectedOutput =
			'<ul>\n\n<li>\n        bar\n\n<!-- prettier-ignore -->\n<p   >baz\n\n</li>\n</ul>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('closes elements around ignored fragments before later closing tags', async () => {
		const input =
			'<ul>\n\n<li>foo\n\n<!-- prettier-ignore -->\n<div   >qux</div>\n\n</ul>\n';
		const expectedOutput =
			'<ul>\n\n<li>\n        foo\n\n<!-- prettier-ignore -->\n<div   >qux</div>\n\n</li>\n</ul>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps omitted closing tags of ignored elements that close after comments with trailing whitespace', async () => {
		const input =
			'<ul>\n\n<!-- prettier-ignore -->\n<li   >foo\n\n<p>bar\n\n<!-- baz -->   \n</ul>\n';
		const expectedOutput =
			'<ul>\n\n<!-- prettier-ignore -->\n<li   >foo\n\n<p>\n            bar\n\n<!-- baz -->\n</p>\n</ul>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('closes elements that Markdown after ignored fragments closes', async () => {
		const input =
			'<div>\n<p>foo\n\n<!-- prettier-ignore -->\n<span   >\nbar</span>\n\nbaz\n\n</div>\n';
		const expectedOutput =
			'<div>\n    <p>\n        foo\n\n<!-- prettier-ignore -->\n<span   >\nbar</span>\n\n</p>\n\nbaz\n\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('separates closing tags after ignored fragments from Liquid tags', async () => {
		const input =
			'<div>\n<p>foo\n\n<!-- prettier-ignore -->\n<style   >a{}</style>\n{% baz %}\n\n</div>\n';
		const expectedOutput =
			'<div>\n    <p>\n        foo\n\n<!-- prettier-ignore -->\n<style   >a{}</style>\n\n</p>\n\n{% baz %}\n\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects closing tags after ignored fragments that would take in Markdown', async () => {
		await expect(
			format(
				'- foo <p>bar\n  <!-- prettier-ignore -->\n  <style   >a{}</style>\n  # baz\n- qux\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (3:3):

			After formatting, the block formed by closing tags after this HTML block would remain open in GitHub Flavored Markdown and include the Markdown that follows]
		`);
	});

	test('closes elements around ignored elements at the end of the document', async () => {
		const input = '<div   >\n\n<!-- prettier-ignore -->\n<p   >foo\n';
		const expectedOutput =
			'<div>\n\n<!-- prettier-ignore -->\n<p   >foo\n\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('closes elements with the same names as ignored elements that close first', async () => {
		const input =
			'<ul>\n<li>foo\n<ul>\n\n<!-- prettier-ignore -->\n<li   >bar\n\n</ul>\n</ul>\n';
		const expectedOutput =
			'<ul>\n    <li>\n        foo\n        <ul>\n\n<!-- prettier-ignore -->\n<li   >bar\n\n</ul>\n    </li>\n</ul>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('closes elements with the same names as ignored elements that later elements close', async () => {
		const input =
			'<ul>\n\n<p>foo\n\n<!-- prettier-ignore -->\n<li   >bar\n<p   >baz\n\n<p>qux\n\n</ul>\n';
		const expectedOutput =
			'<ul>\n\n<p>\n        foo\n\n<!-- prettier-ignore -->\n<li   >bar\n<p   >baz\n\n<p>qux</p>\n    </p>\n\n</ul>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects closing elements with the same names as ignored elements with omitted closing tags', async () => {
		await expect(
			format(
				'<ul>\n\n<p>foo\n\n<!-- prettier-ignore -->\n<li   >bar\n<p   >baz\n\n<li>qux\n</ul>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (3:1):

			The \`<p>\` element can’t close because an ignore directive prevents adding a closing tag to the \`<p>\` element inside it]
		`);
	});

	test('rejects closing tags that would join Markdown ignore directives', async () => {
		await expect(
			format(
				'<ul>\n\n<p>foo\n\n<li>bar\n<p>baz\n\n<!-- prettier-ignore -->\n<div   >qux</div>\n\n</ul>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (8:1):

			After formatting, this Prettier ignore comment would share its HTML block with other HTML, so Prettier would no longer recognize it]
		`);
	});

	test('keeps HTML attribute ignore directives with their targets', async () => {
		const input =
			'<!-- prettier-ignore-attribute -->\n<div   title = "foo">bar</div>\n';
		const expectedOutput =
			'<!-- prettier-ignore-attribute -->\n<div title = "foo">bar</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps lists with link reference definitions unchanged after ignore directives', async () => {
		const input =
			'<!-- prettier-ignore -->\n- [foo]: bar\n\n  "baz"\n- <span   >qux</span>\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('keeps lists with link reference definitions unchanged in ignored ranges', async () => {
		const input =
			'<!-- prettier-ignore-start -->\n\n- [foo]: bar\n\n  "baz"\n- <span   >qux</span>\n\n<!-- prettier-ignore-end -->\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
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

	test('rejects layouts that would hide ignore directives', async () => {
		await expect(
			format(
				'- foo <p>bar\n  <!-- prettier-ignore -->\n  # baz   qux\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (2:3):

			After formatting, this Prettier ignore comment would share its HTML block with other HTML, so Prettier would no longer recognize it]
		`);
	});

	test('completes elements after ignore range comments that Prettier doesn’t honor', async () => {
		const input =
			'- foo <p>bar\n  <!-- prettier-ignore -->\n  baz\n  <!-- prettier-ignore-end -->\n  # qux\n';
		const expectedOutput =
			'- foo <p>bar\n  <!-- prettier-ignore -->\n    baz\n  <!-- prettier-ignore-end --> </p>\n    # qux\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('formats fragments after opening tags that Markdown ignore directives protect', async () => {
		const input =
			'<!-- prettier-ignore -->\n<div   >\n\nfoo\n\n<p   >bar</p>\n\n</div   >\n';
		const expectedOutput =
			'<!-- prettier-ignore -->\n<div   >\n\nfoo\n\n<p>bar</p>\n\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps blank lines that end ignored open preformatted content', async () => {
		const input = '<!-- prettier-ignore -->\n<pre>\nx\n\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('keeps trailing whitespace that ends ignored preformatted content', async () => {
		const input = '<!-- prettier-ignore -->\n<pre>foo  \n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('keeps trailing whitespace of ignored fragments inside text areas', async () => {
		const input =
			'<div><textarea>\n\n<!-- prettier-ignore -->\n<p   >foo  \n\n</textarea>\n</div>\n';
		const expectedOutput =
			'<div>\n    <textarea>\n\n<!-- prettier-ignore -->\n<p   >foo  \n\n</textarea>\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('formats HTML after ignore comments with trailing whitespace that Prettier doesn’t honor', async () => {
		const input =
			'<!-- prettier-ignore -->   \n<div   >\n\nfoo\n\n<p   >bar</p>\n\n</div   >\n';
		const expectedOutput =
			'<!-- prettier-ignore -->\n<div>\n\nfoo\n\n<p>bar</p>\n\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps ignored preformatted content after list item prefixes that change', async () => {
		const input =
			'-   <!-- prettier-ignore -->\n    <pre   >\n    a  \n      \n    b</pre>\n';
		const expectedOutput =
			'- <!-- prettier-ignore -->\n  <pre   >\n  a  \n    \n  b</pre>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps the indentation of ignored HTML after list item prefixes that change', async () => {
		const input =
			'*   foo\n\n    <!-- prettier-ignore -->\n    <div   id = "a">\n      bar</div>\n';
		const expectedOutput =
			'- foo\n\n  <!-- prettier-ignore -->\n  <div   id = "a">\n    bar</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps ignored preformatted content after block quote prefixes that change', async () => {
		const input =
			'>foo\n>\n><!-- prettier-ignore -->\n><pre   >\n>x\n>\n>  y</pre>\n';
		const expectedOutput =
			'> foo\n>\n> <!-- prettier-ignore -->\n> <pre   >\n> x\n>\n>  y</pre>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps ignored HTML in footnote definitions unchanged', async () => {
		const input =
			'[^1]: foo\n\n    <!-- prettier-ignore -->\n    <pre>\n      x\n    </pre>\n\nbar[^1]\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('keeps preformatted content in ignored lists after list item prefixes that change', async () => {
		const input =
			'-    -    <!-- prettier-ignore -->\n          - <pre   >\n              a\n              </pre>\n';
		const expectedOutput =
			'-   - <!-- prettier-ignore -->\n        - <pre   >\n            a\n            </pre>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps ignored lists with HTML in block quotes unchanged', async () => {
		const input =
			'> <!-- prettier-ignore -->\n> - <div>foo</div>\n>\n> bar\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('keeps code blocks that end ignored lists with HTML in block quotes unchanged', async () => {
		const input =
			'> <!-- prettier-ignore -->\n> - <div>foo</div>\n>\n>   ```\n>   bar\n>\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
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

	test('keeps trailing whitespace of ignored HTML at the end of block quotes', async () => {
		const input = '> <!-- prettier-ignore -->\n> <div>foo</div>  \n\nbar\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('keeps links with inline HTML that ignore directives protect unchanged', async () => {
		const input =
			'<!-- prettier-ignore -->\n[<b>foo</b>](https://example.com)\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
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

	test('keeps preformatted content in ignored lists that end with text after list item prefixes that change', async () => {
		const input =
			'-    -    <!-- prettier-ignore -->\n          - <pre>\n              foo\n              </pre>\n          - bar\n';
		const expectedOutput =
			'-   - <!-- prettier-ignore -->\n        - <pre>\n            foo\n            </pre>\n        - bar\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps tabs in ignored preformatted content after list item prefixes that change', async () => {
		const input = '-\t<!-- prettier-ignore -->\n\t<pre>\n\t\tx</pre>\n';
		const expectedOutput =
			'- <!-- prettier-ignore -->\n  <pre>\n  \tx</pre>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps the columns of partly covered tabs in ignored preformatted content', async () => {
		const input =
			'- foo\n\n  <!-- prettier-ignore -->\n  <pre>\n\t x</pre>\n';
		const expectedOutput =
			'- foo\n\n  <!-- prettier-ignore -->\n  <pre>\n     x</pre>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps ignored preformatted content after task list item prefixes that change', async () => {
		const input =
			'-   [ ] foo\n\n    <!-- prettier-ignore -->\n    <pre   >\n      x</pre>\n';
		const expectedOutput =
			'- [ ] foo\n\n  <!-- prettier-ignore -->\n  <pre   >\n    x</pre>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('protects only the attributes that a named attribute ignore directive selects', async () => {
		const input =
			'<!-- prettier-ignore-attribute style -->\n<div   style="a:b;c:d"   class = "x">bar</div>\n';
		const expectedOutput =
			'<!-- prettier-ignore-attribute style -->\n<div style="a:b;c:d" class="x">bar</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('completes elements whose attributes ignore directives protect', async () => {
		const input =
			'<!-- prettier-ignore-attribute -->\n<div   title = "foo">\n\nbar\n';
		const expectedOutput =
			'<!-- prettier-ignore-attribute -->\n<div title = "foo">\n\nbar\n\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('keeps omitted closing tags at the end of the document for elements that Markdown ignore directives protect', async () => {
		const input = '<!-- prettier-ignore -->\n<div   >\n\nfoo\n';

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('formats fragments inside elements whose opening tags range ignore directives protect', async () => {
		const input =
			'<!-- prettier-ignore-start -->\n\n<div   >\n\n<!-- prettier-ignore-end -->\n\n<p   >foo</p>\n\n</div   >\n';
		const expectedOutput =
			'<!-- prettier-ignore-start -->\n\n<div   >\n\n<!-- prettier-ignore-end -->\n\n<p>foo</p>\n\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('rejects invalid HTML that Markdown ignore directives protect', async () => {
		await expect(
			format(
				'<!-- prettier-ignore -->\n<div><p></div></p>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (2:15):

			Unexpected closing tag "p". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags]
		`);
	});

	test('rejects invalid HTML that range ignore directives protect', async () => {
		await expect(
			format(
				'<!-- prettier-ignore-start -->\n\n<div><span></div>\n\n<!-- prettier-ignore-end -->\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (3:12):

			This \`</div>\` tag doesn’t match the \`<span>\` element that is still open]
		`);
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
			format(input, { ...SPEC_EXAMPLE_OPTIONS, requirePragma: true })
		).resolves.toBe(input);
	});

	test('skips validation in files with an ignore pragma', async () => {
		const input = '<!-- @noformat -->\n\n<div><p></div></p>\n';

		await expect(
			format(input, { ...SPEC_EXAMPLE_OPTIONS, checkIgnorePragma: true })
		).resolves.toBe(input);
	});

	test('validates files with a required pragma', async () => {
		await expect(
			format('<!-- @format -->\n\n<div><p></div></p>\n', {
				...SPEC_EXAMPLE_OPTIONS,
				requirePragma: true,
			})
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (3:15):

			Unexpected closing tag "p". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags]
		`);
	});

	test('applies pragmas to the Markdown document rather than to fragments', async () => {
		const input = 'foo\n\n<!-- @noformat --><div   id = "a">bar</div>\n';
		const expectedOutput =
			'foo\n\n<!-- @noformat -->\n<div id="a">bar</div>\n';
		const options = { ...SPEC_EXAMPLE_OPTIONS, checkIgnorePragma: true };

		const output = await format(input, options);

		expect(output).toBe(expectedOutput);
		await expect(format(output, options)).resolves.toBe(output);
	});
});

describe('Range Formatting', () => {
	test('returns accepted input unchanged when Prettier makes no edits in the range', async () => {
		const input = '<div   >foo</div>\n\n<div   >bar</div>\n';

		await expect(
			format(input, {
				...SPEC_EXAMPLE_OPTIONS,
				rangeEnd: 5,
				rangeStart: 0,
			})
		).resolves.toBe(input);
	});

	test('returns accepted input unchanged when Prettier makes no edits in the range with the remark parser', async () => {
		const input = '<div   >foo</div>\n\n<div   >bar</div>\n';

		await expect(
			format(input, {
				...SPEC_EXAMPLE_OPTIONS,
				parser: 'remark',
				rangeEnd: 5,
				rangeStart: 0,
			})
		).resolves.toBe(input);
	});

	test('returns accepted input unchanged when formatting the complete document would report an error', async () => {
		const input =
			'foo\n\n<div>\n<script type="text/markdown">\n# foo\n* bar\n</script>\n</div>\n';

		await expect(
			format(input, {
				...SPEC_EXAMPLE_OPTIONS,
				rangeEnd: 3,
				rangeStart: 0,
			})
		).resolves.toBe(input);
	});

	test('returns accepted input unchanged when formatting would change protected content outside the range', async () => {
		const input =
			'foo\n\n<div><pre>\n\nfoo  bar\n\n<div></div></pre></div>\n';

		await expect(
			format(input, {
				...SPEC_EXAMPLE_OPTIONS,
				rangeEnd: 3,
				rangeStart: 0,
			})
		).resolves.toBe(input);
	});

	test('rejects invalid HTML outside the range', async () => {
		const message = await getUncoloredErrorMessage(
			format('foo\n\n<div><p></div></p>\n\nbar\n', {
				...SPEC_EXAMPLE_OPTIONS,
				rangeEnd: 3,
				rangeStart: 0,
			})
		);

		expect(message).toMatchInlineSnapshot(`
			"[prettier-plugin-markdown-html] Invalid HTML (3:15):

			Unexpected closing tag "p". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags
			  1 | foo
			  2 |
			> 3 | <div><p></div></p>
			    |               ^
			  4 |
			  5 | bar
			  6 |"
		`);
	});

	test('rejects invalid HTML outside the range after parser preprocessing shortens the text', async () => {
		const pluginShorteningText = {
			parsers: {
				markdown: {
					...markdownParsers.markdown,
					preprocess: (text: string) => text.replace('qux', ''),
				},
			},
		} satisfies Plugin;
		const input = 'foo\n\n<div><p></div></p>\n\nbar qux\n';

		const message = await getUncoloredErrorMessage(
			format(input, {
				...SPEC_EXAMPLE_OPTIONS,
				plugins: [pluginShorteningText, pluginMarkdownHTML],
				rangeEnd: input.length - 2,
				rangeStart: 0,
			})
		);

		expect(message).toMatchInlineSnapshot(`
			"[prettier-plugin-markdown-html] Invalid HTML (3:15):

			Unexpected closing tag "p". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags
			  1 | foo
			  2 |
			> 3 | <div><p></div></p>
			    |               ^
			  4 |
			  5 | bar qux
			  6 |"
		`);
	});

	test('rejects invalid HTML before the range', async () => {
		const message = await getUncoloredErrorMessage(
			format('<div><p></div></p>\n\nfoo\n', {
				...SPEC_EXAMPLE_OPTIONS,
				rangeStart: 20,
			})
		);

		expect(message).toMatchInlineSnapshot(`
			"[prettier-plugin-markdown-html] Invalid HTML (1:15):

			Unexpected closing tag "p". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags
			> 1 | <div><p></div></p>
			    |               ^
			  2 |
			  3 | foo
			  4 |"
		`);
	});

	test('rejects HTML blocks that only Prettier reads outside the range', async () => {
		const message = await getUncoloredErrorMessage(
			format('baz\n\nfoo\n<search>\nbar\n</search>\n', {
				...SPEC_EXAMPLE_OPTIONS,
				rangeEnd: 3,
				rangeStart: 0,
			})
		);

		expect(message).toMatchInlineSnapshot(`
			"[prettier-plugin-markdown-html] Unsupported Markdown (4:1):

			Prettier’s Markdown parser starts an HTML block here, but GitHub Flavored Markdown continues the paragraph above
			  2 |
			  3 | foo
			> 4 | <search>
			    | ^
			  5 | bar
			  6 | </search>
			  7 |"
		`);
	});

	test('rejects raw HTML that only the reference renderer reads outside the range', async () => {
		const message = await getUncoloredErrorMessage(
			format('foo\n\n$$\n<span>\n$$\n', {
				...SPEC_EXAMPLE_OPTIONS,
				rangeEnd: 3,
				rangeStart: 0,
			})
		);

		expect(message).toMatchInlineSnapshot(`
			"[prettier-plugin-markdown-html] Unsupported Markdown (3:1):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown recognizes raw HTML within it
			  1 | foo
			  2 |
			> 3 | $$
			    | ^
			  4 | <span>
			  5 | $$
			  6 |"
		`);
	});
});

describe('Output and Errors', () => {
	test('reports positions in the original Markdown', async () => {
		await expect(
			format('- <div>\n\t<span></div>\n', {
				...SPEC_EXAMPLE_OPTIONS,
				tabWidth: 2,
			})
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (2:8):

			This \`</div>\` tag doesn’t match the \`<span>\` element that is still open]
		`);
	});

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
			'<div data-prettier-markdown-html-1>\n\nfoo\n\n<p   >x</p>\n\n</div>\n';
		const expectedOutput =
			'<div data-prettier-markdown-html-1>\n\nfoo\n\n<p>x</p>\n\n</div>\n';

		const output = await format(input, SPEC_EXAMPLE_OPTIONS);

		expect(output).toBe(expectedOutput);
		await expect(format(output, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
			output
		);
	});

	test('reports positions in the original Markdown after frontmatter', async () => {
		await expect(
			format(
				'---\na: b\n---\n\n<div><p></div></p>\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (5:15):

			Unexpected closing tag "p". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags]
		`);
	});

	test('reports positions in the original Markdown with CRLF line endings', async () => {
		await expect(
			format('foo\r\n\r\n<div>\r\n<span></div>\r\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (4:7):

			This \`</div>\` tag doesn’t match the \`<span>\` element that is still open]
		`);
	});
});

describe('Prettier Compatibility', () => {
	test('formats HTML blocks at the document root as Prettier formats HTML', async () => {
		const input =
			'<div   id = "a" class="b c"><p>foo <b>bar</b>   baz</p><ul><li>x<li>y</ul></div>\n';
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
