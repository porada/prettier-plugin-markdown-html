import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import { beforeEach, expect, test, vi } from 'vitest';
import formatHTML from '../format-html/index.ts';
import preprocessMarkdown from './index.ts';

vi.mock('../format-html/index.ts', () => ({
	default: vi.fn(async (text: string) => {
		/* oxlint-disable-next-line eslint/no-promise-executor-return */
		await new Promise((resolve) => setTimeout(resolve));
		return text;
	}),
}));

beforeEach(() => {
	vi.clearAllMocks();
});

test('processes root nodes only', async () => {
	const node: AST.Node = { type: 'html', value: '<p>foo</p>' };

	const result = await preprocessMarkdown(node, {} as ParserOptions);

	expect(result).toBe(node);
	expect(formatHTML).not.toHaveBeenCalled();
});

test('formats HTML in group of nodes', async () => {
	const root: AST.RootNode = {
		type: 'root',
		children: [
			{ type: 'html', value: '<div>' },
			{ type: 'html', value: '<p>foo</p></div>' },
			{ type: 'text', value: 'bar' },
		],
	};

	vi.mocked(formatHTML).mockResolvedValueOnce('<div><p>foo</p></div>');

	await preprocessMarkdown(root, {} as ParserOptions);

	expect(formatHTML).toHaveBeenCalledWith('<div>\n<p>foo</p></div>', {});
	expect(root.children).toStrictEqual([
		{ type: 'html', value: '<div><p>foo</p></div>' },
		{ type: 'text', value: 'bar' },
	]);
});

test('keeps closing tags without formatting', async () => {
	const root: AST.RootNode = {
		type: 'root',
		children: [
			{ type: 'html', value: '</div>' },
			{ type: 'text', value: 'foo' },
		],
	};

	await preprocessMarkdown(root, {} as ParserOptions);

	expect(formatHTML).not.toHaveBeenCalled();
	expect(root.children).toStrictEqual([
		{ type: 'html', value: '</div>' },
		{ type: 'text', value: 'foo' },
	]);
});

test('keeps original nodes when trailing closing tags can’t be stripped', async () => {
	const node: AST.Node = { type: 'html', value: '<div><p>foo</p>' };

	const root: AST.RootNode = {
		type: 'root',
		children: [node],
	};

	vi.mocked(formatHTML).mockResolvedValueOnce('<div><p>foo</p>');

	await preprocessMarkdown(root, {} as ParserOptions);

	expect(root.children).toStrictEqual([node]);
	expect(root.children[0]!.value).toBe('<div><p>foo</p>');
});
