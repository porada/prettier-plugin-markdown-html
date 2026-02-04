import { expect, test } from 'vitest';
import findUnclosedTags from './index.ts';

test('finds unclosed tags in an HTML fragment', () => {
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
});

test('handles incorrectly nested tags', () => {
	expect(findUnclosedTags('<p></div>')).toStrictEqual(['p']);
	expect(findUnclosedTags('<div><p></div>')).toStrictEqual(['div', 'p']);
});
