import type { AST } from '../types/index.d.ts';
import { expect, test } from 'vite-plus/test';
import collectHTMLGroup from './index.ts';

test('returns an empty group without an HTML node at the starting index', () => {
	const children: AST.Node[][] = [
		[],
		[{ type: 'html' }],
		[{ type: 'text', value: 'foo' }],
		Array.from<AST.Node>({ length: 1 }),
	];

	for (const nodes of children) {
		expect(collectHTMLGroup(nodes, 0, '')).toStrictEqual({
			value: '',
			children: [],
		});
	}
});

test('collects adjacent HTML from the starting index without changing nodes', () => {
	const children: AST.Node[] = [
		{ type: 'text', value: 'foo' },
		{ type: 'html', value: ' <div>' },
		{ type: 'html', value: '<p>bar</p></div> ' },
		{ type: 'text', value: 'baz' },
		{ type: 'html', value: '<p>qux</p>' },
	];

	const group = collectHTMLGroup(children, 1, '');

	expect(group.value).toBe('<div>\n<p>bar</p></div>');
	expect(group.children).toStrictEqual(children.slice(1, 3));
	expect(group.children[0]).toBe(children[1]);
	expect(group.children[1]).toBe(children[2]);
	expect(children[1]!.value).toBe(' <div>');
	expect(children[2]!.value).toBe('<p>bar</p></div> ');
});

test('separates closed HTML groups using source offsets', () => {
	const children: AST.HTMLNode[] = [
		{
			type: 'html',
			value: '<div></div>',
			position: {
				start: { line: 1, column: 1, offset: 0 },
				end: { line: 1, column: 12, offset: 11 },
			},
		},
		{
			type: 'html',
			value: '<p></p>',
			position: {
				start: { line: 2, column: 1, offset: 13 },
				end: { line: 2, column: 8, offset: 20 },
			},
		},
	];

	const group = collectHTMLGroup(children, 0, '<div></div>\n\n<p></p>');

	expect(group).toStrictEqual({
		value: '<div></div>',
		children: [children[0]],
	});
});

test('preserves significant blank lines without Markdown container prefixes', () => {
	const cases = [
		['', '', '', ''],
		['  ', '', '  ', ''],
		['  ', '    ', '  ', '  '],
		['> ', '>', '> ', ''],
		['>   ', '>', '>   ', ''],
		['> > ', '> >', '>>', ''],
	] as const;

	for (const [prefix, blankPrefix, closingPrefix, whitespace] of cases) {
		for (const separator of ['\n', '\r', '\r\n']) {
			const opening = '<div title="';
			const closing = '<p>foo</p>"></div>';
			const input = `${prefix}${opening}${separator}${blankPrefix}${separator}${closingPrefix}${closing}`;
			const closingOffset = input.length - closing.length;

			const children: AST.HTMLNode[] = [
				{
					type: 'html',
					value: opening,
					position: {
						start: {
							line: 1,
							column: prefix.length + 1,
							offset: prefix.length,
						},
						end: {
							line: 1,
							column: prefix.length + opening.length + 1,
							offset: prefix.length + opening.length,
						},
					},
				},
				{
					type: 'html',
					value: closing,
					position: {
						start: {
							line: 3,
							column: closingPrefix.length + 1,
							offset: closingOffset,
						},
						end: {
							line: 3,
							column: closingPrefix.length + closing.length + 1,
							offset: input.length,
						},
					},
				},
			];

			const group = collectHTMLGroup(children, 0, input);

			expect(group).toStrictEqual({
				value: `${opening}\n${whitespace}\n${closing}`,
				children,
			});
		}
	}
});

test('preserves separators on the same source line', () => {
	const children: AST.HTMLNode[] = [
		{
			type: 'html',
			value: '<div>',
			position: {
				start: { line: 1, column: 1, offset: 0 },
				end: { line: 1, column: 6, offset: 5 },
			},
		},
		{
			type: 'html',
			value: '</div>',
			position: {
				start: { line: 1, column: 8, offset: 7 },
				end: { line: 1, column: 14, offset: 13 },
			},
		},
	];
	const input = '<div> \t</div>';

	expect(collectHTMLGroup(children, 0, input)).toStrictEqual({
		value: input,
		children,
	});
});

test('uses line positions when source offsets are absent or overlap', () => {
	for (const offsets of [
		[undefined, undefined],
		[undefined, 0],
		[5, 4],
	]) {
		const children: AST.HTMLNode[] = [
			{
				type: 'html',
				value: '<div>',
				position: {
					start: { line: 1, column: 1 },
					end: { line: 1, column: 6, offset: offsets[0] },
				},
			},
			{
				type: 'html',
				value: '</div>',
				position: {
					start: { line: 3, column: 1, offset: offsets[1] },
					end: { line: 3, column: 7 },
				},
			},
		];

		expect(collectHTMLGroup(children, 0, '')).toStrictEqual({
			value: '<div>\n\n</div>',
			children,
		});
	}
});

test('handles source positions on only one node', () => {
	const opening: AST.HTMLNode = {
		type: 'html',
		value: '<div>',
		position: {
			start: { line: 1, column: 1, offset: 0 },
			end: { line: 1, column: 6, offset: 5 },
		},
	};
	const closing: AST.HTMLNode = {
		type: 'html',
		value: '</div>',
		position: {
			start: { line: 2, column: 1, offset: 6 },
			end: { line: 2, column: 7, offset: 12 },
		},
	};

	for (const children of [
		[opening, { type: 'html', value: closing.value }],
		[{ type: 'html', value: opening.value }, closing],
	]) {
		expect(collectHTMLGroup(children, 0, '')).toStrictEqual({
			value: '<div>\n</div>',
			children,
		});
	}
});

test('continues an inherited raw-text group until its closing tag', () => {
	for (const tagName of ['script', 'style', 'textarea', 'title']) {
		const closing = `</${tagName}>`;
		const children: AST.HTMLNode[] = [
			{
				type: 'html',
				value: '<p>foo</p>',
				position: {
					start: { line: 1, column: 1 },
					end: { line: 1, column: 11 },
				},
			},
			{
				type: 'html',
				value: closing,
				position: {
					start: { line: 3, column: 1 },
					end: { line: 3, column: closing.length + 1 },
				},
			},
			{
				type: 'html',
				value: '<div>bar</div>',
				position: {
					start: { line: 5, column: 1 },
					end: { line: 5, column: 15 },
				},
			},
		];

		expect(collectHTMLGroup(children, 0, '', tagName)).toStrictEqual({
			value: `<p>foo</p>\n\n${closing}`,
			children: children.slice(0, 2),
		});
	}
});
