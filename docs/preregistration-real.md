# Preregistration: Phrasebook on real GitHub

Written on 2026-10-24, before any model run against api.github.com.

## Why

Every GitHub result so far ran against a local mock behind the real github-mcp-server binary.
This set checks whether those results carry over to the real API: real JSON shapes, real
pagination, real search. It is NOT blind (written by the glossary's author from the seeded
data) and is not offered as new evidence of superiority.

## Setup

- Repo `Rixmerz/phrasebook-sandbox`, private, seeded by `src/github/real/seed.ts`:
  120 issues (31 closed, 7 of them not planned), 13 custom labels, 23 issues with comments,
  8 pull requests (2 drafts, 3 into `release/1.0`), 3 files on `main`.
- Frozen snapshot `results/real-snapshot.json`; every truth is computed from it.
- `src/github/real/suite.ts`: the same github-mcp-server binary with `--toolsets=default`
  and no `--gh-host`. An allowlist refuses any call not naming the sandbox (searches get a
  `repo:` qualifier; `create_repository` and `fork_repository` are refused). After each run,
  every issue or PR changed since the run started is restored to the snapshot and the whole
  repo is checked against it.
- One account only: authors and assignees are all `Rixmerz`, so there are no per-person tasks.
  The write token cannot change file contents, so there are no file-edit tasks.

## Engine changes found by a model-free probe (before any run)

Probing `glossary4` against the real server, with no model, found two places where the mock
had hidden real-API behavior. Both were fixed in `src/v3/engine.ts` before freezing:

1. `list_issues` without `state` returns open and closed issues on the real server (the mock
   returned open only). The engine now sends `state=OPEN` when none is given, as the glossary
   text already promised.
2. Several labels (`labels=v1.1,bug`) match any of them on the real server (the mock matched
   all). The engine now fetches every page and keeps rows with all the labels.

Native and code mode see the real server unchanged.

## Tasks

`src/github/real/tasks.ts`, 12 tasks: 9 read-only (counts, sets, a percentage, PR bases,
drafts, a config value) and 3 writes (add a label to a computed set, assign a computed set,
close as not planned with an exact comment). Frozen by hash in `results/real-freeze.sha256`.

## Runs

Arms `native`, `code`, `glossary4`; claude-sonnet-5-5 and claude-haiku-5-5; 3 reps.
Read tasks at concurrency 3, write tasks at concurrency 1, never at the same time.
A pilot (Sonnet, 1 rep, 3 tasks) runs first to check cost; its rows are kept apart.

## Predictions and refutations

1. Accuracy: `glossary4` within 2 failed runs of `native` and of `code`, per model.
2. Cost vs native: `native` costs more than `glossary4` per model (point estimate above 1x).
   Significant only if the 95% bootstrap interval excludes 1x.
3. Cost vs code: `code` costs more than `glossary4` on Sonnet (point estimate above 1x), as on
   the mock GitHub sets. Refuted if the point estimate is at or below 1x.
4. The mock carries over: the code/glossary4 and native/glossary4 ratios on Sonnet fall within
   the range seen on the mock blind sets (code 1.9x to 2.8x, native 2.3x to 5x), or the
   difference is explained in the report.
