import { expect, test } from 'vite-plus/test';
import isBlockTag from './index.ts';

test('identifies block tag names', () => {
	for (const tagName of ['address', 'hgroup', 'meta', 'script', 'source']) {
		expect(isBlockTag(tagName)).toBe(true);
	}

	expect(isBlockTag('span')).toBe(false);
});
