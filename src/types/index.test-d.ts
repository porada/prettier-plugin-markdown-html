import type { Options as PrettierOptions } from 'prettier';
import type {
	AST,
	ParserHookName,
	ParserInitializer,
	ParserName,
	ParseWithCompatibility,
	PluginOptions,
	PluginWithParsers,
	PluginWithPrinters,
	PrinterInitializer,
	PriorParserResolver,
	ResolvedPriorParser,
	ResolvedPriorPrinter,
} from './index.d.ts';
import { expectTypeOf, test } from 'vite-plus/test';

test('exposes valid types', () => {
	expectTypeOf<AST.Node>().toBeObject();
	expectTypeOf<AST.ParentNode>().toBeObject();
	expectTypeOf<AST.RootNode>().toBeObject();

	expectTypeOf<AST.HTMLNode>().toBeObject();
	expectTypeOf<AST.HTMLGroup>().toBeObject();
	expectTypeOf<AST.HTMLFormatMode>().toEqualTypeOf<
		'block' | 'compact' | 'inline'
	>();

	expectTypeOf<AST.Point>().toBeObject();
	expectTypeOf<AST.Position>().toBeObject();

	expectTypeOf<ParserHookName>().toEqualTypeOf<'parse' | 'preprocess'>();
	expectTypeOf<ParserInitializer>().toBeFunction();
	expectTypeOf<ParserName>().toEqualTypeOf<'markdown' | 'remark'>();
	expectTypeOf<ParseWithCompatibility>().toBeFunction();

	expectTypeOf<PluginOptions>().toBeObject();
	expectTypeOf<PluginOptions>().toHaveProperty('htmlFragmentBracketSameLine');
	expectTypeOf<PluginOptions>().toHaveProperty(
		'htmlFragmentEmbeddedLanguageFormatting'
	);
	expectTypeOf<PluginOptions>().toHaveProperty('htmlFragmentPrintWidth');
	expectTypeOf<PluginOptions>().toHaveProperty(
		'htmlFragmentSingleAttributePerLine'
	);
	expectTypeOf<PluginOptions>().toHaveProperty(
		'htmlFragmentWhitespaceSensitivity'
	);

	expectTypeOf<PluginWithParsers>().toBeObject();
	expectTypeOf<PluginWithParsers>().toHaveProperty('parsers');

	expectTypeOf<PluginWithPrinters>().toBeObject();
	expectTypeOf<PluginWithPrinters>().toHaveProperty('printers');

	expectTypeOf<PrinterInitializer>().toBeFunction();
	expectTypeOf<PriorParserResolver>().toBeFunction();

	expectTypeOf<ResolvedPriorParser>().toBeObject();
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('locationState');
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('parser');
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('plugin');
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('plugins');
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('selectedParser');

	expectTypeOf<ResolvedPriorPrinter>().toBeObject();
	expectTypeOf<ResolvedPriorPrinter>().toHaveProperty('locEnd');
	expectTypeOf<ResolvedPriorPrinter>().toHaveProperty('locStart');
	expectTypeOf<ResolvedPriorPrinter>().toHaveProperty('printer');
	expectTypeOf<ResolvedPriorPrinter>().toHaveProperty('plugins');
});

test('extends Prettier’s `Options`', () => {
	expectTypeOf<PrettierOptions>().toBeObject();
	expectTypeOf<PrettierOptions>().toHaveProperty('useTabs');

	expectTypeOf<PrettierOptions>().toHaveProperty(
		'htmlFragmentBracketSameLine'
	);
	expectTypeOf<PrettierOptions>().toHaveProperty(
		'htmlFragmentEmbeddedLanguageFormatting'
	);
	expectTypeOf<PrettierOptions>().toHaveProperty('htmlFragmentPrintWidth');
	expectTypeOf<PrettierOptions>().toHaveProperty(
		'htmlFragmentSingleAttributePerLine'
	);
	expectTypeOf<PrettierOptions>().toHaveProperty(
		'htmlFragmentWhitespaceSensitivity'
	);
});
