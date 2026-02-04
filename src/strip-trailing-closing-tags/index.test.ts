import { expect, test } from 'vitest';
import stripTrailingClosingTags from './index.ts';

test('strips closing tags from the end of an HTML fragment', () => {
	expect(
		stripTrailingClosingTags('<details><summary>foo</summary></details>', [
			'details',
		])
	).toStrictEqual('<details><summary>foo</summary>');

	expect(stripTrailingClosingTags('<p>foo</p>', [])).toStrictEqual(
		'<p>foo</p>'
	);

	expect(stripTrailingClosingTags('<p>foo</p>', ['details'])).toBeUndefined();
});
