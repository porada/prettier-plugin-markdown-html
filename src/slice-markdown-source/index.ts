import type { AST } from '../types/index.d.ts';

export type MarkdownSource = {
	// The source offset of each character of the text, and of its end
	offsets: number[];
	text: string;
};

type LineCursor = {
	column: number;
	index: number;
	// Columns that a partly read tab before `index` still covers
	pending: number;
};

const LIST_MARKER_PATTERN = /^(?:[*+-]|\d{1,9}[).])/;

const TAB_STOP = 4;

// The source of each HTML block that a document was read with, from the content
// edge of its containers
const htmlBlockTexts = new WeakMap<AST.Node, string>();

/**
 * Returns a node’s Markdown without container prefixes, along with its source
 * offsets. Returns `undefined` if the node lacks a start or end offset.
 */
export default function sliceMarkdownSource(
	source: string,
	node: AST.Node,
	containers: ReadonlyArray<AST.Node> = []
): MarkdownSource | undefined {
	const start = node.position?.start.offset;
	const end = node.position?.end.offset;

	if (start === undefined || end === undefined) {
		return undefined;
	}

	const offsets: number[] = [];
	let text = '';
	let lineStart = start;

	for (const [index, line] of source
		.slice(start, end)
		.split('\n')
		.entries()) {
		let contentStart = 0;

		if (index > 0) {
			const cursor = readPrefixes(source, lineStart, line, containers);
			offsets.push(lineStart - 1);
			text += '\n';

			// Leading whitespace keeps its columns as spaces, since tab stops
			// move with the removed prefixes
			for (const offset of readIndentation(line, cursor)) {
				offsets.push(lineStart + offset);
				text += ' ';
			}

			contentStart = cursor.index;
		}

		for (let offset = contentStart; offset < line.length; offset += 1) {
			offsets.push(lineStart + offset);
			text += line[offset];
		}

		lineStart += line.length + 1;
	}

	offsets.push(end);

	return { offsets, text };
}

/**
 * Records an HTML block’s source as `readHTMLBlockText` returns it: its lines
 * from the content edge of the block quotes and list items around it, outermost
 * first, with their leading whitespace as spaces covering the same columns.
 */
export function recordHTMLBlockText(
	source: string,
	node: AST.Node,
	containers: ReadonlyArray<AST.Node>
): void {
	const lines = readLinesFromContentEdge(
		source,
		node,
		containers,
		() => Number.POSITIVE_INFINITY
	);

	if (lines) {
		htmlBlockTexts.set(node, lines.map(({ text }) => text).join('\n'));
	}
}

/**
 * Reads HTML block text at its original columns so the block-start check sees
 * the correct tab width after container prefixes. Falls back to the node’s
 * value when no source was recorded.
 */
export function readHTMLBlockText(node: AST.HTMLNode): string {
	return htmlBlockTexts.get(node) ?? node.value;
}

/**
 * Reads a node’s source lines from the enclosing containers’ content edge.
 * Expands only the requested indentation columns, preserving the remaining
 * whitespace and any lazy continuation lines.
 */
export function readLinesFromContentEdge(
	source: string,
	node: AST.Node,
	containers: ReadonlyArray<AST.Node>,
	expandedColumns: (text: string, index: number) => number
): Array<{ hasPrefixes: boolean; text: string }> | undefined {
	const start = node.position?.start.offset;
	const end = node.position?.end.offset;

	if (start === undefined || end === undefined) {
		return undefined;
	}

	let lineStart = source.lastIndexOf('\n', start - 1) + 1;

	return source
		.slice(lineStart, end)
		.split('\n')
		.map((line, index) => {
			const cursor = readPrefixes(source, lineStart, line, containers);
			lineStart += line.length + 1;

			if (!cursor.isComplete) {
				return { hasPrefixes: false, text: line };
			}

			const limit = expandedColumns(line.slice(cursor.index), index);
			let columns = cursor.pending;
			let column = cursor.column + cursor.pending;

			while (
				columns < limit &&
				(line[cursor.index] === ' ' || line[cursor.index] === '\t')
			) {
				const next = advance(line[cursor.index]!, column);
				columns += next - column;
				column = next;
				cursor.index += 1;
			}

			return {
				hasPrefixes: true,
				text: ' '.repeat(columns) + line.slice(cursor.index),
			};
		});
}

/**
 * Reads the container prefixes present at the start of a line. An incomplete
 * prefix marks a lazy continuation and leaves the remaining indentation intact.
 */
