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

/**
 * Returns a node’s Markdown source without the prefixes of the block quotes and
 * list items around it, outermost first, so it parses as it would at the
 * document root.
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
 * Returns a node’s source without the surrounding block quote and list item
 * prefixes, read from outermost to innermost. Characters after those prefixes
 * stay unchanged, except that a tab extending beyond a prefix leaves its
 * remaining columns as spaces. With `isRelativeToNode`, later lines also lose
 * the indentation between the containers’ content edge and the node’s first
 * line.
 */
export function stripContainerPrefixes(
	source: string,
	node: AST.Node,
	containers: ReadonlyArray<AST.Node>,
	isRelativeToNode = false
): string | undefined {
	const start = node.position?.start.offset;
	const end = node.position?.end.offset;

	if (start === undefined || end === undefined) {
		return undefined;
	}

	const firstLineStart = source.lastIndexOf('\n', start - 1) + 1;
	const firstLineEnd = source.indexOf('\n', start);
	const firstLine = source.slice(
		firstLineStart,
		firstLineEnd === -1 ? undefined : firstLineEnd
	);
	const indentation = isRelativeToNode
		? measureColumns(firstLine.slice(0, start - firstLineStart)) -
			readPrefixes(source, firstLineStart, firstLine, containers).column
		: 0;
	let lineStart = start;

	return source
		.slice(start, end)
		.split('\n')
		.map((line, index) => {
			const cursor =
				index === 0
					? undefined
					: readPrefixes(source, lineStart, line, containers);
			lineStart += line.length + 1;

			if (!cursor) {
				return line;
			}

			skipColumns(line, cursor, indentation);
			return ' '.repeat(cursor.pending) + line.slice(cursor.index);
		})
		.join('\n');
}

/**
 * Checks whether a source line ends a paragraph inside the block quotes and
 * list items around a node. Container prefixes are read from outermost to
 * innermost. If a line lacks a block quote marker or sufficient list item
 * indentation, the check starts after the outer containers’ prefixes. The line
 * breaks the paragraph if only whitespace or empty block quote markers remain.
 * Otherwise, a line lacking a required prefix continues the paragraph lazily.
 */
export function isParagraphBreak(
	source: string,
	lineStart: number,
	containers: ReadonlyArray<AST.Node>
): boolean {
	const lineEnd = source.indexOf('\n', lineStart);
	const line = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
	const cursor: LineCursor = { column: 0, index: 0, pending: 0 };

	for (const [index, container] of containers.entries()) {
		if (container.type === 'blockquote' && !readQuoteMarker(line, cursor)) {
			break;
		}

		if (container.type === 'listItem') {
			const indentation = getListItemIndentation(
				source,
				container,
				containers.slice(0, index)
			);
			const outer = { ...cursor };

			skipColumns(line, cursor, indentation);

			if (cursor.column - outer.column < indentation) {
				Object.assign(cursor, outer);
				break;
			}
		}
	}

	while (readQuoteMarker(line, cursor)) {
		// Each marker of an empty block quote can follow up to three columns of
		// indentation
	}

	return /^[\t ]*$/.test(line.slice(cursor.index));
}

/**
 * Reads the prefixes that containers require at the start of a line. A list
 * item’s first line starts with its marker, and later lines with its
 * indentation. A line without a block quote’s marker continues lazily and has
 * no further prefixes.
 */
function readPrefixes(
	source: string,
	lineStart: number,
	line: string,
	containers: ReadonlyArray<AST.Node>
): LineCursor {
	const cursor: LineCursor = { column: 0, index: 0, pending: 0 };

	for (const [index, container] of containers.entries()) {
		const start = container.position?.start.offset ?? 0;

		if (container.type === 'blockquote') {
			if (!readQuoteMarker(line, cursor)) {
				break;
			}
		} else if (
			container.type === 'listItem' &&
			start >= lineStart &&
			start <= lineStart + line.length
		) {
			cursor.column = measureColumns(line.slice(0, start - lineStart));
			cursor.index = start - lineStart;
			cursor.pending = 0;
			readListMarker(line, cursor);
		} else if (container.type === 'listItem') {
			skipColumns(
				line,
				cursor,
				getListItemIndentation(
					source,
					container,
					containers.slice(0, index)
				)
			);
		}
	}

	return cursor;
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
	const start = item.position?.start.offset ?? 0;
	const lineStart = source.lastIndexOf('\n', start - 1) + 1;
	const lineEnd = source.indexOf('\n', start);
	const line = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
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
