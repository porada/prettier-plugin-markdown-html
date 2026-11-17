import type { Options } from 'prettier';
import { format } from 'prettier';
import { describe, expect, test } from 'vite-plus/test';
import * as pluginMarkdownHTML from './index.ts';

const SPEC_EXAMPLE_OPTIONS = {
	parser: 'markdown',
	plugins: [pluginMarkdownHTML],
	printWidth: 80,
	tabWidth: 4,
} satisfies Options;

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

describe('Supported Syntax', () => {
	test('keeps indented markup after apparent footnote definitions as literal code', async () => {
		const input = `[^foo]: bar

    <div title = "baz">qux</div>
`;

		await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(input);
	});

	test('rejects raw HTML that only the reference renderer reads in math', async () => {
		await expect(format('$$\n<span>\n$$\n', SPEC_EXAMPLE_OPTIONS)).rejects
			.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as math, but GitHub Flavored Markdown recognizes raw HTML within it]
		`);
	});

	test('rejects raw HTML that only the reference renderer reads in frontmatter', async () => {
		await expect(
			format('---\ntitle: <b>foo</b>\n---\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as frontmatter, but GitHub Flavored Markdown recognizes raw HTML within it]
		`);
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

	test('rejects frontmatter formatting that changes how GFM renders it', async () => {
		await expect(
			format("---\ntitle: 'foo'\n---\n\nbar\n", SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			Formatting this frontmatter would change how GitHub Flavored Markdown renders it]
		`);
	});

	test('accepts frontmatter formatting that changes only whitespace', async () => {
		const input = '---\ntitle:   foo\n---\n\nbar\n';
		const expectedOutput = '---\ntitle: foo\n---\n\nbar\n';

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

	test('rejects raw HTML that ends a paragraph in an apparent footnote definition', async () => {
		await expect(format('[^foo]: bar </p><p>baz\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML (1:1):

			A closing tag in raw HTML ends this paragraph before its Markdown content ends]
		`);
	});

	test('rejects formatting that changes literal code after an apparent footnote definition', async () => {
		await expect(
			format('[^foo]: bar\n\n    baz  qux\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			Formatting this footnote definition would change how GitHub Flavored Markdown renders it]
		`);
	});

	test('accepts frontmatter that the effective options leave unchanged', async () => {
		const input = "---\ntitle: 'foo'\n---\n\nbar\n";

		await expect(
			format(input, { ...SPEC_EXAMPLE_OPTIONS, singleQuote: true })
		).resolves.toBe(input);
	});

	test('rejects formatting that changes literal code after an apparent footnote definition in a block quote', async () => {
		await expect(
			format('> [^foo]: bar\n>\n>     baz  qux\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:3):

			Formatting this footnote definition would change how GitHub Flavored Markdown renders it]
		`);
	});

	test('rejects formatting that changes literal code after an apparent footnote definition indented with tabs', async () => {
		await expect(
			format('- [^foo]: bar\n\n\t  baz  qux\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:3):

			Formatting this footnote definition would change how GitHub Flavored Markdown renders it]
		`);
	});

	test('rejects formatting that changes literal code after an apparent footnote definition in a block quote inside a list', async () => {
		await expect(
			format(
				'- > [^foo]: bar\n  >\n  >     baz  qux\n',
				SPEC_EXAMPLE_OPTIONS
			)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:5):

			Formatting this footnote definition would change how GitHub Flavored Markdown renders it]
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

	test('rejects declarations that formatting would make GFM read as text', async () => {
		await expect(format('<!DOCTYPE html>\n\nfoo\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout (1:1):

			After formatting, GitHub Flavored Markdown would no longer recognize this as an HTML block, and some of its content would be interpreted as Markdown]
		`);
	});

	test('rejects declarations that only Prettier reads as HTML blocks', async () => {
		await expect(format('<!doctype html>\n\nfoo\n', SPEC_EXAMPLE_OPTIONS))
			.rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (1:1):

			Prettier’s Markdown parser reads this as an HTML block, but GitHub Flavored Markdown reads it as Markdown]
		`);
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

	test('rejects HTML blocks that only Prettier lets interrupt a paragraph', async () => {
		await expect(
			format('foo\n<search>\nbar\n</search>\n', SPEC_EXAMPLE_OPTIONS)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
			[Error: [prettier-plugin-markdown-html] Unsupported Markdown (2:1):

			Prettier’s Markdown parser starts an HTML block here, but GitHub Flavored Markdown continues the paragraph above]
		`);
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
		};

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
		};
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
});
