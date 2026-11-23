import type { ParserOptions } from 'prettier';
import type { AST, Regions } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test } from 'vite-plus/test';
import readRawHTML from '../read-raw-html/index.ts';
import findDocumentRegions, {
	findEndFragment,
	isSplitForeignElement,
	matchRawTags,
} from './index.ts';

async function readMarkdown(markdown: string): Promise<Regions.Document> {
	const root = (await pluginMarkdown.parsers.markdown.parse(markdown, {
		originalText: markdown,
	} as unknown as ParserOptions)) as AST.RootNode;

	return readRawHTML(root, markdown);
}

function describeElement({
	end,
	endTag,
	isForeign,
	name,
	opening,
	parent,
}: Regions.Element): string {
	const ending = endTag ? ` ${locate(endTag)}` : '';
	const enclosing = parent
		? ` in ${parent.name} ${locate(parent.opening)}`
		: '';

	return `${name} ${locate(opening)} ${end}${ending}${enclosing}${isForeign ? ' foreign' : ''}`;
}

function locate({ position }: Regions.Token): string {
	return `${position.line}:${position.column}`;
}

async function matchMarkdown(
	markdown: string,
	getCorrections?: (tokens: Regions.Token[]) => Regions.Corrections
): Promise<{ elements: string[]; unpairedClosingTags: string[] }> {
	const document = await readMarkdown(markdown);
	const sequence = [
		document.root.blocks,
		...document.root.inlines.map(({ fragments }) => fragments),
	].find((fragments) => fragments.length > 0);
	const matching = await matchRawTags(
		sequence!,
		getCorrections?.(document.fragments.flatMap(({ tokens }) => tokens))
	);

	return {
		elements: matching.elements.map((element) => describeElement(element)),
		unpairedClosingTags: matching.unpairedClosingTags.map(
			(tag) => `${tag.name} ${locate(tag)}`
		),
	};
}

async function findSplitForeignElements(markdown: string): Promise<string[]> {
	const document = await readMarkdown(markdown);
	const { elements } = await matchRawTags(
		document.root.inlines[0]!.fragments
	);

	return elements
		.filter((element) => isSplitForeignElement(element))
		.map((element) => describeElement(element));
}

function describeRegions(
	regions: ReadonlyArray<Regions.Region>,
	depth = 0
): string[] {
	return regions.flatMap((region) => {
		const container =
			region.container.kind === 'root'
				? ''
				: ` in ${region.container.kind}`;
		const lines =
			region.kind === 'block'
				? `${region.nodes[0]!.position!.start.line}-${region.nodes.at(-1)!.position!.end.line}`
				: `${region.node.position!.start.line}`;

		return [
			`${'  '.repeat(depth)}${region.kind} ${lines}${container}${region.isProtected ? ' protected' : ''}`,
			...describeRegions(region.regions, depth + 1),
		];
	});
}

async function findMarkdownRegions(markdown: string): Promise<string[]> {
	const { regions } = await findDocumentRegions(await readMarkdown(markdown));

	return describeRegions(regions);
}

test('pairs a closing tag with the nearest open element of the same name', async () => {
	await expect(
		matchMarkdown('<div><span><div></div></span>\n')
	).resolves.toStrictEqual({
		elements: [
			'div 1:1 unclosed',
			'span 1:6 closing-tag 1:23 in div 1:1',
			'div 1:12 closing-tag 1:17 in span 1:6',
		],
		unpairedClosingTags: [],
	});
});

test('pairs overlapping elements', async () => {
	await expect(
		matchMarkdown('foo <b><i>bar</b></i>\n')
	).resolves.toStrictEqual({
		elements: ['b 1:5 closing-tag 1:14', 'i 1:8 closing-tag 1:18 in b 1:5'],
		unpairedClosingTags: [],
	});
});

