# Preregistration: glossary v3

Written on 2026-10-24, before glossary v3 was implemented. Tasks frozen in
`src/github/v3tasks.ts` (hash in `results/v3-freeze.sha256`).

## What v3 adds (designed from phase 1 and 2 failures)

Shared by both v3 arms: compact table output (TOON-style, lossless for the
fields kept), `all` to fetch every page in the engine, a declarative pipeline
(`| where | select | sort | group | count | top`), references to earlier
results (`@n`, `@n.field`, `@n[*].field`, fan-out over `#@n[*].number`),
literal blocks (`key<<EOF ... EOF`, exact bytes), list arithmetic
(`labels+=x`, `labels-=x`), verb macros (`close`, `reopen`, `comment`), and
`form <command>` with the server's real options.

Two arms, identical except for where conventions live:

- `glossary3-legend`: conventions up front in the description (paging, default
  sort and state, irreversible actions); outputs carry no hints.
- `glossary3-feedback`: minimal description; every output ends with what was
  applied (defaults, order, shown/total) and ready-to-send next commands; every
  error carries a ready-to-send corrected command when one parses.

## Predictions and refutations

1. **Data work (`github-bulk2`).** Both v3 arms are within noise of code mode in
   accuracy on every model, and at most 1.5x its cost on Sonnet 5.5 and Haiku
   5.5. Refuted for an arm that fails 3 or more runs more than `code` on a
   model, or costs more than 1.5x `code`.
2. **Exact content (`github-exact`).** Both v3 arms have zero byte-mismatch
   failures. Refuted by any run whose file differs from the expected bytes after
   the model reported success.
3. **Legend vs feedback.** Equal accuracy within noise; `glossary3-feedback` has
   fewer invalid calls and turns per task than `glossary3-legend`. Refuted if
   feedback has more invalid calls per task on two of three models.
4. **No regression.** On `github` and `github-hard`, v3 arms stay within noise of
   `glossary2` in accuracy. Refuted if a v3 arm fails 3 or more runs more than
   `glossary2` on a model with some task failing 2 of 2 only in v3.

Accuracy differences of one or two runs are noise.
