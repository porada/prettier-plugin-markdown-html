import type { AST } from '../types/index.d.ts';
import { expect, test } from 'vite-plus/test';
import sliceMarkdownSource, {
	readHTMLBlockText,
	readLinesFromContentEdge,
	recordHTMLBlockText,
} from './index.ts';

function createNode(type: string, start: number, end: number): AST.Node {
	return {
		position: {
			end: { column: 1, line: 1, offset: end },
			start: { column: 1, line: 1, offset: start },
		},
		type,
	};
}

test('removes container prefixes from continuation lines', () => {
	const source = '> - foo\n>   bar\n';

	const result = sliceMarkdownSource(source, createNode('paragraph', 4, 15), [
		createNode('blockquote', 0, 15),
		createNode('listItem', 2, 15),
	]);

	expect(result?.text).toBe('foo\nbar');
	expect(result?.offsets).toStrictEqual([4, 5, 6, 7, 12, 13, 14, 15]);
});

test('removes the indentation before list markers from continuation lines', () => {
	const source = '- > foo\n  >   - bar\n  >\n  >         baz\n';

	const result = sliceMarkdownSource(
		source,
		createNode('paragraph', 16, 39),
		[
			createNode('listItem', 0, 39),
			createNode('blockquote', 2, 39),
			createNode('listItem', 14, 39),
		]
	);

	expect(result?.text).toBe('bar\n\n    baz');
});

test('expands tabs in the indentation that continuation lines keep', () => {
	const source = '- foo\n\n\t  bar\n';

	const result = sliceMarkdownSource(source, createNode('paragraph', 2, 13), [
		createNode('listItem', 0, 13),
	]);

	expect(result?.text).toBe('foo\n\n    bar');
	expect(result?.offsets).toStrictEqual([
		2, 3, 4, 5, 6, 7, 7, 8, 9, 10, 11, 12, 13,
	]);
});

test('starts list item content one column after markers before indented code', () => {
	const source = '-     foo\n\n  bar\n     baz\n';

	const result = sliceMarkdownSource(
		source,
		createNode('paragraph', 13, 25),
		[createNode('listItem', 0, 25)]
	);

	expect(result?.text).toBe('bar\n   baz');
});

test('starts list item content one column after markers on otherwise blank lines', () => {
	const source = '-   \n  foo\n   bar\n';

	const result = sliceMarkdownSource(source, createNode('paragraph', 7, 17), [
		createNode('listItem', 0, 17),
	]);

	expect(result?.text).toBe('foo\n bar');
});

test('keeps lazy continuation lines after block quotes', () => {
	const source = '> foo\n  bar\n';

	const result = sliceMarkdownSource(source, createNode('paragraph', 2, 11), [
		createNode('blockquote', 0, 11),
	]);

	expect(result?.text).toBe('foo\n  bar');
});

test('keeps the indentation of lazy continuation lines in list items', () => {
	const source = '  1) foo\n    bar\n';

	const result = sliceMarkdownSource(source, createNode('paragraph', 5, 16), [
		createNode('listItem', 2, 16),
	]);

	expect(result?.text).toBe('foo\n    bar');
});

test('reads source lines from the content edge with leading whitespace as spaces up to a number of columns', () => {
	const source = '- foo\n\n   bar\n  \t\tbaz\nqux\n';
	const node = createNode('paragraph', 10, 25);
	const containers = [createNode('listItem', 0, 25)];

	expect(
		readLinesFromContentEdge(
			source,
			node,
			containers,
			() => Number.POSITIVE_INFINITY
		)
	).toStrictEqual([
		{ hasPrefixes: true, text: ' bar' },
		{ hasPrefixes: true, text: '      baz' },
		{ hasPrefixes: false, text: 'qux' },
	]);
	expect(
		readLinesFromContentEdge(source, node, containers, () => 3)?.[1]
	).toStrictEqual({ hasPrefixes: true, text: '      baz' });
	expect(
		readLinesFromContentEdge(source, node, containers, () => 2)?.[1]
	).toStrictEqual({ hasPrefixes: true, text: '  \tbaz' });
	expect(
		readLinesFromContentEdge(source, {}, containers, () => 0)
	).toBeUndefined();
});

test('reads recorded HTML blocks with leading whitespace as spaces covering its columns', () => {
	const source = '- foo\n\n  \t<!-- bar -->\n  \t<!-- baz -->\n';
	const node = {
		...createNode('html', 9, 38),
		value: '\t<!-- bar -->\n\t<!-- baz -->',
	} as AST.HTMLNode;
	const unrecordedNode = { ...node };

	recordHTMLBlockText(source, node, [createNode('listItem', 0, 38)]);
	recordHTMLBlockText(source, {}, []);

	expect(readHTMLBlockText(node)).toBe('  <!-- bar -->\n  <!-- baz -->');
	expect(readHTMLBlockText(unrecordedNode)).toBe(
		'\t<!-- bar -->\n\t<!-- baz -->'
	);
});

test('returns `undefined` without source positions', () => {
	expect(sliceMarkdownSource('foo', {})).toBeUndefined();
});
