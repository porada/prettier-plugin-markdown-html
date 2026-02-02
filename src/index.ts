import type { Plugin } from 'prettier';
import type { AST, PluginOptions } from './types/index.d.ts';
import {
	parsers as markdownParsers,
	printers as markdownPrinters,
} from 'prettier/plugins/markdown';
import formatHTML from './format-html/index.ts';

export const parsers: Plugin['parsers'] = {
	markdown: markdownParsers.markdown,
	remark: markdownParsers.remark,
};

export const printers: Plugin['printers'] = {
	mdast: {
		...markdownPrinters.mdast,

		async preprocess(ast, options) {
			const { preprocess } = markdownPrinters.mdast;

			/* oxlint-disable-next-line typescript/no-unsafe-assignment */
			const root: AST.Node =
				/* v8 ignore next -- @preserve */
				typeof preprocess === 'function'
					? await preprocess(ast, options)
					: ast;

			await mutateHTMLNodes(root, async (node) => {
				node.value = await formatHTML(node.value, options);
			});

			return root;
		},
	},
};

export const options: Plugin['options'] = {
	htmlFragmentPrintWidth: {
		category: 'Output',
		description:
			'Override the preferred line length for raw HTML fragments in Markdown.',
		type: 'int',
	},
	htmlFragmentSingleAttributePerLine: {
		category: 'Output',
		description:
			'Enforce one HTML attribute per line for raw HTML fragments in Markdown.',
		type: 'boolean',
	},
};

export type { PluginOptions };

async function mutateHTMLNodes(
	node: AST.Node,
	mutate: (node: AST.HTMLNode) => Promise<void>
) {
	/* v8 ignore next -- @preserve */
	if (node.type !== 'root' || !Array.isArray(node.children)) {
		return;
	}

	const children: AST.Node[] = [];

	// Merge consecutive HTML nodes
	for (const child of node.children) {
		const lastChild = children.at(-1);

		if (isHTMLNode(lastChild) && isHTMLNode(child)) {
			lastChild.value = `${lastChild.value}\n\n${child.value}`;
			continue;
		}

		children.push(child);
	}

	// Process HTML nodes
	node.children = await Promise.all(
		children.map(async (child) => {
			if (isHTMLNode(child)) {
				await mutate(child);
			}

			return child;
		})
	);
}

function isHTMLNode(node: AST.Node | undefined): node is AST.HTMLNode {
	return node?.type === 'html' && typeof node.value === 'string';
}
