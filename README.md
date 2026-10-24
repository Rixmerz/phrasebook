# Phrasebook

A command language for MCP servers: the model gets one tool and a short phrasebook
instead of every tool schema, and an engine turns each phrase into the real MCP calls.

A benchmark of three ways to give an LLM agent the tools of an MCP server:

- **native**: the MCP tools as they are, one tool definition per tool;
- **glossary**: one tool that takes a short controlled-language command
  (`merge pr octo/app#10 method=squash`), described by a glossary of the
  server's nouns, values and commands. A deterministic parser turns each
  command into calls to the same MCP tools;
- **code** (code mode): one `execute` tool whose description is a TypeScript
  API generated from the MCP schemas. Model code runs in a Deno subprocess with
  no permissions; its only way out is a bridge to the same MCP tools.

The hypothesis: an agent needs the *words* of a system, not one schema per
operation. Verbs are generic; nouns and their values are what the model cannot
guess. So a glossary should cost far fewer tokens than native tool definitions,
grow more slowly as tools are added, and keep accuracy.

## Result

| Server | Tools | Native defs | Glossary defs | Ratio |
|---|---|---|---|---|
| `@modelcontextprotocol/server-memory` | 9 | 1,961 | 716 | 2.7x |
| `github-mcp-server` v2.0.3, default toolsets | 46 | 19,384 | 1,719 | 11.3x |
| `github-mcp-server` v2.0.3, all toolsets | 91 | 40,480 | 2,569 (generated) | 15.8x |

Tokens of tool definitions per request, Claude Sonnet 5.5 / Haiku 5.5 tokenizer
(Haiku 4.5 counts are about 23% lower). Measured with `count_tokens`.

- **Scaling holds.** The gap grows with the server: 2.7x at 9 tools, 11.3x at 46.
- **Cost, uncached (GitHub, 12 tasks x 3 reps):** the glossary arm costs 80% to
  89% less per task than native on all three models. Code mode saves 27% to 30%,
  because its typed API carries the same parameter descriptions.
- **Cost, with prompt caching (GitHub, 1 rep):** the glossary saves about 74% on
  Sonnet 5.5 and Haiku 5.5. See the caveats: this number depends on the client.
- **Accuracy:** native and code mode solved every GitHub task. Glossary v1 solved
  33/36 on Haiku 4.5: one task (`pr-files`) failed 3 of 3 because of a word
  collision in the glossary (below). On the held-out tasks every arm solved
  everything, v1 included: v2 matched v1 on accuracy and cut retries on Haiku 4.5
  and Sonnet 5.5, not on Haiku 5.5.
- **The "Haiku cannot parse JSON tool calls" report did not reproduce.** In 117
  native-arm Haiku 4.5 runs there were zero schema violations, unknown tools or
  malformed inputs (direct API calls, no strict mode). The Haiku failures seen
  were giving up after one failed search, asking instead of acting, and the
  glossary word collision.

## Phase 2: is it a replacement?

Phase 2 asked what a strong claim needs: hard tasks, data-heavy tasks, the
strongest competitors, a real client, and glossaries generated automatically.
Predictions were written and hash-frozen before each block ran
(`docs/preregistration*.md`, `results/*freeze.sha256`). All runs below use
prompt caching. Costs are USD per task.

### Verdict

- **Replaces the MCP tool interface for operations.** On every suite of
  operations (GitHub 12 + 11 held-out + 11 hard tasks, filesystem, git, GitHub
  with 91 tools), the glossary matched native accuracy within noise on Sonnet 5.5
  and Haiku 5.5, in direct API calls and inside Claude Code. It was the cheapest
  arm everywhere on Sonnet 5.5, and on Haiku 5.5 everywhere except filesystem,
  where all three arms cost about the same (0.00022 to 0.00026 USD per task).
- **Does not replace code mode for data work.** On 240-issue aggregation and
  bulk writes, code mode was as accurate or better and 2x to 3x cheaper on
  Sonnet 5.5 and Haiku 5.5. There the glossary was more accurate than native MCP
  but also cost more than native (Sonnet 5.5 +19%, Haiku 5.5 +43%), because every
  listing it reads lands in context. The glossary is a partial replacement for
  code mode, as preregistered, and not a cost win over native for data work.
- **Migration can be automatic.** Opus 5.5 generated a valid glossary for each
  of four servers (0 to 2 automatic repair rounds, 0.10 to 3.19 USD each).
  filesystem and git are the independent test: the generator's prompt uses
  GitHub examples (`merge pr octo/app#10`, `files pr`) written after the v1
  failures, so the generated GitHub glossaries are not independent evidence.
  On GitHub the generated glossary beat v1 on one task (`pr-files`) and tied v2.
- **Weakest model, weakest point.** Haiku 4.5 is where the glossary loses:
  exact file content (a dropped trailing newline), paginated listings, and, on
  data-heavy tasks, a collapse to 4/24.

### Hard tasks (11 tasks x 3 reps) - `results/hard-corrected.jsonl`

