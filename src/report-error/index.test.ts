import { expect, test } from 'vite-plus/test';
import {
	describeRejectedRegion,
	isFormatterFailure,
	reportFormatterFailure,
	reportRejectedRegion,
	reportUnsafeLayout,
	reportUnsupportedASTFormat,
} from './index.ts';

test('reports errors with the file, the Markdown position, and the reason', () => {
	expect(() =>
		reportUnsafeLayout({
			filepath: 'foo.md',
			position: { column: 2, line: 3 },
			reason: 'Bar',
		})
	).toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (3:2):

		Bar]
	`);
	expect(() => reportUnsafeLayout({ reason: 'Baz' }))
		.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout:

		Baz]
	`);
	expect(() =>
		reportRejectedRegion({
			position: { column: 4, line: 5 },
			reason: 'Qux',
		})
	).toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] PRETTIER_DEBUG stopped formatting (5:4):

		Qux]
	`);
});

test('describes regions that fall back to plain Prettier on one line', () => {
	expect(
		describeRejectedRegion({
			filepath: 'foo.md',
			position: { column: 2, line: 3 },
			reason: 'Bar',
		})
	).toBe(
		'[prettier-plugin-markdown-html] Skipped HTML formatting in `foo.md` (3:2): Bar'
	);
});

test('reports syntax trees from other parsers that the plugin can’t format', () => {
	expect(() =>
		reportUnsupportedASTFormat({
			expected: 'mdast',
			name: 'markdown',
			received: 'foo',
		})
	).toThrowErrorMatchingInlineSnapshot(
		`[TypeError: [prettier-plugin-markdown-html] Unsupported AST format for the \`markdown\` parser. Expected \`mdast\`, received \`foo\`]`
	);
	expect(() =>
		reportUnsupportedASTFormat({
			expected: 'mdast',
			filepath: 'bar.md',
			name: 'remark',
			received: undefined,
		})
	).toThrowErrorMatchingInlineSnapshot(
		`[TypeError: [prettier-plugin-markdown-html] Unsupported AST format for the \`remark\` parser. Expected \`mdast\`, received \`undefined\` while formatting \`bar.md\`]`
	);
});

test('exposes the Markdown position to Prettier', () => {
	let result: unknown;

	try {
		reportUnsafeLayout({ position: { column: 2, line: 3 }, reason: 'Foo' });
	} catch (error: unknown) {
		result = error;
	}

	expect(result).toBeInstanceOf(Error);
	expect((result as { loc?: unknown }).loc).toStrictEqual({
		start: { column: 2, line: 3 },
	});
});

test('keeps the formatter’s error as the cause', () => {
	const cause = new SyntaxError('Foo');
	let result: unknown;

	try {
		reportFormatterFailure({ cause, filepath: 'bar.md' });
	} catch (error: unknown) {
		result = error;
	}

	expect(result).toBeInstanceOf(SyntaxError);
	expect(isFormatterFailure(result)).toBe(true);
	expect(isFormatterFailure(new Error('Baz'))).toBe(false);
	expect((result as Error).cause).toBe(cause);
	expect((result as Error).message).toMatchInlineSnapshot(`
		"[prettier-plugin-markdown-html] Failed to format HTML with Prettier in \`bar.md\`:

		Foo"
	`);
});

test('reports formatter failures that aren’t errors', () => {
	expect(() => reportFormatterFailure({ cause: 'Foo (1:2)\nBar' }))
		.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Failed to format HTML with Prettier:

		Foo]
	`);
});
