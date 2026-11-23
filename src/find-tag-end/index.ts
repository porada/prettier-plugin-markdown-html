/**
 * Finds the offset after a tag’s first unquoted `>`. Returns `undefined` if the
 * given offset doesn’t point to `<` or no unquoted `>` follows it.
 */
export default function findTagEnd(
	html: string,
	start: number
): number | undefined {
	if (html[start] !== '<') {
		return undefined;
	}

	let quote: string | undefined;

	for (let index = start + 1; index < html.length; index += 1) {
		const character = html[index]!;

		if (quote) {
			quote = character === quote ? undefined : quote;
		} else if (character === '"' || character === "'") {
			quote = character;
		} else if (character === '>') {
			return index + 1;
		}
	}

	return undefined;
}
