# Preregistration: hard, bulk and competitor arms (main thread)

Written on 2026-10-24, before any run of the suites and arms below, and before
the `toolsearch` and `codesearch` arms and the auto-generated glossaries were
built. Task files are hash-frozen in `results/phase2-freeze.sha256`.

## Suites

- `github-hard` (`src/github/hard.ts`, 12 tasks): multi-step work, lookups the
  prompt does not spell out, a condition, and a request that must be refused.
- `github-bulk` (`src/github/bulk.ts`, 8 tasks): 240 issues; aggregation,
  filtering across pages, bulk writes of 17 to 24 issues.

## Arms

`native`, `glossary2` (hand-written v2), `code` (Cloudflare style),
`codesearch` (Anthropic style, progressive discovery), `toolsearch` (native
tools deferred behind the API tool search tool).

## Predictions and what would refute them

1. **Hard tasks, accuracy.** `glossary2` is within noise of `native` on every
   model. Refuted if, on any model, `glossary2` fails at least 3 more runs than
   `native` and at least one task fails 2 of 3 or worse with `glossary2` only.
2. **Hard tasks, cost.** `glossary2` costs less per task than `native`, `code`
   and `codesearch`. Refuted for any arm that is cheaper with equal accuracy.
3. **Tool search.** `toolsearch` is much cheaper than `native` but `glossary2`
   is still cheaper per task, at equal accuracy. Refuted if `toolsearch` is at
   least as cheap and at least as accurate as `glossary2` on a model.
4. **Bulk tasks.** `code` and `codesearch` beat `glossary2` on total tokens and
   are at least as accurate, because they aggregate inside the sandbox instead
   of reading every page into context. If this holds, the glossary is a partial
   replacement for code mode (interface for operations) and not a total one. If
   `glossary2` matches `code` on bulk cost and accuracy, it is evidence for a
   total replacement.

Accuracy differences of one or two runs out of 36 are reported as noise.
