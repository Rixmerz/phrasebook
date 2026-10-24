# Preregistration: Phrasebook on a second large server (Notion)

Written 2026-10-24, before the glossary for this server exists and before any run.

## Why

The glossary's cost advantage over code mode was shown on GitHub only. Filesystem and git tied,
but those are small servers with short text answers. Notion is a second large JSON API in a
different domain (documents and databases, not a code forge): 24 tools, about 76 KB of tool
definitions, verbose page and block objects.

## Setup

- Server: the official `@notionhq/notion-mcp-server@2.5.2`, unchanged, with `BASE_URL` pointed
  at an in-process mock of the Notion REST API (`src/notion/mock.ts`, seed in `src/notion/seed.ts`).
  The mock follows the API reference shapes (rich text, property values, list envelopes with
  cursors, error objects) and records any request it cannot serve as a harness gap.
- Model-free smoke test through the real server before freezing: every endpoint used answered,
  no gaps.
- Glossary: generated once by `src/auto/generate.ts` from the frozen tool list
  (`results/notion-tools.json`), never edited by hand, run by the generic v4 engine (arm
  `glossary4`). No engine change for this server before the runs; any later fix is reported as
  post-hoc in a `-corrected` file.

## Tasks

`src/notion/blindtasks.ts`, 16 tasks (11 read, 5 write), written by a separate agent that saw
only `seed.ts` and a plain description of what Notion can do; no tool list, no glossary, no
engine, no results. Five truths were recomputed independently before freezing. Known soft spot:
`nb-mas-comentada` answers with a task title that three rows share; the check accepts the title.

## Runs

Arms `native`, `code`, `glossary4`; claude-sonnet-5-5 and claude-haiku-5-5; 3 reps. Pilot first
(Haiku 5.5, 1 rep, all arms, 4 tasks) to check cost and harness gaps; pilot rows are kept apart.

## Predictions and refutations

1. Accuracy: `glossary4` within 2 failed runs of `native` and of `code`, per model.
2. Cost vs native: point estimate above 1x per model; significant if the interval excludes 1x.
3. Cost vs code: point estimate above 1x on Sonnet. Refuted at or below 1x. If refuted, the
   claim stays "GitHub only" and the report says so.
4. Generalization: on Sonnet the code/glossary4 ratio is at least 1.5x (the low end of the
   GitHub blind sets). Below 1.5x but above 1x counts as a weaker carry-over and is reported so.
