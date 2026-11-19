import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test } from 'vite-plus/test';
import checkFenceFormatting from './index.ts';

function parse(text: string): AST.RootNode {
	return pluginMarkdown.parsers.markdown.parse(text, {
		originalText: text,
	} as ParserOptions) as AST.RootNode;
}

function check(
	text: string,
	options: Partial<ParserOptions> = {},
	root: AST.Node = parse(text)
): void {
	checkFenceFormatting(root, {
		filepath: 'foo.md',
		originalText: text,
		proseWrap: 'preserve',
		...options,
	} as ParserOptions);
}

test('accepts fence syntax that formatting keeps', () => {
	expect(() => {
		check('foo ``` bar\n\n<div   >baz</div>\n');
	}).not.toThrow();
	expect(() => {
		check('foo ```bar`baz`\n<span   >qux</span>\n', {
			proseWrap: 'always',
		});
	}).not.toThrow();
	expect(() => {
		check('~~~foo\n<div   >bar</div>\n~~~\n');
	}).not.toThrow();
});

test('accepts fence syntax without raw HTML syntax after it', () => {
	expect(() => {
		check('<div   >foo</div>\n\nbar\n\t```\n');
	}).not.toThrow();
});

test('rejects indented lines that formatting turns into fence openings', () => {
	expect(() => {
		check('foo\n\t```\n\n<div   >bar</div>\n');
	}).toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (2:2):

		Prettier’s Markdown formatting would remove the indentation of this line, so it would open a code fence, and later raw HTML could render as code]
	`);
	expect(() => {
		check('- foo\n  bar\n      ~~~\n\n<div   >baz</div>\n');
	}).toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (3:7):

		Prettier’s Markdown formatting would remove the indentation of this line, so it would open a code fence, and later raw HTML could render as code]
	`);
});

test('rejects indented fence openings that continue a link reference definition', () => {
	expect(() => {
		check('[foo]: /bar\n\t```\nbaz <span   >qux</span>\n');
	}).toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (2:2):

		Prettier’s Markdown formatting would remove the indentation of this line, so it would open a code fence, and later raw HTML could render as code]
	`);
});

test('accepts indented lines that Prettier joins when `proseWrap` is `never`', () => {
	expect(() => {
		check('foo\n    ```\n<div   >bar</div>\n', { proseWrap: 'never' });
	}).not.toThrow();
});

test('rejects indented lines after hard breaks when `proseWrap` is `never`', () => {
	expect(() => {
		check('foo  \n    ```\n\n<div   >bar</div>\n', { proseWrap: 'never' });
	}).toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (2:5):

		Prettier’s Markdown formatting would remove the indentation of this line, so it would open a code fence, and later raw HTML could render as code]
	`);
});

test('accepts indented lines after escaped backslashes when `proseWrap` is `never`', () => {
	expect(() => {
		check('foo\\\\\\\\\n\t```\n\n<div   >bar</div>\n', {
			proseWrap: 'never',
		});
	}).not.toThrow();
});

test('accepts indented lines inside inline HTML', () => {
	expect(() => {
		check('foo <span title="bar  \n    ```">baz</span>\n', {
			proseWrap: 'never',
		});
	}).not.toThrow();
});

test('rejects indented lines inside inline HTML without source positions', () => {
	const text = 'foo <span title="bar  \n    ```">baz</span>\n';
	const root = parse(text);

	delete root.children[0]!.children![1]!.position;

	expect(() => {
		check(text, { proseWrap: 'never' }, root);
	}).toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (2:5):

		Prettier’s Markdown formatting would remove the indentation of this line, so it would open a code fence, and later raw HTML could render as code]
	`);
});

test('accepts indented paragraph lines with character references', () => {
	expect(() => {
		check('foo\n\t```bar&lt;i&gt;\n');
	}).not.toThrow();
});

test('accepts fence info strings with text that only looks like a character reference', () => {
	expect(() => {
		check('~~~foo `bar` &BAZ_QUX;\n~~~\n');
	}).not.toThrow();
});

test('accepts fence syntax after a no-break space at the start of a paragraph line', () => {
	expect(() => {
		check('foo\n\u00A0~~~ bar\n\n<div   >baz</div>\n');
	}).not.toThrow();
	expect(() => {
		check('foo\n    \u00A0~~~ bar\n\n<div   >baz</div>\n');
	}).not.toThrow();
});

