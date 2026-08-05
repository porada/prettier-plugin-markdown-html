import { expect, test } from 'vite-plus/test';
import findUnclosedTags from './index.ts';

test('finds unclosed tags in an HTML fragment', () => {
	expect(findUnclosedTags('foo')).toStrictEqual([]);

	expect(findUnclosedTags('<details><summary>foo</summary>')).toStrictEqual([
		'details',
	]);

	expect(findUnclosedTags('<div align="center"><p>foo')).toStrictEqual([
		'div',
		'p',
	]);

	expect(
		findUnclosedTags('<p><img src="#" /><!-- <div> --></p>')
	).toStrictEqual([]);

	expect(findUnclosedTags('<div title="<p>">foo</div>')).toStrictEqual([]);
});

test('handles raw text HTML tags', () => {
	expect(
		findUnclosedTags('<script>const foo = "<div>";</script>')
	).toStrictEqual([]);
	expect(findUnclosedTags('<script>const foo = "<div>";')).toStrictEqual([
		'script',
	]);
	expect(
		findUnclosedTags('<style>.foo::before { content: "<div>"; }</style>')
	).toStrictEqual([]);
	expect(
		findUnclosedTags('<style>.foo::before { content: "<div>"; }')
	).toStrictEqual(['style']);
	expect(findUnclosedTags('<textarea><div></textarea>')).toStrictEqual([]);
	expect(findUnclosedTags('<textarea><div>')).toStrictEqual(['textarea']);
});

test('handles optional HTML end tags', () => {
	expect(
		findUnclosedTags(
			'<ul><li id="a" class="x">one<li id="b" class="y">two</ul>'
		)
	).toStrictEqual([]);
	expect(findUnclosedTags('<dl><dt>term<dd>definition</dl>')).toStrictEqual(
		[]
	);
	expect(findUnclosedTags('<div><p>foo</div>')).toStrictEqual([]);
	expect(findUnclosedTags('<ruby><rt>foo<rp>(</ruby>')).toStrictEqual([]);
	expect(
		findUnclosedTags('<select><optgroup><option>one<option>two</select>')
	).toStrictEqual([]);
	expect(
		findUnclosedTags('<table><thead><tr><th>a<tbody><tr><td>b<td>c</table>')
	).toStrictEqual([]);
	expect(
		findUnclosedTags(
			'<table><caption>foo<colgroup><col><tbody><tr><td>bar</table>'
		)
	).toStrictEqual([]);
});

test('handles incorrect HTML', () => {
	expect(findUnclosedTags('</img>')).toStrictEqual([]);
	expect(findUnclosedTags('<p></div>')).toStrictEqual(['p']);
	expect(findUnclosedTags('<div><span></div>')).toStrictEqual([
		'div',
		'span',
	]);
	expect(findUnclosedTags('<dl><dt>foo</dl>')).toStrictEqual(['dl', 'dt']);
	expect(findUnclosedTags('<div <p>foo</p>')).toStrictEqual([]);
	expect(findUnclosedTags('<div><!-- foo <p>')).toStrictEqual(['div']);
});
