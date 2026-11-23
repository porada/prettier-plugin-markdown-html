// Elements whose content is foreign, where HTML void names can take content and
// closing tags, and self-closing syntax closes any element
export const FOREIGN_TAG_NAMES: ReadonlySet<string> = new Set(['math', 'svg']);

// The characters that Prettier’s HTML lexer reads as whitespace, as a regular
// expression character class body
export const HTML_WHITESPACE = String.raw`\t-\x20\u00a0`;

// A comment that Prettier’s Markdown printer honors as an ignore directive
export const IGNORE_COMMENT_PATTERN =
	/^<!--\s*prettier-ignore(?:-(end|start))?\s*-->$/;