test('ends an element that never pairs where an enclosing element closes', async () => {
	await expect(
		matchMarkdown('foo <a><b><i>bar</b> baz</a> <u>qux</a>\n')
	).resolves.toStrictEqual({
		elements: [
			'a 1:5 closing-tag 1:25',
			'b 1:8 closing-tag 1:17 in a 1:5',
			'i 1:11 enclosing 1:17 in b 1:8',
			'u 1:30 unclosed',
		],
		unpairedClosingTags: ['a 1:36'],
	});
});

test('follows Prettier where a later tag in an HTML block closes an element', async () => {
	await expect(
		matchMarkdown('<p>foo\n<div>bar</div>\n<ul><li>baz<li>qux</ul>\n')
	).resolves.toStrictEqual({
		elements: [
			'p 1:1 implicit',
			'div 2:1 closing-tag 2:9',
			'ul 3:1 closing-tag 3:19',
			'li 3:5 implicit in ul 3:1',
			'li 3:12 implicit in ul 3:1',
		],
		unpairedClosingTags: [],
	});
});

test('keeps elements from earlier HTML blocks open', async () => {
	await expect(
		matchMarkdown('<p>foo\n\n<div>bar</div>\n\n<p>baz\n<p>qux\n')
	).resolves.toStrictEqual({
		elements: [
			'p 1:1 unclosed',
			'div 3:1 closing-tag 3:9 in p 1:1',
			'p 5:1 implicit',
			'p 6:1 unclosed',
		],
		unpairedClosingTags: [],
	});
});

test('keeps elements open when Prettier can’t parse their HTML block', async () => {
	await expect(
		matchMarkdown('<p>foo\n<div>bar</div></span>\n')
	).resolves.toStrictEqual({
		elements: ['p 1:1 unclosed', 'div 2:1 closing-tag 2:9 in p 1:1'],
		unpairedClosingTags: ['span 2:15'],
	});
});

test('applies corrections before Prettier reads an HTML block', async () => {
	await expect(
		matchMarkdown('<p>foo</section>\n<div>bar</div>\n', (tokens) => ({
			closingTags: new Map(
				tokens
					.filter(
						(token): token is Regions.ClosingTag =>
							token.kind === 'closing-tag' &&
							token.name === 'section'
					)
					.map((token) => [token, ''])
			),
		}))
	).resolves.toStrictEqual({
		elements: ['p 1:1 implicit', 'div 2:1 closing-tag 2:9'],
		unpairedClosingTags: [],
	});
});

test('takes parents from Prettier’s parse of an HTML block', async () => {
	await expect(
		matchMarkdown('<ul><li>First<li>Second</li></ul>\n')
	).resolves.toStrictEqual({
		elements: [
			'ul 1:1 closing-tag 1:29',
			'li 1:5 implicit in ul 1:1',
			'li 1:14 closing-tag 1:24 in ul 1:1',
		],
		unpairedClosingTags: [],
	});
});

test('finds the end marker in Prettier’s parse by its position', async () => {
	await expect(
		matchMarkdown(`<p>foo
<prettier-plugin-markdown-html-block-end></prettier-plugin-markdown-html-block-end>
<div>bar</div>
`)
	).resolves.toStrictEqual({
		elements: [
			'p 1:1 implicit',
			'prettier-plugin-markdown-html-block-end 2:1 closing-tag 2:42 in p 1:1',
			'div 3:1 closing-tag 3:9',
		],
		unpairedClosingTags: [],
	});
});

test('keeps elements open in an HTML block that ends inside an opaque construct', async () => {
	await expect(
		matchMarkdown('<div><!-- foo </div>\n')
	).resolves.toStrictEqual({
		elements: ['div 1:1 unclosed'],
		unpairedClosingTags: [],
	});
});

