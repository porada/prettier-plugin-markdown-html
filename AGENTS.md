# Agent Instructions

## Overview

- **Repository:** Formats raw HTML in Markdown with Prettier.
- **Disclosure:** The repository is public and open source.

## Agent Documentation

| Source | Authority and Ownership |
| --- | --- |
| `AGENTS.md` | Defines project instructions, scope, and documentation authority. Applicable project instructions override global defaults. |
| `.agents/PROJECT.md` | Records constraints, durable facts, maintenance decisions, and rationale. It doesn’t override agent instructions. |
| `SPEC.md` | Defines the formatting contract. |

## General

- **Navigation:** Consult the relevant sections of `.agents/PROJECT.md`.
- **Durable knowledge:** Add project knowledge to `.agents/PROJECT.md` only when its absence would likely cause a wrong future decision or substantial repeated investigation. Capture non-obvious constraints and rationale not already clear from canonical configuration, instructions, or source. Don’t record optimization recaps, routine implementation details, or workflow summaries. Prefer updating existing material over adding another explanation. If the task doesn’t permit the edit, report deferred documentation work only if it meets this threshold.

## Review Formatting Behavior

- **Findings:** Report failures of universal guarantees and explicit rules in `SPEC.md`, including required rejections and layout on printed lines. For a supported region, a rendering change is a defect when plain Prettier preserves its rendering under the same options, subject to [Conformance](SPEC.md#conformance) and [Limits](SPEC.md#limits). A [stability defect](SPEC.md#stability) occurs when a second pass with the same settings changes accepted HTML in a supported shape.
- **Rendering comparisons:** Render the input, plain Prettier’s output, and the plugin’s output with the renderer command in [Verify Examples](#verify-examples), then compare the affected region under [Conformance](SPEC.md#conformance).
- **Upstream defects:** Report defects in Prettier’s Markdown layout or HTML formatter output upstream. Follow [Prettier’s layout of the surrounding Markdown](SPEC.md#limits) and apply the [inline tag rule](SPEC.md#line-breaks) even where plain Prettier would wrap the line. Reject the region if the HTML formatter fails or the printed block fails its [boundary and container check](SPEC.md#block-html).
- **Unsupported shapes:** A reported change of meaning outside the supported shapes that breaks no explicit rule is a candidate for narrowing. Add a rejection if a feature of Prettier’s tree or the region’s source identifies the shape. Otherwise the [general limit](SPEC.md#limits) already covers it.
- **Large or repeated fixes:** For a shape absent from real documents, narrow the rule when a fix would require more code or formatting rules than its use warrants. When a finding reopens a rule that already needed a correction, reconsider whether to narrow or drop the rule before patching it again.

## Specification Work

- **Scope:** Keep formatting behavior and its constraints in `SPEC.md`. Keep authoring and verification instructions here. Record settled rules rather than open questions, implementation history, or a catalog of current defects.
- **Evidence:** Add a formatting rule, exception, or guarantee only when a real document needs it or a user reports the need. Cite a public file at a specific commit or the user’s report. A constructed example alone cannot establish the need.
- **Changes During Implementation:** During implementation, change `SPEC.md` only to narrow or remove a guarantee. A new guarantee requires the user’s decision.
- **Organization:** Lead with formatting outcomes. State each opening principle in one line, link it to the section that defines it, and follow the principles with one example of ordinary formatting. Cover ordinary formatting before corrections and rejections, then introduce Formatting Controls. Put reference material, including specific renderer versions and example settings, at the end.
- **Rule Sections:** When a section introduces a formatting rule, state the rule in the opening sentence and show an example before explaining the details. Examples are optional in sections devoted to limits, options, notices, edge cases, or reference material.
- **Options:** Keep the option mapping and override rules with Formatting Controls. Explain individual option effects alongside the formatting rules they change, and include an option only when it affects a defined rule or example.
- **Voice:** Write `SPEC.md` as a description of observable formatting behavior and its reasons. Use direct, explanatory prose rather than instructions addressed to the reader, and preserve the force of each rule.
- **Durability:** Keep short-lived details such as current dates and counts out of the rules and examples. Give an exact version only when it defines a reference, as the GFM renderer’s version does. For Prettier, say that the examples use the version installed by the repository.
- **Examples:** Use a realistic document fragment with meaningful content. Choose input that isolates one feature and would produce different output without the rule. Show the input and the required formatted Markdown under **Input** and **Output**. Include **Rendered HTML** only when the example illustrates how that output renders. Put `<!-- prettier-ignore -->` immediately before each `md` fence and only those fences. Let the formatter format the paired HTML.
- **Test Organization:** Keep spec integration tests in `src/spec.test.ts`. Group them in `describe` blocks for the sections or subsections that define the tested behavior. Use the exact section heading text as each block’s title, and order the blocks as those sections appear in `SPEC.md`. Within each block, keep example-based tests in the same order as their examples.
- **Tests and Examples:** Treat each spec example as a contract for integration tests that exercise the plugin. Make the correspondence clear in the tests, using the documented input and effective options. Assert the exact documented Markdown output, and format that output again with the same options to check that it remains unchanged.
- **Contract Consistency:** When implementing or changing a rule illustrated by a spec example, keep the example and corresponding test expectations consistent. Resolve disagreements against the intended rule rather than updating examples or test expectations to match current plugin output. Additional tests may cover variations without adding examples to the spec.
- **Conformance Status:** `SPEC.md` may define contracts ahead of their tests and implementation. When reporting coverage, distinguish examples with passing integration tests for the intended behavior from examples whose coverage remains outstanding. Skipped tests and expected failures remain outstanding. An example’s presence alone doesn’t establish coverage.
- **Proposals:** When proposing a formatting rule, show its intended output and the current plugin’s output. Probe slightly unformatted input so unchanged output does not masquerade as successful formatting. Check a second pass, and distinguish observed behavior from the proposed contract.
- **Verification:** Follow [Verify Examples](#verify-examples). Use only the specified renderer for the rendered HTML comparison. Recheck all affected examples after edits and preserve the spec’s literal examples during document formatting.

## Verify Examples

Use the renderer version, extensions, and baseline Prettier options in [Settings](SPEC.md#settings). If the required renderer isn’t installed, build the source linked from the spec’s [GFM Profile](SPEC.md#gfm-profile) in a task temporary directory, following its upstream build instructions. For a temporary build, replace `cmark-gfm` in the commands below with the built executable’s path. Check the renderer version before comparing rendered HTML.

```sh
cmark-gfm --version
```

For each example with **Rendered HTML**, save the **Output** fence’s contents in a task temporary file. In the commands below, replace the file placeholders with task temporary paths and the option placeholders with the spec’s baseline values. Render first, and continue only if rendering succeeds.

```sh
cmark-gfm --unsafe -e autolink -e strikethrough -e table -e tasklist \
    < "<markdown-file>" > "<rendered-html-file>"
```

This deliberately omits `tagfilter`, since the examples show HTML before filtering. Format that output without repository or editor configuration, which can override Prettier’s defaults.

```sh
pnpm exec prettier --no-config --no-editorconfig --parser html \
    --print-width "<print-width>" --tab-width "<tab-width>" < "<rendered-html-file>"
```

Compare the successful command’s complete output with the paired HTML fence, including its final newline. A match verifies the rendered example. The integration test checks whether the plugin produces the documented Markdown.

For rejected regions, protected source, and Markdown outside raw HTML, the comparison starts with **Input**. Save that fence’s contents in `<input-file>` and format them with plain Prettier. Add any options the example specifies to the baseline options below.

```sh
pnpm exec prettier --no-config --no-editorconfig --parser markdown \
    --print-width "<print-width>" --tab-width "<tab-width>" < "<input-file>"
```

Compare those portions of the result with the corresponding text under **Output**. Require an exact match for rejected regions and protected Markdown source. For a rejected table cell, compare its [content](SPEC.md#document-regions) without column padding. Check the blank lines around HTML blocks against plain Prettier’s output. In the surrounding prose, account for the effect of [inline tag layout](SPEC.md#line-breaks) on wrapping.
