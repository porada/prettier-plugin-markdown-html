import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test } from 'vite-plus/test';
import renderDocumentContext from '../render-document-context/index.ts';
import checkReferenceReadings from './index.ts';

async function check(text: string): Promise<void> {
	const root = pluginMarkdown.parsers.markdown.parse(text, {
		originalText: text,
	} as ParserOptions) as AST.RootNode;
	const context = renderDocumentContext(root, { source: text });

	await checkReferenceReadings(context, () => false, {
		filepath: 'foo.md',
		originalText: text,
		parser: 'markdown',
		plugins: [],
		printWidth: 80,
		tabWidth: 4,
	} as unknown as ParserOptions);
}

test('accepts formatting that keeps the reference rendering', async () => {
	await expect(check('---\nfoo:   bar\n---\n')).resolves.toBeUndefined();
	await expect(check('[^foo]: bar  baz\n')).resolves.toBeUndefined();
	await expect(check('foo\n')).resolves.toBeUndefined();
});

test('rejects formatting that changes the reference rendering', async () => {
	await expect(check("---\nfoo: 'bar'\n---\n")).rejects
		.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (1:1):

		Formatting this frontmatter would change how GitHub Flavored Markdown renders it]
	`);
	await expect(check('[^foo]: bar\n\n    baz  qux\n')).rejects
		.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (1:1):

		Formatting this footnote definition would change how GitHub Flavored Markdown renders it]
	`);
});
