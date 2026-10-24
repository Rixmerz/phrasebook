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
