import type { ParserOptions, Options as PrettierOptions } from 'prettier';
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

	expectTypeOf<PluginOptions>()
		.toHaveProperty('htmlFragmentBracketSameLine')
		.toEqualTypeOf<PrettierOptions['bracketSameLine']>();
	expectTypeOf<PluginOptions>()
		.toHaveProperty('htmlFragmentEmbeddedLanguageFormatting')
		.toEqualTypeOf<PrettierOptions['embeddedLanguageFormatting']>();
	expectTypeOf<PluginOptions>()
		.toHaveProperty('htmlFragmentPrintWidth')
		.toEqualTypeOf<PrettierOptions['printWidth']>();
	expectTypeOf<PluginOptions>()
		.toHaveProperty('htmlFragmentSingleAttributePerLine')
		.toEqualTypeOf<PrettierOptions['singleAttributePerLine']>();
	expectTypeOf<PluginOptions>()
		.toHaveProperty('htmlFragmentWhitespaceSensitivity')
		.toEqualTypeOf<PrettierOptions['htmlWhitespaceSensitivity']>();

	expectTypeOf<PluginWithParsers>().toBeObject();
	expectTypeOf<PluginWithParsers>().toHaveProperty('parsers');

	expectTypeOf<PluginWithPrinters>().toBeObject();
	expectTypeOf<PluginWithPrinters>().toHaveProperty('printers');

	expectTypeOf<PrinterInitializer>().toBeFunction();
	expectTypeOf<PriorParserResolver>().toBeFunction();

	expectTypeOf<ResolvedPriorParser>().toBeObject();
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('delegation');
	expectTypeOf<ResolvedPriorParser['delegation']>().toEqualTypeOf<
		| {
				hook: ParserHookName;
				parserName: ParserName;
				resolveNext: () => Promise<ResolvedPriorParser | undefined>;
		  }
		| undefined
	>();

	expectTypeOf<ResolvedPriorParser>().toHaveProperty('entryOptions');
	expectTypeOf<ResolvedPriorParser['entryOptions']>().toEqualTypeOf<
		Pick<ParserOptions, 'locEnd' | 'locStart' | 'plugins'> | undefined
	>();

	expectTypeOf<ResolvedPriorParser>().toHaveProperty('lifecycleState');
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('parser');
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('plugin');
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('plugins');

	expectTypeOf<ResolvedPriorPrinter>().toBeObject();
	expectTypeOf<ResolvedPriorPrinter>().toHaveProperty('plugins');
	expectTypeOf<ResolvedPriorPrinter>().toHaveProperty('printer');
});

test('extends Prettier’s `Options`', () => {
	expectTypeOf<PrettierOptions>().toBeObject();
	expectTypeOf<PrettierOptions>().toHaveProperty('useTabs');

	expectTypeOf<PrettierOptions>()
		.toHaveProperty('htmlFragmentBracketSameLine')
		.toEqualTypeOf<PrettierOptions['bracketSameLine']>();
	expectTypeOf<PrettierOptions>()
		.toHaveProperty('htmlFragmentEmbeddedLanguageFormatting')
		.toEqualTypeOf<PrettierOptions['embeddedLanguageFormatting']>();
	expectTypeOf<PrettierOptions>()
		.toHaveProperty('htmlFragmentPrintWidth')
		.toEqualTypeOf<PrettierOptions['printWidth']>();
	expectTypeOf<PrettierOptions>()
		.toHaveProperty('htmlFragmentSingleAttributePerLine')
		.toEqualTypeOf<PrettierOptions['singleAttributePerLine']>();
	expectTypeOf<PrettierOptions>()
		.toHaveProperty('htmlFragmentWhitespaceSensitivity')
		.toEqualTypeOf<PrettierOptions['htmlWhitespaceSensitivity']>();
});
