# Agent Instructions

## Overview

- **Repository:** Formats raw HTML in Markdown with Prettier.
- **Disclosure:** The repository is public and open source.

## Agent Documentation

| Source | Authority and Ownership |
| --- | --- |
| `AGENTS.md` | Defines project instructions, scope, and documentation authority. Applicable project instructions override global defaults. |
| `SPEC.md` | Defines the intended formatting contract. Its opening note states the implementation status. |

## Specification Work

- **Scope:** Keep formatting behavior and its constraints in `SPEC.md`. Keep authoring and verification instructions here. Record settled rules rather than open questions, implementation history, or a catalog of current defects.
- **Organization:** Lead with formatting outcomes. Keep the opening guarantees brief, and put specific renderer versions and example settings at the end. Keep the option mapping and override rules with Formatting Controls. Explain individual option effects alongside the formatting rules they change, and include an option only when it affects a defined rule or example.
- **Voice:** Write `SPEC.md` as a description of observable formatting behavior and its reasons. Use direct, explanatory prose rather than instructions addressed to the reader, and preserve the force of each rule.
- **Examples:** Show the required formatted Markdown followed by its rendered HTML, using `###### Markdown` and `###### Rendered HTML`. Put `<!-- prettier-ignore -->` immediately before each `md` fence and only those fences. Let the formatter format the paired HTML.
- **Fixtures:** Use incidental values `foo`, `bar`, `baz`, `qux`, `quux`, `corge`, `grault`, `garply`, `waldo`, `fred`, `plugh`, `xyzzy`, and `thud`, in that order. Restart for each independent example and keep distinct values distinct. Use `Comment` for one comment and numbered comments when several are needed.
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
