import { defineConfig } from '@standard-config/prettier';
import * as pluginMarkdownHTML from './src/index.ts';

const config = defineConfig();

config.plugins!.push(pluginMarkdownHTML);

config.overrides!.push({
	files: ['*.md'],
	options: {
		printWidth: Number.POSITIVE_INFINITY,
		singleAttributePerLine: true,
	},
});

export default config;
