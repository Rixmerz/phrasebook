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

## Intake (added 2026-10-28, before any run; analysis rules unchanged)

Each returned log is checked with `deno run -A src/xv_check.ts <file>`. It verifies:

- one runner, one model and one suite per file;
- every (arm, task, rep) present exactly once, with the frozen task ids;
- no API-error rows.

A file that passes is copied to `results/runs/` as is. `src/paper_tables.ts` then picks up every
`xv-*.jsonl` and writes `paper/tables/crossvendor.tex`, one block per language.

- Rows are keyed by model and runner, so two people running the same model stay separate.
- The cost column is input plus output tokens per run, as prediction 2 states, not USD.
- If a runner left `--runner` empty, it is filled in from their contribution form; no other
  field is edited.

## Amendment 1 (2026-10-28, before any run): runners with a subscription instead of an API key

Some runners pay for a chat subscription (ChatGPT, Google AI) rather than an API key. They run
the same set through the vendor's own coding CLI, headless, with `src/cli_bench.ts`:

- **Codex CLI** 0.165.0 (ChatGPT login) and **Gemini CLI** 0.66.0 (Google login).
- **Same backend.** The CLI talks to the same MCP servers as the other runners.
- **Built-in tools off.** Each CLI runs in an empty folder with shell, files, web, images,
  sub-agents, skills and plugins turned off. The only tools left are the GitHub server's (or
  the phrasebook's), plus the MCP resource helpers both CLIs add.
- **Tested setup.** This was checked by capturing the requests each CLI sends to a fake model
  API:
  - both CLIs carry out MCP reads and writes;
  - a correct write through each CLI passes its grader.
- **Codex approvals.** Codex refuses unapproved MCP tools in headless mode, so every GitHub tool
  is approved up front (`default_tools_approval_mode="approve"`).
- **Foreign tools.** Any other tool a CLI still uses is logged in `foreign_tools`. Such runs
  count as failed in the log, are excluded from the analysis, are counted, and are reported as a
  setup leak.

Differences from the API runs, stated in the paper:

- **Tokens** are what the CLI reports. They include the CLI's own system prompt, which is the
  same for every arm, so ratios against the phrasebook are diluted toward 1.
- **Code mode** has no CLI equivalent. CLI rows have native, glossary4 and glossary4s, plus
  native-trimmed-compact as an option.
- **Separate rows.** CLI rows are a separate row per (model, runner, CLI) in
  `paper/tables/crossvendor.tex`, never pooled with API rows of the same model.
- **Model id** is the one the runner passes with `--model`, which is required.
- **Usage limits.** Runs cut short by a subscription limit are retried, never scored.

Predictions 1, 3, 4 and 5 apply to CLI rows unchanged. Prediction 2 (tokens, native ≥ 1.5×
glossary4) applies to API rows only. For CLI rows the ratio is reported without a prediction,
because the CLI's fixed prompt shifts it.

The Claude baselines stay with us (`src/client_bench.ts`); runners who only have a Claude
subscription are not needed for this round.

The amendment's code is frozen by `results/crossvendor-freeze-amendment1.sha256`.
