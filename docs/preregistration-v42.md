# Preregistration: glossary v4.2

Written on 2026-10-24, before v4.2 was built.

## Changes planned (from the v4.1 logs on github-blind3)

1. Fields a list does not carry (e.g. `state_reason` on issue lists): `| select` or `| where`
   on such a field fetches each record and fills it in, with a one-line note, instead of
   returning blanks (one run spent 6 turns and 37 gets on this).
2. Lines in one call run in order and stop at the first error, and the glossary says to send
   dependent steps (branch, file, PR) in one call.
3. `edit file o/r path=... branch=... old="..." new="..."`: exact replacement of one
   occurrence, the engine reads the file and writes it back with its sha, so the model does
   not retype the file.

## Tasks

`src/github/set4tasks.ts` (suite `github-set4`, 15 tasks). NOT blind: written by the
glossary's author after reading the v4.1 logs; it includes closing reasons, small edits and a
multi-step write, so it can favor v4.2. Frozen in `results/set4-freeze.sha256`. The unbiased
check is the regression on the blind sets 2 and 3.

## Runs

`glossary4` (v4.2), `code`, on `github-set4`, Sonnet 5.5 and Haiku 5.5, 3 reps.
Regression: `glossary4` (v4.2) on `github-blind3`, Sonnet 5.5 and Haiku 5.5, 3 reps,
against the v4.1 rows already in `results/blind3.jsonl`.

## Predictions and refutations

1. set4: `glossary4` within 2 failed runs of `code` on each model.
2. set4: `code` costs more than `glossary4` on both models, intervals above 1x.
3. blind3 regression: v4.2 fails at most 2 more runs than v4.1 on each model.
4. blind3: v4.2 takes fewer turns per run than v4.1 on Sonnet 5.5 (v4.1: 3.02).
5. blind3: v4.2 costs no more than v4.1 on Sonnet 5.5 (point estimate at or below 1x).