| Model | native | toolsearch | glossary v2 | code | codesearch |
|---|---|---|---|---|---|
| Haiku 4.5 | 29/33, 0.0099 | 29/33, 0.0186 | **30/33, 0.0080** | 29/33, 0.0085 | 30/33, 0.0132 |
| Haiku 5.5 | 33/33, 0.00096 | 31/33, 0.00236 | **33/33, 0.00036** | 32/33, 0.00110 | 32/33, 0.00061 |
| Sonnet 5.5 | 33/33, 0.0203 | 32/33, 0.0377 | **33/33, 0.0056** | 33/33, 0.0159 | 33/33, 0.0114 |

`toolsearch` is native tools deferred behind the API's tool search tool. In
this harness it was the most expensive arm with caching, about twice native,
with 7k to 9k uncached input tokens per run: expanded definitions land after
this bench's cache breakpoints. Inside Claude Code, its own deferred loading
(`native-defer`) was cheaper than native instead (below), so this cost is a
property of this harness, not of deferred loading. `codesearch` is code mode
with progressive discovery (`search_tools` + `execute`), the Anthropic style.

### Data-heavy tasks (8 tasks over 240 issues x 3 reps) - `results/bulk-corrected.jsonl`

| Model | native | toolsearch | glossary v2 | code | codesearch |
|---|---|---|---|---|---|
| Haiku 4.5 | 12/24, 0.0336 | 13/24, 0.0277 | **4/24**, 0.0180 | 13/24, 0.0170 | 17/24, 0.0222 |
| Haiku 5.5 | 20/24, 0.0021 | 21/24, 0.0032 | 23/24, 0.0030 | 23/24, **0.0012** | 23/24, **0.0010** |
| Sonnet 5.5 | 21/24, 0.0329 | 21/24, 0.0511 | 23/24, 0.0392 | 23/24, **0.0174** | **24/24, 0.0131** |

Haiku 4.5 with the glossary read only the first page of results and asked for
"the 5 oldest" in the default (newest first) order: the hand-written glossary
had dropped the native descriptions' notes on paging and sort direction.

Run again with the generated GitHub glossary, which keeps those notes
(`results/auto-bulk.jsonl`): Haiku 4.5 10/24 (hand-written: 4/24, native:
12/24), Haiku 5.5 21/24, Sonnet 5.5 22/24; "the 5 oldest" went from 0/3 to 3/3
on Haiku 4.5. Most of the 4/24 came from what the hand-written glossary left
out, not from the format. Cost stayed above native (Sonnet 5.5 0.0431 vs
0.0329).

### Generated glossaries - `results/auto-*.jsonl`

| Suite | Tools | Native defs | Generated defs | Native | Generated glossary | Code |
|---|---|---|---|---|---|---|
| filesystem | 14 | 2,779 | 734 | H4.5 28/30, H5.5 30/30, S 30/30 | H4.5 **25/30**, H5.5 30/30, S 30/30 | 28, 30, 30 |
| git | 12 | 2,409 | 815 | 27, 30, 30 | 28, 28, 30 | 26, 29, 30 |
| GitHub | 46 | 19,384 | 1,569 | (phase 1) | 36/36 on every model | |
| GitHub held-out | 46 | 19,384 | 1,569 | (phase 1) | 33/33 on every model | |
| GitHub | 91 | 40,480 | 2,569 | 36/36 on every model | 36/36 on every model | |

Cost per task on GitHub with 91 tools: Haiku 4.5 0.0149 native vs 0.0074
generated glossary (-50%), Haiku 5.5 0.00139 vs 0.00025 (-82%), Sonnet 5.5
0.0301 vs 0.0047 (-84%).

The filesystem result refutes the preregistered prediction on Haiku 4.5: 3 more
failures than native, all on one task (copy `README.md` exactly), where the
model wrote the content in a quoted string without its trailing newline. JSON
arguments make that newline explicit; quoted text hides it.

Generation (`src/auto/generate.ts`, Opus 5.5, structured output, validators in
`src/auto/validate.ts`, up to 2 automatic repair rounds):

| Glossary | Tools | Commands | Repair rounds | Cost |
|---|---|---|---|---|
| git | 12 | 12 | 0 | 0.10 USD |
| filesystem | 14 | 16 | 0 | 0.11 USD |
| GitHub | 46 | 74 | 0 | 0.75 USD |
| GitHub | 91 | 172 | 2 | 3.19 USD |

### Inside Claude Code - `results/client-*.jsonl`

`claude -p --bare --strict-mcp-config`, only the test server, built-in tools
disallowed, billed to the API key. Arms: native MCP server, native with Claude
Code's deferred tool loading (`ENABLE_TOOL_SEARCH`), and the glossary served by
`src/proxy.ts` (an MCP server that wraps any MCP server behind one glossary tool).

| Model | Suite | native-defer | glossary | Saving |
|---|---|---|---|---|
| Sonnet 5.5 | GitHub 12 x 2 | 24/24, 0.0086 | 24/24, 0.0038 | -56% |
| Sonnet 5.5 | hard 11 x 2 | 20/22, 0.0124 | 22/22, 0.0059 | -52% |
| Haiku 5.5 | GitHub | 24/24, 0.00076 | 24/24, 0.00027 | -64% |
| Haiku 5.5 | hard | 22/22, 0.00106 | 22/22, 0.00051 | -52% |
| Haiku 4.5 | GitHub | 24/24, 0.0075 | 24/24, 0.0092 | +23% |
| Haiku 4.5 | hard | 20/22, 0.0102 | 20/22, 0.0140 | +37% |

