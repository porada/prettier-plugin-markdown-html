import type { Options as PrettierOptions } from 'prettier';
import type { AST, PluginOptions } from './index.d.ts';
import { expectTypeOf, test } from 'vitest';

test('exposes valid types', () => {
	expectTypeOf<AST.Node>().toBeObject();
	expectTypeOf<AST.RootNode>().toBeObject();
	expectTypeOf<AST.HTMLNode>().toBeObject();

	expectTypeOf<PluginOptions>().toBeObject();
	expectTypeOf<PluginOptions>().toHaveProperty('htmlFragmentPrintWidth');
	expectTypeOf<PluginOptions>().toHaveProperty(
		'htmlFragmentSingleAttributePerLine'
	);
	expectTypeOf<PluginOptions>().toHaveProperty(
		'htmlFragmentWhitespaceSensitivity'
	);
});

test('extends Prettier’s `Options`', () => {
	expectTypeOf<PrettierOptions>().toBeObject();
	expectTypeOf<PrettierOptions>().toHaveProperty('useTabs');

	expectTypeOf<PrettierOptions>().toHaveProperty('htmlFragmentPrintWidth');
	expectTypeOf<PrettierOptions>().toHaveProperty(
		'htmlFragmentSingleAttributePerLine'
	);
	expectTypeOf<PrettierOptions>().toHaveProperty(
		'htmlFragmentWhitespaceSensitivity'
	);
});
