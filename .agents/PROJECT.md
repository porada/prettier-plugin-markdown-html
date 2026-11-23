# Project Documentation

This document records constraints, durable facts, maintenance decisions, and rationale that are not obvious from source and configuration. `AGENTS.md` remains authoritative for agent instructions.

## Formatting Contract

### Block Placement

Plain Prettier can reindent a list while keeping an HTML block’s original indentation. That moves the outer item’s `</details>` into the nested RepoCloud item in the [Flowise README](https://github.com/FlowiseAI/Flowise/blob/9291856d1ea4a4ceea9f8fef8ce14f4f6c81e8eb/README.md#L188-L219). In the [TrendRadar README](https://github.com/sansan0/TrendRadar/blob/86584f5544c66d4e22132f9b87c44a7ea3a32fea/README.md#L1358-L1364), it moves `<br>` into the last nested item and makes the list loose. Printing each block at [its container’s content edge](../SPEC.md#block-html) preserves both list structures.

### Corrections

The two [corrections](../SPEC.md#corrections) act on a single closing token. Closing an unclosed container would require choosing which later Markdown belongs inside it. Removing a stray tag could join text on either side into new Markdown syntax. Even an adjacent `</img>` can matter. Removing it would leave the logo’s opening tag alone on its line and turn a paragraph into an HTML block in the [Kazumi README](https://github.com/Predidit/Kazumi/blob/9ed884b195e40daa924c0068803943e8e18c9869/README.md#L5).

### Plain Prettier Baseline

[Plain Prettier’s output](../SPEC.md#baseline) shows whether its Markdown formatting already changed how the input renders. That distinction matters around wraps, fences, tables, and math near raw HTML.

The [line break rule](../SPEC.md#line-breaks) accounts for where a formatted tag lands. The plugin can put a tag alone on a line by fitting a multi-line tag on one line. Prettier’s Markdown wrapping can do the same. With `proseWrap` set to `always`, it wraps an email address to the next line and leaves the image tag alone at the start of a list item in the [k9s README](https://github.com/derailed/k9s/blob/8d011cb21ab9a145220100898bce49f3c3571aa4/README.md#L1528).

### Raw HTML Recognition

Prettier’s parsed nodes can hide written tags inside image descriptions and syntax specific to Prettier. [Letting Prettier identify raw HTML](../SPEC.md#formatting-scope) avoids a separate rule for every construct the reference renderer reads differently. The two rarely disagree about raw HTML in real documents.

Raw HTML inside footnote definitions stays with plain Prettier. The reference profile has no footnotes, so the end of a definition provides no rendered boundary for pairing tags or closing an element.

### Rejected Regions

An HTML error used to prevent Prettier from formatting even the surrounding Markdown. [Limiting rejection to one region](../SPEC.md#rejected-regions) lets the rest of the document format normally. Acceptance checks can stay simple and conservative because a false rejection skips HTML formatting only within that region.

The [next pass](../SPEC.md#limits) can see an HTML block where the first pass rejected a paragraph. Plain Prettier exposes just such a block when it removes indentation before a `<p>` tag on a paragraph continuation in the [mirai README](https://github.com/mamoe/mirai/blob/5651d642fa65b6f80cedbeddae2851a4fac9fc6f/README.md#L13-L15).

### Supported Shapes

The earlier contract promised preservation for every input under both Prettier’s parser and the GFM renderer. Each disagreement could reopen a review, even when a fix changed nothing in the real documents that prompted the work. The [supported shapes](../SPEC.md#supported-shapes) give review a boundary grounded in those documents. The renderer can check their output in tests without the plugin having to reproduce its reading of the surrounding Markdown.

### Tag Matching

[Tag matching](../SPEC.md#tag-matching) considers only raw tags. Including elements generated from Markdown would require reproducing the renderer’s handling of every Markdown construct. For example, raw `<p>` and `</p>` tags around a Markdown paragraph pair as written. The browser closes the raw `p` when the generated paragraph starts, both before and after formatting.

An element can extend beyond the HTML block that Prettier parses in isolation. Requiring an explicit closing tag across blocks keeps the plugin from accepting a closing tag that Prettier supplied just because its input ended.
