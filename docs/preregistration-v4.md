# Preregistration: glossary v4

Written on 2026-10-24, before v4 was implemented. Design input: `docs/v4-analysis.md`.

v4 = the v3 feedback arm (`glossary3-feedback`) plus:

1. Compact default columns per record type in list results (issue: number, title,
   state, labels, assignees, comments; PR: number, title, state, author, head, base),
   nested objects flattened to a name, SHAs left out, columns with one value across
   all rows lifted into a header line, and one line naming the hidden fields.
   `| select` brings any hidden field back.
2. Each feedback hint at most once per run; next-step hints only when a result is
   truncated, empty or an error.
3. `| select` and `| where` on a single object; batched gets (`get issue o/r#1,5,9`).
4. List filters the server lacks become client-side `where` steps, with a note.

## Tasks

A new blind set, `src/github/blind2tasks.ts` (suite `github-blind2`), written by
another agent that could not read the glossary, the engine or any result. Frozen by
hash in `results/blind2-freeze.sha256` before any v4 run. No v4 change may be made
after a v4 run on that suite except bug fixes in the mock (rerun only affected cells).
The earlier sets (blind, calc, bulk2) serve as regression checks; v4 was designed
by inspecting their logs, so they are not evidence of improvement.

## Arms and runs

`glossary4` vs `glossary3-feedback` vs `code` on `github-blind2`, 3 reps, on
claude-sonnet-5-5 and claude-haiku-5-5. Regression: `glossary4` on `github-calc`
and `github-blind` on Sonnet 5.5, 3 reps.

## Predictions and refutations

1. Accuracy: `glossary4` is within 2 failed runs of `glossary3-feedback` and of
   `code` on `github-blind2`, on each model. Refuted otherwise.
2. Cost: `glossary4` costs less than `glossary3-feedback` on `github-blind2` on
   Sonnet 5.5, with the 95% bootstrap interval of the ratio below 1x.
   Expected size: 15-30% cheaper.
3. Cost vs code mode: `glossary4` is cheaper than `code` on Sonnet 5.5
   (point estimate below 1x). Claimed significant only if the interval excludes 1x.
4. Regression: on `github-calc` and `github-blind`, `glossary4` fails at most 2
   more runs than `glossary3-feedback` did, and costs no more.
5. Tool-result characters per run drop by at least 40% vs `glossary3-feedback`
   on `github-blind2`.
