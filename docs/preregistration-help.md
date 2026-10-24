# Preregistration: progressive glossary (`glossary-help`)

Written on 2026-10-24 before the arm was run on any task.

## Arm

The tool description keeps the glossary header (grammar, targets, value rules),
the list of nouns and the examples, and drops the per-noun command lines.
`help <noun>` (or `help` alone) returns those lines from the same glossary text.
Commands go to the same parser as the full glossary arm. The split is generic
(header, two-space-indented noun blocks, examples) and works on the
hand-written and the generated glossaries alike; nothing is written per task.

Motivation, from evidence already collected: Claude Code shows only the first
paragraph of an MCP tool description, and a full glossary grows with the server
(2,569 tokens at 91 tools); a progressive glossary keeps the description small
at any size.

## Predictions and refutations

1. Definition tokens are at most half of the full glossary's on `github91`.
2. Accuracy is within noise of the full glossary on `github`, `github-hard`,
   `github91`. Refuted if, on any model, it fails at least 3 more runs than the
   full glossary and some task fails 2 of 3 or worse only with this arm.
3. Cost per task is lower than the full glossary on `github91` and may be
   higher on `github` (one extra turn to read help). Refuted for `github91` if
   it is not cheaper there.