test('stops an element that an enclosing element ends from enclosing later blocks', async () => {
	await expect(
		matchMarkdown('<details>\n\n<svg>\n\n</details>\n\n<div><br></div>\n')
	).resolves.toStrictEqual({
		elements: [
			'details 1:1 closing-tag 5:1',
			'svg 3:1 enclosing 5:1 in details 1:1 foreign',
			'div 7:1 closing-tag 7:10',
			'br 7:6 opening-tag in div 7:1',
		],
		unpairedClosingTags: [],
	});
});

test('keeps an element open where Prettier pairs its closing tag differently', async () => {
	await expect(
		matchMarkdown('<div><div/>foo</div>\n\n<p>bar</p>\n\n</div>\n')
	).resolves.toStrictEqual({
		elements: [
			'div 1:1 closing-tag 5:1',
			'div 1:6 closing-tag 1:15 in div 1:1',
			'p 3:1 closing-tag 3:7 in div 1:1',
		],
		unpairedClosingTags: [],
	});
});

test('pairs a closing tag with an element around the elements that close inside it', async () => {
	await expect(
		matchMarkdown('<ul>\n<li>foo<ul><li>bar</ul></li>\n\nbaz\n\n</ul>\n')
	).resolves.toStrictEqual({
		elements: [
			'ul 1:1 closing-tag 6:1',
			'li 2:1 closing-tag 2:24 in ul 1:1',
			'ul 2:8 closing-tag 2:19 in li 2:1',
			'li 2:12 implicit in ul 2:8',
		],
		unpairedClosingTags: [],
	});
	await expect(
		matchMarkdown('<ul>\n<li>foo\n\nbar\n\n<ul><li>baz</ul></li>\n</ul>\n')
	).resolves.toStrictEqual({
		elements: [
			'ul 1:1 closing-tag 7:1',
			'li 2:1 closing-tag 6:17 in ul 1:1',
			'ul 6:1 closing-tag 6:12 in li 2:1',
			'li 6:5 implicit in ul 6:1',
		],
		unpairedClosingTags: [],
	});
});

test('closes only void and foreign elements with self-closing syntax', async () => {
	await expect(
		matchMarkdown(
			'foo <img src="bar.png"> <br/> <span/> <x-a/> <svg><path/></svg></br>\n'
		)
	).resolves.toStrictEqual({
		elements: [
			'img 1:5 opening-tag',
			'br 1:25 opening-tag',
			'span 1:31 unclosed',
			'x-a 1:39 unclosed in span 1:31',
			'svg 1:46 closing-tag 1:58 in x-a 1:39 foreign',
			'path 1:51 opening-tag in svg 1:46 foreign',
		],
		unpairedClosingTags: ['br 1:64'],
	});
});

test('reads tags after a self-closing raw text element as markup', async () => {
	await expect(
		matchMarkdown(
			'<div><script/>\n\n<div data-a="b">\n\n<p></script></div>\n'
		)
	).resolves.toStrictEqual({
		elements: [
			'div 1:1 unclosed',
			'script 1:6 closing-tag 5:4 in div 1:1',
			'div 3:1 closing-tag 5:13 in script 1:6',
			'p 5:1 implicit in div 3:1',
		],
		unpairedClosingTags: [],
	});
});

test('closes self-closing raw text elements in foreign content', async () => {
	await expect(
		matchMarkdown('<div><svg><title/><rect/></svg></div>\n\n<p>foo</p>\n')
	).resolves.toStrictEqual({
		elements: [
			'div 1:1 closing-tag 1:32',
			'svg 1:6 closing-tag 1:26 in div 1:1 foreign',
			'title 1:11 opening-tag in svg 1:6 foreign',
			'rect 1:19 opening-tag in svg 1:6 foreign',
			'p 3:1 closing-tag 3:7',
		],
		unpairedClosingTags: [],
	});
});

