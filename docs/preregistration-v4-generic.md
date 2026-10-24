# Preregistration: glossary v4 on other MCP servers

Written on 2026-10-24, before the generic v4 arm was built.

## What changes

The v4.2 runtime (results numbered @n and reused, literal blocks, pipelines, calc, compact
output, hints once per run, stop at the first error) runs over the generated command tables
for the filesystem and git servers (`glossaries/filesystem-auto.json`, `git-auto.json`)
instead of the hand-written GitHub parser. Text results (file contents, logs, git output)
can be piped as lines: `| where line contains ERROR | count`. Arm name: `glossary4`.
The tables themselves are not edited.

## Tasks

1. The phase-2 sets `filesystem` (11 tasks) and `git` (10 tasks), frozen before any glossary
   for these servers existed; native, code and the generated v1 glossary already ran on them
   (`results/auto-filesystem.jsonl`, `results/auto-git.jsonl`). They were inspected in phase 2,
   not while building v4.
2. New blind sets `filesystem-blind` (12) and `git-blind` (10), written by an agent that could
   not read any glossary, engine or result. Frozen by hash in
   `results/blind-disk-freeze.sha256` before any run.

## Runs

Phase-2 sets: `glossary4` only, Haiku 5.5 and Sonnet 5.5, 3 reps, against the existing rows.
Blind sets: `glossary4`, `code`, `native`, Haiku 5.5 and Sonnet 5.5, 3 reps.

## Predictions and refutations

1. Accuracy: `glossary4` within 2 failed runs of `native` and of `code` on each set and model.
2. Cost vs native: `native` costs more than `glossary4` on the blind sets on both models
   (point estimate above 1x). Significant only if the interval excludes 1x.
3. Cost vs code: no direction predicted. On GitHub the gain came from compact JSON tables;
   these servers return plain text, so a tie is plausible.
4. `glossary4` fails no more runs than the v1 generated glossary on the phase-2 sets.

## Inside Claude Code (added before any client run)

`src/client_bench.ts` on `github-blind3` (frozen blind set), arms `native` and `glossary4`
(the proxy with `--runtime=v4`), Haiku 5.5 and Sonnet 5.5, 2 reps. Claude Code 2.1.310, `--bare`.
5. Accuracy: `glossary4` within 2 failed runs of `native` per model.
6. Cost: `native` costs more than `glossary4` per model (point estimate above 1x).
