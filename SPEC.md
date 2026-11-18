# Formatting Specification

This specification defines how `prettier-plugin-markdown-html` formats Markdown and HTML, and when it reports an error.

Each example pairs the required Markdown output with its rendered HTML. Prettier formats the HTML for readability, so the indentation and blank lines shown there aren’t the renderer’s exact output. The [reference settings](#reference-settings) define the renderer and options used for these comparisons.

## Target and Guarantees

Formatting follows Prettier’s style while preserving [GitHub Flavored Markdown](https://github.github.com/gfm/) (GFM) meaning within the plugin’s [formatting scope](#formatting-scope). Markdown, raw HTML, and literal content within that scope retain their roles.

Malformed HTML produces an error. The same applies when the required formatting can’t preserve meaning or meet the [stability guarantee](#stability). The first successful pass meets those requirements.

Outside the [parser disagreement limits](#parser-disagreement), other Markdown follows Prettier. Differences or defects in Prettier’s parsers and printers, or quirks of the reference renderer, require no detection, repair, or additional error when their effects stay outside the formatting scope. This upstream exception includes changes in meaning and instability.

The [reference profile](#gfm-profile) defines the GFM interpretation that formatting preserves.

## Formatting Scope

The plugin supports Prettier’s `markdown` and `remark` parsers. It formats raw HTML recognized in the input by the [reference profile](#gfm-profile), including inline tags, HTML blocks, and HTML inside block quotes and list items. The same rules apply within nested Markdown containers.

The guarantees cover that HTML’s content and container relationships, Markdown layout affected by its formatting, and their boundaries. Already formatted and ignored raw HTML remain within this scope. Unrelated Markdown doesn’t enter it merely by appearing in the same document.

Inline code, fenced code, indented code, and escaped text are outside raw HTML formatting and validation. Prettier remains responsible for Markdown and supported fenced languages. Sequences that the reference profile treats as ordinary text also remain outside HTML formatting and validation.

In the example below, the inline `span` and the HTML inside the block quote are formatted. The code span keeps its literal markup, including the spaces around `=`.

<!-- eslint-disable markdown/heading-increment -->

###### Markdown

<!-- eslint-enable markdown/heading-increment -->

<!-- prettier-ignore -->
```md
foo <span title="bar">**baz**</span>

> <div class="qux">
>     <p>quux</p>
> </div>

`<span title = "corge">grault</span>`
```

###### Rendered HTML

```html
<p>
    foo <span title="bar"><strong>baz</strong></span>
</p>
<blockquote>
    <div class="qux">
        <p>quux</p>
    </div>
</blockquote>
<p><code>&lt;span title = &quot;corge&quot;&gt;grault&lt;/span&gt;</code></p>
```

HTML-like text in image descriptions becomes literal alternative text in the reference renderer. It neither undergoes raw HTML formatting and validation nor establishes HTML context for surrounding content. Its formatting follows Prettier, subject to the content protection of any raw HTML that encloses it.

### Supported Syntax

Prettier’s HTML parser determines accepted syntax, including custom elements and foreign content such as SVG. The plugin adds no separate conformance checks for attributes, permitted children, or document wrappers.

MDX, JSX, and template syntax receive their ordinary interpretation under GFM and Prettier’s HTML parser. They introduce no additional dialect or execution semantics. The plugin doesn’t infer another language or rewrite literal text to accommodate it.

Other Prettier plugins can format unrelated languages. A replacement for the Markdown or HTML parser or printer is compatible only when it supports this specification within the formatting scope. Detected incompatibilities that prevent required raw HTML formatting or validation, such as an unsupported Markdown syntax tree, produce an error instead of silently skipping that work. Arbitrary third-party replacements have no compatibility guarantee.

### Parser Disagreement

Prettier’s Markdown parser can assign source a different role from the reference profile. The reference profile still determines what is raw HTML, Markdown, or literal content. The acceptance limits below keep those disagreements from compromising formatting or document context. They can produce an unsupported Markdown error even when the HTML is well-formed or the reference profile finds only literal text.

Frontmatter, math, Liquid tags, and wiki links follow Prettier outside the [formatting scope](#formatting-scope). When Prettier reads source as one of these constructs and the reference profile recognizes raw HTML within it, formatting reports an unsupported Markdown error. The plugin doesn’t rewrite that HTML or return the construct unchanged as a fallback. This restriction follows Prettier’s classification, not the delimiters alone. For example, single-dollar text remains ordinary Markdown when Prettier doesn’t recognize it as math.

When a GFM code fence remains open at the end of frontmatter or math, later markup may be literal code. Formatting reports an unsupported Markdown error if the remaining source contains the syntax of a raw HTML token or an HTML block start. Even escaped markup and markup in code count, and the check continues past a later closing fence. The same rule applies if formatting the construct would leave a fence open at its end.

When inline math ends partway through a line, the source check includes the rest of that line, which can keep it from opening a GFM fence. Prettier prints the math as written, but wrapping the paragraph or reindenting its container can change how GFM reads it. With `proseWrap` set to `always`, the check for formatted output assumes a line break at the first space or tab after the closing delimiter. Inside a list item or block quote, that check ignores the indentation of every line of the math after the first. Either assumption can produce an unsupported Markdown error even when Prettier’s output would leave no fence open.

Prettier’s Markdown parser recognizes `[^foo]: bar` as a footnote definition and treats following indented markup as its content. The reference profile disables footnotes and interprets that line as an ordinary link reference definition. At the document root, markup indented by four spaces after the definition and a blank line is therefore code under the reference profile. The plugin doesn’t format that code as HTML. Changes made by Prettier’s footnote formatting follow the upstream exception unless they affect covered HTML content or boundaries.

Raw HTML in a footnote definition is supported only where each raw HTML token in the reference reading is inline and matches HTML source in Prettier’s footnote definition. A raw HTML block in the reference reading is unsupported.

Text that Prettier reads as HTML but the reference profile reads as Markdown stays outside HTML formatting. An inline declaration with raw HTML inside that Markdown reading is unsupported. A block containing raw HTML is also unsupported when the reference profile doesn’t read each of its lines as part of an HTML block or a blank line, or when the block interrupts a paragraph only for Prettier.

For a block that the reference profile reads entirely as Markdown text, support depends on the surrounding source. These checks look for raw HTML tokens and HTML block starts, including an unfinished tag such as `</div`:

- Source before and after the block, through the nearest blank line or Markdown container edge, contains neither raw HTML tokens nor HTML block starts. An HTML block that has ended on the preceding line also separates the source. The following source is separate when an HTML block starts on the next line and can interrupt a paragraph. Other Markdown block starts don’t establish separation for this check.
- Within raw HTML or protected content, the block occupies one line and stands alone between blank lines or Markdown container edges.
- When the block immediately follows a list or block quote, with no blank line between them, the check extends to the rest of the document. The container can continue in the reference reading after Prettier has closed it. The check doesn’t infer whether the container’s last content prevents that continuation. This applies to single-line and multi-line blocks, including within nested containers.
- For a multi-line block, a block quote or list item marker on a later line, or a fence left open at the end of the block, extends the check to the rest of the document. Markers inside a fence that the block opens and closes don’t count. Markers count even where GFM would read them as text or a thematic break.

Where a check extends to the rest of the document, a raw HTML token or HTML block start anywhere later makes the arrangement unsupported. These are conservative source checks, not a reconstruction of GFM’s paragraph and container boundaries. The same syntax counts even when an escape, code span, or code block would make it literal. The plugin neither validates nor formats that literal sequence as HTML. If a check fails, the combination produces an unsupported Markdown error. Otherwise, Prettier formats the block, subject to the applicable content protection rules.

## Input Acceptance

### HTML in Document Context

An HTML fragment is a portion of Markdown that GFM interprets as raw HTML. Several fragments can belong to one element, with Markdown between them. Ending a fragment doesn’t close that element or make its markup malformed.

Document context is the complete output of the reference renderer under the [reference profile](#gfm-profile). That context determines raw HTML’s content, ancestors, and boundaries. Prettier’s HTML parser determines acceptance of the raw HTML together with generated markup that interacts with it, before sanitization. This defines acceptance without requiring the implementation to render the document as an intermediate step.

Every element generated by the reference renderer participates in that context: paragraph and container wrappers, emphasis, links, code elements, table rows and cells, and task list inputs. Escaped text and code contribute their rendered text and escaping. Image descriptions contribute literal alternative text. Reference definitions don’t create wrappers, and disabled footnotes don’t create containers.

For example, `foo <b>_bar_</b>` places a generated `em` inside the raw `b`. A raw `a` around a Markdown link creates nested anchors, which Prettier accepts. A raw element spanning two table cells encounters the generated cell boundaries between them. Acceptance follows Prettier’s treatment of that combined structure under [Supported Syntax](#supported-syntax).

> [!WARNING]
>
> This example illustrates formatting behavior. Nested links violate [HTML’s content rules](https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-a-element), even though Prettier accepts them. The example is not a pattern for authoring documents.

<!-- eslint-disable markdown/heading-increment -->

###### Markdown

<!-- eslint-enable markdown/heading-increment -->

<!-- prettier-ignore -->
```md
foo <b>_bar_</b>

<a href="baz">[qux](quux)</a>
```

###### Rendered HTML

```html
<p>
    foo <b><em>bar</em></b>
</p>
<p>
    <a href="baz"><a href="quux">qux</a></a>
</p>
```

Tag matching preserves Markdown container boundaries. An element opened inside a block quote or list item can’t close in a sibling or outer container if that would cross the original container’s closing boundary. An element opened outside the container can enclose it completely. The same distinction applies to inline elements within paragraphs and headings.

A container boundary doesn’t repair HTML that Prettier rejects. In `foo <span>bar`, the generated paragraph closes while the `span` remains open, so Prettier rejects the input. An unclosed `div` inside a block quote fails for the same reason. A raw `p` around a generated Markdown paragraph also creates rejected nesting, including a Markdown image separated from the raw tags by blank lines. Implicit closures accepted by Prettier remain valid.

The two HTML blocks below belong to one `details` element, with the Markdown paragraph inside it. A closing tag before that paragraph would change the accepted document merely to make one fragment complete.

<!-- eslint-disable markdown/no-duplicate-headings -->

###### Markdown

<!-- eslint-enable markdown/no-duplicate-headings -->

<!-- prettier-ignore -->
```md
<details>
    <summary>foo</summary>

**bar**

</details>
```

<!-- eslint-disable markdown/no-duplicate-headings -->

###### Rendered HTML

<!-- eslint-enable markdown/no-duplicate-headings -->

```html
<details>
    <summary>foo</summary>
    <p><strong>bar</strong></p>
</details>
```

### Normalization and Closing Tags

Normalization stays within Prettier’s HTML semantics. The plugin makes no independent changes to text, attribute values, element order, or content ownership. It adds no policy for sorting attributes, renaming elements, rewriting URLs, or inserting escapes.

Void elements, omitted tags, open elements, and nesting follow Prettier’s treatment. The output includes closing tags that Prettier supplies for raw HTML unless an explicit ignore protects the affected source. Each added tag appears where the element closes in the complete document context, preserving the content it encloses.

An open `div` at the document root, for example, closes at the end of the document after any intervening Markdown. The missing end tag alone isn’t an error. Document wrappers and tags are never added just to make an isolated fragment parse.

Prettier accepts `<ul><li>foo<li>bar</ul>` and supplies the omitted list item closures. Those closures become explicit in the formatted output.

<!-- eslint-disable markdown/heading-increment -->

###### Markdown

<!-- eslint-enable markdown/heading-increment -->

<!-- prettier-ignore -->
```md
<ul>
    <li>foo</li>
    <li>bar</li>
</ul>
```

###### Rendered HTML

```html
<ul>
    <li>foo</li>
    <li>bar</li>
</ul>
```

### Malformed HTML

Markup is malformed when Prettier’s HTML parser rejects it in document context. The plugin reports that error without repairing the rejected markup or returning the original source to conceal it.

Prettier rejects `<div><span></div>`, for example. A closing tag in a later fragment needs matching context established by the source. The same acceptance check applies to unfinished tags, quoted attributes, comments, and raw text elements that GFM recognizes as HTML. Sequences that GFM treats as ordinary text remain outside HTML validation.

The end of a GFM HTML block, list item, block quote, or document doesn’t finish an HTML token. Document context determines whether a comment, declaration, processing instruction, CDATA section, or raw text element is terminated and accepted. Prettier rejects an unterminated comment or `script`, but accepts an open `pre` at the document root and supplies its closing tag.

[Content protection](#content-and-whitespace) doesn’t change how HTML is parsed. Prettier rejects `<pre><code>foo</pre>` because `code` is still open at `</pre>`. Later closing tags match against the elements Prettier actually parsed, including within preformatted content.

### Non-Element Markup

Opaque tokens are comments, declarations, processing instructions, CDATA sections, and the contents of raw text elements, including escapable raw text elements such as `textarea`, as parsed by Prettier. Apparent tags inside them don’t open or close elements. A raw text element’s own opening and closing tags remain element boundaries. In `<?foo </div> ?>`, for example, Prettier reads `</div>` as part of the processing instruction rather than an unmatched closing tag.

Doctype declarations preserve the source’s letter case for the `DOCTYPE` keyword in both block and inline raw HTML. The reference profile recognizes `<!DOCTYPE html>` as a declaration but reads `<!doctype html>` as text, so lowercasing can change its interpretation. Case is preserved even where that change wouldn’t affect the interpretation. The rest of the declaration follows Prettier’s normalization, including whitespace and the `html` name. Ignore directives and the existing content and boundary requirements still apply.

GFM determines source boundaries independently. It ends a processing instruction block at `?>`, even when Prettier ends its instruction at an earlier `>`. Formatting preserves both interpretations, including any following text or elements Prettier recognizes. A required layout that can’t preserve them produces an error.

An opaque token can contain output from several GFM nodes. Both the original Markdown interpretation and the significant content emitted inside the token remain intact. Apparent tags there are token content, not elements to format. Except for the doctype normalization described above, raw HTML portions retain the reference renderer’s text after applicable container prefixes are removed and `\|` becomes `|` in table cells. Other backslashes in raw HTML remain literal. Markdown syntax can change only if it produces identical [protected content](#content-and-whitespace), subject to the selected line ending normalization.

An opaque token can enclose a complete generated element. Consuming only that element’s opening or closing boundary is a formatting error, even when Prettier accepts the combined HTML. A comment opened inside a block quote and closed outside it, for example, can’t swallow the generated `</blockquote>`. The plugin doesn’t compensate by adding raw closing tags for wrappers generated from Markdown.

Here, GFM recognizes `**foo**` as Markdown. Its generated `strong` element becomes text inside the HTML comment. The last raw HTML block closes that comment, so its apparent `div` doesn’t open another element.

<!-- eslint-disable markdown/heading-increment -->

###### Markdown

<!-- eslint-enable markdown/heading-increment -->

<!-- prettier-ignore -->
```md
<div></div>
<!-- Comment

**foo**

<div>bar -->
```

###### Rendered HTML

```html
<div></div>
<!-- Comment
<p><strong>foo</strong></p>
<div>bar -->
```

The closing marker needs to reach the document context as markup. Replacing the last raw HTML block with ordinary Markdown `bar -->` renders `&gt;` inside a generated paragraph. That leaves the comment unterminated and produces a formatting error.

Generated markup participates in tokenization. An unfinished processing instruction can consume the `<p>` generated for a later paragraph, leaving `</p>` unmatched. Validation covers that combined output, including generated tags that become part of a token.

## Content and Whitespace

Protected content means content inside preformatted elements or [opaque tokens](#non-element-markup), and source covered by ignore directives. The corresponding content and ignore rules determine which changes remain allowed, including line ending normalization and applicable embedded language formatting.

Markdown between raw tags retains its interpretation. Emphasis, links, code spans, and other inline syntax contribute the structure emitted by the reference renderer. [Document context](#html-in-document-context) determines whether that structure forms elements or becomes protected content inside a token. Text inside a GFM HTML block remains literal HTML content, even when it resembles Markdown. Formatting neither adds blank lines nor collapses the block in a way that activates that syntax.

This `span` starts an HTML block, so the asterisks are literal text. The opening tag stays on its own line to preserve that interpretation.

<!-- eslint-disable markdown/heading-increment -->

###### Markdown

<!-- eslint-enable markdown/heading-increment -->

<!-- prettier-ignore -->
```md
<span title="foo" class="bar">
    **baz**
</span>
```

###### Rendered HTML

```html
<span title="foo" class="bar"> **baz** </span>
```

Whitespace significance follows the effective `htmlWhitespaceSensitivity` setting and Prettier’s treatment of whitespace directives and preformatted elements. With `css` or `strict`, spacing that Prettier considers significant remains intact, including whether adjacent inline content is separated. With `ignore`, the whitespace changes Prettier permits are allowed. Every setting still preserves GFM structure and literal content.

Preformatted text and raw text elements retain Prettier’s content protection. A Markdown boundary adjustment can’t trim significant spaces or collapse significant blank lines. If a required adjustment conflicts with that protection, formatting reports an error.

Markdown that renders inside protected content inherits that protection while remaining subject to normal Markdown formatting and ignore directives. If formatting changes the protected rendered content beyond its permitted normalization, the result is an error. Preserving the Markdown source is not an additional fallback. For example, collapsing two spaces between words in a paragraph that renders inside `pre` or a comment produces an error.

Comments, declarations, and processing instructions recognized by GFM follow Prettier’s treatment, with the doctype casing adjustment defined in [Non-Element Markup](#non-element-markup). Existing comments retain their content and position relative to surrounding content, subject to Prettier’s formatting directives. Formatting adds no comments, sentinel text, wrapper elements, or extra escapes to preserve indentation or affect parsing.

## HTML and Markdown Layout

### Formatting Decisions

For a given input, formatter version, and effective configuration, the following sequence determines the result:

1. The reference profile establishes the source’s interpretation and document context. Prettier’s HTML parsing and the content protection rules determine protected content. Configuration and Prettier’s directive matching determine formatting controls. The input acceptance rules apply, including rejection of partial generated elements inside opaque tokens. Errors thrown by parsers, formatters, or required integrations propagate.
2. Prettier supplies the initial Markdown and HTML formatting, including accepted normalization and required closing tags. Layout accounts for the actual HTML ancestors and available line width. Doctype keyword casing follows [Non-Element Markup](#non-element-markup).
3. HTML blocks receive the required [container prefixes and indentation](#indentation-across-fragments), [blank lines](#blank-lines-at-boundaries), and [block boundary adjustments](#block-boundaries).
4. Inline HTML receives the [wrapping and boundary adjustments](#inline-html) that preserve its Markdown context.
5. The resulting layout satisfies preservation, stability, and the applicable ignore and range constraints within the [formatting scope](#formatting-scope). If any condition remains unmet, formatting reports an error. It doesn’t select another layout, leave a region unformatted as a fallback, or rely on a later pass to repair the result.

Normalized declarations and tags retain their GFM interpretation. The defined adjustments can exceed the preferred width or override attribute and bracket preferences, but allow no other reflow of Markdown or HTML.

These rules define observable output without prescribing a parsing or printing architecture.

### Indentation Across Fragments

Each HTML block starts at its surrounding Markdown container’s content edge. At the document root, it has no leading indentation. Within a block quote or list item, it retains the markers and continuation indentation supplied by Prettier’s Markdown layout.

A standalone `prettier-ignore`, `prettier-ignore-start`, or `prettier-ignore-end` HTML comment indented past the content edge is an exception: the plugin preserves its indentation, matching plain Prettier. Leading whitespace in the HTML node’s value prevents Prettier’s Markdown printer from recognizing the comment as a directive. For example, ` <!-- prettier-ignore -->` at the root and `>  <!-- prettier-ignore -->` in a block quote don’t protect the following Markdown node. Moving an indented comment to the content edge could activate a directive on the next pass and change which source is protected.

Subsequent HTML lines are indented for their raw HTML ancestors, including ancestors opened in earlier fragments or outside the current Markdown container. Wrappers generated from Markdown add no HTML indentation because the container’s prefixes and continuation indentation already represent their layout. Moving the first line to the content edge leaves later lines at their original nesting depth. Protected spaces remain intact even when they prevent moving that first line.

Intervening Markdown keeps the indentation required by its own structure and container. HTML nesting adds none. Unprotected blank lines contain only required container prefixes, such as block quote markers. Protected spaces remain intact, including whitespace-only lines inside `pre` and whitespace covered by an ignore directive.

### Blank Lines at Boundaries

Exactly one blank line separates an HTML block from an adjacent Markdown block when that separation preserves GFM structure and significant content. Extra blank lines at those boundaries collapse. The source’s GFM interpretation determines the boundaries, with no new ones inside raw HTML or literal content. Spacing within Markdown blocks remains Markdown’s responsibility.

A boundary stays unpadded when adding a blank line would turn a tight list into a loose one. One blank line remains when it preserves an existing loose list or terminates an HTML block. Significant whitespace remains protected. If no permitted boundary preserves the interpretation, formatting reports an error.

For lists whose content or layout is affected by HTML formatting, tightness follows the reference profile, including the effect of blank lines inside HTML blocks. Blank lines don’t move across HTML block or list item boundaries to obtain another layout. The same boundary rules govern trailing blank lines when a block reaches the end of its container. Output that remains unstable after those adjustments produces an error. Suppressing or relocating a separator between loose list items is not an additional stabilization step.

Adjacent HTML blocks keep a separating blank line when removing it would change their GFM interpretation. That separation reduces to one blank line unless its content is protected. Other spacing within HTML follows Prettier.

Each Markdown paragraph in this table has one blank line on either side. The first line of a resumed HTML block returns to the left edge. Later lines keep their nesting indentation, and `foo` and `baz` remain inside their respective `div` elements.

<!-- eslint-disable markdown/heading-increment -->

###### Markdown

<!-- eslint-enable markdown/heading-increment -->

<!-- prettier-ignore -->
```md
<table>
    <tr>
        <td>
            <div>

**foo**

</div>
        </td>
        <td>
            <div>
                <div>
                    <p>bar</p>
                </div>

baz

</div>
        </td>
    </tr>
</table>
```

###### Rendered HTML

```html
<table>
    <tr>
        <td>
            <div>
                <p><strong>foo</strong></p>
            </div>
        </td>
        <td>
            <div>
                <div>
                    <p>bar</p>
                </div>
                <p>baz</p>
            </div>
        </td>
    </tr>
</table>
```

This list stays tight. A blank line before the `div` would change it into a loose list and add paragraph wrappers around the items’ text.

<!-- eslint-disable markdown/no-duplicate-headings -->

###### Markdown

<!-- eslint-enable markdown/no-duplicate-headings -->

<!-- prettier-ignore -->
```md
- foo
  <div>bar</div>
- baz
```

<!-- eslint-disable markdown/no-duplicate-headings -->

###### Rendered HTML

<!-- eslint-enable markdown/no-duplicate-headings -->

```html
<ul>
    <li>
        foo
        <div>bar</div>
    </li>
    <li>baz</li>
</ul>
```

### Block Boundaries

An HTML block remains an HTML block after formatting. Its first complete tag occupies a line of its own when sharing that line with content would make GFM read it as a paragraph. The tag can be an opener or a closer. The tag itself stays on one physical line when splitting it would prevent block recognition, even if that exceeds the preferred width or overrides one attribute per line.

When a tag needs a separate line but Prettier would otherwise fit the element on one line, the element uses Prettier’s expanded layout. Opening and closing tags occupy separate lines, with the content indented normally, as in the `span` example in [Content and Whitespace](#content-and-whitespace). Significant whitespace remains intact.

A resumed block’s first line establishes the HTML block that later indented lines depend on. Moving or splitting its start can’t leave those lines outside the block.

Each required end marker stays on one physical line, including raw text closing tags, `-->`, `?>`, and `]]>`. A declaration’s `>` keeps its terminating role. Splitting `</script>` into `</script` and `>`, for example, would let the HTML block consume following Markdown and is therefore forbidden. Start markers remain recognizable in the same way when their spelling or position determines block recognition. A marker or complete tag that needs one physical line uses Prettier’s syntax for that layout without changing significant content.

Other line breaks follow Prettier while preserving the block. A break can’t expose HTML content as Markdown or turn a following line into indented code. If the permitted boundary and indentation adjustments can’t preserve that interpretation, formatting reports an error.

### Inline HTML

Inline HTML stays in its original paragraph, heading, table cell, link, or other inline context. Its relationship with Markdown content remains intact, including text immediately before and after each tag. Inline fragments receive no padding.

Inline tags use Prettier’s HTML layout and the effective fragment options where GFM permits them. Layout accounts for the tag’s position in the formatted Markdown line, including preceding text and container prefixes, and for attached content through the next break opportunity in Prettier’s HTML layout. Wrapped attribute lines are indented one level from the paragraph’s printed content edge, where Prettier starts its continuation lines. Markdown structure is assessed from the surrounding container’s GFM content edge.

Line breaks within tag syntax follow Prettier where they preserve Markdown interpretation, independently of `proseWrap`. A bracket or end marker rejoins its tag if the break would create Markdown structure. Another unsafe break inside a tag puts the complete tag on one physical line. Removed breaks use the spacing Prettier would use without wrapping.

Outside tag syntax, breaks follow the Markdown formatter and `proseWrap`, including between adjacent tags. The exception is a break that would turn inline HTML, including a comment, into an HTML block. That break rejoins the HTML to preceding inline content even if the Markdown formatter introduced it. Hard line breaks and protected content remain intact. With `never`, prose stays unwrapped while HTML options continue to control tag layout.

Every line break introduced by HTML layout preserves the surrounding Markdown construct. It can’t introduce a heading, block quote, fence, thematic break, list item, HTML block, setext underline, or table delimiter row. The reference profile’s interruption rules govern this distinction, with the actual container prefixes and indentation.

Here, Prettier keeps the attributes together and places the opening tag’s bracket on an indented continuation line. That line remains part of the paragraph. The closing tag stays complete because its standalone `>` would start a block quote at the content edge. No space appears between `foo` and the `span`.

<!-- eslint-disable markdown/heading-increment -->

###### Markdown

<!-- eslint-enable markdown/heading-increment -->

<!-- prettier-ignore -->
```md
foo<span title="bar" data-description="baz" data-label="qux" data-value="quux"
    >corge</span> grault
```

###### Rendered HTML

```html
<p>
    foo<span
        title="bar"
        data-description="baz"
        data-label="qux"
        data-value="quux"
        >corge</span
    >
    grault
</p>
```

Inline HTML and surrounding content stay on one physical line wherever the Markdown construct requires it, including ATX headings and GFM table rows. Tag syntax stays on that line, ahead of width, bracket placement, and one attribute per line preferences, including fragment overrides. Attribute values and significant content remain intact.

Table escaping belongs to Markdown syntax. The reference profile’s table extension processes `\|` before HTML interpretation. Formatting applies to the resulting HTML value, with the escapes needed to keep each pipe in its original cell retained in the source. No formatted pipe becomes a cell separator or changes the decoded attribute value.

The heading and table keep their required line structure even with `htmlFragmentSingleAttributePerLine` set to `true`. The image description retains its literal markup under the [scope rules](#formatting-scope).

<!-- eslint-disable markdown/no-duplicate-headings -->

###### Markdown

<!-- eslint-enable markdown/no-duplicate-headings -->

<!-- prettier-ignore -->
```md
# foo <span title="bar" class="baz">qux</span>

| quux                                                    |
| ------------------------------------------------------- |
| <span title="corge\|grault" class="garply">waldo</span> |

![fred <span title = "plugh">xyzzy</span>](thud)
```

<!-- eslint-disable markdown/no-duplicate-headings -->

###### Rendered HTML

<!-- eslint-enable markdown/no-duplicate-headings -->

```html
<h1>foo <span title="bar" class="baz">qux</span></h1>
<table>
    <thead>
        <tr>
            <th>quux</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><span title="corge|grault" class="garply">waldo</span></td>
        </tr>
    </tbody>
</table>
<p>
    <img src="thud" alt='fred &lt;span title = "plugh"&gt;xyzzy&lt;/span&gt;' />
</p>
```

## Formatting Controls

### Effective HTML Options

An explicitly set fragment option overrides its corresponding Prettier option. Otherwise, the ordinary option and its Prettier default apply. Explicit `false` and `off` values are overrides.

| Prettier Option              | Fragment Option                          |
| ---------------------------- | ---------------------------------------- |
| `bracketSameLine`            | `htmlFragmentBracketSameLine`            |
| `embeddedLanguageFormatting` | `htmlFragmentEmbeddedLanguageFormatting` |
| `htmlWhitespaceSensitivity`  | `htmlFragmentWhitespaceSensitivity`      |
| `printWidth`                 | `htmlFragmentPrintWidth`                 |
| `singleAttributePerLine`     | `htmlFragmentSingleAttributePerLine`     |

Fragment overrides affect raw HTML only. Markdown layout and fenced code options stay separate. Other applicable Prettier options, including `tabWidth` and `useTabs`, retain their usual meaning within the document’s context constraints. A tab can’t turn HTML into GFM indented code.

Line width is a layout preference. The available space accounts for nesting and Markdown container prefixes. Meeting that preference never justifies changing content, moving an element outside its container, or breaking a required GFM boundary.

### Embedded Languages

Prettier recognizes and formats supported embedded languages in raw HTML, including supported `script` and `style` content. Language selection and formatting follow Prettier and the effective embedded language setting. The plugin doesn’t infer a language Prettier doesn’t recognize.

With embedded language formatting set to `off`, that language’s syntax stays unformatted while Prettier’s surrounding HTML layout still applies. Unsupported embedded content receives Prettier’s normal preservation behavior. When Prettier preserves embedded content after a formatting failure, the plugin follows that behavior. Errors thrown by Prettier propagate. HTML acceptance, applicable content protection, and stability requirements still apply.

### Ignore Directives

[Prettier’s ignore directives](https://prettier.io/docs/ignore) apply within their own syntax. A Markdown `prettier-ignore` protects the next Markdown node, and Markdown range directives protect the range Prettier recognizes. HTML ignore and attribute ignore directives protect their corresponding HTML targets. Sharing an open element doesn’t extend a directive to unrelated fragments.

Within the [formatting scope](#formatting-scope), protected source retains its formatting, including attribute spacing and internal blank lines. Document line ending normalization still applies. When Markdown container prefixes change, the protected target’s first line and continuation lines receive the corresponding new prefixes. Its content and internal whitespace, measured after those prefixes, remain intact. Changes outside the protected region leave the directive’s target and the document’s interpretation intact.

An omitted closing tag stays omitted when a node or range ignore protects the element’s opening tag. An attribute ignore alone doesn’t prevent closing tag completion. An explicit closing tag outside the protected region remains eligible for formatting.

Ignored HTML still participates in document context and needs to be accepted by Prettier’s HTML parser. A protected opening tag can establish context for a later unprotected fragment. If preserving that source prevents safe formatting, the result is an error. The plugin neither rewrites the protected source nor discards its context.

Prettier controls file exclusions and pragma options. A file it skips entirely needs no HTML validation. Document controls, range offsets, cursor positions, and pragma settings belong to the outer Markdown operation and aren’t applied independently to each fragment.

### Range Formatting

Range formatting follows Prettier’s selected parser and range, with preservation requirements applying within the [formatting scope](#formatting-scope). When Prettier makes no Markdown edits for that operation, accepted input returns unchanged after HTML validation, apart from Prettier’s line ending normalization. The [reference Prettier version](#example-options) makes no Markdown edits for partial ranges. The stability guarantee for complete documents doesn’t require formatting the remainder during a range operation.

Unless Prettier skips the file, HTML validation covers the complete document, including content outside the range. An edit needed to preserve the interpretation of changes made within the range is a required edit. If that edit lies beyond the range Prettier permits, formatting reports an error. Unformatted content elsewhere doesn’t, by itself, require an edit.

## Output and Errors

Document line endings and the final newline follow Prettier. HTML formatting and its Markdown adjustments use the selected line endings and introduce neither mixed line endings nor extra blank lines at the end. Temporary markers and internal formatting state never appear in the result.

Formatting reports an error when raw HTML violates an acceptance rule, a [parser disagreement](#parser-disagreement) is unsupported, Prettier throws an error, a required integration is incompatible, or the permitted layout can’t meet preservation, protection, range, and stability requirements within the [formatting scope](#formatting-scope). A valid but unsupported arrangement is distinct from an HTML syntax error. The plugin never converts these errors into a partly formatted document or unchanged source.

Each error identifies the plugin and includes the file path when supplied. Errors distinguish rejected HTML, unsupported Markdown, unsafe Markdown layout, and incompatible formatter integration, while retaining any underlying error as the cause. Available source positions refer to the original Markdown, not an internal fragment or generated wrapper. Exact diagnostic wording is outside this contract.

## Conformance

The following comparisons apply within the [formatting scope](#formatting-scope). The complete document context still determines the content, ancestry, and boundaries of raw HTML.

1. The input and output agree under the reference profile in their Markdown structures, container relationships, list tightness, inline relationships, hard breaks, and division between Markdown, raw HTML, and literal content. Raw HTML added by the specified closing tag completion is exempt from this comparison, while the original content retains its structure and interpretation. Source positions and Prettier’s normal syntax choices are excluded, including soft breaks allowed by `proseWrap` and formatting within supported code fences. Other normalization preserves the reference interpretation and significant content within this scope.
2. Within that scope, the input and output document contexts agree in elements, content ownership, attribute values, and significant text after Prettier’s accepted normalization and the specified closing tag completion. Comments, raw text, preformatted content, and ignored source retain their required content. Embedded language changes follow the selected formatter and options.
3. A second complete formatting pass leaves the covered content and layout unchanged under the [stability guarantee](#stability).

These comparisons work alongside the layout rules. Equivalent rendering doesn’t permit another layout, and stable text doesn’t establish preserved meaning. Rejected input produces an error with no formatted result. GitHub.com or browser rendering can’t replace these comparisons.

### Prettier Compatibility

Prettier is the reference for Markdown formatting and HTML acceptance, normalization, whitespace sensitivity, and layout. Comparisons use the same supported Prettier version and effective options. HTML acceptance depends on its complete [document context](#html-in-document-context).

Prettier’s layout and normalization preferences apply within the requirements summarized in [Output and Errors](#output-and-errors), with only the adjustments defined in this specification.

### Stability

Within the [formatting scope](#formatting-scope), formatting depends on the input and effective configuration, without relying on previous calls.

After a successful operation on the complete document, formatting its output again with the same options, plugin configuration, and formatter versions leaves the covered content and layout unchanged. This includes HTML indentation, blank lines, wrapping, closing tags, container prefixes, and affected Markdown boundaries.

The first successful pass reaches that stable layout. Several passes that eventually stabilize don’t satisfy the guarantee. If the specified formatting and boundary adjustments can’t meet this requirement, formatting reports an error.

Instability confined to other Markdown follows the upstream exception in [Target and Guarantees](#target-and-guarantees). Preservation of meaning remains an independent requirement within the formatting scope.

## Reference Settings

### GFM Profile

The reference profile uses [`cmark-gfm@0.29.0.gfm.13`](https://github.com/github/cmark-gfm/tree/0.29.0.gfm.13) as its reference renderer for [GitHub Flavored Markdown](https://github.github.com/gfm/). Its GFM extensions for autolinks, strikethrough, tables, and task lists are enabled, along with raw HTML rendering. Within the [formatting scope](#formatting-scope), this profile governs where its interpretation differs from the written GFM specification or Prettier’s Markdown parser.

Only the listed extensions are enabled. Parsing uses `CMARK_OPT_DEFAULT`, and rendering adds only `CMARK_OPT_UNSAFE`. Soft breaks render as newlines, with footnotes and smart punctuation disabled.

HTML structure and content are assessed without the GFM [disallowed raw HTML](https://github.github.com/gfm/#disallowed-raw-html-extension-) extension (`tagfilter`) or GitHub’s additional sanitization. Tags affected by either filter remain eligible for formatting. The plugin doesn’t render or sanitize documents, predict attributes added by GitHub, or evaluate stylesheets and browser behavior. The HTML examples also use the renderer’s output before either filter, then apply Prettier’s HTML formatting for readability.

### Example Options

Examples use `prettier@3.10.1`, with its defaults and the options below. An example’s accompanying text can specify an additional formatting option. The paired rendered HTML always uses these baseline options, without fragment overrides:

```json
{
    "printWidth": 80,
    "tabWidth": 4
}
```
