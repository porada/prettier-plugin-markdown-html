import type { ParserOptions } from 'prettier';
import type { AST, Regions } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test } from 'vite-plus/test';
import readRawHTML from '../read-raw-html/index.ts';
import decideCorrections from './index.ts';

async function decideMarkdownCorrections(markdown: string): Promise<string[]> {
	const root = (await pluginMarkdown.parsers.markdown.parse(markdown, {
		originalText: markdown,
	} as unknown as ParserOptions)) as AST.RootNode;
	const { closingTags } = await decideCorrections(
		readRawHTML(root, markdown)
	);

	return [...closingTags!]
		.toSorted(([a], [b]) => a.position.offset! - b.position.offset!)
		.map(
			([tag, replacement]) =>
				`${describeTag(tag)} → ${replacement === '' ? 'removed' : replacement}`
		);
}

function describeTag(tag: Regions.ClosingTag): string {
	const { position } = tag;

	return `${tag.fragment.node.value.slice(tag.start, tag.end)} ${position.line}:${position.column}`;
}

test('corrects only closing tags whose name directly follows `</`', async () => {
	await expect(
		decideMarkdownCorrections(
			'<p>foo</ br>bar</br >baz<img src="a.png"></ img></p>\n'
		)
	).resolves.toStrictEqual(['</br > 1:16 → <br />']);
});

test('rewrites `</br>` as `<br />`', async () => {
	await expect(
		decideMarkdownCorrections(
			'Install the extension.</br>Restart your editor.\n'
		)
	).resolves.toStrictEqual(['</br> 1:23 → <br />']);
	await expect(
		decideMarkdownCorrections(
			'<p>Install the extension.</br>Restart your editor.</p>\n'
		)
	).resolves.toStrictEqual(['</br> 1:26 → <br />']);
	await expect(
		decideMarkdownCorrections('<p>foo<br></br>bar</p>\n')
	).resolves.toStrictEqual(['</br> 1:11 → <br />']);
	await expect(
		decideMarkdownCorrections('<div>\n\nfoo\n\n</br>\n\n</div>\n')
	).resolves.toStrictEqual(['</br> 5:1 → <br />']);
});

test('removes void closing tags directly after their own opening tags', async () => {
	await expect(
		decideMarkdownCorrections(
			'<p><img src="prettier.svg" alt="Prettier"></img></p>\n'
		)
	).resolves.toStrictEqual(['</img> 1:43 → removed']);
	await expect(
		decideMarkdownCorrections('See <img src="foo.png"></img> here.\n')
	).resolves.toStrictEqual(['</img> 1:24 → removed']);
	await expect(
		decideMarkdownCorrections('<p><img\n  src="foo.png"\n></img></p>\n')
	).resolves.toStrictEqual(['</img> 3:2 → removed']);
	await expect(
		decideMarkdownCorrections('> <p><hr></hr></p>\n')
	).resolves.toStrictEqual(['</hr> 1:10 → removed']);
});

test('keeps void closing tags that don’t directly follow their own opening tags', async () => {
	await expect(
		decideMarkdownCorrections('<p><img src="foo.png"> </img></p>\n')
	).resolves.toStrictEqual([]);
	await expect(
		decideMarkdownCorrections('<p><img src="foo.png">\n</img></p>\n')
	).resolves.toStrictEqual([]);
	await expect(
		decideMarkdownCorrections('<p><hr></img></p>\n')
	).resolves.toStrictEqual([]);
	await expect(
		decideMarkdownCorrections('See <img src="foo.png">bar</img> here.\n')
	).resolves.toStrictEqual([]);
	await expect(
		decideMarkdownCorrections('<img src="foo.png">\n\n</img>\n')
	).resolves.toStrictEqual([]);
	await expect(decideMarkdownCorrections('</img>\n')).resolves.toStrictEqual(
		[]
	);
});

test('leaves unclosed container elements and stray closing tags uncorrected', async () => {
	await expect(
		decideMarkdownCorrections('<div align="center">\n\n**foo**\n')
	).resolves.toStrictEqual([]);
	await expect(
		decideMarkdownCorrections('<p>foo</p>\n</section>\n')
	).resolves.toStrictEqual([]);
	await expect(
		decideMarkdownCorrections('foo </span> bar\n')
	).resolves.toStrictEqual([]);
});

test('corrects nothing in opaque content', async () => {
	await expect(
		decideMarkdownCorrections('<!-- foo</br>bar -->\n')
	).resolves.toStrictEqual([]);
	await expect(
		decideMarkdownCorrections('<script>foo("</br>");</script>\n')
	).resolves.toStrictEqual([]);
});