test('pairs closing tags of HTML void names in foreign content', async () => {
	await expect(
		matchMarkdown('foo <svg><source></source></svg> <math><br></math>\n')
	).resolves.toStrictEqual({
		elements: [
			'svg 1:5 closing-tag 1:27 foreign',
			'source 1:10 closing-tag 1:18 in svg 1:5 foreign',
			'math 1:34 closing-tag 1:44 foreign',
			'br 1:40 enclosing 1:44 in math 1:34 foreign',
		],
		unpairedClosingTags: [],
	});
});

test('skips closing tags that a correction removes or rewrites', async () => {
	await expect(
		matchMarkdown('foo</br>bar</section>\n', (tokens) => ({
			closingTags: new Map(
				tokens
					.filter(
						(token): token is Regions.ClosingTag =>
							token.kind === 'closing-tag'
					)
					.map((token) => [
						token,
						token.name === 'br' ? '<br />' : '',
					])
			),
		}))
	).resolves.toStrictEqual({ elements: [], unpairedClosingTags: [] });
});

test('splits inline SVG and MathML elements that an enclosing element closes first', async () => {
	await expect(
		findSplitForeignElements('foo <span><svg></span></svg> bar\n')
	).resolves.toStrictEqual(['svg 1:11 closing-tag 1:23 in span 1:5 foreign']);
	await expect(
		findSplitForeignElements('foo <span><math></math></span> bar\n')
	).resolves.toStrictEqual([]);
});

test('finds the fragment where an element ends', async () => {
	const document = await readMarkdown(
		'<div>\n<img>\n\n<p>foo\n\n</div>\n\n<section>\n'
	);
	const { elements } = await matchRawTags(document.root.blocks);
	const [first, , third] = document.root.blocks;

	expect(elements.map((element) => findEndFragment(element))).toStrictEqual([
		third,
		first,
		third,
		undefined,
	]);
});

test('gives each HTML block that no element crosses its own region', async () => {
	await expect(
		findMarkdownRegions('<div>foo</div>\n\nbar\n\n<p>baz</p>\n')
	).resolves.toStrictEqual(['block 1-1', 'block 5-5']);
});

test('joins HTML blocks that a pair of tags spans, with the Markdown between', async () => {
	await expect(
		findMarkdownRegions('<div>\n\nfoo <b>bar</b>\n\n</div>\n\nbaz\n')
	).resolves.toStrictEqual(['block 1-5', '  inline 3']);
});

test('joins overlapping pairs into one region', async () => {
	await expect(
		findMarkdownRegions('<div>\n\n<span>\n\n</div>\n\n</span>\n')
	).resolves.toStrictEqual(['block 1-7']);
});

test('extends an unclosed element’s region to the end of its container', async () => {
	await expect(
		findMarkdownRegions(
			'> <p>foo</p>\n>\n> <div>\n>\n> bar\n\n<p>baz</p>\n'
		)
	).resolves.toStrictEqual([
		'block 1-1 in blockquote',
		'block 3-5 in blockquote',
		'block 7-7',
	]);
});

test('extends an element that never pairs only to the enclosing element’s close', async () => {
	await expect(
		findMarkdownRegions(
			'<div>\n\n<p>foo\n\n<section>\n\n</div>\n\n<p>bar</p>\n'
		)
	).resolves.toStrictEqual(['block 1-7', 'block 9-9']);
});

test('extends the region of raw text that a paragraph leaves open to the end of its container', async () => {
	await expect(
		findMarkdownRegions(
			'> foo <textarea>bar\n>\n> <p>baz</p>\n\n<p>qux</p>\n'
		)
	).resolves.toStrictEqual([
		'block 1-3 in blockquote',
		'  inline 1 in blockquote',
		'  block 3-3 in blockquote',
		'block 5-5',
	]);
});

