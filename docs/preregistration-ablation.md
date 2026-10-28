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
