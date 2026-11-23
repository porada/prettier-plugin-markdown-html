import { expect, test } from 'vite-plus/test';
import scanRawHTML from './index.ts';

test('scans opening and closing tags with their names', () => {
	expect(scanRawHTML('<DIV class="foo">bar</div>')).toStrictEqual({
		state: undefined,
		tokens: [
			{
				end: 17,
				isSelfClosing: false,
				kind: 'opening-tag',
				name: 'div',
				sourceName: 'DIV',
				start: 0,
			},
			{
				end: 26,
				kind: 'closing-tag',
				name: 'div',
				sourceName: 'div',
				start: 20,
			},
		],
	});
});

test('keeps quoted brackets inside their tags', () => {
	expect(scanRawHTML(`<a title="<b>" alt='>'>`).tokens).toStrictEqual([
		{
			end: 23,
			isSelfClosing: false,
			kind: 'opening-tag',
			name: 'a',
			sourceName: 'a',
			start: 0,
		},
	]);
});

test('recognizes self-closing tags of any element', () => {
	expect(scanRawHTML('<div /><script/>').tokens).toStrictEqual([
		{
			end: 7,
			isSelfClosing: true,
			kind: 'opening-tag',
			name: 'div',
			sourceName: 'div',
			start: 0,
		},
		{
			end: 16,
			isSelfClosing: true,
			kind: 'opening-tag',
			name: 'script',
			sourceName: 'script',
			start: 7,
		},
	]);
});

test('reads closing tags with whitespace after `</`', () => {
	expect(scanRawHTML('</ foo ></bar ></\nbaz')).toStrictEqual({
		state: { construct: 'incomplete-tag', kind: 'opaque' },
		tokens: [
			{
				end: 8,
				kind: 'closing-tag',
				name: 'foo',
				sourceName: 'foo',
				start: 0,
			},
			{
				end: 15,
				kind: 'closing-tag',
				name: 'bar',
				sourceName: 'bar',
				start: 8,
			},
			{
				construct: 'incomplete-tag',
				end: undefined,
				kind: 'opaque',
				start: 15,
			},
		],
	});
});

test('reads closing tags with attributes or a slash in raw text as raw text', () => {
	expect(
		scanRawHTML('<script>a</script x>b</style/></script>')
	).toStrictEqual({
		state: undefined,
		tokens: [
			{
				end: 8,
				isSelfClosing: false,
				kind: 'opening-tag',
				name: 'script',
				sourceName: 'script',
				start: 0,
			},
			{ construct: 'raw-text', end: 30, kind: 'opaque', start: 8 },
			{
				end: 39,
				kind: 'closing-tag',
				name: 'script',
				sourceName: 'script',
				start: 30,
			},
		],
	});
});

test('skips text that starts no tag', () => {
	expect(scanRawHTML('1 < 2 <3').tokens).toStrictEqual([]);
});

test('resumes after `</` that starts no closing tag', () => {
	expect(scanRawHTML('a </x b</div>').tokens).toStrictEqual([
		{
			end: 13,
			kind: 'closing-tag',
			name: 'div',
			sourceName: 'div',
			start: 7,
		},
	]);
	expect(scanRawHTML('</br=foo>').tokens).toStrictEqual([]);
	expect(scanRawHTML('</x b')).toStrictEqual({
		state: { construct: 'incomplete-tag', kind: 'opaque' },
		tokens: [
			{
				construct: 'incomplete-tag',
				end: undefined,
				kind: 'opaque',
				start: 0,
			},
		],
	});
});

test('reads `</>` as a closing tag with an empty name', () => {
	expect(scanRawHTML('1 </> 2').tokens).toStrictEqual([
		{ end: 5, kind: 'closing-tag', name: '', sourceName: '', start: 2 },
	]);
});

test('scans opaque constructs, whose tag-like text is literal', () => {
	expect(
		scanRawHTML(
			'<!-- <foo> --><![CDATA[<bar>]]><!DOCTYPE html><?xml version="1.0"?>'
		).tokens
	).toStrictEqual([
		{ construct: 'comment', end: 14, kind: 'opaque', start: 0 },
		{ construct: 'cdata', end: 31, kind: 'opaque', start: 14 },
		{ construct: 'declaration', end: 46, kind: 'opaque', start: 31 },
		{
			construct: 'processing-instruction',
			end: 67,
			kind: 'opaque',
			start: 46,
		},
	]);
});

