import { expect, test } from 'vitest';
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

test('handles incorrect HTML', () => {
	expect(findUnclosedTags('<p></div>')).toStrictEqual(['p']);
	expect(findUnclosedTags('<div><p></div>')).toStrictEqual(['div', 'p']);
	expect(findUnclosedTags('<div <p>foo</p>')).toStrictEqual([]);
	expect(findUnclosedTags('<div><!-- foo <p>')).toStrictEqual(['div']);
});
