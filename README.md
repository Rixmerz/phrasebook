# Phrasebook

A command language for MCP servers. The model gets one tool and a short phrasebook
instead of every tool schema, and a deterministic engine turns each phrase into the
real MCP calls:

```
list issue octo/app state=open labels=bug | group assignees
merge pr octo/app#10 method=squash
create branch octo/app branch=docs/import from=release/4.2
```

The idea: an agent needs the *words* of a system, not one schema per operation.
Verbs are generic; nouns and their values are what the model cannot guess. So a
phrasebook costs far fewer tokens than native tool definitions, grows slowly as tools
are added, and keeps accuracy. Results come back compact, and a small pipeline
(`where`, `select`, `group`, `count`, `sum`, ...) does data work without code.

This repository is both the implementation and the benchmark that tests it against
native MCP tools, code mode and Anthropic's programmatic tool calling.

## Results in brief

Every claim below comes from tasks frozen (sha256) before the arm it tests was run.
Most blind sets were written by an agent that could not see the phrasebook, the engine
or any result. Intervals are 95%. The full record, including refutations, is in
[docs/RESULTS.md](docs/RESULTS.md).

| Claim | Evidence |
|---|---|
| Much smaller context | GitHub MCP, 46 tools: 19,384 tokens of definitions vs 1,719 (11.3x); 91 tools: 15.8x |
| Same accuracy as native and code mode on operations | GitHub, filesystem, git blind sets on Haiku 5.5, Sonnet 5.5, Opus 5.5 |
| Cheaper than code mode on JSON data work | glossary v4: code mode costs 1.6x to 2.8x more on GitHub blind sets (intervals exclude 1x) |
| Cheaper than native tools | Opus 5.5: native 5.1x; inside Claude Code: native 1.8x to 2.5x |
| Small models: a variant that wins | Haiku 4.5, Notion blind sets 4 to 6 (36 tasks, 108 runs per arm): glossary4s 90% [83, 94], native 58% [49, 67], p < 0.001, at 58% of native's cost |
| Holds on real GitHub | live sandbox repo, 12 blind tasks: glossary4 36/36 and 33/36 vs native 31/36 and 29/36 (Haiku 5.5, Sonnet 5.5); native costs 3.3x to 4.2x |

Where it does not win: on small servers that return plain text (filesystem, git) all
arms cost about the same, and code mode is about 2x cheaper on text-file data work.
GitHub with Haiku 4.5 (10 blind tasks): glossary4s 27/30 vs native 23/30, a trend
that is not significant (p = 0.29).

Caveats that matter: most backends are local fakes of the real APIs (GitHub REST and
GraphQL, Notion), plus two rounds on real GitHub; tasks and graders were written by the
authors, so some graders have bugs (documented, left frozen); prompts are in Spanish;
only Claude models were tested.

## How it works

- `src/v3/`: the engine (command parser, references `@n`, pipeline, compact output).
- `src/proxy.ts`: an MCP server that wraps any MCP server and exposes the phrasebook
  as one tool. GitHub uses a hand-written phrasebook; other servers use a generated
  command table (`glossaries/*.json`, from `src/auto/generate.ts`). `--notes=` adds
  instructions and recipes for small models (`glossaries/*-small.json`).
- `src/bench.ts`: direct API benchmark. `src/client_bench.ts`: the same tasks run
  through Claude Code (`claude -p`).
- `src/github/mock.ts`, `src/notion/`: local fakes, one isolated state per run token.

## Running it

```sh
scripts/setup.sh                        # fetch the GitHub MCP server binary
deno test -A src/                       # engine and parser tests, no API calls
deno run -A src/github/count.ts         # definition tokens only

# API key at runtime only, never in the repo: ~/.config/phrasebook/env -> ANTHROPIC_API_KEY=...
deno run -A src/bench.ts --suite=github-blind3 --models=claude-haiku-5-5 --reps=1
deno run -A src/client_bench.ts --auth=subscription --suite=notion-blind6 \
  --models=claude-haiku-4-5 --arms=glossary4s,native --reps=3 --out=results/x.jsonl

# use it with any MCP client
deno run -A src/proxy.ts --name=github --runtime=v4 -- <upstream MCP server command>
```

Analysis: `src/stats.ts` (API runs, cost ratios) and `src/client_stats.ts` (Claude Code
runs, McNemar and bootstrap). Scored runs without transcripts are in `results/runs/`;
full transcripts of the earlier rounds are in `results/logs.tar.gz`.

## Layout

```
src/          engine, proxy, benchmarks, fakes, task sets
glossaries/   phrasebooks and generated command tables
docs/         RESULTS.md (full record), preregistrations, design notes
results/      run logs (*.out), scored runs (runs/), freeze hashes
scripts/      setup and reruns
```

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