test('completes a processing instruction at its first `>`', () => {
	expect(scanRawHTML('<?foo >').tokens).toStrictEqual([
		{
			construct: 'processing-instruction',
			end: 7,
			kind: 'opaque',
			start: 0,
		},
	]);
	expect(scanRawHTML('<?report data="a>b" ?>').tokens).toStrictEqual([
		{
			construct: 'processing-instruction',
			end: 17,
			kind: 'opaque',
			start: 0,
		},
	]);
	expect(scanRawHTML('<?foo')).toStrictEqual({
		state: { construct: 'processing-instruction', kind: 'opaque' },
		tokens: [
			{
				construct: 'processing-instruction',
				end: undefined,
				kind: 'opaque',
				start: 0,
			},
		],
	});
});

test('continues an opaque construct that the HTML leaves open', () => {
	const first = scanRawHTML('<div><!-- foo');
	const second = scanRawHTML('bar --> <div>', first.state);

	expect(first).toStrictEqual({
		state: { construct: 'comment', kind: 'opaque' },
		tokens: [
			{
				end: 5,
				isSelfClosing: false,
				kind: 'opening-tag',
				name: 'div',
				sourceName: 'div',
				start: 0,
			},
			{ construct: 'comment', end: undefined, kind: 'opaque', start: 5 },
		],
	});
	expect(second).toStrictEqual({
		state: { construct: 'comment', kind: 'opaque' },
		tokens: [
			{ construct: 'comment', end: undefined, kind: 'opaque', start: 0 },
		],
	});
});

test('treats a tag that the HTML ends before completing as opaque', () => {
	expect(scanRawHTML('<p>foo</p><div title="bar')).toStrictEqual({
		state: { construct: 'incomplete-tag', kind: 'opaque' },
		tokens: [
			{
				end: 3,
				isSelfClosing: false,
				kind: 'opening-tag',
				name: 'p',
				sourceName: 'p',
				start: 0,
			},
			{
				end: 10,
				kind: 'closing-tag',
				name: 'p',
				sourceName: 'p',
				start: 6,
			},
			{
				construct: 'incomplete-tag',
				end: undefined,
				kind: 'opaque',
				start: 10,
			},
		],
	});
});

test('reads raw text through its closing tag in any letter case', () => {
	expect(scanRawHTML('<script>a("</div>")</SCRIPT >').tokens).toStrictEqual([
		{
			end: 8,
			isSelfClosing: false,
			kind: 'opening-tag',
			name: 'script',
			sourceName: 'script',
			start: 0,
		},
		{ construct: 'raw-text', end: 19, kind: 'opaque', start: 8 },
		{
			end: 29,
			kind: 'closing-tag',
			name: 'script',
			sourceName: 'SCRIPT',
			start: 19,
		},
	]);
	expect(scanRawHTML('<textarea></textarea>').tokens).toStrictEqual([
		{
			end: 10,
			isSelfClosing: false,
			kind: 'opening-tag',
			name: 'textarea',
			sourceName: 'textarea',
			start: 0,
		},
		{
			end: 21,
			kind: 'closing-tag',
			name: 'textarea',
			sourceName: 'textarea',
			start: 10,
		},
	]);
});

test('continues raw text that the HTML leaves open', () => {
	const first = scanRawHTML('<style>');
	const second = scanRawHTML('<b>foo</b>', first.state);
	const third = scanRawHTML('bar</style><b>', second.state);

	expect(first).toStrictEqual({
		state: { kind: 'raw-text', name: 'style' },
		tokens: [
			{
				end: 7,
				isSelfClosing: false,
				kind: 'opening-tag',
				name: 'style',
				sourceName: 'style',
				start: 0,
			},
		],
	});
	expect(second).toStrictEqual({
		state: { kind: 'raw-text', name: 'style' },
		tokens: [
			{ construct: 'raw-text', end: undefined, kind: 'opaque', start: 0 },
		],
	});
	expect(third).toStrictEqual({
		state: undefined,
		tokens: [
			{ construct: 'raw-text', end: 3, kind: 'opaque', start: 0 },
			{
				end: 11,
				kind: 'closing-tag',
				name: 'style',
				sourceName: 'style',
				start: 3,
			},
			{
				end: 14,
				isSelfClosing: false,
				kind: 'opening-tag',
				name: 'b',
				sourceName: 'b',
				start: 11,
			},
		],
	});
});

test('reads markup after a self-closing raw text tag', () => {
	expect(scanRawHTML('<script/><b>foo</b></script>').tokens).toStrictEqual([
		{
			end: 9,
			isSelfClosing: true,
			kind: 'opening-tag',
			name: 'script',
			sourceName: 'script',
			start: 0,
		},
		{
			end: 12,
			isSelfClosing: false,
			kind: 'opening-tag',
			name: 'b',
			sourceName: 'b',
			start: 9,
		},
		{
			end: 19,
			kind: 'closing-tag',
			name: 'b',
			sourceName: 'b',
			start: 15,
		},
		{
			end: 28,
			kind: 'closing-tag',
			name: 'script',
			sourceName: 'script',
			start: 19,
		},
	]);
});

