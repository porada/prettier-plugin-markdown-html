import type { ParserOptions } from 'prettier';
import type { AST } from '../types/index.d.ts';
import * as pluginMarkdown from 'prettier/plugins/markdown';
import {
	FENCE_OPENING_PATTERN,
	findTextNodes,
	hasRawHTML,
	toPoint,
} from '../render-document-context/index.ts';
import { reportUnsafeLayout } from '../report-error/index.ts';
import sliceMarkdownSource from '../slice-markdown-source/index.ts';

// A character reference, which Prettier decodes in an info string
const CHARACTER_REFERENCE_PATTERN =
	/&(?:#\d{1,7}|#[Xx][\dA-Fa-f]{1,6}|[A-Za-z][\dA-Za-z]{1,31});/;

// A fence opening at the start of a code block’s source, and its info string
const FENCE_PATTERN = /^(`{3,}|~{3,})(.*)/s;

// A run of backticks or tildes long enough to open a fence
const FENCE_RUN_PATTERN = /`{3,}|~{3,}/g;

// A line end that makes a hard break: two spaces, or an unescaped backslash
const HARD_BREAK_PATTERN = /(?: {2}|(?<!\\)(?:\\\\)*\\)$/;

const INDENTATION_REASON =
	'Prettier’s Markdown formatting would remove the indentation of this line, so it would open a code fence, and later raw HTML could render as code';

type CodeNode = AST.Node & {
	lang?: string;
	meta?: string;
};

type CheckState = {
	options: ParserOptions;
	source: string;
	isIgnored: (node: AST.Node) => boolean;
};

/**
 * Reports an error when Prettier’s Markdown formatting would open a code fence,
 * or rewrite one that the reference profile then doesn’t recognize, while raw
 * HTML syntax appears after the fence delimiter. Prettier removes the
 * indentation of a paragraph’s later lines. With `proseWrap` set to `always`,
 * it can wrap a line before a word that starts with a fence delimiter. It
 * rewrites tilde fences with backticks and decodes character references in
 * info strings. Ignored nodes keep their source. As a conservative bound,
 * later syntax counts wherever it appears, as it does after frontmatter and
 * math.
 */
export default function checkFenceFormatting(
	root: AST.Node,
	options: ParserOptions,
	isIgnored: (node: AST.Node) => boolean = () => false
): void {
	const source = options.originalText as string | undefined;

	if (source !== undefined) {
		visit(root, [], { isIgnored, options, source });
	}
}

/**
 * Checks the paragraphs and code blocks in a node and its descendants.
 */
function visit(
	node: AST.Node,
	containers: ReadonlyArray<AST.Node>,
	state: CheckState,
	previous?: AST.Node
): void {
	if (state.isIgnored(node)) {
		return;
	}

	if (node.type === 'paragraph' || node.type === 'heading') {
		checkParagraph(node, containers, state, previous);
		return;
	}

	if (node.type === 'code') {
		checkFenceInfo(node, state);
		return;
	}

	const innerContainers =
		node.type === 'blockquote' || node.type === 'listItem'
			? [...containers, node]
			: containers;

	for (const [index, child] of (node.children ?? []).entries()) {
		visit(child, innerContainers, state, node.children?.[index - 1]);
	}
}

/**
 * Checks the later lines of a paragraph or setext heading for indentation that
 * hides a fence opening, and a paragraph’s text for words that wrapping could
 * move to a line start. Only spaces and tabs indent a line, and the words
 * exclude the inline constructs that Prettier keeps together, such as inline
 * links. After a link reference definition, the reference profile continues
 * the definition’s paragraph on an indented line, so the first line counts
 * too. Lines that continue inline HTML don’t count.
 */
function checkParagraph(
	paragraph: AST.Node,
	containers: ReadonlyArray<AST.Node>,
	state: CheckState,
	previous: AST.Node | undefined
): void {
	const { options, source } = state;
	const sliced = sliceMarkdownSource(source, paragraph, containers);
	const paragraphStart = paragraph.position?.start.offset ?? 0;

	if (!sliced) {
		return;
	}

	const lines = sliced.text.split('\n');

	if (
		previous?.type === 'definition' &&
		/(?:\t| {4})$/.test(
			source.slice(
				source.lastIndexOf('\n', paragraphStart - 1) + 1,
				paragraphStart
			)
		) &&
		FENCE_OPENING_PATTERN.test(lines[0]!)
	) {
		reportFence(paragraphStart, INDENTATION_REASON, state);
	}

	let lineStart = 0;

	for (const [index, line] of lines.entries()) {
		const content = line.replace(/^[\t ]+/, '');
		// With `proseWrap` set to `never`, Prettier joins the lines unless a
		// hard break ends the previous one
		const startsLine =
			options.proseWrap !== 'never' ||
			HARD_BREAK_PATTERN.test(lines[index - 1] ?? '');

		const offset =
			sliced.offsets[lineStart + line.length - content.length]!;

		if (
			index > 0 &&
			startsLine &&
			content !== line &&
			FENCE_OPENING_PATTERN.test(content) &&
			!isInInlineToken(paragraph, offset)
		) {
			reportFence(offset, INDENTATION_REASON, state);
		}

		lineStart += line.length + 1;
	}

	// Prettier wraps a setext heading’s text like a paragraph’s
	if (
		options.proseWrap !== 'always' ||
		(paragraph.type !== 'paragraph' && !lines[1])
	) {
		return;
	}

	for (const text of findTextNodes(paragraph)) {
		const start = text.position?.start.offset;
		const end = text.position?.end.offset;

		// Without its source offsets, the text’s words can’t be found
		if (start === undefined || end === undefined) {
			continue;
		}

		const value = source.slice(start, end);

		for (const { 0: run, index } of value.matchAll(FENCE_RUN_PATTERN)) {
			const offset = start + index;
			const word = source.slice(offset).split(/[\t\n\v\f ]/, 1)[0]!;

			if (
				(offset === paragraphStart ||
					/[\t\n\v\f ]/.test(source[offset - 1]!)) &&
				(run.startsWith('~') || !word.slice(run.length).includes('`'))
			) {
				reportFence(
					offset,
					'With `proseWrap` set to `always`, Prettier’s Markdown formatting can wrap this line here, where it would open a code fence, and later raw HTML could render as code',
					state
				);
			}
		}
	}
}

/**
 * Checks a fenced code block whose info string would contain a backtick after
 * Prettier rewrites it, which makes the reference profile read the opening as
 * text. Prettier rewrites tilde fences with backticks and decodes character
 * references.
 */
function checkFenceInfo(code: AST.Node, state: CheckState): void {
	const start = code.position?.start.offset;
	const opening =
		start === undefined
			? undefined
			: FENCE_PATTERN.exec(state.source.slice(start).split('\n', 1)[0]!);

	if (start === undefined || !opening) {
		return;
	}

	const [, run, info] = opening;
	// Prettier decodes the info string, so a character reference in it can
	// become markup once the fence opening reads as text
	const hasReference = CHARACTER_REFERENCE_PATTERN.test(info!);

	if (run!.startsWith('~') && info!.includes('`')) {
		reportFence(
			start,
			'Prettier’s Markdown formatting would rewrite this tilde fence with backticks, which GitHub Flavored Markdown doesn’t read as a fence when its info string contains a backtick, so markup in it could become raw HTML',
			state,
			hasReference
		);
	}

	if (decodesToBacktick(code)) {
		reportFence(
			start,
			'Prettier’s Markdown formatting would decode a character reference in this fence’s info string into a backtick, which GitHub Flavored Markdown doesn’t allow there, so markup in the fence could become raw HTML',
			state,
			hasReference
		);
	}
}

/**
 * Checks whether formatting a fenced code block again and again would put a
 * backtick in its info string. Each pass prints the info string as Prettier’s
 * Markdown parser decodes it, which can form another character reference.
 * Decoding shortens the info string, so the passes end.
 */
function decodesToBacktick(code: AST.Node): boolean {
	// Prettier’s `remark` parser is the `markdown` parser under another name
	const parser = pluginMarkdown.parsers.markdown;
	let info = printInfo(code);
	let previous: string | undefined;

	// Only character references and backslash escapes change when decoded
	while (!info.includes('`') && info !== previous && /[&\\]/.test(info)) {
		const text = `\`\`\`${info}\n\`\`\`\n`;

		previous = info;
		info = printInfo(
			(
				parser.parse(text, {
					originalText: text,
				} as ParserOptions) as AST.RootNode
			).children[0]
		);
	}

	return info.includes('`');
}

/**
 * Prints a fenced code block’s info string as Prettier does, with the language
 * and metadata separated by a space.
 */
function printInfo(code: CodeNode | undefined): string {
	return [code?.lang, code?.meta].filter(Boolean).join(' ');
}

/**
 * Reports an error at a fence delimiter when raw HTML syntax follows it,
 * including in the rest of its line, or when the caller finds other markup
 * that formatting could expose.
 */
function reportFence(
	offset: number,
	reason: string,
	state: CheckState,
	exposesMarkup = false
): void {
	const { options, source } = state;
	const rest = source.slice(offset).replace(/^(?:`+|~+)/, '');

	if (exposesMarkup || hasRawHTML(rest.split('\n'))) {
		reportUnsafeLayout({
			filepath: options.filepath,
			position: toPoint(source, offset),
			reason,
		});
	}
}

/**
 * Checks whether an offset lies inside inline HTML or a code span in a node,
 * where a line break doesn’t end a paragraph line.
 */
function isInInlineToken(node: AST.Node, offset: number): boolean {
	return (node.children ?? []).some(
		(child) =>
			((child.type === 'html' || child.type === 'inlineCode') &&
				(child.position?.start.offset ?? 0) < offset &&
				offset < (child.position?.end.offset ?? 0)) ||
			isInInlineToken(child, offset)
	);
}