test('corrects nothing in SVG and MathML content', async () => {
	await expect(
		decideMarkdownCorrections('<svg width="16"><br></br></svg>\n')
	).resolves.toStrictEqual([]);
	await expect(
		decideMarkdownCorrections('<svg width="16"></br></svg>\n')
	).resolves.toStrictEqual([]);
	await expect(
		decideMarkdownCorrections('<svg width="16"><source /></source></svg>\n')
	).resolves.toStrictEqual([]);
	await expect(
		decideMarkdownCorrections('<math><source /></source></math>\n')
	).resolves.toStrictEqual([]);
});

test('corrects nothing in SVG and MathML content after a closing tag that pairs with nothing', async () => {
	await expect(
		decideMarkdownCorrections(
			'<div><svg width="16"></g></br></svg></div>\n'
		)
	).resolves.toStrictEqual([]);
	await expect(
		decideMarkdownCorrections('<div><math></mi></br>\n')
	).resolves.toStrictEqual([]);
	await expect(
		decideMarkdownCorrections(
			'<div><svg width="16"><g></g></x></br></svg></br><math></math></div>\n'
		)
	).resolves.toStrictEqual(['</br> 1:44 → <br />']);
});

test('corrects nothing in source that a Markdown ignore directive protects', async () => {
	await expect(
		decideMarkdownCorrections(
			'<!-- prettier-ignore -->\n<p>foo</br>bar</p>\n'
		)
	).resolves.toStrictEqual([]);
	await expect(
		decideMarkdownCorrections(
			'<!-- prettier-ignore-start -->\n\nfoo</br>bar\n\n<!-- prettier-ignore-end -->\n'
		)
	).resolves.toStrictEqual([]);
});

test('corrects nothing in elements that HTML ignore directives protect', async () => {
	await expect(
		decideMarkdownCorrections(
			'<div><!-- prettier-ignore --><p><img src="foo.png"></img></p></div>\n'
		)
	).resolves.toStrictEqual([]);
});

test('keeps closing tags that HTML ignore directives target directly', async () => {
	await expect(
		decideMarkdownCorrections(
			'<div>\n<!-- prettier-ignore -->\n</br>\n<p>foo</p>\n</div>\n'
		)
	).resolves.toStrictEqual([]);
	await expect(
		decideMarkdownCorrections('foo <!-- prettier-ignore --> </br> bar\n')
	).resolves.toStrictEqual([]);
});

test('rewrites `</br>` after an attribute ignore directive', async () => {
	await expect(
		decideMarkdownCorrections(
			'<p>foo <!-- prettier-ignore-attribute --></br> bar</p>\n'
		)
	).resolves.toStrictEqual(['</br> 1:42 → <br />']);
	await expect(
		decideMarkdownCorrections(
			'foo <!-- prettier-ignore-attribute --> </br> bar\n'
		)
	).resolves.toStrictEqual(['</br> 1:40 → <br />']);
});

test('corrects closing tags outside the targets of HTML ignore directives', async () => {
	await expect(
		decideMarkdownCorrections(
			'<div></br><!-- prettier-ignore --><p>foo</br>bar</p></div>\n'
		)
	).resolves.toStrictEqual(['</br> 1:6 → <br />']);
	await expect(
		decideMarkdownCorrections(
			'<div><!-- prettier-ignore --><b>foo</b></br></div>\n'
		)
	).resolves.toStrictEqual(['</br> 1:40 → <br />']);
	await expect(
		decideMarkdownCorrections(
			'# Title <!-- prettier-ignore -->\n\n<p>foo</br>bar</p>\n'
		)
	).resolves.toStrictEqual(['</br> 3:7 → <br />']);
	await expect(
		decideMarkdownCorrections(
			'<p>foo</br>bar</p>\n\nThe end <!-- prettier-ignore -->\n'
		)
	).resolves.toStrictEqual(['</br> 1:7 → <br />']);
	await expect(
		decideMarkdownCorrections(
			'<div><!-- prettier-ignore --><p>foo<div>bar</div></div>\n\n<p>baz</br></p>\n'
		)
	).resolves.toStrictEqual(['</br> 3:7 → <br />']);
	await expect(
		decideMarkdownCorrections(
			'> <div><!-- prettier-ignore --><span>foo\n\n<p>bar</br></p>\n'
		)
	).resolves.toStrictEqual(['</br> 3:7 → <br />']);
});
