import { defineConfig } from '@standard-config/prettier';
import * as pluginMarkdownHTML from './src/index.ts';

export default defineConfig({
	pluginOverrides: {
		'prettier-plugin-markdown-html': pluginMarkdownHTML,
	},
});
