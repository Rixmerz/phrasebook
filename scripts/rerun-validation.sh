#!/usr/bin/env bash
# Reruns the 2026-10-24 validation round into results/rerun-*.jsonl. Costs about 13 USD.
set -euo pipefail
cd "$(dirname "$0")/.."
C="--cache --budget=1000000000 --concurrency=6"
ARMS=native,code,ptc,glossary3-feedback
deno run -A src/bench.ts --suite=github-blind --models=claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5 --arms=$ARMS --reps=3 $C --out=results/rerun-blind.jsonl
deno run -A src/bench.ts --suite=github-safety --models=claude-haiku-5-5,claude-sonnet-5-5 --arms=$ARMS --reps=3 $C --out=results/rerun-safety.jsonl
deno run -A src/bench.ts --suite=github-calc --models=claude-haiku-5-5,claude-sonnet-5-5 --arms=ptc --reps=3 $C --out=results/rerun-ptc-calc.jsonl
deno run -A src/bench.ts --suite=github-bulk2 --models=claude-haiku-5-5,claude-sonnet-5-5 --arms=ptc --reps=3 $C --out=results/rerun-ptc-bulk2.jsonl
deno run -A src/bench.ts --suite=github-calc --models=claude-opus-5-5 --arms=code,ptc,glossary3-feedback --reps=2 $C --out=results/rerun-opus-calc.jsonl
deno run -A src/bench.ts --suite=github-bulk2 --models=claude-opus-5-5 --arms=code,ptc,glossary3-feedback --reps=2 $C --out=results/rerun-opus-bulk2.jsonl
deno run -A src/stats.ts results/rerun-*.jsonl
