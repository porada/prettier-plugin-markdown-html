import { expect, test } from 'vite-plus/test';
import isRawTextTag from './index.ts';

test('identifies raw text tag names', () => {
	expect(isRawTextTag('p')).toBe(false);
	expect(isRawTextTag('script')).toBe(true);
});
