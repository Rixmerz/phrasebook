# Preregistration: ablation round (Claude Code, subscription)

Written on 2026-10-28, before any scored run of the ablation arms. Two smoke runs (one task,
Haiku 5.5) checked the harness and are not scored.

Question: glossary4 changes two things at once against native MCP: the command language and
compact results. Which part carries the cost saving?

Arms (`src/arms/ablations.ts`, served through `src/proxy.ts --passthrough=`):
- `native`: the upstream tools as they are.
- `native-compact`: the same tools; JSON results shaped as glossary4 shapes them, no field hidden.
- `native-trimmed`: descriptions cut to their first sentence, parameter descriptions removed.
- `native-trimmed-compact`: both.
- `glossary4`: the v4 runtime through the proxy.

Set: `github-blind3` (16 tasks, written blind, frozen in `results/blind3-freeze.sha256`). The set is
fresh for the ablation arms; glossary4 and native were run on it before (`client-blind3.jsonl`,
Claude Code 2.1.310), so both are rerun here under the same client version.

Runs: `src/client_bench.ts --auth=subscription`, Claude Code 2.1.312, Haiku 5.5 and Sonnet 5.5,
3 reps, every arm with tool search off (`ENABLE_TOOL_SEARCH=false`, the default before 2.1.312).
Costs are what Claude Code reports per run. Code and tasks frozen in
`results/ablation-freeze.sha256` before the run.

Analysis: `src/paper_tables.ts` (cost ratio vs glossary4 with a bootstrap over tasks; exact
McNemar with Holm correction for pass rates).

Predictions:
1. Replication: native costs at least 1.5x glossary4 on both models, interval above 1x.
2. Accuracy: no pass-rate difference against glossary4 is significant after Holm correction.
3. Each ingredient helps: native-compact and native-trimmed each cost less than native
   (point estimates) on both models.
4. The language adds beyond less text: native-trimmed-compact costs at least 1.3x glossary4 on
   Sonnet 5.5, interval above 1x. If refuted, the paper says the saving comes from shorter
   definitions and compact results, not from the command language.

Amendment (2026-10-28, during the run): two Sonnet 5.5 attempts aborted inside the client
(0 turns, no output, cost 0): 58 runs in the first, 169 in the second. Kept apart in
`results/runs/client-ablation-sonnet-aborted*.jsonl`; they are not model outcomes. Haiku 5.5
finished without such aborts. Cause, found on a third attempt: Claude Code left each run's MCP
servers running after it exited; about 240 proxies and 240 GitHub servers filled the container's
16 GB and the system killed later runs (exit 137). `src/client_bench.ts` now stops every process
that carries a run's token when the run ends, and records what the client printed when a run
aborts. Grading is unchanged. Sonnet is rerun in full with concurrency 2. The Haiku runs ran with
the leak but none aborted; they are kept.

## Result (2026-10-28)

Logs: `results/runs/client-ablation.jsonl` (Haiku 5.5), `results/runs/client-ablation-sonnet.jsonl`
(Sonnet 5.5, third attempt). One Sonnet glossary4 run hit a route the fake lacks and is excluded
(it passed). Cost relative to glossary4, 95% bootstrap over tasks:

| model | glossary4 | native | native-compact | native-trimmed | native-trimmed-compact |
|---|---|---|---|---|---|
| Haiku 5.5 | 46/48 | 43/48, 1.89x [1.49, 2.41] | 44/48, 1.58x [1.22, 2.04] | 46/48, 1.63x [1.26, 2.03] | 45/48, 1.24x [0.87, 1.67] |
| Sonnet 5.5 | 47/47 | 48/48, 2.05x [1.44, 2.84] | 45/48, 1.82x [1.21, 2.70] | 48/48, 1.84x [1.34, 2.60] | 45/48, 1.53x [1.03, 2.21] |

Scorecard: (1) held on both models. (2) held: no difference survives Holm. (3) held on both
models. (4) held on Sonnet 5.5, barely (lower bound 1.03); on Haiku 5.5, not predicted, the
interval crosses 1x. All six Sonnet failures of the compact arms are `t3-pct-unassigned-v42`:
the right value (14.3%) after its arithmetic, rejected by the frozen grader.
