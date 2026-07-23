import { defineConfig } from '@standard-config/prettier';
import * as pluginMarkdownHTML from './src/index.ts';

export default defineConfig({
	/* oxlint-disable-next-line typescript/no-deprecated */
	pluginOverrides: {
		'prettier-plugin-markdown-html': pluginMarkdownHTML,
	},
});
