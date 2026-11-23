import type { Regions } from '../types/index.d.ts';
import { FOREIGN_TAG_NAMES, HTML_WHITESPACE } from '../constants/index.ts';
import findTagEnd from '../find-tag-end/index.ts';
import isRawTextTag from '../is-raw-text-tag/index.ts';

type ScannedToken =
	Regions.ClosingTagToken | Regions.OpaqueToken | Regions.OpeningTagToken;

type ScanResult = {
	// Where scanning continues, or `undefined` if the HTML ends first
	end: number | undefined;
	state?: ScanState | undefined;
	tokens: ScannedToken[];
};

// What a fragment leaves for the next one: an opaque construct that continues
// to the end of the container, the raw text of an element with this name, or
// open foreign content. The foreign elements are the names of the elements open
// from the outermost foreign element inward
export type ScanState =
	| { construct: Regions.OpaqueConstruct; kind: 'opaque' }
	| { foreignElements: ReadonlyArray<string>; kind: 'foreign' }
	| {
			foreignElements?: ReadonlyArray<string>;
			kind: 'raw-text';
			name: string;
	  };

// Delimiters of the opaque constructs that Prettier’s HTML parser reads, in the
// order it tries them. Declarations and processing instructions end at the
// first `>`
const OPAQUE_DELIMITERS: ReadonlyArray<
	readonly [start: string, end: string, construct: Regions.OpaqueConstruct]
> = [
	['<!--', '-->', 'comment'],
	['<![CDATA[', ']]>', 'cdata'],
	['<!', '>', 'declaration'],
	['<?', '>', 'processing-instruction'],
];

// Prettier’s HTML lexer ends a tag name at whitespace, `/`, `<`, `=`, `>`, or a
// quote. An opening tag’s name starts with an ASCII letter. A closing tag’s
// name can follow whitespace and start with any other character
const TAG_NAME = String.raw`[^\0${HTML_WHITESPACE}/<=>"']`;
const TAG_START_PATTERN = new RegExp(
	String.raw`<(?:(\/[${HTML_WHITESPACE}]*)(${TAG_NAME}*)|([a-z]${TAG_NAME}*))`,
	'iy'
);

// A closing tag ends at `>` after its name and any whitespace
const CLOSING_TAG_END_PATTERN = new RegExp(
	String.raw`[${HTML_WHITESPACE}]*>`,
	'y'
);

/**
 * Scans raw tags and opaque constructs in source order. Passes open foreign
 * elements, raw text, and unfinished opaque constructs to the next fragment.
 */
export default function scanRawHTML(
	html: string,
	state?: ScanState
): { state: ScanState | undefined; tokens: ScannedToken[] } {
	if (state?.kind === 'opaque') {
		return {
			state,
			tokens: [
				{
					construct: state.construct,
					end: undefined,
					kind: 'opaque',
					start: 0,
				},
			],
		};
	}

	const tokens: ScannedToken[] = [];
	let foreignElements = state?.foreignElements;
	let result: ScanResult =
		state?.kind === 'raw-text'
			? scanRawText(html, 0, state.name)
			: { end: 0, tokens: [] };

	while (true) {
		tokens.push(...result.tokens);
		foreignElements = followForeignContent(foreignElements, result.tokens);

		if (result.end === undefined) {
			return {
				state:
					result.state?.kind === 'raw-text' && foreignElements
						? { ...result.state, foreignElements }
						: result.state,
				tokens,
			};
		}

		const index = html.indexOf('<', result.end);

		if (index === -1) {
			return {
				state: foreignElements && { foreignElements, kind: 'foreign' },
				tokens,
			};
		}

		result = scanToken(html, index, foreignElements?.[0]);
	}
}

/**
 * Lists the foreign elements still open after these tokens, outermost first.
 * Unmatched closing tags end foreign content. Returns `undefined` when no
 * foreign elements remain.
 */