test('accepts fence syntax that other whitespace keeps inside a word with `proseWrap` set to `always`', () => {
	expect(() => {
		check('foo\u00A0~~~ bar\n<span   >baz</span>\n', {
			proseWrap: 'always',
		});
	}).not.toThrow();
	expect(() => {
		check('foo\u2028~~~ bar\n<span   >baz</span>\n', {
			proseWrap: 'always',
		});
	}).not.toThrow();
	expect(() => {
		check('foo ```bar\u00A0`baz`\n<span   >qux</span>\n', {
			proseWrap: 'always',
		});
	}).not.toThrow();
});

test('accepts fence syntax in the text of inline links with `proseWrap` set to `always`', () => {
	expect(() => {
		check('foo [bar ~~~ baz](/qux)\n<span   >quux</span>\n', {
			proseWrap: 'always',
		});
	}).not.toThrow();
});

test('rejects fence syntax in the visible text of reference links with `proseWrap` set to `always`', () => {
	expect(() => {
		check(
			'foo [bar ~~~ baz][qux]\n<span   >quux</span>\n\n[qux]: /corge\n',
			{
				proseWrap: 'always',
			}
		);
	}).toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (1:10):

		With \`proseWrap\` set to \`always\`, Prettier’s Markdown formatting can wrap this line here, where it would open a code fence, and later raw HTML could render as code]
	`);
});

test('rejects words that wrapping can move into fence openings', () => {
	expect(() => {
		check('foo ```bar `baz`\n<span   >qux</span>\n', {
			proseWrap: 'always',
		});
	}).toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (1:5):

		With \`proseWrap\` set to \`always\`, Prettier’s Markdown formatting can wrap this line here, where it would open a code fence, and later raw HTML could render as code]
	`);
	expect(() => {
		check('```bar `baz`\n<span   >qux</span>\n', { proseWrap: 'always' });
	}).toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (1:1):

		With \`proseWrap\` set to \`always\`, Prettier’s Markdown formatting can wrap this line here, where it would open a code fence, and later raw HTML could render as code]
	`);
});

test('rejects tilde fences whose info string contains a backtick', () => {
	expect(() => {
		check('~~~foo `bar`\n<div   >baz</div>\n~~~\n');
	}).toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (1:1):

		Prettier’s Markdown formatting would rewrite this tilde fence with backticks, which GitHub Flavored Markdown doesn’t read as a fence when its info string contains a backtick, so markup in it could become raw HTML]
	`);
});

test('rejects tilde fences whose info string contains a backtick after a line separator', () => {
	expect(() => {
		check('~~~foo\u2028`bar`\n<div   >baz</div>\n~~~\n');
	}).toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (1:1):

		Prettier’s Markdown formatting would rewrite this tilde fence with backticks, which GitHub Flavored Markdown doesn’t read as a fence when its info string contains a backtick, so markup in it could become raw HTML]
	`);
});

test('rejects fence info strings that decode to a backtick', () => {
	expect(() => {
		check('```foo&#96;\n<div   >bar</div>\n```\n');
	}).toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (1:1):

		Prettier’s Markdown formatting would decode a character reference in this fence’s info string into a backtick, which GitHub Flavored Markdown doesn’t allow there, so markup in the fence could become raw HTML]
	`);
});

test('skips documents without source text', () => {
	expect(() => {
		checkFenceFormatting(
			{ children: [], type: 'root' },
			{} as ParserOptions
		);
	}).not.toThrow();
});

test('skips paragraphs without source positions', () => {
	const text = 'foo\n\t```\n\n<div   >bar</div>\n';
	const root = parse(text);

	delete root.children[0]!.position;

	expect(() => {
		check(text, {}, root);
	}).not.toThrow();
});

test('skips text without source offsets when `proseWrap` is `always`', () => {
	const text = '```\nfoo\n```\n\nbar\n\n```\nbaz\n```\n\n<div   >qux</div>\n';
	const rootWithoutStart = parse(text);
	const rootWithoutEnd = parse(text);

	delete rootWithoutStart.children[1]!.children![0]!.position!.start.offset;
	delete rootWithoutEnd.children[1]!.children![0]!.position!.end.offset;

	expect(() => {
		check(text, { proseWrap: 'always' }, rootWithoutStart);
	}).not.toThrow();
	expect(() => {
		check(text, { proseWrap: 'always' }, rootWithoutEnd);
	}).not.toThrow();
});

test('skips code blocks without source positions', () => {
	const text = '~~~foo `bar`\n<div   >baz</div>\n~~~\n';
	const root = parse(text);

	delete root.children[0]!.position;

	expect(() => {
		check(text, {}, root);
	}).not.toThrow();
});