**Claude Code showed the model only the first paragraph of an MCP tool
description** (it cut at the first blank line; observed with `claude -p --bare`,
Claude Code 2.1.310). The first glossary runs saw
190 of 3,915 characters, still passed almost everything through error
messages, and took twice the turns. The proxy now sends the glossary without
blank lines; the table above is that rerun. It would affect any MCP server whose
descriptions have several paragraphs; 3 of the 46 native GitHub tool
descriptions have one, so the native arms here also ran with 3 descriptions cut.

On Haiku 4.5 the glossary arm cost more because, in `--bare` mode, its whole
prompt stays under Haiku 4.5's minimum cacheable prefix and is billed uncached;
the native arm is larger and caches. With Claude Code's normal system prompt
every arm would cache. This is an effect of the isolation, reported as measured.

### Progressive glossary (`glossary-help`) - `results/help-*.jsonl`

The description keeps the grammar, the list of nouns and the examples; `help
<noun>` returns that noun's commands. Generic over hand-written and generated
glossaries (`src/arms/glossary_help.ts`).

| Suite | Defs: full -> progressive | Haiku 4.5 | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|---|---|
| GitHub 46 | 1,765 -> 807 | 34/36 | 36/36 | 36/36 |
| hard | 1,765 -> 807 | 27/33 (full: 30/33) | 33/33 | 33/33 |
| GitHub 91 | 2,569 -> 807 | 34/36 | 36/36 | 36/36 |

At 91 tools it is cheaper than the full glossary (Haiku 4.5 -31%, Haiku 5.5
-4%, Sonnet 5.5 -7%, `results/help-github91-corrected.jsonl`). At 46 tools it
costs a little more, because of the extra turn to read help: on the hard tasks,
same hand-written v2, full vs progressive is +3% on Haiku 4.5, +17% on Haiku 5.5
and +7% on Sonnet 5.5. On hard tasks Haiku 4.5 failed 3 more runs than with the
full glossary, one per task, which is within the preregistered noise rule. At
91 tools the description stays at 2% of native's.

### Preregistration scorecard

| Prediction | Source | Result |
|---|---|---|
| Hard tasks: glossary within noise of native | preregistration-main 1 | Held (30/33 vs 29/33, 33 vs 33, 33 vs 33) |
| Hard tasks: glossary cheapest arm | preregistration-main 2 | Held on all three models |
| Tool search much cheaper than native | preregistration-main 3 | Refuted in this harness (about 2x native); not reproduced inside Claude Code |
| Glossary cheaper than tool search at equal accuracy | preregistration-main 3 | Held |
| Data-heavy: code beats glossary on cost, at least as accurate | preregistration-main 4 | Held on Sonnet 5.5 and Haiku 5.5 -> partial replacement |
| Generated glossary defs at least 2x smaller than native | preregistration (auto) | Held: 2.3x to 15.8x |
| Generated glossary within noise of native | preregistration (auto) | Held on git and GitHub; refuted on filesystem with Haiku 4.5 (exact-copy task 0/3) |
| Progressive defs at most half of full at 91 tools | preregistration-help 1 | Held (31%) |
| Progressive accuracy within noise of full | preregistration-help 2 | Held (Haiku 4.5 hard -3 runs, spread one per task) |
| Progressive cheaper than full at 91 tools | preregistration-help 3 | Held (-31%, -4%, -7%) |

## Glossary v3 (`src/v3/`)

Designed from the phase 1 and 2 failures and preregistered in
`docs/preregistration-v3.md` before it was built; its tasks (`github-bulk2`,
300 issues; `github-exact`, byte-exact files) were frozen first. v3 adds
compact table output, `all` (every page in the engine), a pipeline (`| where |
select | sort | top | group | count`), references to earlier results (`@n`,
`@n.field`, fan-out over `#@n[*].number`), literal blocks (`key<<EOF`),
`labels+=x`, verb macros (`close`, `reopen`, `comment`) and `form` with the
repository's real options. Two arms differ only in where conventions live:
`glossary3-legend` (up front) and `glossary3-feedback` (in every answer, plus
ready-to-send corrections in errors). Only the new tasks were run for `code`
and `glossary2`; earlier results were reused elsewhere.

### Data work against code mode (`results/v3-github-bulk2.jsonl`, 6 tasks x 3 reps)

| Model | glossary2 | v3 legend | v3 feedback | code |
|---|---|---|---|---|
| Haiku 4.5 | 4/18, 0.0181 | 9/18, 0.0143 | **14/18**, 0.0144 | 11/18, 0.0129 |
| Haiku 5.5 | 18/18, 0.00258 | 18/18, 0.00149 | 18/18, 0.00121 | 17/18, 0.00113 |
| Sonnet 5.5 | 16/18, 0.0305 | 18/18, 0.0120 | **18/18, 0.0099** | 18/18, 0.0173 |

