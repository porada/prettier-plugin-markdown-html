import { expect, test } from 'vitest';
import extractLeadingClosingTags from './index.ts';

test('extracts closing tags from the beginning of an HTML fragment', () => {
	expect(
		extractLeadingClosingTags('\t</details>\t\r\n\t</div> <p>foo</p>')
	).toStrictEqual({
		closingTags: '</details>\n</div>',
		html: '<p>foo</p>',
	});

	expect(extractLeadingClosingTags('<p>foo</p>')).toStrictEqual({
		closingTags: '',
		html: '<p>foo</p>',
	});

	expect(extractLeadingClosingTags('<img src="#" />')).toStrictEqual({
		closingTags: '',
		html: '<img src="#" />',
	});
});
