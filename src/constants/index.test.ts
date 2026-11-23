import { expect, test } from 'vite-plus/test';
import { IGNORE_COMMENT_PATTERN } from './index.ts';

test('matches the ignore comments that Prettier’s Markdown printer honors', () => {
	expect('<!-- prettier-ignore -->').toMatch(IGNORE_COMMENT_PATTERN);
	expect('<!--prettier-ignore-start-->').toMatch(IGNORE_COMMENT_PATTERN);
	expect('<!-- prettier-ignore-end -->').toMatch(IGNORE_COMMENT_PATTERN);
	expect('<!-- prettier-ignore-attribute -->').not.toMatch(
		IGNORE_COMMENT_PATTERN
	);
	expect(' <!-- prettier-ignore -->').not.toMatch(IGNORE_COMMENT_PATTERN);
});
