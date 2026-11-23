import type { ParserOptions } from 'prettier';
import type { AST, Regions } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, onTestFinished, test, vi } from 'vite-plus/test';
import findDocumentRegions from '../find-document-regions/index.ts';
import readRawHTML from '../read-raw-html/index.ts';
import checkRegionAcceptance from './index.ts';

async function decideRegions(
	markdown: string,
	getCorrections?: (tokens: Regions.Token[]) => Regions.Corrections
): Promise<string[]> {
	const root = (await pluginMarkdown.parsers.markdown.parse(markdown, {
		originalText: markdown,
	} as unknown as ParserOptions)) as AST.RootNode;
	const document = readRawHTML(root, markdown);
	const documentRegions = await findDocumentRegions(
		document,
		getCorrections?.(document.fragments.flatMap(({ tokens }) => tokens))
	);
	const verdicts = await checkRegionAcceptance(documentRegions);

	return describeRegions(documentRegions.regions, verdicts);
}

function describeRegions(
	regions: ReadonlyArray<Regions.Region>,
	verdicts: ReadonlyMap<Regions.Region, Regions.Verdict>,
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
		const protection = region.isProtected ? ' protected' : '';

		return [
			`${'  '.repeat(depth)}${region.kind} ${lines}${container}${protection}: ${describeVerdict(verdicts.get(region)!)}`,
			...describeRegions(region.regions, verdicts, depth + 1),
		];
	});
}

function describeVerdict(verdict: Regions.Verdict): string {
	if (verdict.isAccepted) {
		return 'accepted';
	}

	const { problem } = verdict;
	const { column, line } = problem.position;
	let subject: string;

	switch (problem.kind) {
		case 'escaped-pipe':
			subject = '\\|';
			break;

		case 'split-construct':

		case 'unsupported-construct':
			subject = problem.construct;
			break;

		case 'unpaired-closing-tag':
			subject = problem.tag.name;
			break;

		case 'unformattable':
			subject = (problem.cause as Error).message.split(/\.\s|\n/)[0]!;
			break;

		default:
			subject = problem.element.name;
	}

	return `${problem.kind} ${subject} at ${line}:${column}`;
}

function selectClosingTags(
	tokens: ReadonlyArray<Regions.Token>,
	name: string
): Regions.ClosingTag[] {
	return tokens.filter(
		(token): token is Regions.ClosingTag =>
			token.kind === 'closing-tag' && token.name === name
	);
}

