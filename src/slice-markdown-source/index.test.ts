import type { AST } from '../types/index.d.ts';
import { expect, test } from 'vite-plus/test';
import sliceMarkdownSource from './index.ts';

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

test('keeps lazy continuation lines after block quotes', () => {
	const source = '> foo\n  bar\n';

	const result = sliceMarkdownSource(source, createNode('paragraph', 2, 11), [
		createNode('blockquote', 0, 11),
	]);

	expect(result?.text).toBe('foo\n  bar');
});

test('returns `undefined` without source positions', () => {
	expect(sliceMarkdownSource('foo', {})).toBeUndefined();
});
