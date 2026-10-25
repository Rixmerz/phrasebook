# Preregistration: Phrasebook on real GitHub, blind set

Written 2026-10-24, before any run on this set.

## Why

The first real-GitHub set (`docs/preregistration-real.md`) was written by the glossary's
author. This set was written by a separate agent that saw only the frozen snapshot
(`results/real-snapshot.json`), the format of `src/github/real/tasks.ts` and the mock's types.
It did not see the glossary text, the engine, the arms or any result.

## Setup

Same as the first real set: same sandbox repo, snapshot, allowlist, restore and pristine check.
The suite `github-real-blind` is `makeRealSuite` with the new tasks. No engine change since
the blind3 regression check (commit df052cc). The sandbox is checked against the snapshot
with `src/github/real/pristine.ts` before the first run.

## Tasks

`src/github/real/blindtasks.ts`, 12 tasks: 9 read-only (combined filters, a ranking over area
labels, comment text, a percentage over closed issues, counts over all states, PRs plus
issues, an average, a config value) and 3 writes (assign a computed set, add a version label
to a computed set, reopen an issue with an exact comment). The author of this file recomputed
seven truths independently before freezing. Frozen in `results/real-blind-freeze.sha256`.

## Runs

Arms `native`, `code`, `glossary4`; claude-sonnet-5-5 and claude-haiku-5-5; 3 reps. Read tasks
at concurrency 3, write tasks at concurrency 1, never at the same time.

## Predictions and refutations

1. Accuracy: `glossary4` within 2 failed runs of `native` and of `code`, per model.
2. Cost vs native: point estimate above 1x per model; significant if the interval excludes 1x.
3. Cost vs code: point estimate above 1x on Sonnet; refuted at or below 1x.
4. Carry-over: on Sonnet, code/glossary4 and native/glossary4 fall within the ranges seen on
   the first real set and the mock blind sets (code 1.9x to 3.4x, native 2.3x to 5x), or the
   difference is explained in the report.

## Grading fix after the first attempt (2026-10-24)

The first attempt is void and kept only as raw logs (`results/real-blind.jsonl`,
`real-blind-w.jsonl`, `*.out`):
- Reads stopped at the bench's default 1.5M-token process cap. Every run after that was logged
  as FAIL, which hit `code` and `glossary4` because they ran last.
- Every write run failed grading, correct ones included. The blind set's `untouched` helper
  compared `state_reason` on open issues, and issue #104 carries "reopened" since the first
  real set closed it and the restore reopened it. `assertPristine` already ignored that field
  on open issues. The helper now does the same, and nothing else changed.
- The aborted run left #120 assigned. The sandbox was restored and checked pristine.

The rerun writes to `results/real-blind2*.jsonl` with `--budget=30000000`.
