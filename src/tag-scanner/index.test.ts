import { expect, test } from 'vite-plus/test';
import TagScanner from './index.ts';

type TagScannerInternals = {
	pendingMarkup?: {
		chunks: string[];
	};
	unclosedTags: {
		tagIndicesByName: Map<string, number[]>;
	};
};

const TEST_HTML =
	'<?ignored?><section><div title="<aside>"></div>' +
	'<!-- <span> --><script>const foo = "<div>";' +
	' "</scriptx>";</script \n><p>';

const TEST_HTML_UNCLOSED_TAGS = ['section', 'p'];

test('finds unclosed tags in an HTML fragment', () => {
	expect(TagScanner.scan('foo')).toStrictEqual([]);

	expect(TagScanner.scan('<details><summary>foo</summary>')).toStrictEqual([
		'details',
	]);

	expect(TagScanner.scan('<div align="center"><p>foo')).toStrictEqual([
		'div',
		'p',
	]);

	expect(
		TagScanner.scan('<p><img src="#" /><!-- <div> --></p>')
	).toStrictEqual([]);

	expect(TagScanner.scan('<div title="<p>">foo</div>')).toStrictEqual([]);
});

test('handles deeply nested tags', () => {
	const html = '<div>'.repeat(20_000);

	expect(TagScanner.scan(html)).toHaveLength(20_000);
});

test('scans complete HTML fragments incrementally', () => {
	const scanner = new TagScanner();

	scanner.consume('<div><!--');
	expect(scanner.hasUnclosedTags()).toBe(true);

	scanner.consume('foo <span>');
	expect(scanner.getUnclosedTags()).toStrictEqual(['div']);

	scanner.consume('--><script>');
	expect(scanner.getUnclosedTags()).toStrictEqual(['div', 'script']);

	scanner.consume('const bar = "<p>";');
	expect(scanner.getUnclosedTags()).toStrictEqual(['div', 'script']);

	scanner.consume('</script></div>');
	expect(scanner.hasUnclosedTags()).toBe(false);
	expect(scanner.getUnclosedTags()).toStrictEqual([]);
});

test('scans HTML as one chunk and as single-character chunks', () => {
	expect(TagScanner.scan(TEST_HTML)).toStrictEqual(TEST_HTML_UNCLOSED_TAGS);

	const scanner = new TagScanner();

	for (const character of TEST_HTML) {
		scanner.consume(character);
	}

	expect(scanner.getUnclosedTags()).toStrictEqual(TEST_HTML_UNCLOSED_TAGS);
});

test.each(Array.from({ length: TEST_HTML.length + 1 }, (_, index) => index))(
	'scans HTML split into two chunks at offset %i',
	(index) => {
		const scanner = new TagScanner();

		scanner.consume(TEST_HTML.slice(0, index));
		scanner.consume(TEST_HTML.slice(index));

		expect(scanner.getUnclosedTags()).toStrictEqual(
			TEST_HTML_UNCLOSED_TAGS
		);
	}
);

test.each([
	[['</', '!<p>'], ['p']],
	[['<!', 'x<p>'], ['p']],
	[['<!-', 'x<p>'], ['p']],
	[['<div', '_<p>'], ['p']],
	[['<div title="foo"', '<p>'], ['p']],
	[
		['<div title="<p>', '"<foo>'],
		['p', 'foo'],
	],
	[[`<foo "<bar '"`, `<baz>'>`], ['bar']],
	[['<x-', '_>'], ['x-']],
	[['<x-y', '_>'], ['x-']],
])(
	'discards invalid markup split across chunks',
	(chunks, expectedUnclosedTags) => {
		const scanner = new TagScanner();

		for (const chunk of chunks) {
			scanner.consume(chunk);
		}

		expect(scanner.getUnclosedTags()).toStrictEqual(expectedUnclosedTags);
	}
);

