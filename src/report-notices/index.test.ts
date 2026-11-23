import type { Rejection } from '../decide-regions/index.ts';
import type { Regions } from '../types/index.d.ts';
import { expect, onTestFinished, test, vi } from 'vite-plus/test';
import reportNotices from './index.ts';

const POSITION = { column: 2, line: 3, offset: 10 };

function createElement(sourceName: string): Regions.Element {
	return { opening: { sourceName } } as Regions.Element;
}

function reportWithWarnings(
	notices: ReadonlyArray<{ problem: Rejection }>,
	filepath?: string
): unknown[][] {
	const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined);

	try {
		reportNotices(notices, { filepath } as { filepath: string });

		return [...warn.mock.calls];
	} finally {
		warn.mockRestore();
	}
}

test('quotes a closing tag written across lines on one line', () => {
	const problem: Rejection = {
		kind: 'unpaired-closing-tag',
		position: POSITION,
		tag: {
			end: 10,
			fragment: { node: { value: '</foo\n\t  >' } },
			sourceName: 'foo',
			start: 0,
		} as Regions.ClosingTag,
	};

	expect(reportWithWarnings([{ problem }])).toStrictEqual([
		[
			'[prettier-plugin-markdown-html] Skipped HTML formatting (3:2): No opening `<foo>` matches this `</foo >` in the same Markdown region.',
		],
	]);
});

test('describes each reason a region falls back to plain Prettier', () => {
	const problems: Rejection[] = [
		{ kind: 'changed-role', position: POSITION },
		{
			element: createElement('Foo'),
			kind: 'crossed-protection',
			position: POSITION,
		},
		{ kind: 'escaped-pipe', position: POSITION },
		{
			element: createElement('svg'),
			kind: 'inline-foreign',
			position: POSITION,
		},
		{ kind: 'moved-block', position: POSITION },
		{ kind: 'open-block', position: POSITION },
		{ kind: 'reindented-block', position: POSITION },
		{
			element: createElement('baz'),
			kind: 'self-closing',
			position: POSITION,
		},
		{ construct: 'pre', kind: 'split-construct', position: POSITION },
		{
			element: createElement('qux'),
			kind: 'unclosed-element',
			position: POSITION,
		},
		{
			cause: new SyntaxError(
				'Unexpected closing tag (1:2)\n> 1 | </quux>'
			),
			kind: 'unformattable',
			position: POSITION,
		},
		{ cause: 'Corge', kind: 'unformattable', position: POSITION },
		{
			kind: 'unpaired-closing-tag',
			position: POSITION,
			tag: {
				end: 10,
				fragment: { node: { value: '</ grault>' } },
				sourceName: 'grault',
				start: 0,
			} as Regions.ClosingTag,
		},
		{
			cause: new Error(
				'[prettier-plugin-markdown-html] Unsafe Markdown layout (3:2):\n\nGarply'
			),
			kind: 'unsafe-layout',
			position: POSITION,
		},
		{
			cause: new TypeError('Fred\nWaldo'),
			kind: 'unsafe-layout',
			position: POSITION,
		},
		{
			construct: 'cdata',
			kind: 'unsupported-construct',
			position: POSITION,
		},
		{
			construct: 'declaration',
			kind: 'unsupported-construct',
			position: POSITION,
		},
		{
			construct: 'processing-instruction',
			kind: 'unsupported-construct',
			position: POSITION,
		},
	];

	expect(
		problems.flatMap((problem) => reportWithWarnings([{ problem }]))
	).toStrictEqual(
		[
			'Formatting would change whether Prettier reads this as inline HTML, an HTML block, or text. Check nearby line breaks, indentation, and code fences.',
			'An ignore directive covers only part of this `<Foo>` element. Keep the whole element inside or outside the ignored source.',
			'The raw HTML in this table cell contains an escaped pipe (`\\|`).',
			'To format this inline `<svg>`, put the whole element in one HTML block.',
			'Prettier’s Markdown layout would change how this HTML block is nested in lists or block quotes.',
			'Formatting would make the next line of Markdown part of this HTML block. Add a blank line after the block.',
			'Prettier’s Markdown layout would change the indentation inside the formatted HTML block.',
			'HTML leaves `<baz/>` open. Use `<baz>` and `</baz>`.',
			'Keep `<pre>` and `</pre>` together in one HTML block.',
			'Close `<qux>` with `</qux>` in the same Markdown region, or escape `<` as `&lt;` if the tag is meant as text.',
			'Prettier can’t format this HTML: Unexpected closing tag',
			'Prettier can’t format this HTML: Corge',
			'No opening `<grault>` matches this `</ grault>` in the same Markdown region.',
			'Garply',
			'Fred',
			'This region contains a CDATA section, which the plugin doesn’t support.',
			'This region contains a markup declaration, which the plugin doesn’t support.',
			'This region contains a processing instruction, which the plugin doesn’t support.',
		].map((reason) => [
			`[prettier-plugin-markdown-html] Skipped HTML formatting (3:2): ${reason}`,
		])
	);
});

test('reports nothing without rejected regions', () => {
	expect(reportWithWarnings([])).toStrictEqual([]);
});

test('counts the notices after the first five', () => {
	const notice = {
		problem: {
			element: createElement('foo'),
			kind: 'unclosed-element',
			position: POSITION,
		},
	} as const;

	expect(
		reportWithWarnings(
			Array.from({ length: 6 }, () => notice),
			'bar.md'
		).at(-1)
	).toStrictEqual([
		'[prettier-plugin-markdown-html] Skipped HTML formatting in `bar.md`: 1 more region.',
	]);
	expect(
		reportWithWarnings(Array.from({ length: 8 }, () => notice)).at(-1)
	).toStrictEqual([
		'[prettier-plugin-markdown-html] Skipped HTML formatting: 3 more regions.',
	]);
});

test('throws the first rejection instead when `PRETTIER_DEBUG` is set', () => {
	vi.stubEnv('PRETTIER_DEBUG', 'true');
	onTestFinished(() => {
		vi.unstubAllEnvs();
	});
	const cause = new SyntaxError('Foo');

	expect(() =>
		reportNotices(
			[
				{
					problem: {
						cause,
						kind: 'unformattable',
						position: POSITION,
					},
				},
				{ problem: { kind: 'changed-role', position: POSITION } },
			],
			{ filepath: 'bar.md' }
		)
	).toThrowErrorMatchingInlineSnapshot(`
		[Error: [prettier-plugin-markdown-html] PRETTIER_DEBUG stopped formatting in \`bar.md\` (3:2):

		Prettier can’t format this HTML: Foo]
	`);
});
