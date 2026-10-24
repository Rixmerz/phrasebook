# Amendments to docs/preregistration-main.md

Made after the Haiku 5.5 pilot (`results/github-hard-pilot.jsonl`,
`results/github-bulk-pilot.jsonl`) and before any matrix run. Both are
arm-agnostic.

1. `x-least-loaded` is dropped from scoring. Its seed has a tie: ana and bruno
   each have 2 open assigned issues, so the task has no correct answer. All three
   arms failed it in the pilot.
2. The `toolsearch` arm gets one system-prompt line ("Your tools are not loaded
   yet: use the tool search tool to find and load the tools you need, then call
   them."), as the tool search documentation recommends. Without it Haiku 4.5
   failed 2 of 2 smoke tasks by never searching; with it, 2 of 2 passed. Other
   arms keep the suite system prompt unchanged; their tool descriptions already
   say what they are.
3. Mock routes added for gaps the pilot found (repository labels and label by
   name over GraphQL, `GET /git/trees/:ref`). Same backend for every arm.

## 2026-10-24: exact-comment wording in github-blind and github-blind2

`b-close-duplicates` and `c-close-obsolete` asked for an exact comment written after a colon
at the end of the sentence, so its final period read as sentence punctuation; Sonnet 5.5 dropped
it in every arm, code mode included. The comment now goes in double quotes with "(con el punto
final)". Only these two tasks were rerun, for every arm on the affected suite and models, into
`results/*-amended.jsonl`; the original rows stay in their files. The checks did not change.
