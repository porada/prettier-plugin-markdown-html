# Project Documentation

This document records constraints, durable facts, maintenance decisions, and rationale that are not obvious from source and configuration. `AGENTS.md` remains authoritative for agent instructions.

## Parser Disagreement

### Block Math Inside Paragraphs

Inline syntax such as a code span, link, or HTML comment can cross a math boundary within a paragraph or setext heading. Detecting those crossings precisely would require reconstructing the paragraph or heading across Prettier’s block boundaries. Raw HTML can also leave a heading, list item, or block quote without any inline syntax crossing the math. Both arrangements are rare enough to justify the [block math exception](../SPEC.md#block-math-inside-paragraphs), even where a conservative source check could flag an adjacent setext underline or a missing container prefix.
