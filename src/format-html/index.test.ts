import { format } from 'prettier';
import * as pluginHTML from 'prettier/plugins/html';
import { expect, test, vi } from 'vite-plus/test';
import formatHTML from './index.ts';

vi.mock(import('prettier'), async (importActual) => {
	const actual = await importActual();

	return {
		...actual,
		format: vi.fn(async (text: string) => Promise.resolve(text)),
	};
});

test('formats HTML', async () => {
	let result = await formatHTML('foo');

	expect(result).toBe('foo');
	expect(format).toHaveBeenCalledWith('foo', {
		endOfLine: 'lf',
		filepath: 'prettier-plugin-markdown-html.html',
		parser: 'html',
		plugins: [pluginHTML],
	});

	result = await formatHTML('bar', {
		endOfLine: 'crlf',
		plugins: ['prettier-plugin-baz'],
		printer: vi.fn(),
	});

	expect(result).toBe('bar');
	expect(format).toHaveBeenCalledWith('bar', {
		endOfLine: 'lf',
		filepath: 'prettier-plugin-markdown-html.html',
		parser: 'html',
		plugins: [pluginHTML, 'prettier-plugin-baz'],
	});
});
