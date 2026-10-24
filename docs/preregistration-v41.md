# Preregistration: glossary v4.1

Written on 2026-10-24, before any v4.1 run on its evaluation set.

v4.1 = v4 plus four fixes for errors seen in the v4 runs: `owner=`/`repo=o/r` keys become
the target; `list issue ... state=all` fetches open and closed issues and merges them (the
tool only takes OPEN or CLOSED); `add comment T` works like `comment T`; `#@n` on a single
record uses its number. The arm name stays `glossary4`; rows before this commit are v4.0.

## Tasks

New blind set `src/github/blind3tasks.ts` (suite `github-blind3`, 16 tasks), written by an
agent that could not read the glossary, the engine, earlier task sets beyond the format
reference, or any result. Frozen by hash in `results/blind3-freeze.sha256` before any run.

## Arms and runs

`glossary4` (v4.1), `glossary3-feedback`, `code`, `native` on `github-blind3`, 3 reps,
on claude-sonnet-5-5 and claude-haiku-5-5; `glossary4`, `code` on claude-opus-5-5, 2 reps.

## Predictions and refutations

1. `glossary4` is within 2 failed runs of `code` on each model. Refuted otherwise.
2. `code` costs more than `glossary4` on Sonnet 5.5 and Haiku 5.5, intervals above 1x.
3. On Opus 5.5, `code` costs more than `glossary4` (point estimate above 1x).
4. `native` costs more than `glossary4` on every model run, intervals above 1x.
5. `glossary4` makes at most half as many parse errors per run as `glossary3-feedback`.
