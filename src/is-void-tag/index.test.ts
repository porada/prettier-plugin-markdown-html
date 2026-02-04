import { expect, test } from 'vitest';
import isVoidTag from './index.ts';

test('identifies void tag names', () => {
	expect(isVoidTag('img')).toBe(true);
	expect(isVoidTag('p')).toBe(false);
});
