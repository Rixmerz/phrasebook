# Preregistration: glossary v4.3

Written on 2026-10-24, before v4.3 was built, after the filesystem-blind results.

Change: a text result longer than 40 lines shows its first 15 lines and a line saying how many
are left; the full text stays in @n for pipes (`@n | where line contains X | count`) and for
`content=@n`. Adding `full` to a command prints all of it. Same for every server.

Tasks: `src/fs/set5tasks.ts` (suite `filesystem-set5`, 8 tasks), NOT blind: written by the
glossary's author after reading the filesystem-blind logs, about large logs and a CSV, so it
favors v4.3. Frozen in `results/set5-freeze.sha256`. Regression: `filesystem-blind`
(inspected, so regression only) and `github-blind3`, glossary4 only, against the v4.2 rows.

Runs: set5 with `glossary4`, `code`, `native`, Haiku 5.5 and Sonnet 5.5, 3 reps. Regression
on Sonnet 5.5, 3 reps.

Predictions:
1. set5: glossary4 within 2 failed runs of code and native per model.
2. set5: glossary4 costs no more than 1.2x code on each model (point estimate).
3. filesystem-blind: v4.3 costs less than v4.2 on Sonnet (point estimate below 1x), same accuracy within 2 runs.
4. github-blind3: v4.3 within 2 failed runs of v4.2 and costs no more than 1.1x it on Sonnet.
