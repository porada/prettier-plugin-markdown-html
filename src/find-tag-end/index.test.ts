import { expect, test } from 'vite-plus/test';
import findTagEnd from './index.ts';

test('finds the end of a tag outside quoted attribute values', () => {
	expect(findTagEnd('<a title="b>c" d=\'e>f\'>g', 0)).toBe(23);
	expect(findTagEnd('foo <b>', 4)).toBe(7);
});

test('returns `undefined` without a tag or its end', () => {
	expect(findTagEnd('foo', 0)).toBeUndefined();
	expect(findTagEnd('<a title=">', 0)).toBeUndefined();
});