function followForeignContent(
	foreignElements: ReadonlyArray<string> | undefined,
	tokens: ReadonlyArray<ScannedToken>
): ReadonlyArray<string> | undefined {
	const open = [...(foreignElements ?? [])];

	for (const token of tokens) {
		if (token.kind === 'opening-tag' && !token.isSelfClosing) {
			if (open.length > 0 || FOREIGN_TAG_NAMES.has(token.name)) {
				open.push(token.name);
			}
		} else if (token.kind === 'closing-tag' && open.length > 0) {
			open.splice(Math.max(open.lastIndexOf(token.name), 0));
		}
	}

	return open.length > 0 ? open : undefined;
}

/**
 * Scans the token that starts with `<` at an offset, inside the outermost
 * foreign element with the given name or outside foreign content. Text that
 * starts no token is skipped.
 */
function scanToken(
	html: string,
	index: number,
	foreignRoot: string | undefined
): ScanResult {
	const delimiter = OPAQUE_DELIMITERS.find(([start]) =>
		html.startsWith(start, index)
	);

	if (delimiter) {
		const [start, endMarker, construct] = delimiter;
		const markerStart = html.indexOf(endMarker, index + start.length);
		const end =
			markerStart === -1 ? undefined : markerStart + endMarker.length;

		return {
			end,
			state: { construct, kind: 'opaque' },
			tokens: [{ construct, end, kind: 'opaque', start: index }],
		};
	}

	TAG_START_PATTERN.lastIndex = index;
	const match = TAG_START_PATTERN.exec(html);

	if (!match) {
		return { end: index + 1, tokens: [] };
	}

	const [, closingPrefix, closingName, openingName] = match as unknown as [
		string,
		string | undefined,
		string | undefined,
		string | undefined,
	];
	const sourceName = (closingName ?? openingName)!;
	const name = sourceName.toLowerCase();
	let end: number | undefined;

	if (closingPrefix === undefined) {
		end = findTagEnd(html, index);
	} else {
		CLOSING_TAG_END_PATTERN.lastIndex = index + match[0].length;
		end = CLOSING_TAG_END_PATTERN.test(html)
			? CLOSING_TAG_END_PATTERN.lastIndex
			: undefined;

		// Text in another form is no tag, so scanning resumes after `</`
		if (end === undefined && html.includes('>', index)) {
			return { end: index + 2, tokens: [] };
		}
	}

	if (end === undefined) {
		const construct = 'incomplete-tag';

		return {
			end,
			state: { construct, kind: 'opaque' },
			tokens: [{ construct, end, kind: 'opaque', start: index }],
		};
	}

	if (closingPrefix !== undefined) {
		return {
			end,
			tokens: [
				{
					end,
					...(foreignRoot !== undefined && {
						isInForeignContent: true as const,
					}),
					kind: 'closing-tag',
					name,
					sourceName,
					start: index,
				},
			],
		};
	}

	const isSelfClosing = html.slice(index, end).endsWith('/>');
	const opening: Regions.OpeningTagToken = {
		end,
		isSelfClosing,
		kind: 'opening-tag',
		name,
		sourceName,
		start: index,
	};

	// Prettier’s parser closes a raw text element at self-closing syntax
	if (!isRawTextTag(name) || isSelfClosing) {
		return { end, tokens: [opening] };
	}

	const rawText = scanRawText(html, end, name);

	return { ...rawText, tokens: [opening, ...rawText.tokens] };
}

/**
 * Scans raw text through its closing tag.
 */
function scanRawText(html: string, start: number, name: string): ScanResult {
	const pattern = new RegExp(
		String.raw`<\/[${HTML_WHITESPACE}]*(${name})[${HTML_WHITESPACE}]*>`,
		'gi'
	);
	pattern.lastIndex = start;
	const match = pattern.exec(html);
	const textEnd = match?.index ?? html.length;
	const tokens: ScannedToken[] = [];

	// Raw text left open continues into the next fragment
	if (textEnd > start) {
		tokens.push({
			construct: 'raw-text',
			end: match?.index,
			kind: 'opaque',
			start,
		});
	}

	if (!match) {
		return { end: undefined, state: { kind: 'raw-text', name }, tokens };
	}

	const end = match.index + match[0].length;
	tokens.push({
		end,
		kind: 'closing-tag',
		name,
		sourceName: match[1]!,
		start: match.index,
	});

	return { end, tokens };
}