test('scans tags split into many chunks', () => {
	const scanner = new TagScanner();
	const internals = scanner as unknown as TagScannerInternals;

	scanner.consume('<div title="');
	expect(scanner.hasUnclosedTags()).toBe(true);

	for (let index = 0; index < 1000; index += 1) {
		scanner.consume('');
	}

	expect(internals.pendingMarkup?.chunks).toHaveLength(1);

	for (let index = 0; index < 20_000; index += 1) {
		scanner.consume('foo');
	}

	scanner.consume('">');

	expect(scanner.getUnclosedTags()).toStrictEqual(['div']);

	const rawTextScanner = new TagScanner();

	rawTextScanner.consume('<script>foo</script');

	for (let index = 0; index < 20_000; index += 1) {
		rawTextScanner.consume(' ');
	}

	rawTextScanner.consume('><p>');

	expect(rawTextScanner.getUnclosedTags()).toStrictEqual(['p']);
});

test('removes closed tag names from the index', () => {
	const scanner = new TagScanner();
	const internals = scanner as unknown as TagScannerInternals;
	const distinctTags = Array.from(
		{ length: 1000 },
		(_, index) => `<x-${index}></x-${index}>`
	).join('');

	scanner.consume(distinctTags);

	expect(internals.unclosedTags.tagIndicesByName.size).toBe(0);

	scanner.consume('<div><div></div>');

	expect(internals.unclosedTags.tagIndicesByName.get('div')).toStrictEqual([
		0,
	]);

	scanner.consume('</div>');

	expect(internals.unclosedTags.tagIndicesByName.size).toBe(0);
});

test('handles raw text HTML tags', () => {
	expect(
		TagScanner.scan('<script>const foo = "<div>";</script>')
	).toStrictEqual([]);
	expect(TagScanner.scan('<script>const foo = "<div>";')).toStrictEqual([
		'script',
	]);
	expect(
		TagScanner.scan('<style>.foo::before { content: "<div>"; }</style>')
	).toStrictEqual([]);
	expect(
		TagScanner.scan('<style>.foo::before { content: "<div>"; }')
	).toStrictEqual(['style']);
	expect(TagScanner.scan('<textarea><div></textarea>')).toStrictEqual([]);
	expect(TagScanner.scan('<textarea><div>')).toStrictEqual(['textarea']);
});

test('handles optional HTML end tags', () => {
	expect(
		TagScanner.scan(
			'<ul><li id="foo" class="bar">baz<li id="qux" class="quux">corge</ul>'
		)
	).toStrictEqual([]);
	expect(TagScanner.scan('<dl><dt>foo<dd>bar</dl>')).toStrictEqual([]);
	expect(TagScanner.scan('<div><p>foo</div>')).toStrictEqual([]);
	expect(TagScanner.scan('<ruby><rt>foo<rp>(</ruby>')).toStrictEqual([]);
	expect(
		TagScanner.scan('<select><optgroup><option>foo<option>bar</select>')
	).toStrictEqual([]);
	expect(
		TagScanner.scan(
			'<table><thead><tr><th>foo<tbody><tr><td>bar<td>baz</table>'
		)
	).toStrictEqual([]);
	expect(
		TagScanner.scan(
			'<table><caption>foo<colgroup><col><tbody><tr><td>bar</table>'
		)
	).toStrictEqual([]);
});

test('handles incorrect HTML', () => {
	expect(TagScanner.scan('</img>')).toStrictEqual([]);
	expect(TagScanner.scan('<p></div>')).toStrictEqual(['p']);
	expect(TagScanner.scan('<div><span></div>')).toStrictEqual(['div', 'span']);
	expect(TagScanner.scan('<dl><dt>foo</dl>')).toStrictEqual(['dl', 'dt']);
	expect(TagScanner.scan('<div <p>foo</p>')).toStrictEqual([]);
	expect(TagScanner.scan('<div title="<p>')).toStrictEqual(['p']);
	expect(TagScanner.scan('<div><!-- foo <p>')).toStrictEqual(['div']);
});