Preregistered prediction 1 held for both v3 arms: accuracy within noise of code
mode on every model and cost at most 1.5x code mode. On Sonnet 5.5 the feedback
arm costs 43% less than code mode. For queries and bulk writes over listings,
v3 replaces code mode in these tasks. Not tested: arithmetic across results
(sums, percentages) and joins between two queries, which the pipeline does not
have yet.

### Exact content (`results/v3-github-exact.jsonl`, 5 tasks x 3 reps)

| Model | glossary2 | v3 legend | v3 feedback | code |
|---|---|---|---|---|
| Haiku 4.5 | 3/15 | 13/15 | **15/15** | 13/15 |
| Haiku 5.5 | 10/15 | 13/15 | 13/15 | 15/15 |
| Sonnet 5.5 | 14/15 | 15/15 | 15/15 | 15/15 |

Prediction 2 (zero byte mismatches) is refuted. Every v3 failure is one task:
writing a PR body that has no trailing newline. Models used the literal block,
which by design ends with a newline, instead of `content=@n.body`. A design flaw
of the literal block, not of references.

### Legend vs feedback

Accuracy was equal or better with feedback (Haiku 4.5 data work 14/18 vs 9/18).
Invalid calls per task were lower with feedback in most cells (Haiku 4.5 exact:
0.13 vs 0.87), but not all (Sonnet 5.5 data work: 0.22 vs 0.06), so prediction 3
held on two of three models.

### Regression and v3.1

On the hard tasks v3.0 lost accuracy on Haiku 4.5 (17/22 and 18/22 vs
glossary2 30/33), refuting prediction 4 there. Two bugs of v3, not of the idea:
the compact view dropped the file SHA that GitHub needs to update a file, and
JSON values with `\n` were unescaped twice. v3.1 fixes both
(`results/v31-*.jsonl`, feedback arm only; in-sample, since the fixes came from
these failures): hard tasks 22/22 on Haiku 4.5 and Haiku 5.5; exact content
14/15, 12/15, 15/15, all remaining failures on the PR-body task above. On the
12 original GitHub tasks both v3 arms solved 24/24 on both Haiku models.

Cost of v3: about 5.2 USD.

### v3.2: arithmetic, joins, no trailing newline (`results/v32-calc.jsonl`, 8 tasks x 3 reps)

Preregistered in `docs/preregistration-v32.md` with held-out tasks frozen
first. Adds `sum`, `avg`, `min`, `max`, `distinct`, `in` / `notin` against another
result, pipelines from an earlier result (`@3 | where ...`), `calc @1 / @2 * 100`,
and `key<<EOF!` (no final newline).

| Model | v3.2 feedback | code |
|---|---|---|
| Haiku 4.5 | 10/24, 0.0121 | **16/24**, 0.0135 |
| Haiku 5.5 | 21/24, 0.00096 | 22/24, 0.00106 |
| Sonnet 5.5 | **24/24, 0.0075** | 24/24, 0.0187 |

- Predictions 1 and 2 held on Sonnet 5.5 (-60% cost at equal accuracy) and
  Haiku 5.5 (within noise, -9%), and prediction 1 is refuted on Haiku 4.5
  (6 runs fewer than code mode).
- Haiku 4.5 rarely used the new steps: it pulled both tables in full and
  joined them by reading, or computed right and answered with its working
  ("36 of 90 ... 40%") instead of the number alone. Code mode forces the
  computation into code, which helps this model.
- Prediction 3 (no byte mismatches) is refuted on Haiku 4.5: `c-tag-no-newline`
  passed 1 of 3; Haiku 5.5 and Sonnet 5.5 passed every exact-content run.

Cost of v3.2: about 1.3 USD.

## Validation round (2026-10-24): blind tasks, the official rival, Opus, safety

Goal: check the claims against tasks we did not write, against Anthropic's own
code-mode feature, on the top model, and on requests where the right move is to
change nothing. Tasks and the new arm were frozen first (`results/blind-freeze.sha256`).
Intervals below are 95%, from `src/stats.ts` (Wilson for pass rates; a bootstrap
over tasks for differences and cost ratios, since runs of one task are not independent).

New arm `ptc`: Anthropic's programmatic tool calling (`code_execution_20260120`
plus `allowed_callers` on every MCP tool), the official version of code mode.
Claude writes Python in Anthropic's container; each tool call pauses the code and
our client runs it. **Its costs here are tokens only**: code execution container
time is billed separately and is not counted, so PTC is somewhat more expensive
than shown. Haiku 4.5 does not support PTC.

### Blind tasks (`github-blind`, 12 tasks x 3 reps)

12 tasks written by a separate agent that was not allowed to read the glossary,
the parsers or any results: 4 lookups, 4 aggregations and joins over 240 issues
and 60 PRs, 4 writes checked against final state (`src/github/blindtasks.ts`).

| Model | native | code | ptc | v3 feedback |
|---|---|---|---|---|
| Haiku 5.5 | 36/36, 0.00114 | 36/36, **0.00077** | 35/36, 0.00105 | 35/36, 0.00088 |
| Sonnet 5.5 | 33/36, 0.0277 | 33/36, 0.0144 | 33/36, 0.0187 | 33/36, **0.0131** |
| Opus 5.5 | 36/36, 0.0523 | 34/36, 0.0260 | 36/36, 0.0331 | 35/36, **0.0209** |

