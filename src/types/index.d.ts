import type { Options as PrettierOptions } from 'prettier';

export interface PluginOptions {
	/**
	 * Override the preferred line length for raw HTML fragments in Markdown.
	 * Unlike `printWidth`, this option does not affect code blocks or other
	 * Markdown content. Falls back to `printWidth` when unset.
	 * @default undefined
	 */
	htmlFragmentPrintWidth?: PrettierOptions['printWidth'];
	/**
	 * Enforce one HTML attribute per line for raw HTML fragments in Markdown.
	 * Unlike `singleAttributePerLine`, this option does not affect code blocks.
	 * Falls back to `singleAttributePerLine` when unset.
	 * @default undefined
	 */
	htmlFragmentSingleAttributePerLine?: PrettierOptions['singleAttributePerLine'];
	/**
	 * Control whitespace handling for raw HTML fragments in Markdown. Unlike
	 * `htmlWhitespaceSensitivity`, this option does not affect code blocks.
	 * Falls back to `htmlWhitespaceSensitivity` when unset.
	 * @default undefined
	 */
	htmlFragmentWhitespaceSensitivity?: PrettierOptions['htmlWhitespaceSensitivity'];
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
