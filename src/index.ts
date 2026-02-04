import type { Plugin } from 'prettier';
import type { AST, PluginOptions } from './types/index.d.ts';
import {
	parsers as markdownParsers,
	printers as markdownPrinters,
} from 'prettier/plugins/markdown';
import preprocessMarkdown from './preprocess-markdown/index.ts';

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

			return preprocessMarkdown(root, options);
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
	htmlFragmentWhitespaceSensitivity: {
		category: 'Output',
		description:
			'Control whitespace handling for raw HTML fragments in Markdown.',
		type: 'choice',
		choices: [
			{
				value: 'css',
				description: 'Respect CSS display property value.',
			},
			{
				value: 'strict',
				description: 'Consider whitespace sensitive.',
			},
			{
				value: 'ignore',
				description: 'Consider whitespace insensitive.',
			},
		],
	},
};

export type { PluginOptions };
