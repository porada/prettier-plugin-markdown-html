import type { AST } from '../types/index.d.ts';
import { expect, test } from 'vite-plus/test';
import sliceMarkdownSource, {
	measureLineIndentation,
	stripContainerPrefixes,
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

test('returns `undefined` without source positions', () => {
	expect(sliceMarkdownSource('foo', {})).toBeUndefined();
	expect(stripContainerPrefixes('foo', {}, [])).toBeUndefined();
});

test('measures indentation after the container prefixes that a line has in full', () => {
	const quoteSource = '> foo\n>\t  bar\n';
	const lazyQuoteSource = '> > foo\n> bar\n';
	const lazyItemSource = '1.   foo\n    bar\n';

	const quoteResult = measureLineIndentation(quoteSource, 6, [
		createNode('blockquote', 0, 13),
	]);
	const lazyQuoteResult = measureLineIndentation(lazyQuoteSource, 8, [
		createNode('blockquote', 0, 13),
		createNode('blockquote', 2, 13),
	]);
	const lazyItemResult = measureLineIndentation(lazyItemSource, 9, [
		createNode('listItem', 0, 16),
	]);

	expect(quoteResult).toStrictEqual({
		indentation: 4,
		isBlank: false,
		isLazy: false,
	});
	expect(lazyQuoteResult).toStrictEqual({
		indentation: 0,
		isBlank: false,
		isLazy: true,
	});
	expect(lazyItemResult).toStrictEqual({
		indentation: 4,
		isBlank: false,
		isLazy: true,
	});
});

test('measures lines with only container prefixes and spaces or tabs as blank', () => {
	const source = '> foo\n>  \t\n> bar\n';

	const result = measureLineIndentation(source, 6, [
		createNode('blockquote', 0, 15),
	]);

	expect(result).toStrictEqual({
		indentation: 2,
		isBlank: true,
		isLazy: false,
	});
});
