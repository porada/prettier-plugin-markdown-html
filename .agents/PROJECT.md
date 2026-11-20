# Project Documentation

This document records constraints, durable facts, maintenance decisions, and rationale that are not obvious from source and configuration. `AGENTS.md` remains authoritative for agent instructions.

## Formatting Contract

### Corrections

An automatic [correction](../SPEC.md#corrections) needs enough evidence in the source to establish that the edit preserves the rendered page. Looking beyond the source would require the same model of the renderer that [tag matching](#tag-matching) avoids.

An element qualifies for the [container element list](../SPEC.md#correction-limits) only if Markdown never generates it, the browser closes it along with its enclosing container, and it carries no parser state that affects later content. The list stays small by omitting some rarely used elements even when they qualify.

The plugin errs on the side of leaving tags as written. If it misses a safe correction, the HTML in one part goes unformatted. If it adds or removes the wrong tag, it can change what the reader sees.

### Plain Prettier Baseline

[Comparing the plugin’s output with plain Prettier’s](../SPEC.md#baseline) isolates the changes the plugin makes. When the original Markdown served as the baseline, the plugin needed separate checks for wraps, fences, tables, and math near raw HTML. Predicting wraps with a separate print can miss a break caused by a tag’s formatted width. The checks sometimes rejected documents whose rendering plain Prettier preserved.

The source still determines whether HTML is inline or starts a block. In real documents, Prettier’s line wrapping has left an inline tag alone at the start of a paragraph, turning it into an HTML block.

### Raw HTML Recognition

Prettier’s parsed nodes can hide written tags inside image descriptions and syntax specific to Prettier. [Letting Prettier identify raw HTML](../SPEC.md#formatting-scope) avoids a separate rule for every construct the reference renderer reads differently. The two rarely disagree about raw HTML in real documents.

Raw HTML inside footnote definitions stays with plain Prettier. The reference profile has no footnotes, so the end of a definition provides no rendered boundary for pairing tags or closing an element.

### Rejected Parts

An HTML error used to prevent Prettier from formatting even the surrounding Markdown. [Limiting rejection to one part](../SPEC.md#rejected-parts) lets the rest of the document format normally. The rejected part follows plain Prettier, with each fragment’s inline or block role preserved. Acceptance checks can stay simple and conservative because a false rejection skips HTML formatting only within that part.

### Tag Matching

[Tag matching](../SPEC.md#tag-matching) considers only raw tags. Including elements generated from Markdown would require reproducing the renderer’s handling of every Markdown construct. For example, raw `<p>` and `</p>` tags around a Markdown paragraph pair as written. The browser closes the raw `p` when the generated paragraph starts, both before and after formatting.

An element can extend beyond the HTML block that Prettier parses in isolation. Requiring an explicit closing tag across blocks keeps the plugin from accepting a closing tag that Prettier supplied just because its input ended.
