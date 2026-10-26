import { format } from 'prettier';
import * as pluginHTML from 'prettier/plugins/html';
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import formatHTML from './index.ts';

vi.mock(import('prettier'), async (importActual) => {
	const actual = await importActual();

	return {
		...actual,
		format: vi.fn(async (text: string) => Promise.resolve(text)),
	};
});

beforeEach(() => {
	vi.clearAllMocks();
});

test('formats HTML', async () => {
	const output = await formatHTML('foo');

	expect(output).toBe('foo');
	expect(format).toHaveBeenCalledWith('foo', {
		endOfLine: 'lf',
		filepath: 'prettier-plugin-markdown-html.html',
		parser: 'html',
		plugins: [pluginHTML],
	});
});

test('overrides line endings, appends plugins, and omits parser options', async () => {
	const output = await formatHTML('foo', {
		endOfLine: 'crlf',
		plugins: ['prettier-plugin-bar'],
		printer: vi.fn(),
	});

	expect(output).toBe('foo');
	expect(format).toHaveBeenCalledWith('foo', {
		endOfLine: 'lf',
		filepath: 'prettier-plugin-markdown-html.html',
		parser: 'html',
		plugins: [pluginHTML, 'prettier-plugin-bar'],
	});
});