test.each([
	{
		example: 'Overview',
		input: `<p align="center"><img src="https://prettier.io/icon.png" alt=""></p>
<h1 align="center">Prettier</h1>
<p align="center">Format code in your editor.<br>Check it on the command line.</p>
`,
		output: ['block 1-3: accepted'],
	},
	{
		example: 'Formatting Scope',
		input: `Press <kbd class='key'>⌘</kbd>+<kbd class='key'>S</kbd> to save the file.

> <p align='center'><b>Tip:</b> enable format on save in your editor.</p>

Write \`<kbd class='key'>\` to style a key.
`,
		output: ['inline 1: accepted', 'block 3-3 in blockquote: accepted'],
	},
	{
		example: 'Document Regions',
		input: `<details><summary>Install Prettier</summary>

In <project-directory>, type \`npm install --save-dev --save-exact prettier\` and press <KBD>Enter</KBD>.

<div><a href='https://prettier.io/docs/install'>Installation guide</a></div>

</details>

Try the options in the <A href='https://prettier.io/playground'>playground</A>.
`,
		output: [
			'block 1-7: accepted',
			'  inline 3: unclosed-element project-directory at 3:4',
			'  block 5-5: accepted',
			'inline 9: accepted',
		],
	},
	{
		example: 'Block HTML',
		input: `## Try the playground

  <p align="center">
  <a href="https://prettier.io/playground">Open the Prettier playground</a>
  </p>

Paste a snippet to compare the source with the formatted code.
`,
		output: ['block 3-5: accepted'],
	},
	{
		example: 'Fragment Indentation',
		input: `<table>
<tr>
<td>

**Before**: \`const ready=true\`

</td>
<td>

**After**: \`const ready = true;\`

</td>
</tr>
</table>
`,
		output: ['block 1-14: accepted'],
	},
	{
		example: 'Blank Lines',
		input: `Start with the defaults and adjust them for your project.
<div><a href="https://prettier.io/docs/options">Formatting options</a></div>
`,
		output: ['block 2-2: accepted'],
	},
	{
		example: 'Blank Lines in a tight list',
		input: `1. Choose the options your project needs
   <div><a href='https://prettier.io/docs/options'>Formatting options</a></div>
2. Save them in \`.prettierrc\`
`,
		output: ['block 2-2 in listItem: accepted'],
	},
	{
		example: 'Block Boundaries',
		input: `<a href="https://opencollective.com/prettier" title="Support Prettier on Open Collective">
  <img src="https://prettier.io/icon.png" width="48" alt="Sponsor Prettier">
</a>
`,
		output: ['block 1-3: accepted'],
	},
	{
		example: 'Inline HTML',
		input: `See <a href="https://prettier.io/docs/cli" target="_blank" rel="noreferrer">the CLI reference</a> for details.
`,
		output: ['inline 1: accepted'],
	},
	{
		example: 'Line Breaks',
		input: `<img src="https://prettier.io/icon.png" width="16" alt=""> [Read about formatting options](https://prettier.io/docs/options)
`,
		output: ['inline 1: accepted'],
	},
	{
		example: 'Single Lines',
		input: `# <img src="https://prettier.io/icon.png" width="32" alt=""> Editor setup

| Editor | Setup |
| --- | --- |
| VS Code | <a href='https://prettier.io/docs/editors' title='Editor integration'>Setup guide</a> |
`,
		output: ['inline 1: accepted', 'inline 5: accepted'],
	},
	{
		example: 'Content Preservation',
		input: `<a href="https://prettier.io/docs/install">
**Install Prettier locally**
</a>
`,
		output: ['block 1-3: accepted'],
	},
	{
		example: 'Normalization',
		input: `<ul><li>CSS<li>JavaScript<li>Markdown</ul>
`,
		output: ['block 1-1: accepted'],
	},
	{
		example: 'Corrections',
		input: `Prettier is free to use.</br>Donations support its development.

<div align="center">

**[Support Prettier on Open Collective](https://opencollective.com/prettier)**

</section>
`,
		output: [
			'inline 1: unpaired-closing-tag br at 1:25',
			'block 3-7: unclosed-element div at 3:1',
			'  block 7-7: unpaired-closing-tag section at 7:1',
		],
	},
	{
		example: 'Rejected Regions',
		input: `Copyright © <year> <copyright-holder>. <a href='LICENSE'>MIT License</a>.

Read the <a href='CONTRIBUTING.md'>contributing guide</a> before opening a pull request.
`,
		output: [
			'inline 1: unclosed-element year at 1:13',
			'inline 3: accepted',
		],
	},
	{
		example: 'Tag Matching',
		input: `<a href='https://prettier.io'>![Prettier](https://prettier.io/icon.png)</a>

Run Prettier locally<SUP>[install guide](https://prettier.io/docs/install)</SUP>.
`,
		output: ['inline 1: accepted', 'inline 3: accepted'],
	},
	{
		example: 'Tag Matching across HTML blocks',
		input: `<ul>
<li>Editor setup

Enable **format on save** for this project.

</ul>

On macOS, press <KBD>⌘</KBD>+<KBD>S</KBD> to save the file.
`,
		output: ['block 1-6: unclosed-element li at 2:1', 'inline 8: accepted'],
	},
	{
		example: 'Comments, Scripts, Preformatted Text',
		input: `<table>
<tr>
<td>
<pre>

npm install --save-dev --save-exact prettier

</pre>
</td>
</tr>
</table>

Press <KBD>Enter</KBD> to run it.
`,
		output: ['block 1-11: split-element pre at 4:1', 'inline 13: accepted'],
	},
	{
		example: 'Ignore Directives',
		input: `<!-- prettier-ignore-start -->
<table><tr><th>Install</th><th>Try online</th></tr><tr><td><a href="https://prettier.io/docs/install">Local setup</a></td><td><a href="https://prettier.io/playground">Playground</a></td></tr></table>

<!-- prettier-ignore-end -->

See the <a href='https://prettier.io/docs/cli'>CLI reference</a> for options.
`,
		output: [
			'block 1-1 protected: accepted',
			'block 2-2 protected: accepted',
			'block 4-4 protected: accepted',
			'inline 6: accepted',
		],
	},
])('decides the regions of the $example example', async ({ input, output }) => {
	await expect(decideRegions(input)).resolves.toStrictEqual(output);
});

