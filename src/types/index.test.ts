import type { AST } from './index.d.ts';
import { expectTypeOf, test } from 'vitest';

test('exposes valid types', () => {
	expectTypeOf<AST.Node>().toBeObject();
	expectTypeOf<AST.RootNode>().toBeObject();
	expectTypeOf<AST.HTMLNode>().toBeObject();
});
