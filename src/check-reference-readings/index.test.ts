import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test } from 'vite-plus/test';
import renderDocumentContext from '../render-document-context/index.ts';
import checkReferenceReadings from './index.ts';

async function check(text: string, isProtected = false): Promise<void> {
	const root = pluginMarkdown.parsers.markdown.parse(text, {
		originalText: text,
	} as ParserOptions) as AST.RootNode;
	const context = renderDocumentContext(root, { source: text });

	const protectedRanges = isProtected
		? [{ description: 'comment', end: context.html.length, start: 0 }]
		: [];

	await checkReferenceReadings(
		context,
		protectedRanges,
		new Map(),
		() => false,
		{
			filepath: 'foo.md',
			originalText: text,
			parser: 'markdown',
			plugins: [],
			printWidth: 80,
			tabWidth: 4,
		} as unknown as ParserOptions
	);
}

test('skips constructs without raw HTML', async () => {
	await expect(check("---\nfoo: 'bar'\n---\n")).resolves.toBeUndefined();
	await expect(check('[^foo]:\n\n    bar  baz\n')).resolves.toBeUndefined();
});

test('accepts formatting that keeps raw HTML and the elements around it', async () => {
	await expect(
		check('[^foo]: bar <b>baz</b>  qux\n')
	).resolves.toBeUndefined();
	await expect(
		check('[^foo]: bar <b>baz</b>\n\n    qux  quux\n')
	).resolves.toBeUndefined();
});

test('rejects formatting that changes raw HTML or the elements around it', async () => {
	await expect(check('[^foo]: bar <b>baz</b>\n    - <i>qux</i>\n')).rejects
		.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (1:1):

		Formatting this footnote definition would change how GitHub Flavored Markdown renders the raw HTML in it]
	`);
});

test('checks constructs inside protected content completely', async () => {
	await expect(check('[^foo]:\n\n    bar  baz\n', true)).rejects
		.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (1:1):

		Formatting this footnote definition would change the content of the comment that contains it]
	`);
});