test('accepts the Corrections examples once their corrections apply', async () => {
	await expect(
		decideRegions(
			`Install the extension.</br>Restart your editor.

<p><img src="prettier.svg" alt="Prettier"></img></p>
`,
			(tokens) => ({
				closingTags: new Map([
					[selectClosingTags(tokens, 'br')[0]!, '<br />'],
					[selectClosingTags(tokens, 'img')[0]!, ''],
				]),
			})
		)
	).resolves.toStrictEqual(['inline 1: accepted', 'block 3-3: accepted']);
});

test('rejects unpaired closing tags', async () => {
	await expect(
		decideRegions('<div>foo</div></span>\n\nbar</b>\n')
	).resolves.toStrictEqual([
		'block 1-1: unpaired-closing-tag span at 1:15',
		'inline 3: unpaired-closing-tag b at 3:4',
	]);
});

test('rejects elements that no closing tag pairs within their boundaries', async () => {
	await expect(
		decideRegions('foo <a><b>bar</a> baz\n\n<span>\n\nqux\n')
	).resolves.toStrictEqual([
		'inline 1: unclosed-element b at 1:8',
		'block 3-5: unclosed-element span at 3:1',
	]);
});

test('accepts elements that a later tag closes within their HTML block', async () => {
	await expect(
		decideRegions('<p>Intro\n<div>Box</div>\n')
	).resolves.toStrictEqual(['block 1-2: accepted']);
});

test('rejects raw HTML that Prettier can’t parse, where Prettier fails', async () => {
	await expect(
		decideRegions(
			'foo <KBD>bar</kbd> <b>baz\n\n<p>\n\n<div>qux</div>\n\n</p>\n'
		)
	).resolves.toStrictEqual([
		'inline 1: unformattable Unexpected closing tag "kbd" at 1:13',
		'block 3-7: unformattable Unexpected closing tag "p" at 7:1',
		'  block 5-5: accepted',
	]);
});

test('leaves nested regions that fail out of the HTML that Prettier parses', async () => {
	await expect(
		decideRegions('<details>\n\n<div></span></div>\n\n</details>\n')
	).resolves.toStrictEqual([
		'block 1-5: accepted',
		'  block 3-3: unpaired-closing-tag span at 3:6',
	]);
});

test('rejects opaque constructs and `pre` elements that continue past their fragment', async () => {
	await expect(
		decideRegions(`<div></div><!-- foo

bar -->
`)
	).resolves.toStrictEqual(['block 1-3: split-construct comment at 1:12']);
	await expect(
		decideRegions(`<div><style>

foo

<p></style></div>
`)
	).resolves.toStrictEqual(['block 1-5: split-element style at 1:6']);
	await expect(
		decideRegions('foo <script>bar</script> <pre>baz</pre>\n')
	).resolves.toStrictEqual(['inline 1: split-element script at 1:5']);
	await expect(decideRegions('foo <pre>bar</pre>\n')).resolves.toStrictEqual([
		'inline 1: split-element pre at 1:5',
	]);
});

test('rejects a tag that its HTML block ends before completing', async () => {
	await expect(
		decideRegions('<div title="foo\n\nbar">baz</div>\n')
	).resolves.toStrictEqual([
		'block 1-3: split-construct incomplete-tag at 1:1',
		'  inline 3: unpaired-closing-tag div at 3:9',
	]);
});

test('rejects elements that cross the boundary of protected source', async () => {
	await expect(
		decideRegions(`<!-- prettier-ignore -->
<p>foo <div>

bar

</div>
`)
	).resolves.toStrictEqual([
		'block 1-1: accepted',
		'block 2-6: crossed-protection div at 2:8',
	]);
	await expect(
		decideRegions(`<div>

foo

<!-- prettier-ignore -->
</div>
`)
	).resolves.toStrictEqual([
		'block 1-6: crossed-protection div at 1:1',
		'  block 5-5: accepted',
	]);
	await expect(
		decideRegions('foo <!-- prettier-ignore --><b>bar</b> baz\n')
	).resolves.toStrictEqual(['inline 1: crossed-protection b at 1:29']);
	await expect(
		decideRegions(
			'foo <!-- prettier-ignore --><b>bar<!-- prettier-ignore --></b> baz\n'
		)
	).resolves.toStrictEqual(['inline 1: crossed-protection b at 1:29']);
});

test('leaves formatting failures to the formatting of each region', async () => {
	vi.stubEnv('PRETTIER_DEBUG', '1');
	onTestFinished(() => {
		vi.unstubAllEnvs();
	});

	await expect(
		decideRegions(`<div><script>let = ;</script></div>

<div><img srcset="foo.png 100w, bar.png 2x" /></div>
`)
	).resolves.toStrictEqual(['block 1-1: accepted', 'block 3-3: accepted']);
});

