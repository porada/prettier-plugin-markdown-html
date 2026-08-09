import { expect, test } from 'vite-plus/test';
import isBlockTag from './index.ts';

test('identifies block tag names', () => {
	expect(isBlockTag('address')).toBe(true);
	expect(isBlockTag('hgroup')).toBe(true);
	expect(isBlockTag('meta')).toBe(true);
	expect(isBlockTag('script')).toBe(true);
	expect(isBlockTag('source')).toBe(true);
	expect(isBlockTag('span')).toBe(false);
});