function readPrefixes(
	source: string,
	lineStart: number,
	line: string,
	containers: ReadonlyArray<AST.Node>
): LineCursor & { isComplete: boolean } {
	const cursor: LineCursor = { column: 0, index: 0, pending: 0 };
	let isComplete = true;

	for (const [index, container] of containers.entries()) {
		/* v8 ignore next -- @preserve */
		const start = container.position?.start.offset ?? 0;

		if (container.type === 'blockquote') {
			if (!readQuoteMarker(line, cursor)) {
				isComplete = false;
				break;
			}
		} else if (start >= lineStart && start <= lineStart + line.length) {
			cursor.column = measureColumns(line.slice(0, start - lineStart));
			cursor.index = start - lineStart;
			cursor.pending = 0;
			readListMarker(line, cursor);
		} else {
			const indentation = getListItemIndentation(
				source,
				container,
				containers.slice(0, index)
			);
			const carried = { ...cursor };

			skipColumns(line, cursor, indentation);

			// A line without the item’s indentation continues lazily from the
			// prefixes it carries, which its own indentation follows
			if (cursor.column - carried.column !== indentation) {
				Object.assign(cursor, carried);
				isComplete = false;
				break;
			}
		}
	}

	return { ...cursor, isComplete };
}

/**
 * Returns the columns of indentation that a list item’s later lines need after
 * the prefixes of the containers around it.
 */
function getListItemIndentation(
	source: string,
	item: AST.Node,
	containers: ReadonlyArray<AST.Node>
): number {
	/* v8 ignore next -- @preserve */
	const start = item.position?.start.offset ?? 0;
	const lineStart = source.lastIndexOf('\n', start - 1) + 1;
	// Later lines follow, so a line break ends the item’s first line
	const line = source.slice(lineStart, source.indexOf('\n', start));
	const contentStart = readPrefixes(
		source,
		lineStart,
		line,
		containers
	).column;
	const cursor: LineCursor = {
		column: measureColumns(line.slice(0, start - lineStart)),
		index: start - lineStart,
		pending: 0,
	};

	readListMarker(line, cursor);

	return cursor.column - contentStart;
}

/**
 * Moves the cursor past a list marker and its following whitespace. If more
 * than four columns follow the marker, only one belongs to it and the rest
 * start indented code. A line with no content after the marker also uses only
 * one column.
 */
function readListMarker(line: string, cursor: LineCursor): void {
	/* v8 ignore next -- @preserve */
	const marker =
		LIST_MARKER_PATTERN.exec(line.slice(cursor.index))?.[0] ?? '';
	cursor.column += marker.length;
	cursor.index += marker.length;

	let { column, index } = cursor;

	while (line[index] === ' ' || line[index] === '\t') {
		column = advance(line[index]!, column);
		index += 1;
	}

	const spaces = column - cursor.column;

	// The implied space has no source character for `skipColumns` to consume
	if (index === line.length && spaces === 0) {
		cursor.column += 1;
		return;
	}

	skipColumns(line, cursor, index === line.length || spaces > 4 ? 1 : spaces);
}

/**
 * Reads a block quote marker after up to three columns of indentation,
 * including its optional following space. Leaves the cursor unchanged if the
 * line has no marker there.
 */
function readQuoteMarker(line: string, cursor: LineCursor): boolean {
	let column = cursor.column + cursor.pending;
	let { index } = cursor;

	while (line[index] === ' ' || line[index] === '\t') {
		column = advance(line[index]!, column);
		index += 1;
	}

	if (line[index] !== '>' || column - cursor.column > 3) {
		return false;
	}

	cursor.column = column + 1;
	cursor.index = index + 1;
	cursor.pending = 0;

	// A tab after the marker may extend beyond its optional space
	if (line[cursor.index] === ' ' || line[cursor.index] === '\t') {
		cursor.pending =
			advance(line[cursor.index]!, cursor.column) - cursor.column;
		cursor.index += 1;
		skipColumns(line, cursor, 1);
	}

	return true;
}

/**
 * Moves the cursor past up to a number of whitespace columns. A tab that covers
 * more columns than remain leaves the rest pending.
 */
function skipColumns(line: string, cursor: LineCursor, width: number): void {
	let remaining = width;

	while (remaining > 0) {
		if (cursor.pending === 0) {
			if (line[cursor.index] !== ' ' && line[cursor.index] !== '\t') {
				return;
			}

			cursor.pending =
				advance(line[cursor.index]!, cursor.column) - cursor.column;
			cursor.index += 1;
		}

		const skipped = Math.min(cursor.pending, remaining);
		cursor.column += skipped;
		cursor.pending -= skipped;
		remaining -= skipped;
	}
}

/**
 * Reads the whitespace before a continuation line’s content, returning the
 * character index in that line for each whitespace column.
 */
function readIndentation(line: string, cursor: LineCursor): number[] {
	const indentation = Array.from<number>({ length: cursor.pending }).fill(
		cursor.index - 1
	);
	let column = cursor.column + cursor.pending;

	while (line[cursor.index] === ' ' || line[cursor.index] === '\t') {
		const next = advance(line[cursor.index]!, column);

		for (; column < next; column += 1) {
			indentation.push(cursor.index);
		}

		cursor.index += 1;
	}

	return indentation;
}

/**
 * Measures the columns that text covers from the start of a line.
 */
function measureColumns(text: string): number {
	let column = 0;

	for (const character of text) {
		column = advance(character, column);
	}

	return column;
}

/**
 * Returns the column after a character, advancing a tab to the next tab stop.
 */
function advance(character: string, column: number): number {
	return character === '\t'
		? column + TAB_STOP - (column % TAB_STOP)
		: column + 1;
}
