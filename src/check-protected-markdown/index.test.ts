import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import { expect, test } from 'vite-plus/test';
import checkProtectedMarkdown from './index.ts';

function protectedMarkdown(text: string): AST.ProtectedMarkdown[] {
	return [
		{
			containers: [],
			description: 'comment',
			isEnclosing: false,
			node: {
				position: {
					end: {
						column: text.length + 1,
						line: 1,
						offset: text.length,
					},
					start: { column: 1, line: 1, offset: 0 },
				},
				type: 'paragraph',
			},
			position: { column: 1, line: 1, offset: 0 },
		},
	];
}

function createOptions(text: string): ParserOptions {
	return {
		filepath: 'foo.md',
		originalText: text,
		parser: 'markdown',
		plugins: [],
		printWidth: 80,
		proseWrap: 'preserve',
		tabWidth: 4,
	} as unknown as ParserOptions;
}

test('accepts Markdown changes that render identically', async () => {
	const text = '*foo* bar';

	await expect(
		checkProtectedMarkdown(
			protectedMarkdown(text),
			() => false,
			createOptions(text)
		)
	).resolves.toBeUndefined();
});

test('rejects Markdown changes that change rendered content', async () => {
	const text = 'foo  bar';

	await expect(
		checkProtectedMarkdown(
			protectedMarkdown(text),
			() => false,
			createOptions(text)
		)
	).rejects.toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] Unsafe Markdown layout in \`foo.md\` (1:1):

		Formatting this Markdown would change the content of the comment that contains it]
	`);
});

test('propagates formatter failures while normalizing protected content', async () => {
	const text = 'foo <textarea>  </textarea>';
	const error = new Error('foo');
	const options = {
		...createOptions(text),
		plugins: [
			{
				parsers: {
					html: {
						astFormat: 'html',
						locEnd: () => 0,
						locStart: () => 0,
						parse() {
							throw error;
						},
					},
				},
			},
		],
	} as unknown as ParserOptions;
	let result: unknown;

	try {
		await checkProtectedMarkdown(
			[
				{
					...protectedMarkdown(text)[0]!,
					description: '`<textarea>` element',
					isEnclosing: true,
				},
			],
			() => false,
			options
		);
	} catch (caughtError) {
		result = caughtError;
	}

	expect(result).toBeInstanceOf(Error);
	expect((result as Error).cause).toBe(error);
});
