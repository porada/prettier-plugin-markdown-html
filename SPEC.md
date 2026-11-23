# Formatting Specification

`prettier-plugin-markdown-html` formats raw HTML in Markdown. Its contract covers the differences between its output and the same document formatted by plain Prettier. A [**region**](#document-regions) is the unit the plugin formats or rejects.

## Principles

- The [comparison with plain Prettier](#baseline) uses the same input, version, and options.
- [Prettier’s HTML formatter](#effective-html-options) determines HTML layout and normalization under the effective options.
- The plugin’s own tag layout keeps [inline HTML](#inline-html) inline and preserves the opening of an [HTML block](#block-boundaries).
- For [supported shapes](#supported-shapes), the plugin [preserves the rendering that plain Prettier preserves](#conformance), and accepted HTML reaches its [final layout on the first pass](#stability).
- For [every input](#conformance), HTML never prevents formatting outside debug mode, and rejected regions print exactly as plain Prettier prints them.
- The plugin makes two [corrections](#corrections) to HTML closing tags, each in place.

## Overview

The examples use snippets from a project’s guide to Prettier. Each shows the Markdown input and required output under the [reference settings](#settings). Some also show the rendered HTML.

In the guide’s README, the logo and heading each fit on one line. The tagline and its tags exceed the preferred width, so Prettier puts the opening and closing `p` tags on lines of their own.

**Input**

<!-- prettier-ignore -->
```md
<p align="center"><img src="https://prettier.io/icon.png" alt=""></p>
<h1 align="center">Prettier</h1>
<p align="center">Format code in your editor.<br>Check it on the command line.</p>
```

**Output**

<!-- prettier-ignore -->
```md
<p align="center"><img src="https://prettier.io/icon.png" alt="" /></p>
<h1 align="center">Prettier</h1>
<p align="center">
    Format code in your editor.<br />Check it on the command line.
</p>
```

## Formatting Scope

Within the top-level Markdown document, Prettier’s Markdown parser identifies raw HTML at any nesting depth, including inline tags and comments, HTML blocks, and HTML inside block quotes and list items.

The `kbd` tags in the first paragraph and the `p` in the block quote receive HTML formatting. The code span contains literal text, so even its single quotes survive.

**Input**

<!-- prettier-ignore -->
```md
Press <kbd class='key'>⌘</kbd>+<kbd class='key'>S</kbd> to save the file.

> <p align='center'><b>Tip:</b> enable format on save in your editor.</p>

Write `<kbd class='key'>` to style a key.
```

**Output**

<!-- prettier-ignore -->
```md
Press <kbd class="key">⌘</kbd>+<kbd class="key">S</kbd> to save the file.

> <p align="center"><b>Tip:</b> enable format on save in your editor.</p>

Write `<kbd class='key'>` to style a key.
```

The plugin supports Prettier’s `markdown` and `remark` parsers. A **fragment** is one stretch of source that the Markdown parser identifies as HTML. Only fragments receive HTML formatting.

Plain Prettier formats Markdown embedded in another document, including fenced Markdown code samples. It also formats literal markup in code, frontmatter, and other text the Markdown parser reads outside a fragment. These produce no plugin notices. Raw HTML in footnote definitions stays as plain Prettier prints it because the reference profile has no footnotes.

### Supported Shapes

The [rendering guarantee](#conformance) covers the following shapes, subject to the [limits](#limits). Accepted HTML in these shapes also has [first-pass stability](#stability).

- An HTML block at the document root, in a block quote, or in a list item.
- An element spanning HTML blocks in the same Markdown container, with its tags paired by name around intervening Markdown.
- Inline HTML in a paragraph, heading, or table cell, with its tags paired within that region.
- A comment, a `pre` element, or a raw text element that ends in the fragment where it starts.
- An `svg` or `math` element that opens and closes in one HTML block.
- Source protected by a Prettier ignore directive, with no raw element crossing the boundary of its target.

The boundaries for comments, preformatted text, foreign content, and protected source apply wherever that content occurs. A region receives HTML formatting only when its tags [match](#tag-matching) and its [syntax](#supported-syntax) is accepted.

### Document Regions

The plugin rejects the smallest region containing an input problem unless rejection [extends to later blocks](#rejected-regions) or [includes an enclosing region](#comments-scripts-preformatted-text).

Inside `details`, the installation instruction is one paragraph. Its `<project-directory>` placeholder looks like an unclosed tag, so even the valid `KBD` tags in that paragraph keep their spelling. The enclosing `details`, the link in the nested `div`, and the final paragraph each format independently.

**Input**

<!-- prettier-ignore -->
```md
<details><summary>Install Prettier</summary>

In <project-directory>, type `npm install --save-dev --save-exact prettier` and press <KBD>Enter</KBD>.

<div><a href='https://prettier.io/docs/install'>Installation guide</a></div>

</details>

Try the options in the <A href='https://prettier.io/playground'>playground</A>.
```

**Output**

<!-- prettier-ignore -->
```md
<details>
    <summary>Install Prettier</summary>

In <project-directory>, type `npm install --save-dev --save-exact prettier` and press <KBD>Enter</KBD>.

<div><a href="https://prettier.io/docs/install">Installation guide</a></div>

</details>

Try the options in the <a href="https://prettier.io/playground">playground</a>.
```

- An **inline region** comprises a paragraph, a heading, or the content of a table cell, including all its inline HTML. Column padding belongs to the table, which Prettier lays out for the cells as printed.
- A **block region** is the smallest run of sibling blocks around an HTML block, in a single Markdown container, with no raw element crossing its boundary. An element crosses the boundary if one of its tags is inside and the other outside.

The document root, each block quote, and each list item are Markdown containers. Paired tags in different HTML blocks join those blocks and everything between them into a region. Regions can nest, as the `div` nests inside `details` above. Each intervening paragraph, heading, or table cell forms its own inline region.

If an enclosing raw element closes while an inner element is still open, the unclosed tag belongs to that region. An unpaired closing tag belongs to the region containing its HTML block.

## Block HTML

An accepted HTML block starts at its container’s printed content edge. Prettier’s Markdown parser identifies the container, and its HTML formatter supplies the block’s internal layout. The blank lines around the block are exactly those that plain Prettier prints.

Plain Prettier keeps the two-space indent on all three lines of HTML. The plugin moves the `p` tags to the left edge, and Prettier’s HTML formatter indents the playground link one level inside them. The Markdown heading and prose keep their places.

**Input**

<!-- prettier-ignore -->
```md
## Try the playground

  <p align="center">
  <a href="https://prettier.io/playground">Open the Prettier playground</a>
  </p>

Paste a snippet to compare the source with the formatted code.
```

**Output**

<!-- prettier-ignore -->
```md
## Try the playground

<p align="center">
    <a href="https://prettier.io/playground">Open the Prettier playground</a>
</p>

Paste a snippet to compare the source with the formatted code.
```

Prettier must read the printed lines as one HTML block or consecutive sibling HTML blocks in the original container. The text on those lines must match the formatted HTML line for line, apart from trailing whitespace that Prettier drops. The parsed HTML must end with the last printed line unless it continues directly into the same container’s next accepted HTML block. If GFM leaves the block open, no other sibling may start on the next line. The plugin rejects the region if any check fails.

### Fragment Indentation

HTML indentation follows the nesting of raw elements across intervening Markdown.

The Markdown paragraphs in these table cells start at the left edge. So does the first closing tag after each paragraph. Later tags in the same block still line up at their nesting depth.

**Input**

<!-- prettier-ignore -->
```md
<table>
<tr>
<td>

**Before**: `const ready=true`

</td>
<td>

**After**: `const ready = true;`

</td>
</tr>
</table>
```

**Output**

<!-- prettier-ignore -->
```md
<table>
    <tr>
        <td>

**Before**: `const ready=true`

</td>
        <td>

**After**: `const ready = true;`

</td>
    </tr>
</table>
```

At the document root, a formatted HTML block starts flush left. In a block quote or list item, it starts where Prettier prints that container’s content. Later lines take their indentation from all enclosing raw elements, including those opened in an earlier fragment. Wrappers generated from Markdown add no HTML indentation of their own.

Markdown between fragments uses the indentation its own structure requires. Outside `pre`, [opaque content](#comments-scripts-preformatted-text), and [ignored source](#ignore-directives), blank lines carry at most the required container prefix, such as a block quote marker.

### Block Boundaries

Formatting preserves the opening that makes Markdown recognize an HTML block.

Here, splitting the long `a` tag across lines would turn the start of the block into a paragraph. The complete tag therefore stays on the first line.

**Input**

<!-- prettier-ignore -->
```md
<a href="https://opencollective.com/prettier" title="Support Prettier on Open Collective">
  <img src="https://prettier.io/icon.png" width="48" alt="Sponsor Prettier">
</a>
```

**Output**

<!-- prettier-ignore -->
```md
<a href="https://opencollective.com/prettier" title="Support Prettier on Open Collective">
    <img src="https://prettier.io/icon.png" width="48" alt="Sponsor Prettier" />
</a>
```

If Prettier’s Markdown parser reads a fragment as an HTML block but its source does not meet GFM’s HTML block start conditions, the plugin rejects the region. In an accepted block, the first complete tag, opening or closing, gets its own line if sharing it with content would start a GFM paragraph. If splitting the tag itself would prevent block recognition, it stays on one physical line regardless of width or attribute layout preferences.

Even a short element expands when its tag needs a separate line. Prettier places the opening and closing tags on separate lines with the usual content indentation and preserves significant whitespace.

When an element spans intervening Markdown, the first line of each later HTML block must establish that block for the indented lines that follow, as in the [table example](#fragment-indentation).

Elsewhere, Prettier chooses the breaks. A break must never expose HTML content as Markdown or leave a following line as indented code. If the permitted boundary and indentation adjustments cannot preserve that interpretation, the region is rejected.

## Inline HTML

Each inline tag stays with the text on either side of it.

Prettier fits these attributes on one line and moves the opening tag’s `>` to the next. With the example’s `tabWidth` of 4, the bracket sits four spaces in and stays in the paragraph. At zero to three spaces it would start a block quote. The closing tag stays whole for the same reason.

**Input**

<!-- prettier-ignore -->
```md
See <a href="https://prettier.io/docs/cli" target="_blank" rel="noreferrer">the CLI reference</a> for details.
```

**Output**

<!-- prettier-ignore -->
```md
See <a href="https://prettier.io/docs/cli" target="_blank" rel="noreferrer"
    >the CLI reference</a> for details.
```

Inline fragments receive no padding. The surrounding text follows the Markdown [line break rules](#line-breaks).

Within those limits, inline tags take Prettier’s HTML layout and the effective fragment options. The available width accounts for the preceding text and container prefixes, plus anything attached to the tag up to Prettier’s next HTML break opportunity. Wrapped attributes start one indent level beyond the paragraph’s printed content edge. The surrounding container’s content edge still determines which Markdown constructs those lines can start.

### Line Breaks

An inline tag the plugin prints must never start an HTML block under GFM’s start conditions for that line. This applies even when plain Prettier would make the same break, because the plugin prints the tag and distinguishing those cases would require predicting Prettier’s wrapping.

With `proseWrap` set to `always`, plain Prettier wraps before this link. The image tag would then stand alone on the first line and start an HTML block, where the Markdown link would render as literal text. The plugin keeps the space after the image unbreakable so the link still renders.

**Input**

<!-- prettier-ignore -->
```md
<img src="https://prettier.io/icon.png" width="16" alt=""> [Read about formatting options](https://prettier.io/docs/options)
```

**Output**

<!-- prettier-ignore -->
```md
<img src="https://prettier.io/icon.png" width="16" alt="" /> [Read about formatting options](https://prettier.io/docs/options)
```

**Rendered HTML**

```html
<p>
    <img src="https://prettier.io/icon.png" width="16" alt="" />
    <a href="https://prettier.io/docs/options">Read about formatting options</a>
</p>
```

Prettier chooses soft breaks according to `proseWrap`. The plugin keeps a separator unbreakable only if breaking there would leave a complete tag alone on the paragraph’s first line or put a tag that can interrupt a paragraph at the start of a line. With `preserve`, it removes an existing soft break in the same circumstances.

Inside a tag, Prettier can break lines independently of `proseWrap`. If a detached bracket or end marker would start a Markdown construct, it rejoins its tag. Any other unsafe break inside the tag puts the whole tag on one physical line.

HTML layout must never introduce a heading, setext underline, block quote, fence, thematic break, list item, HTML block, or table delimiter row. If no permitted layout avoids that, the region is rejected.

### Single Lines

In ATX headings and GFM table rows, inline tags and their surrounding content share one physical line.

Here `htmlFragmentSingleAttributePerLine` is `true`. The icon in the heading and the link in the table keep their attributes together because splitting either tag would break its Markdown line.

**Input**

<!-- prettier-ignore -->
```md
# <img src="https://prettier.io/icon.png" width="32" alt=""> Editor setup

| Editor | Setup |
| --- | --- |
| VS Code | <a href='https://prettier.io/docs/editors' title='Editor integration'>Setup guide</a> |
```

**Output**

<!-- prettier-ignore -->
```md
# <img src="https://prettier.io/icon.png" width="32" alt="" /> Editor setup

| Editor  | Setup                                                                                 |
| ------- | ------------------------------------------------------------------------------------- |
| VS Code | <a href="https://prettier.io/docs/editors" title="Editor integration">Setup guide</a> |
```

This constraint takes precedence over width, bracket placement, and one attribute per line, including fragment overrides. Attribute values and significant content stay intact.

## Content Preservation

Text inside an HTML block keeps its literal meaning, even when the same text would have a different meaning in Markdown.

The asterisks below appear on the page. Joining the opening `a` tag to the text would turn the block into a Markdown paragraph and the asterisks into emphasis.

**Input**

<!-- prettier-ignore -->
```md
<a href="https://prettier.io/docs/install">
**Install Prettier locally**
</a>
```

**Output**

<!-- prettier-ignore -->
```md
<a href="https://prettier.io/docs/install">
    **Install Prettier locally**
</a>
```

**Rendered HTML**

```html
<a href="https://prettier.io/docs/install"> **Install Prettier locally** </a>
```

Prettier formats Markdown between raw tags. Inside an HTML block, neither an added blank line nor a collapsed layout may activate Markdown syntax.

Prettier’s HTML formatter applies its whitespace directives, its rules for preformatted elements, and the effective `htmlWhitespaceSensitivity` setting. With `css` or `strict`, it accounts for spacing between inline items. With `ignore`, it may change that spacing. [Embedded languages](#embedded-languages) and source protected by an [ignore directive](#ignore-directives) follow their own formatting rules.

The plugin uses the HTML formatter’s result and keeps comments where the formatter places them. If the indentation, container prefixes, or line joins the plugin adds around that result would change any text or whitespace inside `pre` or [opaque content](#comments-scripts-preformatted-text), it rejects the region. The plugin introduces no comments, wrappers, markers, or escapes to control parsing or indentation.

### Normalization

The plugin accepts the normalization Prettier’s HTML formatter gives an element within its block.

HTML allows the `li` closing tags in this list to be omitted. Each new `li` closes the previous one, and `</ul>` closes the last. Prettier makes all three closing tags explicit.

**Input**

<!-- prettier-ignore -->
```md
<ul><li>CSS<li>JavaScript<li>Markdown</ul>
```

**Output**

<!-- prettier-ignore -->
```md
<ul>
    <li>CSS</li>
    <li>JavaScript</li>
    <li>Markdown</li>
</ul>
```

Beyond [documented corrections](#corrections), the plugin makes no changes of its own to text, attribute values, element order, or which element owns content. It has no additional rules for sorting attributes, renaming elements, rewriting URLs, or inserting escapes. It never adds tags or wrappers just to make a fragment parse.

A closing tag supplied by Prettier stays only if another tag in the same HTML block closes the element. Prettier also closes elements when its input ends. The end of an HTML block alone gives the plugin no reason to keep such a tag.

## Corrections

The plugin corrects [closing tags](#reading-tags) in place only outside `svg` and `math` elements, [opaque content](#comments-scripts-preformatted-text), and [ignored source](#ignore-directives). Both corrections allow any letter case in the name and whitespace before `>`. Each eligible `</br>` becomes `<br />`. Any other eligible HTML void closing tag disappears only when it immediately follows its own opening tag with nothing between them. Outside `svg` and `math` elements, an uncorrected HTML void closing tag, including one with whitespace between `</` and its name, stays as written and is unpaired, so the region is rejected.

A lone `</br>` supplies the line break between these installation steps. The pair `<br></br>` supplies two breaks.

**Input**

<!-- prettier-ignore -->
```md
Install the extension.</br>Restart your editor.
```

**Output**

<!-- prettier-ignore -->
```md
Install the extension.<br />Restart your editor.
```

**Rendered HTML**

```html
<p>Install the extension.<br />Restart your editor.</p>
```

A browser ignores the closing `img` tag after the logo. Formatting drops that token.

**Input**

<!-- prettier-ignore -->
```md
<p><img src="prettier.svg" alt="Prettier"></img></p>
```

**Output**

<!-- prettier-ignore -->
```md
<p><img src="prettier.svg" alt="Prettier" /></p>
```

Both corrections take effect silently if the corrected region qualifies for formatting. A correction must preserve the fragment’s role, so the region is rejected if dropping a closing tag would leave a paragraph containing only a complete tag that GFM reads as an HTML block. An unclosed container or stray closing tag causes [rejection](#rejected-regions).

## Rejected Regions

When a region cannot be formatted, it prints exactly as plain Prettier prints the same region. The rest of the document still formats.

The license placeholders look like unclosed tags. Plain Prettier removes an extra space but keeps the link’s single quotes. The plugin reports the rejection and formats the link in the next paragraph.

**Input**

<!-- prettier-ignore -->
```md
Copyright © <year> <copyright-holder>.  <a href='LICENSE'>MIT License</a>.

Read the <a href='CONTRIBUTING.md'>contributing guide</a> before opening a pull request.
```

**Output**

<!-- prettier-ignore -->
```md
Copyright © <year> <copyright-holder>. <a href='LICENSE'>MIT License</a>.

Read the <a href="CONTRIBUTING.md">contributing guide</a> before opening a pull request.
```

The input features requiring rejection are exactly those defined under [Block Boundaries](#block-boundaries), [Tag Matching](#tag-matching), [Comments, Scripts, Preformatted Text](#comments-scripts-preformatted-text), [Supported Syntax](#supported-syntax), [Corrections](#corrections), and [Ignore Directives](#ignore-directives). A region that passes these checks is still rejected if its printed lines fail the [layout rules](#conformance). Each rejected region takes its text from plain Prettier without HTML formatting or corrections.

A rejection caused by the input covers the [smallest region](#document-regions) containing the problem. Exactly three cases extend rejection from that region through the last block of its Markdown container.

- An HTML block leaves an element open, and no later HTML block in that container closes it with its own closing tag or an enclosing element’s closing tag. A closing tag in a paragraph, heading, or table cell does not close an element opened in a block.
- A paragraph, heading, or table cell leaves a `pre` or [raw text element](#comments-scripts-preformatted-text) open.
- An HTML block contains an [unfinished tag, comment, CDATA section, declaration, or processing instruction](#reading-tags). In an inline fragment, such a construct rejects only the inline region.

When rejection extends to the end of the container, one [notice](#notices) identifies the original problem for the entire span.

### Tag Matching

[Raw tags](#reading-tags) must pair within their region and their HTML must be [acceptable to Prettier](#region-html), regardless of the Markdown between them.

The `a` tags below enclose a Markdown image and the `sup` tags enclose a Markdown link. Both pairs format normally.

**Input**

<!-- prettier-ignore -->
```md
<a href='https://prettier.io'>![Prettier](https://prettier.io/icon.png)</a>

Run Prettier locally<SUP>[install guide](https://prettier.io/docs/install)</SUP>.
```

**Output**

<!-- prettier-ignore -->
```md
<a href="https://prettier.io">![Prettier](https://prettier.io/icon.png)</a>

Run Prettier locally<sup>[install guide](https://prettier.io/docs/install)</sup>.
```

A closing tag pairs with the nearest open element of the same name. Unpaired or crossing raw tags cause rejection. HTML void elements need no closing tag. A self-closing slash on any other HTML element causes rejection. In SVG or MathML, an element can close with `/>` or its matching closing tag.

Within one HTML block, Prettier’s HTML parser determines whether a later tag closes an element, as in the [list example](#normalization). An element still open at the end of that block needs a matching closing tag in a later HTML block of the same Markdown container. Inline tags pair by name within their paragraph, heading, or table cell. Elements generated from Markdown do not participate.

The `li` below is still open at the blank line ending the first HTML block. With no closing `li` tag in the later block, the entire `ul` region keeps plain Prettier’s layout. The last paragraph formats independently.

**Input**

<!-- prettier-ignore -->
```md
<ul>
<li>Editor setup

Enable **format on save** for this project.

</ul>

On macOS, press <KBD>⌘</KBD>+<KBD>S</KBD> to save the file.
```

**Output**

<!-- prettier-ignore -->
```md
<ul>
<li>Editor setup

Enable **format on save** for this project.

</ul>

On macOS, press <kbd>⌘</kbd>+<kbd>S</kbd> to save the file.
```

### Comments, Scripts, Preformatted Text

A tag, comment, raw text element, or preformatted `pre` element must end in the fragment where it starts.

The blank line ends the HTML block while `pre` is still open. The command then becomes a Markdown paragraph inside `pre`, so the `table` region is rejected. The instruction after the table still formats.

**Input**

<!-- prettier-ignore -->
```md
<table>
<tr>
<td>
<pre>

npm install --save-dev --save-exact prettier

</pre>
</td>
</tr>
</table>

Press <KBD>Enter</KBD> to run it.
```

**Output**

<!-- prettier-ignore -->
```md
<table>
<tr>
<td>
<pre>

npm install --save-dev --save-exact prettier

</pre>
</td>
</tr>
</table>

Press <kbd>Enter</kbd> to run it.
```

**Rendered HTML**

```html
<table>
    <tr>
        <td>
            <pre>
<p>npm install --save-dev --save-exact prettier</p>
</pre>
        </td>
    </tr>
</table>
<p>Press <kbd>Enter</kbd> to run it.</p>
```

Here, **raw text elements** are the `script`, `style`, `textarea`, and `title` elements that Prettier’s HTML parser reads as raw text. Comments and the contents of these elements are **opaque**. Tag-like text within them is literal. The raw text element’s own tags still open and close it.

When a `pre` or raw text element opens and closes in separate sibling HTML blocks, rejection covers the smallest region containing both tags. Inline opening and closing tags are separate fragments, so even a matched inline `pre` or raw text element rejects its inline region. The [rejection span](#rejected-regions) includes an enclosing region when its closing tag falls within the rejected range.

### Notices

By default, the plugin reports rejected regions on standard error and returns the formatted document.

Each formatting operation reports rejections once, in document order. A notice identifies the plugin, the original Markdown position, the reason, and the file path if supplied. A rejected region inside a larger rejected region gets no separate notice. The first five notices per document appear individually. If more remain, a final line gives their count. The wording is unspecified.

Notices have no effect on the result and no option of their own. When a region causes a notice, fixing its HTML or protecting the entire region with an [ignore directive](#ignore-directives) clears that notice.

When the `PRETTIER_DEBUG` environment variable is non-empty, the plugin throws an error in place of the first notice and returns no formatted document. The error gives the same reason and Markdown position as the notice. This follows Prettier’s debugging convention for embedded code. A [plain Prettier error](#errors) takes precedence.

## Formatting Controls

### Effective HTML Options

Each fragment option in the table overrides its paired Prettier option when set explicitly, including to `false` or `off`. Otherwise the ordinary Prettier option applies, with its usual default.

| Prettier Option              | Fragment Option                          |
| ---------------------------- | ---------------------------------------- |
| `bracketSameLine`            | `htmlFragmentBracketSameLine`            |
| `embeddedLanguageFormatting` | `htmlFragmentEmbeddedLanguageFormatting` |
| `htmlWhitespaceSensitivity`  | `htmlFragmentWhitespaceSensitivity`      |
| `printWidth`                 | `htmlFragmentPrintWidth`                 |
| `singleAttributePerLine`     | `htmlFragmentSingleAttributePerLine`     |

Fragment options apply only to raw HTML. Markdown layout and fenced code keep their own options. Other settings, including `tabWidth` and `useTabs`, apply within the limits of the Markdown context. For example, a tab must never turn an HTML block into indented code.

Nesting and container prefixes reduce the width available for layout. Preserving content, containers, and boundaries takes precedence over meeting the preferred width.

### Embedded Languages

Inside raw HTML, Prettier chooses and formats the embedded languages it recognizes, including supported `script` and `style` content. The effective embedded language setting governs that formatting. The plugin infers no additional languages.

With embedded formatting set to `off`, Prettier skips embedded language formatting and still applies its HTML layout. For embedded languages Prettier does not recognize, the plugin uses the HTML formatter’s result. If formatting an embedded language fails, the plugin preserves whatever Prettier preserves. If the HTML formatter throws while formatting the region, as it can in debug mode, the plugin [rejects the region with the formatter’s message](#supported-syntax). Embedded content follows the same rules for acceptance, [content preservation](#content-preservation), and stability.

### Ignore Directives

[Prettier’s ignore directives](https://prettier.io/docs/ignore) protect their target source from formatting, corrections, and notices.

The range directives protect this generated table of Prettier resources. The link to the CLI reference falls outside the range and gets its usual formatting.

**Input**

<!-- prettier-ignore -->
```md
<!-- prettier-ignore-start -->
<table><tr><th>Install</th><th>Try online</th></tr><tr><td><a href="https://prettier.io/docs/install">Local setup</a></td><td><a href="https://prettier.io/playground">Playground</a></td></tr></table>

<!-- prettier-ignore-end -->

See the <a href='https://prettier.io/docs/cli'>CLI reference</a> for options.
```

**Output**

<!-- prettier-ignore -->
```md
<!-- prettier-ignore-start -->
<table><tr><th>Install</th><th>Try online</th></tr><tr><td><a href="https://prettier.io/docs/install">Local setup</a></td><td><a href="https://prettier.io/playground">Playground</a></td></tr></table>

<!-- prettier-ignore-end -->

See the <a href="https://prettier.io/docs/cli">CLI reference</a> for options.
```

In Markdown, Prettier decides which node or range each directive protects. Both the directive and its target print as plain Prettier prints them. If a raw element crosses the target’s boundary, the smallest region containing the crossing is rejected. A directive covering an entire rejected region silences that region’s [notice](#notices).

Within one HTML block, Prettier’s HTML formatter applies its own rules for ignored nodes and attributes.

Prettier handles file exclusions and pragma options. A skipped file receives no inspection. Document controls, range offsets, cursor positions, and pragma settings apply once to the outer Markdown operation.

### Range Formatting

For a partial range, plain Prettier supplies the result. The plugin skips HTML inspection and formatting and emits no notices. A range covering the entire document receives full-document formatting.

## Reference

### Baseline

**Plain Prettier** formats the same input with the same Prettier version and options, without this plugin. Its output shows which changes in [rendering](#conformance) come from Prettier alone and supplies the exact text of [rejected regions](#rejected-regions).

### Supported Syntax

Prettier’s HTML parser determines how to format accepted HTML, including custom elements and foreign content. The plugin rejects declarations, processing instructions, and CDATA sections. It also rejects inline SVG or MathML, a foreign element that extends beyond its HTML block, and a table cell whose raw HTML contains an escaped pipe.

Prettier’s Markdown and HTML parsers give MDX, JSX, and template syntax their usual interpretation in these languages. The plugin adds no dialect or execution semantics, infers no other language, and leaves literal text intact.

Other plugins can format unrelated languages. A replacement Markdown or HTML parser or printer is compatible only if it supports this contract within the formatting scope. The plugin checks the syntax tree format of the configured Markdown parser and [raises an error](#errors) if it cannot use that format.

<a id="region-html"></a>For the acceptance check, the input to Prettier’s HTML parser begins with `<name>` for each enclosing raw element, outermost first, using the name as written. The region’s raw HTML fragments follow in source order, as written after any [corrections](#corrections) and without intervening Markdown. An inline region’s fragments join directly. A block region joins its own HTML blocks and those of its accepted child block regions in the same container with one line break between blocks, leaving out inline HTML in the intervening Markdown.

Any failure of the configured HTML formatter on an individual region causes the plugin to reject that region with the formatter’s message. This includes a parser or printer that throws and a replacement HTML parser whose syntax tree has no printer.

#### Reading Tags

For tag matching, closing-tag corrections, and rejection spans, these rules define a fragment’s tags in source order. Tag-like text in [opaque content](#comments-scripts-preformatted-text) is literal. Tag names end at whitespace, NUL, `/`, `<`, `=`, `>`, `'`, or `"`. For these checks, names match if their lowercase forms are identical, including inside `svg` and `math`. Whitespace here is Prettier’s HTML whitespace, U+0009 through U+0020 and U+00A0.

- An opening tag starts with `<` followed by an ASCII letter. It runs to the first `>` outside a quoted value, or is unfinished if the fragment ends first. Either `'` or `"` opens a value that runs to the next identical quote.
- A closing tag consists of `</`, a possibly empty name, and `>`, with optional whitespace on either side of the name. If no `>` follows `</` anywhere in the fragment, the tag is unfinished. Any other `</` is text, so a later `<` can still start a tag.
- The other constructs are comments (`<!--` through `-->`), CDATA sections (`<![CDATA[` through `]]>`), declarations (any other `<!` through `>`), and processing instructions (`<?` through `>`). Each ends at its first closing delimiter and is unfinished if that delimiter is absent from the fragment.

Recognizing tags does not validate the HTML. Text that starts with `</` but forms no tag stays as written. If Prettier’s HTML parser cannot parse [the region’s HTML](#region-html), the region is rejected.

### Limits

The plugin decides what to format from Prettier’s Markdown syntax tree and the region’s own source. To decide whether its layout introduces any of the Markdown constructs named in [Line Breaks](#line-breaks), it tests the lines it prints against the construct’s start conditions. It also checks whether a printed line starts indented code and whether an HTML block has ended. The [reference renderer](#gfm-profile) checks documents and examples in tests.

- For the rendering comparison, Prettier’s Markdown parser and the reference renderer must read the same source text in the input region as raw HTML, in the same inline or block role and in the same Markdown container. First-pass stability is independent of this agreement.
- Prettier lays out the surrounding Markdown, measuring the HTML as the plugin prints it when wrapping prose and padding table columns. A printed block must pass the [check on its boundaries and container](#block-html) for its region to qualify for formatting. The plugin keeps its [inline tags](#line-breaks) from starting HTML blocks, even where plain Prettier would wrap the line.
- <a id="rejected-regions-on-later-passes"></a>A rejected region takes plain Prettier’s text. On the next pass, the plugin reads that text anew and may accept what it previously rejected.
- Prettier’s HTML parser and a browser can give the same tags different meanings, including in foreign content. Defects in a successful HTML formatter result pass through. A [formatter failure](#supported-syntax) rejects the region.
- Outside the [supported shapes](#supported-shapes), the listed [rejection rules](#rejected-regions) still apply. Other shapes carry no rendering or stability promise.

### Formatting Decisions

1. Prettier identifies raw HTML fragments and the source protected by its directives.
2. Within each region the plugin applies the two in-place corrections where eligible and checks whether the HTML can be formatted.
3. Accepted HTML takes Prettier’s layout under the effective options, with the [block](#block-html) or [inline](#inline-html) boundaries its Markdown context requires.
4. A rejected region takes plain Prettier’s text on this pass and produces a [notice](#notices) unless a directive protects it.

### Conformance

For every input, an HTML problem leaves the file formattable outside [debug mode](#notices). A rejected region must match the corresponding text in plain Prettier’s output exactly.

The layout rules apply to all HTML the plugin formats and are judged on the lines it prints. If no layout satisfies them, the region is rejected.

For each [supported region](#supported-shapes) on which [the parsers agree in the input](#limits), the plugin must preserve that region’s rendering under the [GFM profile](#gfm-profile) whenever plain Prettier preserves it. This comparison covers elements, nesting, attributes, significant text, and surrounding Markdown structure, allowing for Prettier’s HTML normalization and the two [corrections](#corrections). A rendering change elsewhere in the document, including in an unsupported region, leaves that guarantee intact.

### Stability

Accepted HTML in a supported shape reaches its final layout on the first pass. Formatting again with the same Prettier version, options, and plugin configuration must reproduce that HTML exactly. On a later pass, the plugin may [accept a previously rejected region](#rejected-regions-on-later-passes) when it reads plain Prettier’s text.

### Output

HTML and the Markdown around it use the document line endings and final newline that Prettier supplies. The plugin’s own formatting introduces no mixed line endings or extra trailing blank lines. Wherever [protected source](#ignore-directives) or a [rejected region](#rejected-regions) takes plain Prettier’s text, that includes any lines Prettier adds or drops, even trailing blank lines. Internal markers and formatter state never appear in the output.

### Errors

An error that plain Prettier raises for the same input and options takes precedence and reaches the caller unchanged. For example, an error parsing Markdown or formatting a JavaScript fence under `PRETTIER_DEBUG` reaches the caller even if the plugin would also report a rejected region.

When the plugin can attribute an HTML failure to one region, it rejects that region, even when its own work caused the failure. Otherwise it rejects every region the failure may involve. The set of regions affected by such a failure is unspecified. In either case, the plugin reports rejections as described in [Notices](#notices).

The plugin raises its own error only if a [compatibility check](#supported-syntax) fails or debug mode turns a notice into an error. Each such error identifies the plugin and retains any underlying error as its cause. Positions, when available, refer to the original Markdown.

### Settings

#### GFM Profile

The reference renderer for [GitHub Flavored Markdown](https://github.github.com/gfm) is [`cmark-gfm@0.29.0.gfm.14`](https://github.com/github/cmark-gfm/tree/0.29.0.gfm.14). It renders spec examples and real documents for the [conformance comparison](#conformance), including where it differs from the written GFM specification. Prettier’s Markdown parser still [identifies fragments](#formatting-scope).

Parsing uses `CMARK_OPT_DEFAULT` and exactly four extensions for autolinks, strikethrough, tables, and task lists. Rendering adds only `CMARK_OPT_UNSAFE` to allow raw HTML. Soft breaks render as newlines. Both footnotes and smart punctuation are disabled.

Comparisons use the HTML before the GFM [disallowed raw HTML filter](https://github.github.com/gfm#disallowed-raw-html-extension-) (`tagfilter`) or GitHub sanitization. Tags those filters affect remain eligible for formatting. The plugin neither renders nor sanitizes documents and makes no predictions about GitHub-added attributes, stylesheets, or browser behavior. Examples show the reference renderer’s unfiltered HTML formatted with Prettier for readability.

#### Example Options

Examples use the repository’s installed Prettier version, its defaults, and the two settings below. An example may specify additional options for formatting its Markdown. Rendered HTML always uses the baseline settings without fragment overrides.

```json
{
    "printWidth": 80,
    "tabWidth": 4
}
```
