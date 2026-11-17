import { expect, test } from 'vite-plus/test';
import {
	describeGeneratedElement,
	reportFormatterFailure,
	reportIncompatibleParser,
	reportInvalidHTML,
	reportUnsafeLayout,
	reportUnsupportedMarkdown,
} from './index.ts';

test('reports errors with the file, the Markdown position, and the reason', () => {
	expect(() =>
		reportInvalidHTML({
			filepath: 'foo.md',
			position: { column: 2, line: 3 },
			reason: 'Bar',
		})
	).toThrowErrorMatchingInlineSnapshot(`
		[SyntaxError: [prettier-plugin-markdown-html] Invalid HTML in \`foo.md\` (3:2):

		Bar]
	`);
	expect(() => reportUnsafeLayout({ reason: 'Baz' }))
		.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout:

		Baz]
	`);
	expect(() =>
		reportUnsupportedMarkdown({ filepath: 'qux.md', reason: 'Quux' })
	).toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsupported Markdown in \`qux.md\`:

		Quux]
	`);
	expect(() => reportIncompatibleParser({ reason: 'Corge' }))
		.toThrowErrorMatchingInlineSnapshot(`
		[TypeError: [prettier-plugin-markdown-html] Incompatible parser:

		Corge]
	`);
});

test('exposes the Markdown position to Prettier', () => {
	let result: unknown;

	try {
		reportInvalidHTML({ position: { column: 2, line: 3 }, reason: 'Foo' });
	} catch (error: unknown) {
		result = error;
	}

	expect(result).toBeInstanceOf(SyntaxError);
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
	expect((result as Error).cause).toBe(cause);
	expect((result as Error).message).toMatchInlineSnapshot(`
		"[prettier-plugin-markdown-html] Failed to format HTML with Prettier in \`bar.md\`:

		Foo"
	`);
});

test('names the Markdown constructs that generate elements', () => {
	expect(describeGeneratedElement('blockquote')).toBe('block quote');
	expect(describeGeneratedElement('h3')).toBe('heading');
	expect(describeGeneratedElement('li')).toBe('list item');
	expect(describeGeneratedElement('p')).toBe('paragraph');
	expect(describeGeneratedElement('td')).toBe('table cell');
	expect(describeGeneratedElement('foo')).toBe('`<foo>`');
});
