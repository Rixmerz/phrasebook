# Preregistration: cross-vendor round on blind set 7 (orchard/beacon)

Written on 2026-10-28, before any model has run on this set. The set, the graders, the runner
and the phrasebook are frozen by `results/crossvendor-freeze.sha256` in the commit that adds this
file. Nothing listed there changes until the round ends. A bug found during the round is reported,
not fixed, unless it is in the harness and affects every arm; then every arm reruns.

## The set

24 GitHub tasks on a seeded repository (`orchard/beacon`: 10 people, 19 labels, 240 issues,
64 PRs, 5 branches): 8 lookups, 8 aggregations, 8 writes graded by final state. They include
three that need all 240 issues, two where the right action is to change nothing, and a prompt
injection hidden in an issue body. Each prompt exists in Spanish and English.

**Authorship.** The set was written by a separate Claude session given only
`docs/blind-task-brief.md`. That session had no access to this repository, its phrasebooks or
any result. It is therefore blind but not human-written. The paper reports it as
Claude-generated. It does not replace the human-written final set in
`docs/preregistration-paper.md`. A model from the same family as the author may find its
phrasing easier, so the paper's comparison is between arms within each model, never between
vendors.

**Conversion.** The prompts and expected values are used exactly as delivered.

- The four delivered files keep their original sha256 (`private/beacon/SHA256SUMS`).
- `private/beacon/tasks.ts` recomputes every expected value from the seed and asserts it against
  `tasks.yaml`.
- Every write grader compares the whole repository (issues, PRs, labels, assignees, comments,
  branches and files) to the seed plus the expected change.
- An oracle run makes the correct calls through the real github-mcp-server, and every write task
  passes on it (`private/beacon/tasks_test.ts`).
- The four assumptions in `ENTREGA.md` hold in the fake GitHub:
  - issues and PRs share numbers;
  - only merges into the default branch close issues: the fake never auto-closes, and the
    seed already reflects past merges;
  - most PR head branches do not exist;
  - every run starts from the seed.

**Privacy.** The set stays out of this public repository (`private/` is git-ignored) and is
handed privately to whoever runs it, until the paper is published.

## Runs

- **Runner.** `src/openai_bench.ts`: any OpenAI-compatible Chat Completions endpoint, talking
  to the same MCP servers as the Claude Code runs. The guide is `docs/runner-guide.md`.
- **Arms (required):** `native`, `glossary4`, `glossary4s`, `code`.
- **Arms (optional):** `native-trimmed-compact`.
- **Models:** at least one OpenAI model, one Google model and one open-weights model. Each
  runner records the exact model id, provider and any `--extra` settings. Defaults: vendor
  default temperature, `--max-turns=20`.
- **Repetitions:** 3 reps per task, arm, model and language, giving 72 runs per arm, model and
  language.
- **Claude baselines** on this set run through `src/client_bench.ts` (Claude Code, subscription)
  and are reported separately, since the client differs.

## Analysis

The analysis is `src/client_stats.ts` as of this commit, per model and language:

- pass rates with Wilson intervals;
- exact McNemar paired by (task, rep), with Holm correction over every comparison within that
  model and language;
- input tokens per run, with a bootstrap over tasks for ratios.

Exclusions:

- Runs with harness gaps are excluded and counted.
- Runs that ended in an API error are rerun. Only the last run of each (model, arm, task, rep)
  counts.
- Nothing else is excluded.

## Predictions

1. **Accuracy.** On each model and language, glossary4 passes at least as many runs as native
   minus 3 (of 72), and no difference between glossary4 and native or code is significant after
   Holm correction.
2. **Tokens.** On each model, mean input tokens per run of native are at least 1.5x those of
   glossary4, with the bootstrap interval above 1x. No USD prediction: prices and caching
   differ across vendors.
3. **Language.** On each model, glossary4's English pass count is within 3 runs of its Spanish
   one.
4. **Small models.** On open-weights models under 20B parameters, glossary4s passes at least as
   many runs as glossary4.
5. **Safety.** On each model, glossary4 passes `s-prompt-injection` in at least as many runs as
   native.

A refuted prediction is reported as refuted.
