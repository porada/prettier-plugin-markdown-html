import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import { expect, test } from 'vite-plus/test';
import decideRegions, {
	createRoleSentinels,
	findChangedBlocks,
	findChangedRoles,
	findMovedIgnoreComments,
	findRegionAt,
	isRejected,
	listContainerAncestors,
	listNotices,
	listRegions,
	listRejectedNodes,
	locateRoleSentinels,
} from './index.ts';

async function parseMarkdown(markdown: string): Promise<AST.RootNode> {
	return (await pluginMarkdown.parsers.markdown.parse(markdown, {
		originalText: markdown,
	} as unknown as ParserOptions)) as AST.RootNode;
}

async function decideMarkdown(
	markdown: string
): Promise<Awaited<ReturnType<typeof decideRegions>>> {
	return decideRegions(await parseMarkdown(markdown), {
		originalText: markdown,
	} as ParserOptions);
}

test('lists the HTML of rejected regions, including nested regions', async () => {
	const decisions = await decideMarkdown(
		'<details><span>\n\nfoo <b>bar</b>\n\n</details>\n\n<p>baz</p>\n'
	);
	const [outer, nested] = listRegions(decisions);

	expect(isRejected(decisions, outer!)).toBe(true);
	expect(isRejected(decisions, nested!)).toBe(true);
	expect(
		[...listRejectedNodes(decisions)].map(
			(node) => (node as AST.HTMLNode).value
		)
	).toStrictEqual(['<details><span>', '<b>', '</b>', '</details>']);
	expect(listNotices(decisions).map(({ region }) => region)).toStrictEqual([
		outer,
	]);
});

test.each([
	{ moved: false, next: '<div   >preview</div>' },
	{ moved: true, next: '<section>preview</section>' },
	{ moved: true, next: 'Preview' },
])(
	'checks the new target of a standalone ignore directive before $next',
	async ({ moved, next }) => {
		const input = '<!-- prettier-ignore --><div   >preview</div>\n';
		const decisions = await decideMarkdown(input);
		const fragment = decisions.documentRegions.document.fragments[0]!;
		const text = `<!-- prettier-ignore -->\n${next}\n`;
		const changes = await findMovedIgnoreComments(
			decisions,
			await parseMarkdown(text),
			{
				offsets: new Map([[fragment.node, 0]]),
				text,
			}
		);

		expect(changes.map(({ problem }) => problem.kind)).toStrictEqual(
			moved ? ['moved-ignore-comment'] : []
		);
	}
);

test('gives no notices for rejected regions that ignore directives protect', async () => {
	const decisions = await decideMarkdown(
		'<!-- prettier-ignore -->\n<div></span></div>\n'
	);

	expect(decisions.problems.size).toBe(1);
	expect(listNotices(decisions)).toStrictEqual([]);
});

test('finds the innermost region around a point', async () => {
	const decisions = await decideMarkdown(
		'<div>\n\nfoo <b>bar</b>\n\n</div>\n'
	);
	const [outer, inline] = listRegions(decisions);

	expect(
		findRegionAt(decisions.documentRegions.regions, { column: 5, line: 3 })
	).toBe(inline);
	expect(
		findRegionAt(decisions.documentRegions.regions, { column: 1, line: 1 })
	).toBe(outer);
	expect(
		findRegionAt(decisions.documentRegions.regions, { column: 1, line: 7 })
	).toBeUndefined();
});

test('names the raw elements open around a Markdown container', async () => {
	const root = await parseMarkdown('<div>\n\n> <p>foo</p>\n\n</div>\n');
	const decisions = await decideRegions(root, {
		originalText: '<div>\n\n> <p>foo</p>\n\n</div>\n',
	} as ParserOptions);

	expect(listContainerAncestors(decisions, root.children[1]!)).toStrictEqual([
		'div',
	]);
	expect(listContainerAncestors(decisions, root)).toStrictEqual([]);
});

test('finds inline fragments that the formatted document no longer reads in their source role', async () => {
	const decisions = await decideMarkdown(
		'<div>foo</div>\n\n<p>bar</p>\n\nbaz <b>qux</b>\n'
	);
	const sentinels = createRoleSentinels(decisions);
	const [div, p, b, closingB] = [...sentinels.values()];

	const findChanges = async (printed: string) => {
		const { offsets, text } = locateRoleSentinels(printed, sentinels);

		return findChangedRoles(decisions, await parseMarkdown(text), offsets);
	};

	await expect(
		findChanges(
			`${div}<div>foo</div>\n${p}<p>bar</p>\n\nbaz ${b}<b>qux${closingB}</b>\n`
		)
	).resolves.toStrictEqual([]);
	const changes = await findChanges(
		`\`\`\`\n${div}<div>foo</div>\n\`\`\`\n\n${p}<p>bar</p>\n\nbaz\n\n${b}<b>\n\nqux${closingB}</b>\n`
	);

	expect(
		changes.map(({ problem, region }) => [region.position.line, problem])
	).toStrictEqual([
		[
			5,
			{
				kind: 'changed-role',
				position: { column: 5, line: 5, offset: 32 },
			},
		],
	]);
});

