import type { AST } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test } from 'vite-plus/test';
import isLooseList from './index.ts';

test('detects loose lists from the list or any of its items', () => {
	expect(isLooseList({ spread: true, type: 'list' } as never)).toBe(true);
	expect(
		isLooseList({
			children: [
				{ type: 'listItem' },
				{ spread: true, type: 'listItem' },
			],
			type: 'list',
		} as never)
	).toBe(true);
	expect(
		isLooseList({
			children: [{ spread: false, type: 'listItem' }],
			spread: false,
			type: 'list',
		} as never)
	).toBe(false);
	expect(isLooseList({ type: 'list' })).toBe(false);
});

test('detects items that an open HTML block separates with a blank line', () => {
	const openBlockItem = {
		children: [{ type: 'html', value: '<?foo >\n\n' }],
		type: 'listItem',
	};

	expect(
		isLooseList({
			children: [openBlockItem, { type: 'listItem' }],
			type: 'list',
		})
	).toBe(true);
	expect(
		isLooseList({
			children: [{ type: 'listItem' }, openBlockItem],
			type: 'list',
		})
	).toBe(false);
	expect(
		isLooseList({
			children: [
				{
					children: [{ children: [openBlockItem], type: 'list' }],
					type: 'listItem',
				},
				{ type: 'listItem' },
			],
			type: 'list',
		})
	).toBe(true);
});

test('detects blank lines between open HTML blocks and the next child', async () => {
	const looseSource = '- foo\n  - <?bar >\n\n  baz\n';
	const tightSource = '- foo\n  - <?bar >\n  baz\n';
	const looseRoot = (await pluginMarkdown.parsers.markdown.parse(
		looseSource,
		{
			originalText: looseSource,
		} as never
	)) as AST.RootNode;
	const tightRoot = (await pluginMarkdown.parsers.markdown.parse(
		tightSource,
		{
			originalText: tightSource,
		} as never
	)) as AST.RootNode;

	expect(isLooseList(looseRoot.children[0]!, looseSource)).toBe(true);
	expect(isLooseList(tightRoot.children[0]!, tightSource)).toBe(false);
});

test('detects blank lines after nested lists in block quotes', async () => {
	const source = '> - foo\n>   - bar\n>\n> - baz\n';
	const root = (await pluginMarkdown.parsers.markdown.parse(source, {
		originalText: source,
	} as never)) as AST.RootNode;
	const list = root.children[0]!.children![0]!;

	expect(isLooseList(list, source)).toBe(true);
});