test('closes self-closing raw text tags inside and outside foreign content', () => {
	expect(
		scanRawHTML('<svg><title/><rect/></svg><title/><b>').tokens
	).toStrictEqual([
		{
			end: 5,
			isSelfClosing: false,
			kind: 'opening-tag',
			name: 'svg',
			sourceName: 'svg',
			start: 0,
		},
		{
			end: 13,
			isSelfClosing: true,
			kind: 'opening-tag',
			name: 'title',
			sourceName: 'title',
			start: 5,
		},
		{
			end: 20,
			isSelfClosing: true,
			kind: 'opening-tag',
			name: 'rect',
			sourceName: 'rect',
			start: 13,
		},
		{
			end: 26,
			isInForeignContent: true,
			kind: 'closing-tag',
			name: 'svg',
			sourceName: 'svg',
			start: 20,
		},
		{
			end: 34,
			isSelfClosing: true,
			kind: 'opening-tag',
			name: 'title',
			sourceName: 'title',
			start: 26,
		},
		{
			end: 37,
			isSelfClosing: false,
			kind: 'opening-tag',
			name: 'b',
			sourceName: 'b',
			start: 34,
		},
	]);
});

test('continues foreign content that the HTML leaves open', () => {
	const first = scanRawHTML('<svg><g>');
	const second = scanRawHTML('</g><style/>', first.state);
	const third = scanRawHTML('<style>foo', second.state);
	const fourth = scanRawHTML('</style></svg>', third.state);

	expect(first.state).toStrictEqual({
		foreignElements: ['svg', 'g'],
		kind: 'foreign',
	});
	expect(second.state).toStrictEqual({
		foreignElements: ['svg'],
		kind: 'foreign',
	});
	expect(third.state).toStrictEqual({
		foreignElements: ['svg', 'style'],
		kind: 'raw-text',
		name: 'style',
	});
	expect(fourth.state).toBeUndefined();
});

test('leaves foreign content where an enclosing element closes', () => {
	expect(scanRawHTML('<div><svg></div><title/><b>')).toStrictEqual({
		state: undefined,
		tokens: [
			{
				end: 5,
				isSelfClosing: false,
				kind: 'opening-tag',
				name: 'div',
				sourceName: 'div',
				start: 0,
			},
			{
				end: 10,
				isSelfClosing: false,
				kind: 'opening-tag',
				name: 'svg',
				sourceName: 'svg',
				start: 5,
			},
			{
				end: 16,
				isInForeignContent: true,
				kind: 'closing-tag',
				name: 'div',
				sourceName: 'div',
				start: 10,
			},
			{
				end: 24,
				isSelfClosing: true,
				kind: 'opening-tag',
				name: 'title',
				sourceName: 'title',
				start: 16,
			},
			{
				end: 27,
				isSelfClosing: false,
				kind: 'opening-tag',
				name: 'b',
				sourceName: 'b',
				start: 24,
			},
		],
	});
});

test('reads the content of SVG titles as raw text', () => {
	expect(
		scanRawHTML('<svg><title><b>foo</b></title></svg>').tokens
	).toStrictEqual([
		{
			end: 5,
			isSelfClosing: false,
			kind: 'opening-tag',
			name: 'svg',
			sourceName: 'svg',
			start: 0,
		},
		{
			end: 12,
			isSelfClosing: false,
			kind: 'opening-tag',
			name: 'title',
			sourceName: 'title',
			start: 5,
		},
		{ construct: 'raw-text', end: 22, kind: 'opaque', start: 12 },
		{
			end: 30,
			kind: 'closing-tag',
			name: 'title',
			sourceName: 'title',
			start: 22,
		},
		{
			end: 36,
			isInForeignContent: true,
			kind: 'closing-tag',
			name: 'svg',
			sourceName: 'svg',
			start: 30,
		},
	]);
});

test('ends raw text at a closing tag with whitespace after `</`', () => {
	expect(
		scanRawHTML('<script>foo</ script>bar</script>').tokens
	).toStrictEqual([
		{
			end: 8,
			isSelfClosing: false,
			kind: 'opening-tag',
			name: 'script',
			sourceName: 'script',
			start: 0,
		},
		{ construct: 'raw-text', end: 11, kind: 'opaque', start: 8 },
		{
			end: 21,
			kind: 'closing-tag',
			name: 'script',
			sourceName: 'script',
			start: 11,
		},
		{
			end: 33,
			kind: 'closing-tag',
			name: 'script',
			sourceName: 'script',
			start: 24,
		},
	]);
});