test('parses nested regions inside the raw elements open around them', async () => {
	await expect(
		decideRegions('<svg>\n\n<source>\n</source>\n\n</svg>\n')
	).resolves.toStrictEqual([
		'block 1-6: split-construct svg at 1:1',
		'  block 3-4: accepted',
	]);
});

test('rejects self-closing syntax on HTML elements other than void elements', async () => {
	await expect(
		decideRegions(
			'<div><pre/></div>\n\nfoo <x-a/> bar\n\n<div><div   />foo</div></div>\n'
		)
	).resolves.toStrictEqual([
		'block 1-1: self-closing pre at 1:6',
		'inline 3: self-closing x-a at 3:5',
		'block 5-5: self-closing div at 5:6',
	]);
});

test('locates parse errors at the start of regions without HTML blocks of their own', async () => {
	await expect(
		decideRegions('<div><script>\n\n> foo <textarea>\n')
	).resolves.toStrictEqual([
		'block 1-3: unclosed-element script at 1:6',
		'  block 3-3 in blockquote: unformattable Unexpected character "EOF" (1:14) at 3:3',
		'    inline 3 in blockquote: unclosed-element textarea at 3:7',
	]);
});

test('rejects SVG and MathML elements that span Markdown', async () => {
	await expect(
		decideRegions('<svg>\n\nfoo <script/><g>\n\n</svg>\n')
	).resolves.toStrictEqual([
		'block 1-5: split-construct svg at 1:1',
		'  inline 3: unclosed-element g at 3:14',
	]);
	await expect(
		decideRegions('<math>\n\nfoo <title/> bar <b>baz\n\n</math>\n')
	).resolves.toStrictEqual([
		'block 1-5: split-construct math at 1:1',
		'  inline 3: unclosed-element b at 3:18',
	]);
	await expect(
		decideRegions('<svg>\n\n> <title/>\n> <g>\n\n</svg>\n')
	).resolves.toStrictEqual([
		'block 1-6: split-construct svg at 1:1',
		'  block 3-4 in blockquote: unclosed-element g at 4:3',
	]);
});

test('rejects only the region of an unpaired closing tag in foreign content', async () => {
	await expect(
		decideRegions(
			'<div>\n<svg><g></rect><rect/></g></svg>\n</div>\n\n<p>foo</p>\n'
		)
	).resolves.toStrictEqual([
		'block 1-3: unpaired-closing-tag rect at 2:9',
		'block 5-5: accepted',
	]);
});

test('rejects only the region of an unpaired closing tag in foreign content before a self-closing title', async () => {
	await expect(
		decideRegions(
			'<div>\n<svg><g></rect><title/><rect/></g></svg>\n</div>\n\n<p>foo</p>\n'
		)
	).resolves.toStrictEqual([
		'block 1-3: unpaired-closing-tag rect at 2:9',
		'block 5-5: accepted',
	]);
});

test('rejects declarations, processing instructions, and CDATA sections', async () => {
	await expect(
		decideRegions(
			'<!DOCTYPE html>\n\n<?xml version="1.0"?>\n\nfoo <![CDATA[bar]]> baz\n'
		)
	).resolves.toStrictEqual([
		'block 1-1: unsupported-construct declaration at 1:1',
		'block 3-3: unsupported-construct processing-instruction at 3:1',
		'inline 5: unsupported-construct cdata at 5:5',
	]);
	await expect(
		decideRegions('<?report data="a>b"\n\n?>\n\n<p>foo</p>\n')
	).resolves.toStrictEqual([
		'block 1-3: unsupported-construct processing-instruction at 1:1',
		'block 5-5: accepted',
	]);
});

test('rejects table cells whose raw HTML contains an escaped pipe', async () => {
	await expect(
		decideRegions('| foo |\n| - |\n| <b title="bar\\|baz">qux</b> |\n')
	).resolves.toStrictEqual(['inline 3: escaped-pipe \\| at 3:3']);
});

test('rejects inline SVG and MathML elements', async () => {
	await expect(
		decideRegions(
			'foo <svg><g></g></svg> bar\n\n<div><svg><g></g></svg></div>\n\nbaz <math><mi>x</mi></math>\n'
		)
	).resolves.toStrictEqual([
		'inline 1: inline-foreign svg at 1:5',
		'block 3-3: accepted',
		'inline 5: inline-foreign math at 5:5',
	]);
});
