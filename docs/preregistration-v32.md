# Preregistration: glossary v3.2

Written on 2026-10-24, before v3.2 was implemented. Tasks frozen in
`src/github/calctasks.ts` (hash in `results/v32-freeze.sha256`).

v3.2 = v3.1 feedback arm plus: pipeline steps `sum`, `avg`, `min`, `max`,
`distinct`; `in` / `notin` against another result (`where author in @2[*].user`);
a pipeline that starts from an earlier result (`@3 | where ...`); `calc` for
arithmetic over results (`calc @1 / @2 * 100`); and a literal block that leaves
out the final newline (`content<<EOF!`).

## Predictions and refutations

1. `glossary3-feedback` (v3.2) is within noise of `code` in accuracy on every
   model on `github-calc`. Refuted if it fails 3 or more runs more than `code` on
   a model.
2. It costs at most 1.5x `code` on Sonnet 5.5 and Haiku 5.5. Refuted otherwise.
3. Zero byte-mismatch failures on `c-copy-version` and `c-tag-no-newline`.

Accuracy differences of one or two runs out of 24 are noise.