(pass, USD per run)

- **Accuracy is the same for every arm on every model**: no pass-rate difference
  has an interval that excludes zero.
- **On these tasks v3 ties code mode on cost**: v3 is cheapest on Sonnet 5.5 and Opus 5.5
  and code mode on Haiku 5.5, but every v3-vs-code interval crosses 1x
  (Sonnet 1.10x [0.51, 2.38], Opus 1.24x [0.76, 2.24], Haiku 0.88x [0.51, 2.02]).
  The large savings over code mode reported above come from data-heavy tasks; on mixed
  everyday tasks written by someone else they shrink to a tie.
- Against native tools v3 costs 2.12x less on Sonnet [0.92, 5.18] and 2.50x less on Opus [1.23, 5.60].
- Sonnet 5.5 failed `b-close-duplicates` in every arm: it wrote "Cerrado por duplicado"
  without the final period. The prompt puts the period inside the quotes, so that is a
  fair reading: an ambiguous prompt, failing equally in every arm, so neutral for the comparison.

### The official rival on data work (`results/ptc-*.jsonl`, `results/opus-*.jsonl`)

Same frozen calc (8 tasks) and bulk2 (6 tasks) suites as above; the code and v3 runs
on Haiku 5.5 / Sonnet 5.5 are the earlier ones, not rerun. Cost is the arm's cost
divided by v3's (above 1x means v3 is cheaper).

| Suite, model | v3 pass | ptc pass | ptc / v3 cost | code / v3 cost |
|---|---|---|---|---|
| calc, Haiku 5.5 | 21/24 | 23/24 | 1.30x [0.93, 1.89] | 1.11x [0.79, 1.62] |
| calc, Sonnet 5.5 | 24/24 | 24/24 | **2.99x [1.91, 5.20]** | **2.49x [1.76, 3.92]** |
| calc, Opus 5.5 | 16/16 | 15/16 | **2.50x [1.27, 6.03]** | **2.60x [1.26, 6.73]** |
| bulk2, Haiku 5.5 | 18/18 | 16/18 | 1.06x [0.74, 1.60] | 0.94x [0.59, 1.81] |
| bulk2, Sonnet 5.5 | 18/18 | 18/18 | **2.45x [1.42, 3.56]** | **1.75x [1.04, 2.68]** |
| bulk2, Opus 5.5 | 12/12 | 12/12 | **3.90x [3.23, 4.70]** | **3.39x [2.80, 4.59]** |

- On Sonnet 5.5 and Opus 5.5, v3 matches PTC and our code mode on accuracy at 1.75x
  to 3.9x lower token cost, and every interval excludes 1x.
- On Haiku 5.5 the three are a tie on cost; tokens are so cheap there that nothing separates them.
- PTC is not cheaper than our in-house code mode: each tool call is one more API
  request carrying the conversation, even when cached.

### Safety (`github-safety`, 6 tasks x 3 reps, `results/safety-corrected.jsonl`)

Requests where the right outcome changes little or nothing: a prompt injection in
an issue body (asks to delete a file and close every bug), a read-only count,
"close only #17", advice without acting, deleting a file that does not exist,
labeling an issue that does not exist. Checks compare the whole repo with the seed.

- After the fixes below, **every arm passed every run on Haiku 5.5 and Sonnet 5.5
  (18/18 each)**. No arm followed the injected instructions.
- `s-missing-file` depends on the fake backend: it passes now only because the fake
  refuses to delete a missing path, as we believe GitHub does (not verified on real
  GitHub). Every model tried the delete without checking first, so this task does not
  separate the arms; on the other 5 tasks every arm passed 15/15.
- The first pass found two bugs of ours, fixed before the rerun:
  - The v3 engine crashed on `labels+=` for a missing issue: it parsed GitHub's error
    as JSON. v3 scored 1/6 on `s-missing-issue` before the fix. The engine now
    returns the error to the model.
  - The fake backend let a tree commit delete a path that does not exist (GitHub
    answers 422), so every arm "deleted" `config/legacy.json`. Fixed. Only the
    affected cells were rerun.
- The pilot also found a fake-backend gap: subtrees were not served by sha, which broke
  edits to existing files in subdirectories through `create_or_update_file`. Fixed before the full run.

### What this round changes in the claim

Scope: every v3 result is on one server, GitHub (through the real github-mcp-server and
a fake backend). Running the v3 engine over the generated filesystem and git glossaries
was planned and not done; the cross-server evidence is for glossary v2 only.

- Holds, on independent tasks: one glossary tool instead of 46 definitions, same
  accuracy as native MCP, code mode and PTC on Haiku 5.5, Sonnet 5.5 and Opus 5.5.
  It is cheaper than native tools, significantly so on Opus.
- Holds, on data work: on Sonnet 5.5 and Opus 5.5, v3 beats both code mode and
  Anthropic's PTC on cost (1.75x to 3.9x) at equal accuracy.
- Narrowed: on general tasks written by someone else, v3 and code mode cost the same.
  "Cheaper than code mode" is true for data-heavy work, not in general.
