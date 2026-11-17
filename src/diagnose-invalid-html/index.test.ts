import type { AST } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test } from 'vite-plus/test';
import renderDocumentContext from '../render-document-context/index.ts';
import diagnoseInvalidHTML, { describeSplitConstruct } from './index.ts';

async function renderMarkdown(text: string): Promise<AST.DocumentContext> {
	const root = (await pluginMarkdown.parsers.markdown.parse(text, {
		originalText: text,
	} as never)) as AST.RootNode;

	return renderDocumentContext(root, { source: text });
}

test('points to the start of an unfinished token', async () => {
	const context = await renderMarkdown('foo\n\n<![CDATA[bar\n');

	const result = diagnoseInvalidHTML(context, context.html.length);

	expect(result).toStrictEqual({
		offset: context.html.indexOf('<![CDATA['),
		reason: 'This CDATA section isn’t closed before the end of the document',
	});
});

test('explains elements generated from Markdown that tokens split', async () => {
	const context = await renderMarkdown(
		'foo <textarea>bar\n\nbaz</textarea> qux\n'
	);

	const result = diagnoseInvalidHTML(context, undefined);

	expect(result).toStrictEqual({
		offset: context.html.indexOf('<textarea>'),
		reason: 'This `<textarea>` element starts inside the paragraph and continues past its end',
	});
});

test('leaves unexpected closing tags without an open element to Prettier', async () => {
	const context = await renderMarkdown('</div>\n');

	const result = diagnoseInvalidHTML(context, 0);

	expect(result).toBeUndefined();
});

test('describes constructs that tokens split in several ways', () => {
	const comment = { description: 'comment' };
	const textarea = { description: '`<textarea>` element' };

	expect(describeSplitConstruct('paragraph', comment, textarea)).toBe(
		'This paragraph starts inside one HTML token (comment) and ends inside another (`<textarea>` element)'
	);
	expect(describeSplitConstruct('list item', comment, undefined)).toBe(
		'This comment contains the start of the list item but not its end'
	);
	expect(describeSplitConstruct('emphasis', undefined, textarea)).toBe(
		'This `<textarea>` element starts inside the emphasis and continues past its end'
	);
});
