import type { ParserOptions } from 'prettier';
import type { AST, Regions } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test } from 'vite-plus/test';
import decideCorrections from '../decide-corrections/index.ts';
import findDocumentRegions from '../find-document-regions/index.ts';
import readRawHTML from '../read-raw-html/index.ts';
import renderRegionHTML, { locateHTMLOffset } from './index.ts';

async function readRegions(markdown: string): Promise<Regions.DocumentRegions> {
	const root = (await pluginMarkdown.parsers.markdown.parse(markdown, {
		originalText: markdown,
	} as unknown as ParserOptions)) as AST.RootNode;
	const document = readRawHTML(root, markdown);

	return findDocumentRegions(document, await decideCorrections(document));
}

test('renders a block region’s HTML with the nested regions that it includes', async () => {
	const { corrections, regions } = await readRegions(
		'<details>\n\n<div>foo</div>\n\n</details>\n'
	);
	const [region] = regions;

	expect(renderRegionHTML(region!, corrections, () => true).html).toBe(
		'<details>\n<div>foo</div>\n</details>'
	);
	expect(renderRegionHTML(region!, corrections, () => false).html).toBe(
		'<details>\n</details>'
	);
});

test('renders corrected closing tags inside the raw elements open around a region', async () => {
	const { corrections, regions } = await readRegions(
		'<div>\n\n> <p>Before</br>After</p>\n\n</div>\n'
	);
	const [region] = regions[0]!.regions;

	expect(renderRegionHTML(region!, corrections, () => true).html).toBe(
		'<div><p>Before<br />After</p>'
	);
});

test('maps points in a region’s HTML back to the Markdown source', async () => {
	const { corrections, document, regions } = await readRegions(
		'<div>\n\n> <p>Before</br>After</p>\n\n</div>\n'
	);
	const [region] = regions[0]!.regions;
	const regionHTML = renderRegionHTML(region!, corrections, () => true);

	expect(
		locateHTMLOffset(regionHTML, { column: 1, line: 1 }, document)
	).toStrictEqual({ column: 3, line: 3, offset: 9 });
	expect(
		locateHTMLOffset(regionHTML, { column: 17, line: 1 }, document)
	).toStrictEqual({ column: 12, line: 3, offset: 18 });
	expect(
		locateHTMLOffset(regionHTML, { column: 21, line: 1 }, document)
	).toStrictEqual({ column: 17, line: 3, offset: 23 });
});