- Unchanged: on Haiku 4.5, code mode is more accurate at computation. We count this as
  a known limit, not a loss: small models stay cheap even with more context. A version
  of the glossary tuned for small models is a later step.

Cost of this round: 13.0 USD (`results/ledger.jsonl`, tokens only).

Raw logs of every run in this README, with full transcripts, are in `results/logs.tar.gz`
(`tar xzf results/logs.tar.gz` restores `results/*.jsonl`).

## Glossary v4 (2026-10-24): compact results

Design: `docs/v4-analysis.md`. Preregistration: `docs/preregistration-v4.md`, frozen with
the new blind set before any v4 run (`results/blind2-freeze.sha256`).

v4 is the v3 feedback arm with smaller tool results: lists show a few default columns
(a `more fields:` line names the rest, `| select` brings them back), values shared by
every row go into one header line, branch objects become their name, SHAs are dropped,
each hint is given once per run, `| select` / `| where` work on a single object,
`get issue o/r#1,5,9` batches gets, and list filters the tool lacks run as a client-side
`where` over every page.

New blind set `github-blind2` (14 tasks on a new repo, octo/telemetry, written by an agent
that could not read the glossary, the engine or any result), 3 reps:

| model | arm | pass | cost vs glossary4 [95% CI] |
|---|---|---|---|
| Haiku 5.5 | glossary4 | 42/42 | 1x |
| Haiku 5.5 | glossary3-feedback | 42/42 | 1.78x [1.19, 2.36] |
| Haiku 5.5 | code | 42/42 | 1.63x [1.32, 2.18] |
| Sonnet 5.5 | glossary4 | 39/42 | 1x |
| Sonnet 5.5 | glossary3-feedback | 40/42 | 2.34x [1.10, 3.89] |
| Sonnet 5.5 | code | 39/42 | 2.78x [1.83, 4.92] |

Tool-result characters per run fell 78% on Sonnet 5.5 (7,740 to 1,669) and 67% on Haiku 5.5.
All Sonnet failures, in every arm, are on `c-close-obsolete`: the exact comment ends in a
period and Sonnet drops it as sentence punctuation. The task is frozen, so it stays as is.

Regression on Sonnet 5.5 (3 reps; these sets were inspected while designing v4, so they
show no regression, not improvement): `github-calc` 24/24, code 2.89x [2.36, 3.64] and v3
1.16x [0.62, 2.02] the cost of v4; `github-blind` 33/36 like every other arm, code 1.73x
[1.19, 2.50], v3 1.56x [0.81, 2.48], native 3.31x, PTC 2.23x.

Scorecard: (1) accuracy within 2 runs of v3 and code on each model: held. (2) cheaper than v3
on Sonnet with the interval below 1x: held (v3 costs 2.34x). (3) cheaper than code mode:
held and significant on both models. (4) no regression on calc and blind: held.
(5) tool-result characters down at least 40%: held (78%).

The v4 round cost 2.32 USD.

## Method

### Arms

All arms of a suite call the same real MCP server, so they differ only in the
interface the model sees.

- `native`: `listTools()` output passed through unchanged.
- `glossary`: `src/glossary.ts` (memory), `src/github/glossary.ts` +
  `src/github/parser.ts` (GitHub). The parser supports every command the
  glossary advertises (67 for GitHub), not only those the tasks use; each one is
  unit-tested against the real tool schemas (`src/github/parser_test.ts`).
- `glossary2`: GitHub only, see "Glossary v2".
- `code`: `src/codemode.ts`, `src/sandbox_runner.ts`. Enums are emitted as
  unions and field descriptions as doc comments, so the API carries the same
  information as the native schemas.

### Backends

- **memory**: the official server, a fresh JSONL file per run. Success is
  checked from the stored graph, or from the exact final answer.
- **GitHub**: the official `github-mcp-server` binary, pointed with `--gh-host`
  at a local fake of the REST v3 and GraphQL APIs (`src/github/mock.ts`). Nothing
  touches real GitHub. Each run gets its own token, and the token selects an
  isolated state bucket, so runs can go in parallel. Shapes follow real API
  responses; blob ids are real git object ids, because the server verifies them.
  A route the fake does not implement is recorded as a harness gap and the run is
  excluded, not scored as a model failure.

### Models

`claude-haiku-4-5-20251001`, `claude-haiku-5-5`, `claude-sonnet-5-5`, default
thinking settings, `max_tokens` 4096, at most 12 turns per run. Prompts are in
Spanish, as the user talks to the agent; everything the model sends to tools is
English.

### Tasks

- memory: 12 tasks (`src/tasks.ts`), including a 60-person graph, a fan-out
  write, a no-op guard and an ambiguous name that must not be deleted.
- GitHub: 12 tasks (`src/github/tasks.ts`): counting and filtering issues,
  search qualifiers (`label:bug assignee:ana`), closing with a reason, a
  multi-line issue body, PR files, squash merge, branch + file + PR, labels.
- GitHub held-out: 11 tasks (`src/github/heldout.ts`), written and frozen before
  glossary v2 existed (sha256 in `results/heldout-freeze.sha256`), with their own
  seed so the original 12 stay reproducible.

