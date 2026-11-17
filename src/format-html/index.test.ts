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
	const output = await formatHTML('foo');

	expect(output).toBe('foo');
	expect(format).toHaveBeenCalledWith('foo', {
		endOfLine: 'lf',
		filepath: undefined,
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
		filepath: undefined,
		parser: 'html',
		plugins: [pluginHTML, 'prettier-plugin-bar'],
	});
});

test('passes the Markdown file path', async () => {
	const output = await formatHTML('foo', { filepath: 'foo/bar.md' });

	expect(output).toBe('foo');
	expect(format).toHaveBeenCalledWith('foo', {
		endOfLine: 'lf',
		filepath: 'foo/bar.md',
		parser: 'html',
		plugins: [pluginHTML],
	});
});

test('removes HTML extensions from file paths', async () => {
	const output = await formatHTML('foo', { filepath: 'foo/bar.htm.html' });

	expect(output).toBe('foo');
	expect(format).toHaveBeenCalledWith('foo', {
		endOfLine: 'lf',
		filepath: 'foo/bar',
		parser: 'html',
		plugins: [pluginHTML],
	});
});
