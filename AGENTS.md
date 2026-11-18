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

## Specification Work

- **Scope:** Keep formatting behavior and its constraints in `SPEC.md`. Keep authoring and verification instructions here. Record settled rules rather than open questions, implementation history, or a catalog of current defects.
- **Organization:** Lead with formatting outcomes. Keep the opening guarantees brief, and put specific renderer versions and example settings at the end. Keep the option mapping and override rules with Formatting Controls. Explain individual option effects alongside the formatting rules they change, and include an option only when it affects a defined rule or example.
- **Voice:** Write `SPEC.md` as a description of observable formatting behavior and its reasons. Use direct, explanatory prose rather than instructions addressed to the reader, and preserve the force of each rule.
- **Examples:** Show the required formatted Markdown followed by its rendered HTML, using `###### Markdown` and `###### Rendered HTML`. Put `<!-- prettier-ignore -->` immediately before each `md` fence and only those fences. Let the formatter format the paired HTML.
- **Test Organization:** Keep spec integration tests in `src/spec.test.ts`. Group them in `describe` blocks for the sections or subsections that define the tested behavior. Use the exact section heading text as each block’s title, and order the blocks as those sections appear in `SPEC.md`. Within each block, keep example-based tests in the same order as their examples.
- **Tests and Examples:** Treat each spec example as a contract for integration tests that exercise the plugin. Make the correspondence clear in the tests, using the same content and effective options. Wherever the example permits it, use an input variant that is unformatted in the aspect under test, so removing that behavior would change the result. Keep protected content intact. Otherwise, use the documented Markdown as input to check preservation. Assert the exact documented Markdown output, and format changed output again with the same options to check that it remains unchanged.
- **Contract Consistency:** When implementing or changing a rule illustrated by a spec example, keep the example and corresponding test expectations consistent. Resolve disagreements against the intended rule rather than updating examples or test expectations to match current plugin output. Additional tests may cover variations without adding examples to the spec.
- **Conformance Status:** `SPEC.md` may define contracts ahead of their tests and implementation. When reporting coverage, distinguish examples with passing integration tests for the intended behavior from examples whose coverage remains outstanding. Skipped tests and expected failures remain outstanding. An example’s presence alone doesn’t establish coverage.
- **Proposals:** When proposing a formatting rule, show its intended output and the current plugin’s output. Probe slightly unformatted input so unchanged output does not masquerade as successful formatting. Check a second pass, and distinguish observed behavior from the proposed contract.
- **Verification:** Follow [Verify Examples](#verify-examples). A different Markdown renderer or GitHub.com output does not establish that comparison. Recheck all affected Markdown/HTML pairs after edits and preserve the spec’s literal examples during document formatting.

## Verify Examples

Use the renderer version, extensions, and baseline Prettier options in [Reference Settings](SPEC.md#reference-settings). If the required renderer isn’t installed, build the source linked from the spec’s [GFM profile](SPEC.md#gfm-profile) in a task temporary directory, following its upstream build instructions. For a temporary build, replace `cmark-gfm` in the commands below with the built executable’s path. Check the renderer and Prettier versions before comparing output:

```sh
cmark-gfm --version
```

```sh
pnpm exec prettier --version
```

Save the Markdown fence’s contents in a task temporary file. In the commands below, replace the file placeholders with task temporary paths and the option placeholders with the spec’s baseline values. Render first, and continue only if rendering succeeds:

```sh
cmark-gfm --unsafe -e autolink -e strikethrough -e table -e tasklist \
    < "<markdown-file>" > "<rendered-html-file>"
```

This deliberately omits `tagfilter`, since the examples show HTML before filtering. Format that output without repository or editor configuration, which can override Prettier’s defaults:

```sh
pnpm exec prettier --no-config --no-editorconfig --parser html \
    --print-width "<print-width>" --tab-width "<tab-width>" < "<rendered-html-file>"
```

Compare the successful command’s complete output with the paired HTML fence, including its final newline. A match verifies the rendered example, not the plugin’s compliance with the spec.
