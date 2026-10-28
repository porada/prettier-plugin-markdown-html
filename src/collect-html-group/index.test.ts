import type { AST } from '../types/index.d.ts';
import { expect, test } from 'vite-plus/test';
import collectHTMLGroup from './index.ts';

test('returns an empty group without an HTML node at the starting index', () => {
	expect(collectHTMLGroup([], 0, '')).toStrictEqual({
		value: '',
		children: [],
	});

	expect(collectHTMLGroup([{ type: 'html' }], 0, '')).toStrictEqual({
		value: '',
		children: [],
	});

	expect(
		collectHTMLGroup([{ type: 'text', value: 'foo' }], 0, '')
	).toStrictEqual({
		value: '',
		children: [],
	});

	expect(
		collectHTMLGroup(Array.from<AST.Node>({ length: 1 }), 0, '')
	).toStrictEqual({
		value: '',
		children: [],
	});
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

test.each([
	['', '', '', '', '\n'],
	['', '', '', '', '\r'],
	['', '', '', '', '\r\n'],
	['  ', '', '  ', '', '\n'],
	['  ', '', '  ', '', '\r'],
	['  ', '', '  ', '', '\r\n'],
	['  ', '    ', '  ', '  ', '\n'],
	['  ', '    ', '  ', '  ', '\r'],
	['  ', '    ', '  ', '  ', '\r\n'],
	['> ', '>', '> ', '', '\n'],
	['> ', '>', '> ', '', '\r'],
	['> ', '>', '> ', '', '\r\n'],
	['>   ', '>', '>   ', '', '\n'],
	['>   ', '>', '>   ', '', '\r'],
	['>   ', '>', '>   ', '', '\r\n'],
	['> > ', '> >', '>>', '', '\n'],
	['> > ', '> >', '>>', '', '\r'],
	['> > ', '> >', '>>', '', '\r\n'],
] as const)(
	'preserves significant blank lines without Markdown container prefixes',
	(prefix, blankPrefix, closingPrefix, whitespace, separator) => {
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
);

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

test.each([
	[undefined, undefined],
	[undefined, 0],
	[5, 4],
])(
	'uses line positions when source offsets are absent or overlap',
	(endOffset, startOffset) => {
		const children: AST.HTMLNode[] = [
			{
				type: 'html',
				value: '<div>',
				position: {
					start: { line: 1, column: 1 },
					end: { line: 1, column: 6, offset: endOffset },
				},
			},
			{
				type: 'html',
				value: '</div>',
				position: {
					start: { line: 3, column: 1, offset: startOffset },
					end: { line: 3, column: 7 },
				},
			},
		];

		expect(collectHTMLGroup(children, 0, '')).toStrictEqual({
			value: '<div>\n\n</div>',
			children,
		});
	}
);

test('joins HTML with one newline when only one node has a source position', () => {
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

	const childrenWithOpeningPosition = [
		opening,
		{ type: 'html', value: closing.value },
	];
	const childrenWithClosingPosition = [
		{ type: 'html', value: opening.value },
		closing,
	];

	expect(collectHTMLGroup(childrenWithOpeningPosition, 0, '')).toStrictEqual({
		value: '<div>\n</div>',
		children: childrenWithOpeningPosition,
	});
	expect(collectHTMLGroup(childrenWithClosingPosition, 0, '')).toStrictEqual({
		value: '<div>\n</div>',
		children: childrenWithClosingPosition,
	});
});

test.each(['script', 'style', 'textarea', 'title'])(
	'continues an inherited `%s` raw text group until its closing tag',
	(tagName) => {
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
);
