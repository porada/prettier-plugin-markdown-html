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
	test.fails(
		'keeps indented markup after apparent footnote definitions as literal code',
		async () => {
			const input = `[^foo]: bar

    <div title = "baz">qux</div>
`;

			await expect(format(input, SPEC_EXAMPLE_OPTIONS)).resolves.toBe(
				input
			);
		}
	);
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
});

describe('Non-Element Markup', () => {
	test.fails(
		'preserves HTML generated from Markdown as comment content',
		async () => {
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
		}
	);
});

describe('Content and Whitespace', () => {
	test.fails(
		'keeps the opening tag of an HTML block on its own line',
		async () => {
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
		}
	);
});

describe('Blank Lines at Boundaries', () => {
	test.fails(
		'keeps one blank line around Markdown paragraphs inside nested HTML',
		async () => {
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
		}
	);

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
});

describe('Inline HTML', () => {
	test.fails(
		'keeps closing tags on one line when wrapping would start a block quote',
		async () => {
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
		}
	);

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
});