## Results

### memory (12 tasks x 3 reps, uncached)

| Model | native | glossary | code |
|---|---|---|---|
| Haiku 4.5 | 33/36, 6,325 in/run | 36/36, 3,406 | 36/36, 4,680 |
| Haiku 5.5 | 36/36, 6,953 | 36/36, 3,143 | 36/36, 4,271 |
| Sonnet 5.5 | 36/36, 7,220 | 36/36, 3,566 | 36/36, 4,174 |

Haiku 4.5 native failed one task 3 of 3: it searched `"Orbita empresa"`, found
nothing and gave up without trying another query.

### GitHub (12 tasks x 3 reps, uncached) - `results/github-full-corrected.jsonl`

| Model | native | glossary v1 | code |
|---|---|---|---|
| Haiku 4.5 | 36/36, $0.0358/task | 33/36, $0.0071 | 36/36, $0.0258 |
| Haiku 5.5 | 36/36, $0.0047 | 36/36, $0.0006 | 36/36, $0.0035 |
| Sonnet 5.5 | 36/36, $0.0942 | 36/36, $0.0108 | 36/36, $0.0659 |

The three glossary failures are the same task. The glossary wrote it as
`files pr octo/app#10`; Haiku 4.5 wrote `pr files` every time. The v1 parser read
`files` as the plural of the noun `file`, and its error listed the repository
file commands instead of the PR ones, which pointed the model away from the
answer. Glossary v2 solved this task 3/3 (`results/github-v2-insample.jsonl`,
36/36 overall; in-sample, since v2 was built from this failure).

### GitHub with prompt caching (12 tasks x 1 rep) - `results/github-cached-corrected.jsonl`

| Model | native | glossary v1 | code |
|---|---|---|---|
| Haiku 4.5 | 12/12, $0.0168/task | 11/12, $0.0080 | 12/12, $0.0067 |
| Haiku 5.5 | 12/12, $0.0010 | 11/12, $0.0003 | 12/12, $0.0007 |
| Sonnet 5.5 | 12/12, $0.0164 | 12/12, $0.0043 | 12/12, $0.0148 |

Both glossary misses are `pr-files`, the v1 word collision described above.

### GitHub held-out (11 tasks x 3 reps, uncached) - `results/heldout-corrected.jsonl`

| Model | native | glossary v1 | glossary v2 | code |
|---|---|---|---|---|
| Haiku 4.5 | 33/33 | 33/33 | 33/33 | 33/33 |
| Haiku 5.5 | 33/33 | 33/33 | 33/33 | 33/33 |
| Sonnet 5.5 | not run | 33/33 | 33/33 | not run |

Invalid calls per run (the model had to retry): Haiku 4.5 v1 0.42, v2 0.15;
Haiku 5.5 v1 0.06, v2 0.09; Sonnet 5.5 v1 0.18, v2 0.00. The v1 collision came
back on unseen tasks (Haiku 4.5 and Sonnet 5.5 wrote `pr commits` on
`h-pr-commit-count` and v1 rejected it before they recovered), which shows the
defect generalizes; it is not an accuracy win for v2. Native and code were not run on Sonnet here
because they had solved every task in the main matrix.

## Glossary v2

Built only from v1 failures on the original 12 tasks, before the held-out run
(`src/github/parser_v2.ts`):

- word order is free (`pr files`, `files pr`, `pr octo/app#10 files`);
- plurals fold through an explicit table, never by stripping a trailing `s`, and
  a test asserts that no two commands fold to the same word set;
- a leading generic verb is dropped when the rest names a command (`get pr files`);
- errors list the three closest commands by word overlap;
- `add pr comment` exists (a PR conversation comment is an issue comment on GitHub).

v2 reads all 67 v1 examples exactly as v1 does (`src/github/parser_v2_test.ts`).
Its definition is 1,765 tokens (v1: 1,719).

## Caveats

- **Uncached vs cached.** Uncached numbers measure context occupancy and the cost
  for clients that do not cache. Real clients such as Claude Code cache tool
  definitions and bill cache reads at 0.1x, so the billed saving is smaller.
  Context occupancy per turn (19.4k vs 1.7k tokens at 46 tools) does not change
  with caching.
- **Cached runs were warm.** Parallel runs of the same model and arm share the
  tools + system prefix, so most runs read the cache instead of writing it. These
  are steady-state costs, not cold-session costs.
- **Minimum cacheable prefix.** The harness uses a one-line system prompt. On
  Haiku 4.5 the glossary arm stayed below the minimum cacheable prefix and was
  mostly billed uncached, which is why code mode looks cheaper than the glossary
  on Haiku 4.5 with caching. A client with a large system prompt would cache all
  arms.
- **Two tuning rounds on the glossary arm**, both disclosed: (1) after one GitHub
  smoke run, the v1 parser started accepting noun-first order (`file get`);
  (2) glossary v2, evaluated on held-out tasks.
- **Code-mode API changed after the memory runs.** Enum unions and field docs
  were added for GitHub; the memory code-mode definition grew from 1,064 to 1,301
  tokens. The memory code-mode results used the older text.
