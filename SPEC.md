# Formatting Specification

`prettier-plugin-markdown-html` formats raw HTML in Markdown. These rules define its output and the notices it gives when it can’t format part of a document.

## Principles

- [Plain Prettier](#baseline) supplies the baseline for comparison by formatting the same input with the same options and version, without the plugin.
- [Prettier’s HTML formatter](#formatting-controls) determines HTML layout and normalization under the effective options.
- Within the [formatting scope](#formatting-scope), HTML that was [inline](#line-breaks) in the source stays inline and [HTML blocks](#block-boundaries) stay blocks, even when Prettier would wrap the line differently.
- The [first pass](#stability) produces the final layout.
- If HTML cannot be formatted safely, only the [affected part](#rejected-parts) falls back to plain Prettier.
- The plugin [corrects an error](#corrections) only when a browser already ignores it or makes the same repair.

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

Prettier’s Markdown parser identifies raw HTML at any nesting depth, including inline tags and comments, HTML blocks, and HTML inside block quotes and list items.

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

The plugin supports Prettier’s `markdown` and `remark` parsers. A **fragment** is one stretch of source the Markdown parser identifies as HTML. Only fragments receive HTML formatting. Two [corrections](#correction-limits) also scan the source for possible opening tags.

Prettier handles the rest of the Markdown, including supported fenced languages. Inline, fenced, indented, and escaped code or text can contain literal markup. So can frontmatter, math, Liquid tags, wiki links, and image descriptions. Anything the parser leaves outside a fragment stays as Prettier prints it, without a notice, even if the [reference profile](#gfm-profile) reads it as HTML.

Conversely, the plugin formats a fragment such as lowercase `<!doctype html>` as HTML even where the reference profile reads it as text. Only its role enters the [conformance comparisons](#conformance).

Raw HTML in a footnote definition stays as plain Prettier prints it. The reference profile has no footnotes and interprets that source differently.

The contract covers raw HTML, its boundaries with Markdown, and the Markdown layout its formatting affects. Other Markdown in the same document remains Prettier’s responsibility.

### Document Parts

A **part** is the unit the plugin formats or rejects. It can contain several fragments, and a rejection affects only the smallest part that contains the problem.

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

- An **inline part** comprises a paragraph, heading, or table cell and all its inline HTML.
- A **block part** is the smallest run of sibling blocks around an HTML block, in a single Markdown container, with no raw element crossing its boundary. An element crosses the boundary if one of its tags is inside and the other outside.

The document root, each block quote, and each list item are Markdown containers. Within a container, [tag matching](#tag-matching) pairs raw tags, including closing tags supplied by a [correction](#corrections). An HTML block with no element crossing its boundary forms its own part. A pair of tags in different HTML blocks joins those blocks and everything between them. Overlapping pairs also belong to one part, as when `<div><span></div></span>` spans four HTML blocks.

If an enclosing raw element closes while an inner element is still open, the inner element ends there too. Any other unclosed element extends its part from the opening HTML block to the end of its container. An unpaired closing tag belongs to the part containing its HTML block.

Parts can nest, like the `div` inside `details` above. Each intervening paragraph, heading, or table cell forms its own inline part.

A part’s formatting depends only on its contents, its Markdown container, and the enclosing raw elements that determine its indentation. Two corrections also look back through earlier source using the [open element test](#correction-limits).

## Block HTML

An HTML block starts at the content edge of its Markdown container and takes Prettier’s HTML layout there.

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

At the document root, an HTML block starts flush left. In a block quote or list item, it starts after the markers and continuation indentation that Prettier supplies. Protected leading spaces stay in place even if they keep the first line from reaching the content edge.

Later lines take their indentation from all raw HTML ancestors, including those opened in an earlier block or outside the current Markdown container. Moving the first line leaves that depth intact. Wrappers generated from Markdown add no HTML indentation of their own. Their layout is already present in the Markdown prefixes.

Markdown between fragments uses only the indentation its own structure requires. Blank lines carry at most the required container prefix, such as a block quote marker, except where whitespace is protected. That protection includes whitespace-only lines inside `pre` and spaces covered by an ignore directive.

### Blank Lines

One blank line separates an HTML block from adjacent Markdown wherever the separation preserves structure and significant content.

Plain Prettier leaves the block containing the options link directly below the paragraph. The plugin adds a blank line between them.

**Input**

<!-- prettier-ignore -->
```md
Start with the defaults and adjust them for your project.
<div><a href="https://prettier.io/docs/options">Formatting options</a></div>
```

**Output**

<!-- prettier-ignore -->
```md
Start with the defaults and adjust them for your project.

<div><a href="https://prettier.io/docs/options">Formatting options</a></div>
```

Inside this tight list, the same blank line would make the list loose and wrap the item text in paragraphs. The options link stays next to the instruction.

**Input**

<!-- prettier-ignore -->
```md
1. Choose the options your project needs
   <div><a href='https://prettier.io/docs/options'>Formatting options</a></div>
2. Save them in `.prettierrc`
```

**Output**

<!-- prettier-ignore -->
```md
1. Choose the options your project needs
   <div><a href="https://prettier.io/docs/options">Formatting options</a></div>
2. Save them in `.prettierrc`
```

**Rendered HTML**

```html
<ol>
    <li>
        Choose the options your project needs
        <div>
            <a href="https://prettier.io/docs/options">Formatting options</a>
        </div>
    </li>
    <li>Save them in <code>.prettierrc</code></li>
</ol>
```

The source determines where one block ends and the next begins. Extra blank lines at an HTML–Markdown boundary collapse to one. Formatting introduces no such boundary inside raw HTML or literal content. Prettier controls spacing within Markdown blocks.

A blank line stays where it terminates an HTML block or preserves an already loose list. Tight lists stay tight. Significant whitespace remains protected. If no permitted spacing preserves the interpretation, the part is rejected.

List tightness must match plain Prettier’s output under the reference profile, counting blank lines inside HTML blocks. The spacing rules also govern trailing blank lines at the end of a container. Blank lines stay on their own side of HTML block and list item boundaries. If those adjustments leave the layout unstable, the part is rejected. Separators between loose list items cannot be moved or dropped to achieve stability.

Adjacent HTML blocks remain distinct. If blank lines already separate them, those lines collapse to one unless their content is protected. Prettier controls spacing within each block.

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

A block’s first complete tag, opening or closing, gets its own line if sharing it with content would start a paragraph under the reference profile. If splitting the tag itself would prevent block recognition, it stays on one physical line regardless of width or attribute layout preferences.

Even a short element expands when its tag needs a separate line. Prettier places the opening and closing tags on separate lines with the usual content indentation and preserves significant whitespace.

When an HTML block resumes, its first line must still establish the block for the indented lines that follow.

Elsewhere, Prettier chooses the breaks. A break must never expose HTML content as Markdown or leave a following line as indented code. If the permitted boundary and indentation adjustments cannot preserve that interpretation, the part is rejected.

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

Breaks introduced by HTML layout preserve the surrounding Markdown, and every break preserves each tag’s inline or block role.

With `proseWrap` set to `always`, plain Prettier wraps before this link. The image tag would then stand alone on the first line and start an HTML block, where the link would render as literal text. Keeping the link on the same line preserves it.

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

Inside a tag, Prettier can break lines independently of `proseWrap`. If a detached bracket or end marker would start a Markdown construct, it rejoins its tag. Any other unsafe break inside the tag puts the whole tag on one physical line. Joining lines uses the spacing Prettier would use without wrapping.

Between tags and in the surrounding prose, Prettier’s Markdown formatter and `proseWrap` choose the breaks. A break that would turn inline HTML, including a comment, into an HTML block is removed even if the Markdown formatter introduced it.

Hard breaks and protected content stay intact. With `never`, prose stays unwrapped and HTML options still control tag layout. With `always`, Prettier wraps the paragraph with its formatted tags. Their new widths may shift a soft break or create Markdown structure, just as if the author had written the formatted tags. The inline-to-block exception still applies.

HTML layout itself can never introduce a heading, setext underline, block quote, fence, thematic break, list item, HTML block, or table delimiter row. The reference profile determines which constructs can start at a break, using the actual indentation and container prefixes.

### Single Lines

When Markdown requires one physical line, inline tags and their surrounding content share that line.

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

This constraint applies to ATX headings, GFM table rows, and any other construct that requires one line. It takes precedence over width, bracket placement, and one attribute per line, including fragment overrides. Attribute values and significant content stay intact.

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

Protection covers preformatted text, [opaque content](#comments-scripts-preformatted-text), and source covered by an [ignore directive](#ignore-directives). Each follows its own content rules, including any permitted line ending normalization or embedded language formatting.

The effective `htmlWhitespaceSensitivity` setting and Prettier’s handling of whitespace directives and preformatted elements determine which spaces matter. With `css` or `strict`, significant spacing survives, including the presence or absence of a space between inline items. With `ignore`, Prettier may change whitespace as usual. Every setting preserves structure and literal content.

Markdown boundary adjustments must respect Prettier’s protection of preformatted and raw text. A required adjustment that would trim significant spaces or collapse significant blank lines causes rejection.

Prettier formats comments, declarations, and processing instructions, subject to the [doctype casing rule](#edge-cases). Existing comments keep their content and position relative to surrounding content, subject to formatting directives. The plugin never inserts comments, markers, wrappers, or extra escapes to control parsing or indentation.

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

The plugin corrects three kinds of HTML error when the source alone shows that the browser already ignores the error or makes the same repair.

The browser reads `</br>` as a line break, ignores the stray `</section>`, and closes the `div` at the end of the document. Formatting makes each of those outcomes explicit.

**Input**

<!-- prettier-ignore -->
```md
Prettier is free to use.</br>Donations support its development.

<div align="center">

**[Support Prettier on Open Collective](https://opencollective.com/prettier)**

</section>
```

**Output**

<!-- prettier-ignore -->
```md
Prettier is free to use.<br />Donations support its development.

<div align="center">

**[Support Prettier on Open Collective](https://opencollective.com/prettier)**

</div>
```

Like other HTML normalization, corrections appear in the diff and produce no notice. Each must preserve the rendered page.

- **Closing tag on a void element.** `</br>` becomes `<br />`. Any other HTML void closing tag, such as `</img>`, disappears. A browser ignores those other tags but gives `<br></br>` two line breaks, so both breaks survive formatting.
- **Unclosed container element.** If an HTML block opens a [listed container element](#correction-limits) and no closing tag pairs with it in the same Markdown container, the plugin closes it where the browser would, at the container’s end, after any intervening Markdown. Nested elements close innermost first, subject to the limits below.
- **Stray closing tag.** A closing tag is stray when nothing before it could have opened its element. The plugin removes stray closing tags that browsers ignore, subject to the [correction limits](#correction-limits).

After these corrections, the plugin [rejects any part](#rejected-parts) that still fails the [acceptance rules](#tag-matching). A browser can carry an unclosed `b` or `a` into later text, so adding a closing tag can change which words appear in bold or belong to a link. Where a `p` or heading ends depends on what follows it. Escaping a placeholder such as `<copyright-holder>` would turn an unclosed tag into visible text.

Corrections apply in source order, before acceptance. Two use the [open element test](#correction-limits) to look back into earlier parts. A part that still fails prints without corrections, as does source protected by an [ignore directive](#ignore-directives).

Removing the only tag in an otherwise empty HTML block removes the block, as with `</section>` above. If other content would remain and the reference profile would read it differently, the part is rejected. For instance, removing `</section>` immediately before a line of literal text could turn that text into a Markdown paragraph.

### Correction Limits

Inside `svg` or `math` content, neither the void element correction nor the stray closing tag correction applies. A `source` element is void inside an HTML `video`. In SVG, `<source><title>Preview</title></source>` can have content and a closing tag. Even `</br>` can cause a browser to [leave foreign content](https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inforeign), so removing it can change how later tags are parsed.

The container correction is limited to `address`, `article`, `aside`, `center`, `details`, `dialog`, `div`, `dl`, `fieldset`, `figcaption`, `figure`, `footer`, `header`, `main`, `nav`, `section`, and `summary`. Markdown generates none of these HTML elements, and browsers close them at the end of their block quote, list item, or document. An element still open when an enclosing raw element closes receives no correction.

Other names have different effects. A `table` can outlast its block quote or list item, as can an `ol` or `ul` inside a list item. A raw `blockquote` can take the enclosing block quote’s closing tag and leave the outer quote open. Closing a `form` early changes how browsers interpret later forms. Some rarely used names are omitted simply to keep the list short.

An added closing tag could close the wrong element if something else has already closed the intended one. In either of the following cases the plugin rejects the part and leaves the tag unwritten.

- After the opening tag, an unpaired closing tag of the same name occurs in a nested Markdown container or in inline HTML within the container. A browser could close the element there.
- The element is in a block quote or list item, and the open element test fails for its name at the start of that container. An outer element of the same name could still be open. If text outside Prettier’s HTML fragments closed the inner element early, the added tag would close the outer one.

The **open element test** asks whether any element of a given name could still be open at a particular point. It examines only the source before that point. Both conditions must hold for the test to pass.

- Every earlier raw element of that name, in any container, has closed through its own closing tag, the close of an enclosing raw element, or the container correction. None may belong to a part that fails [acceptance](#tag-matching), since such markup can keep an element open. A failing part that also contains the point is exempt because it receives no corrections. For this test alone, acceptance disregards unpaired closing tags in the part being checked and its nested parts. A closing tag cannot keep an element open, and disregarding it avoids making the test depend on another application of the same test.
- No other earlier source text looks like an opening tag of that name. The spelling that counts is `<` followed by the name in any letter case, then whitespace, `/`, `>`, or the end of the line. Even escaped or incomplete tags count, including those in code or footnote definitions. This catches spellings outside Prettier’s HTML fragments, for example inside a wiki link or in a tag with a slash in an unquoted attribute value.

A closing tag qualifies as stray only if the test passes for its name at that tag. Even then, the tag must stay if it could close an element Markdown or the browser supplied.

Apart from void elements, Markdown can generate `a`, `blockquote`, `code`, `del`, `em`, `h1` through `h6`, `li`, `ol`, `p`, `pre`, `strong`, `table`, `tbody`, `td`, `th`, `thead`, `tr`, and `ul`. The browser can supply the document’s `html`, `head`, and `body` wrappers. Stray closing tags for all these names stay in the source.

## Rejected Parts

When a part can’t be formatted safely, it falls back to plain Prettier and the rest of the document still formats.

The license placeholders look like unclosed tags. A notice identifies the problem, and the link in that paragraph keeps its single quotes. The next paragraph gets its usual HTML formatting.

**Input**

<!-- prettier-ignore -->
```md
Copyright © <year> <copyright-holder>. <a href='LICENSE'>MIT License</a>.

Read the <a href='CONTRIBUTING.md'>contributing guide</a> before opening a pull request.
```

**Output**

<!-- prettier-ignore -->
```md
Copyright © <year> <copyright-holder>. <a href='LICENSE'>MIT License</a>.

Read the <a href="CONTRIBUTING.md">contributing guide</a> before opening a pull request.
```

Rejection covers the smallest part that fails [acceptance](#tag-matching) or whose [layout](#formatting-decisions) cannot preserve content, protection, and stability. Everything inside that part, including nested parts and inline HTML, prints as plain Prettier would print it, without corrections.

Two differences from plain Prettier are allowed. A break that would change a fragment’s role is removed, just as for [accepted inline HTML](#line-breaks). Markdown layout that depends on the surrounding document, such as table column padding, reflects the formatted document.

Enclosing parts and the rest of the document retain their own formatting decisions.

### Tag Matching

Raw tags must pair within their part and their HTML must be acceptable to Prettier, regardless of the Markdown between them.

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

A part qualifies for formatting only if it meets all four conditions.

- Its raw tags pair within the boundaries below.
- Prettier can parse its raw HTML and format it without throwing.
- Each [opaque construct and `pre` element](#comments-scripts-preformatted-text) ends in the fragment where it starts.
- Every raw element stays wholly inside or wholly outside source protected by an [ignore directive](#ignore-directives).

A closing tag pairs with the nearest open element of the same name. HTML void elements need no closing tag. That exemption applies only to HTML elements. In SVG or MathML, an element can close itself or have a matching closing tag even if its name is void in HTML.

- **Across HTML blocks.** An element still open at the end of its opening block needs an explicit closing tag in a later HTML block of the same container, unless a [correction](#corrections) closes it.
- **Within inline parts.** Tags must pair within their paragraph, heading, or table cell. In `Copyright © <year>`, the placeholder is still open at the end of the paragraph, so that part is rejected.
- **Across containers.** An element and its closing tag belong to the same Markdown container. An element cannot extend past its container’s end.

The `li` below is still open at the blank line ending the first HTML block. With no closing `li` tag in the later block, the entire `ul` part keeps plain Prettier’s layout. The last paragraph formats independently.

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

Tag matching skips intervening Markdown and nested parts that fail acceptance. Elements generated from Markdown do not participate. A raw `p` may enclose Markdown blocks, and a tag pair may cross emphasis, as in `_Press <kbd>Enter_ twice</kbd>`. Formatting changes the tag syntax and preserves the author’s structure.

### Comments, Scripts, Preformatted Text

A comment, raw text element, other opaque construct, or `pre` must end in the fragment where it starts.

The blank line ends the HTML block while `pre` is still open. The command then becomes a Markdown paragraph inside `pre`, so the `table` part is rejected. The instruction after the table still formats.

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

Prettier treats comments, declarations, processing instructions, CDATA sections, and the contents of raw text elements such as `script`, `style`, and `textarea` as opaque. Tag-like text inside them is literal. A raw text element’s own tags still open and close the element.

If opaque content or a `pre` extends beyond its fragment, formatting the intervening Markdown could change its contents. The part is therefore rejected. Inline opening and closing tags are separate fragments, so an inline `pre` or raw text element always fails this check.

For a `pre` or raw text element in a block part, rejection extends through the HTML block containing its closing tag. Comments, declarations, processing instructions, and CDATA sections have no closing tag to pair. Their part extends to the end of the container even if an end marker appears in a later block.

### Notices

By default, the plugin reports rejected parts on standard error and returns the formatted document.

Each formatting operation reports rejections once, in document order. A notice identifies the plugin, the original Markdown position, the reason, and the file path if supplied. A rejected part inside a larger rejected part gets no separate notice. The first five notices per document appear individually. If more remain, a final line gives their count. The wording is unspecified.

Notices have no effect on the result and no option of their own. Fixing the HTML clears a notice, as does protecting the entire part with an [ignore directive](#ignore-directives).

When the `PRETTIER_DEBUG` environment variable is non-empty, the first rejection that would produce a notice raises an error with the same details and formatting returns no result. This follows Prettier’s debugging convention for embedded code.

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

With embedded formatting set to `off`, the embedded syntax stays as written while the surrounding HTML still takes Prettier’s layout. Unsupported content receives Prettier’s usual protection. If formatting an embedded language fails, the plugin preserves whatever Prettier preserves. If Prettier throws, as it does in debug mode, the part is rejected. Acceptance, content protection, and stability still apply.

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

In Markdown, `prettier-ignore` protects the next Markdown node, and range directives protect the range Prettier recognizes. Within raw HTML, Prettier’s HTML formatter determines the targets of HTML ignore and attribute ignore directives.

Tags protected by a Markdown directive still participate in [tag matching](#tag-matching) and the [open element test](#correction-limits). Line endings follow the document. If a Markdown container’s prefix changes, the target’s first line and continuation lines take their corresponding new prefixes. Content and whitespace after those prefixes stay intact.

Protected source is self-contained if no raw element crosses its boundary. A pair with one tag inside and one outside crosses it, as does an element left open inside, which extends to the end of its container. No correction closes that element.

Formatting proceeds around self-contained protected source. A crossing element would make formatting its exposed tags depend on source the plugin cannot change, so the smallest part containing the protected source is rejected.

An ignore directive covering the entire rejected part acknowledges it. The part prints as protected source in plain Prettier and produces no notice.

Prettier handles file exclusions and pragma options. A skipped file receives no inspection. Document controls, range offsets, cursor positions, and pragma settings apply once to the outer Markdown operation.

### Range Formatting

For a partial range, plain Prettier supplies the result. The plugin skips HTML inspection and formatting and emits no notices. A range covering the entire document receives full-document formatting.

## Reference

### Baseline

**Plain Prettier** is the result of formatting the same input with the same Prettier version and options, without this plugin. Within the [formatting scope](#formatting-scope), both outputs must have the same meaning under the [reference profile](#gfm-profile), allowing for Prettier’s HTML formatting under the [effective options](#effective-html-options), the specified [corrections](#corrections), and preservation of the source role.

The source determines whether raw HTML is inline or forms a block. The plugin preserves that role even when Prettier’s Markdown formatter would change it by wrapping a line. Rejected parts have the same protection.

Prettier remains responsible for how it parses, wraps, and prints other Markdown, including text, tables, fences, headings, and syntax extensions next to raw HTML. When plain Prettier changes their meaning or layout, or produces unstable output, the plugin has no obligation to repair that behavior so long as raw HTML keeps its role.

### Supported Syntax

Prettier’s HTML parser determines which syntax it accepts, including custom elements and foreign content such as SVG. The plugin imposes no additional constraints on attributes, permitted children, or document wrappers.

Prettier’s Markdown and HTML parsers give MDX, JSX, and template syntax their usual interpretation in these languages. The plugin adds no dialect or execution semantics, infers no other language, and leaves literal text intact.

Other plugins can format unrelated languages. A replacement Markdown or HTML parser or printer is compatible only if it supports this contract within the formatting scope. A detected incompatibility that prevents required formatting or acceptance checks raises an error. An unsupported Markdown syntax tree is one example.

### Edge Cases

- **Doctype letter case.** Both block and inline declarations keep the original spelling of the `DOCTYPE` keyword. The reference profile reads `<!DOCTYPE html>` as a declaration and `<!doctype html>` as text. The rest of the declaration follows Prettier’s normalization.
- **End markers.** Raw text closing tags, `-->`, `?>`, `]]>`, and other required end markers stay on one physical line. A declaration’s `>` must still terminate it. Splitting `</script>` into `</script` and `>` could let the block consume following Markdown. A start marker must likewise keep the spelling or position that makes it recognizable. When a marker or tag requires one line, Prettier supplies the syntax for that layout and significant content stays intact.
- **Indented ignore comments.** A standalone `prettier-ignore`, `prettier-ignore-start`, or `prettier-ignore-end` indented past the content edge keeps that indentation, as in plain Prettier. Leading whitespace in the HTML node’s value keeps the Markdown printer from recognizing a directive. For example, ` <!-- prettier-ignore -->` at the root and `>  <!-- prettier-ignore -->` in a block quote leave the next node eligible for formatting. Moving either comment to the content edge could activate it on the next pass.
- **Table pipes.** The reference table extension processes `\|` before HTML interpretation. Formatting uses the decoded HTML value and keeps the escaping needed to hold each pipe in its original cell. A formatted pipe can neither become a cell separator nor change the decoded attribute value.

### Formatting Decisions

For a given input, formatter version, and effective configuration, the rules take effect in this order.

1. Prettier identifies the Markdown containers and raw HTML fragments. Configuration and Prettier’s directive matching determine which controls apply.
2. Tags pair in source order, [corrections](#corrections) apply, and the resulting elements determine the [parts](#document-parts). An [open element test](#correction-limits) sees only earlier source, where those decisions have already been made.
3. Each part must meet the [acceptance rules](#tag-matching) to receive HTML formatting.
4. Prettier supplies Markdown layout throughout and HTML layout and normalization in accepted parts, accounting for available width and enclosing raw elements. The [doctype rule](#edge-cases) preserves the keyword’s letter case.
5. HTML blocks take their [container prefixes and indentation](#fragment-indentation), [blank lines](#blank-lines), and [boundaries](#block-boundaries).
6. [Inline layout](#inline-html) adjusts wrapping and tag boundaries to preserve the Markdown context.
7. A part whose resulting layout fails preservation, protection, or stability is [rejected](#rejected-parts). The plugin cannot choose a different layout or defer a repair to a later pass.

These adjustments may exceed the preferred width or override attribute and bracket placement. Normalized tags and declarations retain their role. No other reflow of HTML or Markdown is permitted.

The sequence specifies the observable result. Implementations may use different parsing and printing architectures.

### Conformance

Within the [formatting scope](#formatting-scope), conformance requires all five comparisons below. Tags added, removed, or rewritten by a [correction](#corrections) are exempt from the first two only.

1. **Roles.** For each fragment, Prettier’s Markdown parser and the reference profile must each give the output the same interpretation they gave the input, whether inline HTML, an HTML block, or something else.
2. **Raw HTML.** Where the reference profile recognizes raw HTML, the plugin’s output and plain Prettier’s must agree on elements, nesting, attribute values, and significant text after the permitted HTML normalization and corrections. Comments, raw text, preformatted text, and protected source must retain their required content. Embedded language changes must agree with the selected formatter and options.
3. **Other Markdown.** Under the reference profile, both outputs must agree on Markdown structure, containers, list tightness, inline relationships, and hard breaks. The comparison excludes soft breaks allowed by `proseWrap` and any Markdown structure those breaks create. Where preserving a fragment’s role precludes agreement, the plugin’s output must agree with the input.
4. **Rejected parts.** A rejected part must match plain Prettier’s text for the same source, apart from the two differences allowed under [Rejected Parts](#rejected-parts).
5. **Stability.** A second full pass must preserve all covered content and layout as defined under [Stability](#stability).

Rendering and layout both matter. A different layout can render identically, and a stable layout can still change meaning. Browser or GitHub.com output cannot substitute for these comparisons.

All comparisons use the same supported Prettier version and effective options. Prettier supplies the reference for Markdown formatting and HTML acceptance, normalization, whitespace sensitivity, and layout, subject only to the adjustments and corrections defined here.

### Stability

Within the [formatting scope](#formatting-scope), the result depends only on the input and effective configuration. Earlier calls have no effect.

After a successful pass, formatting the result with the same options, plugin configuration, and formatter versions must preserve all [covered](#formatting-scope) content and layout. This includes indentation, blank lines, wrapping, corrections, container prefixes, and affected Markdown boundaries. Each rejected part must be rejected again with the same output.

The first pass must produce that layout. A part that would need further passes to settle is rejected.

Instability that also occurs in plain Prettier for the same input falls outside this requirement.

### Output

HTML and the Markdown around it use the document line endings and final newline that Prettier supplies. Formatting introduces no mixed line endings or extra trailing blank lines. Internal markers and formatter state never appear in the output.

### Errors

Formatting fails only if Prettier throws outside an individual part, a [required integration](#supported-syntax) is incompatible, or [debug mode](#notices) turns a notice into an error. Every error identifies the plugin, includes the file path if supplied, and retains any underlying error as its cause. Positions, when available, refer to the original Markdown.

### Settings

#### GFM Profile

The reference renderer for [GitHub Flavored Markdown](https://github.github.com/gfm) is [`cmark-gfm@0.29.0.gfm.13`](https://github.com/github/cmark-gfm/tree/0.29.0.gfm.13). Its interpretation governs the [conformance comparisons](#conformance) and rendered examples, including where it differs from the written GFM specification. Prettier’s Markdown parser still [identifies fragments](#formatting-scope).

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
