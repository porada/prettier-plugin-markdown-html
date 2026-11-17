import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import { expect, test } from 'vite-plus/test';
import formatInlineHTML from './index.ts';

const OPTIONS = { printWidth: 30, tabWidth: 4 } as ParserOptions;

function createFragment(
	value: string,
	overrides: Partial<AST.Fragment> = {}
): AST.Fragment {
	const node: AST.HTMLNode = { type: 'html', value };

	return {
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

	await formatInlineHTML(fragment, false, OPTIONS, formattedNodes);

	expect(fragment.node.value).toBe('<span id="foo">');
	expect(formattedNodes.has(fragment.node)).toBe(true);
});

test('formats void and closing tags', async () => {
	const voidFragment = createFragment('<img   src="foo.png">');
	const closingFragment = createFragment('</span   >');

	await formatInlineHTML(voidFragment, false, OPTIONS, new WeakSet());
	await formatInlineHTML(closingFragment, false, OPTIONS, new WeakSet());

	expect(voidFragment.node.value).toBe('<img src="foo.png" />');
	expect(closingFragment.node.value).toBe('</span>');
});

test('keeps other HTML tokens and protected content unchanged', async () => {
	const commentFragment = createFragment('<!--   foo   -->');
	const protectedFragment = createFragment('<span   id = "bar">');
	const formattedNodes = new WeakSet<AST.Node>();

	await formatInlineHTML(commentFragment, false, OPTIONS, formattedNodes);
	await formatInlineHTML(protectedFragment, true, OPTIONS, formattedNodes);

	expect(commentFragment.node.value).toBe('<!--   foo   -->');
	expect(protectedFragment.node.value).toBe('<span   id = "bar">');
	expect(formattedNodes.has(commentFragment.node)).toBe(false);
	expect(formattedNodes.has(protectedFragment.node)).toBe(false);
});

test('keeps the bracket on the last attribute line when wrapping', async () => {
	const fragment = createFragment(
		'<span title="foo" data-bar="baz" data-qux="quux">'
	);

	await formatInlineHTML(fragment, false, OPTIONS, new WeakSet());

	expect(fragment.node.value).toBe(
		'<span\n    title="foo"\n    data-bar="baz"\n    data-qux="quux">'
	);
});

test('keeps tags on one line in headings and table cells', async () => {
	const fragment = createFragment(
		'<span title="foo" data-bar="baz|qux" data-quux="corge">',
		{ isInTableCell: true, isSingleLine: true }
	);
	fragment.node.value = String.raw`<span title="foo" data-bar="baz\|qux" data-quux="corge">`;

	await formatInlineHTML(
		fragment,
		false,
		{ ...OPTIONS, singleAttributePerLine: true },
		new WeakSet()
	);

	expect(fragment.node.value).toBe(
		String.raw`<span title="foo" data-bar="baz\|qux" data-quux="corge">`
	);
});