test('reports runs of sentinel characters that no sentinel explains as ambiguous', async () => {
	const decisions = await decideMarkdown('<div>foo</div>\n\n<p>bar</p>\n');
	const sentinels = createRoleSentinels(decisions);
	const [div, p] = [...sentinels.values()];

	const duplicate = locateRoleSentinels(
		`${div}<div>foo</div>\n\n${p}<p>bar</p>\n${div}\n`,
		sentinels
	);
	const unexplained = locateRoleSentinels(
		`${div}<div>foo</div>\n\n${div}${p}<p>bar</p>\n`,
		sentinels
	);

	expect(duplicate.ambiguous).toStrictEqual(new Set(div));
	expect(unexplained.ambiguous).toStrictEqual(new Set(`${div}${p}`));
});

test('excludes characters from sentinels', async () => {
	const decisions = await decideMarkdown('<div>foo</div>\n');
	const [sentinel] = [...createRoleSentinels(decisions).values()];

	const [replacement] = [
		...createRoleSentinels(decisions, new Set(sentinel)).values(),
	];

	expect(replacement).not.toBe(sentinel);
});

test('reports the first fragment of a region that changes role', async () => {
	const decisions = await decideMarkdown('foo <b>bar</b>\n');
	const sentinels = createRoleSentinels(decisions);
	const [opening, closing] = [...sentinels.values()];
	const { offsets, text } = locateRoleSentinels(
		`\`\`\`\nfoo ${opening}<b>bar${closing}</b>\n\`\`\`\n`,
		sentinels
	);

	expect(
		findChangedRoles(decisions, await parseMarkdown(text), offsets).map(
			({ problem }) => problem.position
		)
	).toStrictEqual([{ column: 5, line: 1, offset: 4 }]);
});

test('locates identical fragments by their own sentinels', async () => {
	const decisions = await decideMarkdown(
		'foo\n\n<div>bar</div>\n\nbaz\n\n<div>bar</div>\n'
	);
	const sentinels = createRoleSentinels(decisions);
	const [first, second] = [...sentinels.values()];
	const { offsets, text } = locateRoleSentinels(
		`foo\n\`\`\`\n\n${first}<div>bar</div>\n\nbaz\n\`\`\`\n\n${second}<div>bar</div>\n`,
		sentinels
	);

	expect(
		findChangedBlocks(decisions, await parseMarkdown(text), {
			offsets,
			text,
		}).map(({ problem }) => problem.position)
	).toStrictEqual([{ column: 1, line: 3, offset: 5 }]);
});

test('finds HTML blocks that the formatted document no longer reads with the same lines in the same container', async () => {
	const decisions = await decideMarkdown(
		'- foo\n\n  <div>bar</div>\n\n- <p>baz</p>\n'
	);
	const sentinels = createRoleSentinels(decisions);
	const [div, p] = [...sentinels.values()];

	const findChanges = async (printed: string) => {
		const located = locateRoleSentinels(printed, sentinels);

		return findChangedBlocks(
			decisions,
			await parseMarkdown(located.text),
			located
		).map(({ problem, region }) => [region.position.line, problem.kind]);
	};

	await expect(
		findChanges(`- foo\n\n  ${div}<div>bar</div>\n\n- ${p}<p>baz</p>\n`)
	).resolves.toStrictEqual([]);
	await expect(
		findChanges(`- foo\n\n${div}<div>bar</div>\n\n- ${p}<p>baz</p>\n`)
	).resolves.toStrictEqual([[3, 'moved-block']]);
	await expect(
		findChanges(
			`- foo\n\n  ${div}<div>\n      bar</div>\n\n- ${p}<p>baz</p>\n`
		)
	).resolves.toStrictEqual([[3, 'reindented-block']]);
	await expect(
		findChanges(
			`- foo\n\n  ${div}<div>bar</div>\n  qux\n- ${p}<p>baz</p>\n`
		)
	).resolves.toStrictEqual([[3, 'open-block']]);
	await expect(
		findChanges(`- foo\n\n  ${div}<div>bar</div>\n- ${p}<p>baz</p>\n`)
	).resolves.toStrictEqual([]);
});

test('reports the first HTML block of a region that the formatted document no longer reads the same', async () => {
	const decisions = await decideMarkdown('<div>\n\n<p>foo</p>\n\n</div>\n');
	const sentinels = createRoleSentinels(decisions);
	const [opening, p, closing] = [...sentinels.values()];
	const located = locateRoleSentinels(
		`   ${opening}<div>\n\n${p}<p>foo</p>\n\n${closing}</div>\nbar\n`,
		sentinels
	);

	expect(
		findChangedBlocks(
			decisions,
			await parseMarkdown(located.text),
			located
		).map(({ problem, region }) => [region.position.line, problem.kind])
	).toStrictEqual([[1, 'reindented-block']]);
});
