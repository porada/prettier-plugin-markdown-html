import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test } from 'vite-plus/test';
import formatInlineHTML from './index.ts';

const OPTIONS = { printWidth: 30, tabWidth: 4 } as ParserOptions;

async function parseParagraph(source: string): Promise<{
	fragment: AST.Fragment;
	layout: AST.InlineLayout;
}> {
	const root = (await pluginMarkdown.parsers.markdown.parse(
		source,
		{} as ParserOptions
	)) as AST.Node;
	const paragraph = root.children![0]!;
	const node = paragraph.children!.find(
		(child) => child.type === 'html'
	) as AST.HTMLNode;

	return {
		fragment: createFragment(node.value, {
			block: paragraph,
			end: node.position!.end.offset!,
			node,
			parent: paragraph,
			start: node.position!.start.offset!,
		}),
		layout: { containerEdge: 0, containers: [], contentEdge: 0, paragraph },
	};
}

function createFragment(
	value: string,
	overrides: Partial<AST.Fragment> = {}
): AST.Fragment {
	const node: AST.HTMLNode = { type: 'html', value };

	return {
		block: undefined,
		end: value.length,
		isBlock: false,
		isInTableCell: false,
		isSingleLine: false,
		node,
		parent: { children: [node], type: 'paragraph' },
		start: 0,
		...overrides,
	};
}

test('formats opening tags without their closing tags', async () => {
	const fragment = createFragment('<span   id = "foo">');
	const formattedNodes = new WeakSet<AST.Node>();

	await formatInlineHTML(
		[fragment],
		undefined,
		new Set(),
		OPTIONS,
		formattedNodes
	);

	expect(fragment.node.value).toBe('<span id="foo">');
	expect(formattedNodes.has(fragment.node)).toBe(true);
});

test('formats void and closing tags', async () => {
	const voidFragment = createFragment('<img   src="foo.png">');
	const closingFragment = createFragment('</span   >');

	await formatInlineHTML(
		[voidFragment],
		undefined,
		new Set(),
		OPTIONS,
		new WeakSet()
	);
	await formatInlineHTML(
		[closingFragment],
		undefined,
		new Set(),
		OPTIONS,
		new WeakSet()
	);

	expect(voidFragment.node.value).toBe('<img src="foo.png" />');
	expect(closingFragment.node.value).toBe('</span>');
});

test('keeps other HTML tokens and protected content unchanged', async () => {
	const commentFragment = createFragment('<!--   foo   -->');
	const protectedFragment = createFragment('<span   id = "bar">');
	const formattedNodes = new WeakSet<AST.Node>();

	await formatInlineHTML(
		[commentFragment],
		undefined,
		new Set(),
		OPTIONS,
		formattedNodes
	);
	await formatInlineHTML(
		[protectedFragment],
		undefined,
		new Set([protectedFragment.node]),
		OPTIONS,
		formattedNodes
	);

	expect(commentFragment.node.value).toBe('<!--   foo   -->');
	expect(protectedFragment.node.value).toBe('<span   id = "bar">');
	expect(formattedNodes.has(commentFragment.node)).toBe(false);
	expect(formattedNodes.has(protectedFragment.node)).toBe(false);
});

test('lays out opening tags at their position in the paragraph', async () => {
	const source = 'foo bar<span title="baz" data-qux="quux">corge</span>\n';
	const { fragment, layout } = await parseParagraph(source);

	await formatInlineHTML(
		[fragment],
		layout,
		new Set(),
		{ ...OPTIONS, originalText: source, printWidth: 40 },
		new WeakSet()
	);

	expect(fragment.node.value).toBe(
		'<span title="baz" data-qux="quux"\n    >'
	);
});

test('rejoins brackets whose lines would start block quotes', async () => {
	const source = 'foo bar<span title="baz" data-qux="quux">corge</span>\n';
	const { fragment, layout } = await parseParagraph(source);

	await formatInlineHTML(
		[fragment],
		layout,
		new Set(),
		{ ...OPTIONS, originalText: source, printWidth: 40, tabWidth: 2 },
		new WeakSet()
	);

	expect(fragment.node.value).toBe('<span title="baz" data-qux="quux">');
});

test('keeps tags on one line without a paragraph layout', async () => {
	const fragment = createFragment(
		'<span title="foo" data-bar="baz" data-qux="quux">'
	);

	await formatInlineHTML(
		[fragment],
		undefined,
		new Set(),
		OPTIONS,
		new WeakSet()
	);

	expect(fragment.node.value).toBe(
		'<span title="foo" data-bar="baz" data-qux="quux">'
	);
});

test('keeps tags on one line in headings and table cells', async () => {
	const fragment = createFragment(
		'<span title="foo" data-bar="baz|qux" data-quux="corge">',
		{ isInTableCell: true, isSingleLine: true }
	);
	fragment.node.value = String.raw`<span title="foo" data-bar="baz\|qux" data-quux="corge">`;

	await formatInlineHTML(
		[fragment],
		undefined,
		new Set(),
		{ ...OPTIONS, singleAttributePerLine: true },
		new WeakSet()
	);

	expect(fragment.node.value).toBe(
		String.raw`<span title="foo" data-bar="baz\|qux" data-quux="corge">`
	);
});
