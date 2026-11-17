import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import { expect, test } from 'vite-plus/test';
import formatBlockHTML from './index.ts';

const OPTIONS = { printWidth: 80, tabWidth: 4 } as ParserOptions;

function createScope(
	children: AST.Node[],
	overrides: Partial<AST.BlockScope> = {}
): AST.BlockScope {
	return {
		activeIgnoreComments: new Set(),
		ancestors: [],
		blockFragments: new Set(children.filter(({ type }) => type === 'html')),
		children,
		endsOpenBlocks: true,
		formattedNodes: new WeakSet(),
		ignoredNodes: new Set(),
		inlineOpeners: new Map(),
		isListItem: false,
		isPrintedTight: false,
		isTight: false,
		prefixWidth: 0,
		protectedEnds: new Set(),
		protectedStarts: new Set(),
		...overrides,
	};
}

function html(value: string): AST.HTMLNode {
	return { type: 'html', value };
}

test('lays out fragments that share elements across Markdown', async () => {
	const opening = html('<table>\n<tr>\n<td>\n<div>');
	const middle = html(
		'</div>\n</td>\n<td>\n<div>\n<div>\n<p>bar</p>\n</div>'
	);
	const closing = html('  </div>\n</td>\n</tr>\n</table>');
	const children = [
		opening,
		{ type: 'paragraph' },
		middle,
		{ type: 'paragraph' },
		closing,
	];

	const result = await formatBlockHTML(createScope(children), OPTIONS);

	expect(result).toStrictEqual(children);
	expect(opening.value).toBe(
		'<table>\n    <tr>\n        <td>\n            <div>'
	);
	expect(middle.value).toBe(
		'</div>\n        </td>\n        <td>\n            <div>\n                <div>\n                    <p>bar</p>\n                </div>'
	);
	expect(closing.value).toBe('</div>\n        </td>\n    </tr>\n</table>');
});

test('indents fragments for raw ancestors outside their container', async () => {
	const node = html('<p>\nfoo\n</p>\n<p>bar</p>');

	await formatBlockHTML(createScope([node], { ancestors: ['div'] }), OPTIONS);

	expect(node.value).toBe('<p>foo</p>\n    <p>bar</p>');
});

test('adds closing tags that Prettier supplies at the end of a scope', async () => {
	const last = html('<ul><li>foo');
	const opening = html('<div>');
	const paragraph = { type: 'paragraph' };

	const lastResult = await formatBlockHTML(createScope([last]), OPTIONS);
	const paragraphResult = await formatBlockHTML(
		createScope([opening, paragraph]),
		OPTIONS
	);

	expect(lastResult).toStrictEqual([last]);
	expect(last.value).toBe('<ul>\n    <li>foo</li>\n</ul>');
	expect(paragraphResult).toStrictEqual([
		opening,
		paragraph,
		{ position: undefined, type: 'html', value: '</div>' },
	]);
});

test('separates the first tag of a non-block HTML block from its content', async () => {
	const node = html(
		'<span   title="foo" data-bar="baz" data-qux="quux" data-corge="grault" data-garply="waldo">\n**fred**\n</span>'
	);

	await formatBlockHTML(createScope([node]), OPTIONS);

	expect(node.value).toBe(
		'<span title="foo" data-bar="baz" data-qux="quux" data-corge="grault" data-garply="waldo">\n    **fred**\n</span>'
	);
});

test('narrows the print width by the container prefix', async () => {
	const node = html('<p title="foo">bar baz qux</p>');

	await formatBlockHTML(createScope([node], { prefixWidth: 10 }), {
		...OPTIONS,
		printWidth: 34,
	});

	expect(node.value).toBe('<p title="foo">\n    bar baz qux\n</p>');
});

test('keeps ignored fragments unchanged', async () => {
	const ignored = html('<div   id="foo">');
	const closing = html('</div>');

	await formatBlockHTML(
		createScope([ignored, { type: 'paragraph' }, closing], {
			ignoredNodes: new Set([ignored]),
		}),
		OPTIONS
	);

	expect(ignored.value).toBe('<div   id="foo">');
	expect(closing.value).toBe('</div>');
});

test('keeps whitespace that starts or ends inside preformatted content', async () => {
	const opening = html('<div><pre>\n  foo  ');
	const closing = html('  <div>bar</div>\n</pre></div>');

	await formatBlockHTML(
		createScope([opening, { type: 'paragraph' }, closing], {
			protectedEnds: new Set([opening]),
			protectedStarts: new Set([closing]),
		}),
		OPTIONS
	);

	expect(opening.value).toBe('<div>\n    <pre>\n  foo  ');
	expect(closing.value).toBe('  <div>bar</div>\n</pre>\n</div>');
});

test('rejects HTML blocks that GFM reads as Markdown', async () => {
	const node = html('<hgroup>foo</hgroup>');

	await expect(
		formatBlockHTML(createScope([node]), { ...OPTIONS, filepath: 'foo.md' })
	).rejects.toThrow(
		'[prettier-plugin-markdown-html] Unsupported Markdown in `foo.md`'
	);
});

test('rejects HTML blocks that interrupt a paragraph only for Prettier', async () => {
	const point = (line: number): AST.Point => ({ column: 1, line });
	const paragraph = {
		position: { end: point(1), start: point(1) },
		type: 'paragraph',
	};
	const node: AST.HTMLNode = {
		position: { end: point(2), start: point(2) },
		type: 'html',
		value: '<search>',
	};

	await expect(
		formatBlockHTML(createScope([paragraph, node]), OPTIONS)
	).rejects.toThrow('[prettier-plugin-markdown-html] Unsupported Markdown');
});