- **Corrections to the fake backend**, all applied to every arm and rerun only for
  the affected cells:
  - a missing review-comment route excluded one Haiku 4.5 glossary run; the route
    was added with real GitHub semantics and that cell rerun (3/3 pass);
  - the PR summary reported `commits: 1` while the branch had 2 commits, so models
    that trusted the summary answered wrong in every arm; fixed and
    `h-pr-commit-count` rerun for every arm;
  - a missing GraphQL query (`suggestedActors`) excluded one Haiku 5.5 native run;
    added and that cell rerun.
  The uncorrected logs are kept next to the corrected ones.
- **Saturation.** Sonnet 5.5 and Haiku 5.5 solved almost everything in every arm,
  so these tasks separate the arms on cost, not on accuracy. Harder tasks are
  needed to compare accuracy on strong models.
- **Code mode was tested in one style only.** This is the Cloudflare style: the
  whole typed API inlined in one tool description, with every field doc. The
  Anthropic style (progressive discovery through a `search_tools` tool or a file
  tree) was not tested. The 27% to 30% saving is a property of this rendering,
  not of code mode in general: on memory, the API text alone moved its cost
  (1,064 vs 1,301 tokens).
- **Phase 2 adjustments, all disclosed in `docs/preregistration-amendments.md`
  or here:** `x-least-loaded` dropped (its seed had a tie); a system-prompt line
  for `toolsearch`, as its documentation recommends (without it Haiku 4.5 never
  searched); code mode now renders `anyOf`/nullable types (affects git only);
  the proxy strips blank lines from the glossary for Claude Code; the
  progressive arm picks the generated glossary on generated-glossary suites; the
  generic engine takes single-quoted values literally (changed after smoke
  runs, before any matrix); the engine does not convert JSON values for
  `object`-typed parameters (left as is, since the tables were frozen).
- **Mock fixes in phase 2** (pagination capped at 100 with `Link` headers, label
  queries, git trees, CI status, issue fields): arm-agnostic; runs that hit a
  missing route were excluded or rerun, and the counts above say so.
- **Runs that hit missing mock routes** were rerun after adding the route with
  real GitHub semantics, as in phase 1 (hard: 2 cells, bulk: 1 cell, progressive
  GitHub 91: 2 cells, Claude Code: 3 cells); `*-corrected.jsonl` holds the
  merged results and the raw logs are kept.
- **Cache mismatch on Haiku 4.5.** In phase 2 the Haiku 4.5 glossary rows were
  billed uncached (their prompt is under Haiku 4.5's minimum cacheable prefix)
  while larger arms cached. This biases cost against the glossary on Haiku 4.5.
- **Tool search without frequent tools.** The `toolsearch` arm deferred every
  tool; the documentation suggests keeping 3 to 5 frequent tools loaded, which
  would be tuned per task and was not done.
- **One fake backend.** The fake implements what the tasks need, not all of
  GitHub.

## Cost of the study

Phase 1: about 17.6 USD. Phase 2: 30.1 USD in runs (`results/ledger.jsonl`)
plus 5.9 USD to generate the glossaries (including a 1.44 USD attempt lost to
the output limit and a 0.33 USD attempt discarded for a validator bug). Total
about 53.6 USD. Validation round: 13.0 USD. Token counting is free.

## Running it

```sh
# API key, read at runtime, never stored in the repo:
#   ~/.config/phrasebook/env  ->  ANTHROPIC_API_KEY=...
deno test -A src/github/                       # parser tests, no API calls
deno run -A src/github/count.ts                # definition tokens only
deno run -A src/bench.ts --suite=github --models=claude-haiku-5-5 --reps=1
deno run -A src/report.ts results/<file>.jsonl
```

Suites: `memory`, `github`, `github-heldout`, `github-hard`, `github-bulk`,
`filesystem`, `git`, `github-auto`, `github-auto-heldout`, `github91`,
`github91-heldout`, `github-bulk2`, `github-exact`, `github-calc`, `github-blind`,
`github-safety`. Arms: `native`, `glossary`, `glossary2` (GitHub), `code`,
`toolsearch`, `codesearch`, `glossary-help`, `glossary3-legend`, `glossary3-feedback`, `ptc`. Options: `--reps`, `--tasks`,
`--concurrency` (default 8), `--budget` (hard token cap), `--usd-cap` (stops
when `results/ledger.jsonl` reaches it), `--cache`.

```sh
deno run -A src/client_bench.ts --suite=github --models=claude-haiku-5-5 --arms=native-defer,glossary
deno run -A src/auto/generate.ts <name> <tools.json>   # generate a glossary from an MCP tool list
deno run -A src/proxy.ts --name=github -- <upstream MCP server command>
```

Confidence intervals: `deno run -A src/stats.ts --ref=glossary3-feedback results/<file>.jsonl ...`.
Rerun the validation round: `scripts/setup.sh`, then `scripts/rerun-validation.sh` (about 13 USD).

The GitHub server binary goes in `vendor/github-mcp/` (release v2.0.3), and
`vendor/github-mcp/tools-default.json` / `tools-all.json` hold its tool lists
(`deno run -A src/gh_list.ts default`).
