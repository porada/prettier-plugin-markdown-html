import { format } from 'prettier';
import { expect, test, vi } from 'vitest';
import formatHTML from './index.ts';

vi.mock(import('prettier'), async (importActual) => {
	const actual = await importActual();

	return {
		...actual,
		format: vi.fn(() => {
			throw new Error();
		}),
	};
});

test('formats HTML', async () => {
	let result = await formatHTML('foo');

	expect(result).toBe('foo');
	expect(format).toHaveBeenCalledWith('foo', {
		filepath: 'prettier-plugin-markdown-html.html',
		parser: 'html',
	});

	result = await formatHTML('bar', {
		plugins: ['prettier-plugin-baz'],
		printer: vi.fn(),
	});

	expect(result).toBe('bar');
	expect(format).toHaveBeenCalledWith('bar', {
		filepath: 'prettier-plugin-markdown-html.html',
		parser: 'html',
		plugins: ['prettier-plugin-baz'],
	});
});