test('starts the region of raw text that a table cell leaves open at that cell', async () => {
	await expect(
		findMarkdownRegions(
			'| foo | bar |\n| --- | --- |\n| <kbd>baz</kbd> | qux <pre> |\n\n<p>quux</p>\n'
		)
	).resolves.toStrictEqual([
		'block 1-5',
		'  inline 3',
		'  block 5-5',
		'inline 3',
	]);
	await expect(
		findMarkdownRegions(
			'<div><span>\n\n| foo | bar |\n| --- | --- |\n| <kbd>baz</kbd> | qux <pre> |\n\n</div>\n'
		)
	).resolves.toStrictEqual(['block 1-7', '  inline 5', '  inline 5']);
	await expect(
		findMarkdownRegions(
			'| foo | bar | baz |\n| --- | --- | --- |\n| <kbd>qux</kbd> | quux <pre> | corge <pre> |\n\n<p>grault</p>\n'
		)
	).resolves.toStrictEqual([
		'block 1-5',
		'  inline 3',
		'  inline 3',
		'  block 5-5',
		'inline 3',
	]);
});

test('extends the region of an opaque construct to the end of its container', async () => {
	await expect(
		findMarkdownRegions(
			'<p>foo</p>\n\n<div><!-- bar\n\nbaz -->\n\n<p>qux</p>\n'
		)
	).resolves.toStrictEqual(['block 1-1', 'block 3-7']);
});

test('leaves an unpaired closing tag in the region of its HTML block', async () => {
	await expect(
		findMarkdownRegions('<div>\n\n</span>\n\n</div>\n')
	).resolves.toStrictEqual(['block 1-5', '  block 3-3']);
});

test('nests regions in containers and in the regions around them', async () => {
	await expect(
		findMarkdownRegions(`<details>

<div><b>foo</b></div>

> <p>bar <i>baz</i></p>
>
> qux <u>quux</u>

- <s>corge</s>

</details>

<i>grault</i>
`)
	).resolves.toStrictEqual([
		'block 1-11',
		'  block 3-3',
		'  block 5-5 in blockquote',
		'  inline 7 in blockquote',
		'  inline 9 in listItem',
		'inline 13',
	]);
});

test('marks regions that ignore directives protect entirely', async () => {
	await expect(
		findMarkdownRegions(`<!-- prettier-ignore -->
<div>foo</div>

<!-- prettier-ignore-start -->
<div>

bar <b>baz</b>

</div>

<!-- prettier-ignore-end -->

<!-- prettier-ignore -->
<p>qux

</p>
`)
	).resolves.toStrictEqual([
		'block 1-1',
		'block 2-2 protected',
		'block 4-4 protected',
		'block 5-9 protected',
		'  inline 7 protected',
		'block 11-11 protected',
		'block 13-13',
		'block 14-16',
	]);
});

test('ends an unclosed element’s region after the last child of its container', async () => {
	await expect(
		findMarkdownRegions('<div>\n\nfoo\n\n<p>bar</p>\n')
	).resolves.toStrictEqual(['block 1-5', '  block 5-5']);
	await expect(
		findMarkdownRegions('<div>\n\nfoo\n\n<p>bar</p>\n\nbaz\n')
	).resolves.toStrictEqual(['block 1-7', '  block 5-5']);
});

test('carries the raw elements open around a region into its matching', async () => {
	const { regions } = await findDocumentRegions(
		await readMarkdown(`<svg>

foo <source></source>

> <source>
> </source>

</svg>
`)
	);
	const [region] = regions;
	const [svg] = region!.elements;
	const [inline, quote] = region!.regions;

	expect(inline!.ancestors).toHaveLength(1);
	expect(inline!.ancestors[0]).toBe(svg);
	expect(
		inline!.elements.map((element) => describeElement(element))
	).toStrictEqual(['source 3:5 closing-tag 3:13 in svg 1:1 foreign']);
	expect(quote!.ancestors).toHaveLength(1);
	expect(quote!.ancestors[0]).toBe(svg);
	expect(
		quote!.elements.map((element) => describeElement(element))
	).toStrictEqual(['source 5:3 closing-tag 6:3 in svg 1:1 foreign']);
	expect(quote!.unpairedClosingTags).toStrictEqual([]);
});
