# Preregistration (DRAFT): final round for the paper

Draft written on 2026-10-28. Not in force until the task set is frozen and this file is
deposited with an external timestamp (OSF or Zenodo); the deposit link goes here.

Goal: one final version, one fresh set, every arm, run once. This round is the paper's
primary evidence; every earlier round becomes supporting evidence.

Version under test: the v4.3 engine as of the freeze commit, `glossary4` and `glossary4s`.
No engine, phrasebook or notes change after the freeze. A bug found during the run is
reported, not fixed, unless it is in the harness and affects every arm; then every arm reruns.

Tasks: a new GitHub set of at least 24 tasks (8 lookups, 8 aggregations or joins, 8 writes
checked against final state) on a new seeded repo, written by a person who has not seen the
phrasebook, the engine or any result, given only the task format reference. Graders are
written with the tasks and frozen with them. Each prompt in Spanish and in English, written
by the same person; the English set is a second suite, not a second grader.

Arms: `glossary4`, `native`, `code`, `native-compact`, `native-trimmed`,
`native-trimmed-compact` (`src/arms/ablations.ts`), and `ptc` where the model supports it.

Models: Haiku 5.5, Sonnet 5.5, Opus 5.5; Haiku 4.5 with `glossary4s` added; at least one
non-Anthropic model and one open-weights model, through an adapter frozen before the run.

Runs: 3 reps per task, arm, model and language, through the API with caching, as in
`src/bench.ts`. Budget set before the run and enforced with `--usd-cap`.

Analysis: `src/paper_tables.ts` as of the freeze commit. Pass rates with Wilson intervals;
paired exact McNemar with Holm correction over every comparison; cost ratios with a bootstrap
over tasks. No run is excluded except harness gaps, which are reported with their count.

Predictions:
1. Accuracy: on each model, glossary4 is within 2 failed runs per 24 tasks of native and code,
   and no pass-rate difference against it is significant after Holm correction.
2. Cost against native: native costs at least 1.5x glossary4 on every Anthropic model, with
   the interval above 1x.
3. Cost against code mode: code costs more than glossary4 on Sonnet 5.5 and Opus 5.5, with the
   interval above 1x; on Haiku 5.5 a tie is allowed.
4. Ablation: native-trimmed-compact costs at least 1.3x glossary4 on Sonnet 5.5, with the
   interval above 1x (the language contributes beyond shorter text). If refuted, the paper
   says the gain comes from compaction and trimming.
5. Language: on each model, glossary4's English pass count is within 2 runs of its Spanish one.
6. Other vendors: glossary4 is within 3 failed runs of native on each non-Anthropic model.
   No cost prediction: prices and caching differ across vendors.
7. Small model: on Haiku 4.5, glossary4s passes more runs than native.
