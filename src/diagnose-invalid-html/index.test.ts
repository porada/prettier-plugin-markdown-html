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

test('explains escaped double quotation marks in unfinished tags', async () => {
	const context = await renderMarkdown('<div title="foo\n\nbar " baz\n');

	const result = diagnoseInvalidHTML(context, context.html.length);

	expect(result).toStrictEqual({
		offset: 0,
		reason: 'This `<div>` tag isn’t closed before the end of the document. A double quotation mark in Markdown text becomes `&quot;`, so it doesn’t end the attribute value',
	});
});

test('skips less-than signs that don’t start tags', async () => {
	const context = await renderMarkdown('<div>\nfoo < bar\n\n<!-- baz\n');

	const result = diagnoseInvalidHTML(context, context.html.length);

	expect(result).toStrictEqual({
		offset: context.html.indexOf('<!--'),
		reason: 'This comment isn’t closed before the end of the document',
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

test('explains elements generated from Markdown that end inside unfinished tokens', async () => {
	const context = await renderMarkdown('> <div title="&foo;\n');

	const result = diagnoseInvalidHTML(context, context.html.indexOf('<div'));

	expect(result).toStrictEqual({
		offset: context.html.indexOf('<div'),
		reason: 'This `<div>` tag starts inside the block quote and continues past its end',
	});
});

test('leaves errors without a location to Prettier', async () => {
	const context = await renderMarkdown('foo\n');

	const result = diagnoseInvalidHTML(context, undefined);

	expect(result).toBeUndefined();
});

test('leaves unexpected closing tags without an open element to Prettier', async () => {
	const context = await renderMarkdown('</div>\n');

	const result = diagnoseInvalidHTML(context, 0);

	expect(result).toBeUndefined();
});

test('leaves errors outside closing tags to Prettier', async () => {
	const context = await renderMarkdown('<div title="&foo;"></div>\n');

	const result = diagnoseInvalidHTML(context, 0);

	expect(result).toBeUndefined();
});

test('skips closing tags without a matching opening tag when finding open elements', async () => {
	const context = await renderMarkdown(
		'<div>\n<foo:bar></bar>\n</div>\n</baz>\n'
	);

	const result = diagnoseInvalidHTML(context, context.html.indexOf('</baz>'));

	expect(result).toBeUndefined();
});

test('skips complete raw text elements when finding open elements', async () => {
	const context = await renderMarkdown(
		'<div>\n<textarea>foo</textarea>\n</span>\n'
	);

	const result = diagnoseInvalidHTML(
		context,
		context.html.indexOf('</span>')
	);

	expect(result).toStrictEqual({
		offset: context.html.indexOf('</span>'),
		reason: 'This `</span>` tag doesn’t match the `<div>` element that is still open',
	});
});

test('stops finding open elements at an unfinished token', async () => {
	const context = await renderMarkdown(
		'<div>\n<textarea>foo <b>bar</ textarea>\n</span>\n'
	);

	const result = diagnoseInvalidHTML(
		context,
		context.html.indexOf('</span>')
	);

	expect(result).toStrictEqual({
		offset: context.html.indexOf('</span>'),
		reason: 'This `</span>` tag doesn’t match the `<div>` element that is still open',
	});
});

test('reports the raw closing tag that the raw opening tags in a construct leave unmatched', async () => {
	const context = await renderMarkdown('*<em>foo</em> bar</em> baz*\n');

	const result = diagnoseInvalidHTML(
		context,
		context.html.lastIndexOf('</em>')
	);

	expect(result).toStrictEqual({
		offset: context.html.indexOf('</em> baz'),
		reason: 'This `</em>` tag is inside emphasized text, so it can’t close the `<em>` element outside it',
	});
});

test('explains raw closing tags after paragraph content without describing a paragraph line', async () => {
	const context = await renderMarkdown('<div>\n\nfoo</div>\n');

	const result = diagnoseInvalidHTML(context, context.html.indexOf('</p>'));

	expect(result).toStrictEqual({
		offset: context.html.indexOf('</div>'),
		reason: 'This `</div>` tag is inside a paragraph, so it can’t close the `<div>` element outside it',
	});
});

test('reports raw elements left open after closed ones in a construct', async () => {
	const context = await renderMarkdown('*<b>foo</b> <i>bar*\n');

	const result = diagnoseInvalidHTML(context, context.html.indexOf('</em>'));

	expect(result).toStrictEqual({
		offset: context.html.indexOf('<i>'),
		reason: 'This `<i>` element is still open when the surrounding emphasized text ends',
	});
});

test('ignores tags generated from Markdown when finding raw elements left open in a construct', async () => {
	const context = await renderMarkdown('*foo <em>bar*\n');

	const result = diagnoseInvalidHTML(context, context.html.indexOf('</p>'));

	expect(result).toStrictEqual({
		offset: context.html.lastIndexOf('<em>'),
		reason: 'This `<em>` element is still open when the surrounding paragraph ends',
	});
});

test('reads raw text elements whose closing tags are separate fragments once', async () => {
	const context = await renderMarkdown(
		'foo <textarea>bar</textarea> <i>baz\n'
	);

	const result = diagnoseInvalidHTML(context, context.html.indexOf('</p>'));

	expect(result).toStrictEqual({
		offset: context.html.indexOf('<i>'),
		reason: 'This `<i>` element is still open when the surrounding paragraph ends',
	});
});

test('leaves raw elements that implicitly close Markdown constructs to Prettier', async () => {
	const context = await renderMarkdown('- foo <li>bar</li>\n');

	const result = diagnoseInvalidHTML(
		context,
		context.html.lastIndexOf('</li>')
	);

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
