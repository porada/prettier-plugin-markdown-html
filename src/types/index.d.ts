import type { Options as PrettierOptions } from 'prettier';

export interface PluginOptions {
	/**
	 * Enforce one HTML attribute per line for raw HTML fragments in Markdown.
	 * Unlike `singleAttributePerLine`, this option does not affect code blocks.
	 * Falls back to `singleAttributePerLine` when unset.
	 * @default undefined
	 */
	htmlFragmentSingleAttributePerLine?: PrettierOptions['singleAttributePerLine'];
}

declare module 'prettier' {
	interface Options extends PluginOptions {}
}

export namespace AST {
	export type Node = {
		children?: Node[];
		type?: string;
		value?: string;
	};

	export type RootNode = {
		children: Node[];
		type: 'root';
	};

	export type HTMLNode = {
		type: 'html';
		value: string;
	};
}
