import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test } from 'vite-plus/test';
import removeHTMLNode from './index.ts';

type Node = { children?: Node[]; type: string; value?: string };

async function parseMarkdown(markdown: string): Promise<AST.Node> {
	const options = { originalText: markdown } as unknown as ParserOptions;

	return (await pluginMarkdown.printers.mdast.preprocess!(
		await pluginMarkdown.parsers.markdown.parse(markdown, options),
		options
	)) as AST.Node;
}

function readNode({ children, type, value }: AST.Node): Node {
	return {
		type: type!,
		...(value === undefined ? {} : { value }),
		...(children ? { children: children.map(readNode) } : {}),
	};
}

test('removes an HTML node from a new array of its parent’s children', async () => {
	const root = await parseMarkdown('<img src="foo.png"></img> bar\n');
	const paragraph = root.children![0]!;
	const children = paragraph.children!;

	removeHTMLNode(children[1]!, paragraph);

	expect(readNode(paragraph)).toStrictEqual({
		children: [
			{ type: 'html', value: '<img src="foo.png">' },
			{
				children: [
					{ type: 'whitespace', value: ' ' },
					{ type: 'word', value: 'bar' },
				],
				type: 'sentence',
			},
		],
		type: 'paragraph',
	});
	expect(children.map(readNode)).toStrictEqual([
		{ type: 'html', value: '<img src="foo.png">' },
		{ type: 'html', value: '</img>' },
		{
			children: [
				{ type: 'whitespace', value: ' ' },
				{ type: 'word', value: 'bar' },
			],
			type: 'sentence',
		},
	]);
});
