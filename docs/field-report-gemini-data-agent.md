# Field report: a phrasebook port to a Gemini data agent

The first test outside this benchmark and the first on a non-Claude model. A team
ported the phrasebook idea to a production data-analytics agent and measured it
against the agent's native tools on real data. The organization, the agent, its
tables and its users are left out on purpose. Every number below is relative or
counts tokens, turns and calls.

## The setting

| | This benchmark (GitHub) | The data agent |
|---|---|---|
| Task | Operations on a code host (list, filter, edit, merge) | Text-to-SQL analytics over a curated data catalog |
| Model | Claude Haiku, Sonnet, Opus 5.5 | Gemini Flash-Lite (via a Python agent framework) |
| Native tools | 46, generic MCP server built for humans | 17, written for the model: curated outputs, structured errors with fixes, row and byte caps, parallel calls, history compaction |
| Native tool outputs | Raw API JSON, hundreds of unused fields | Already trimmed to what the model reads |
| System prompt | Small; the phrasebook is most of the interface | About 37k characters, naming the native tools 30+ times, with a fixed step order (26 MUST/ALWAYS/NEVER) |
| Turn shape | About 3 turns per task | About 3.3 tool rounds per answer, 4.3 model calls |
| Prompt caching | Headline numbers uncached | 55% to 70% of input served from cache |

## What was built

- One tool `run(commands: list[str])` whose description is a command glossary,
  replacing 15 of the 17 tools. The two tools that carry contracts with the
  front end (a structured question form and a report preview) stayed native.
- Commands run in order, so a schema lookup caches the table before a query in the
  same batch. A failing command does not stop the batch.
- Lossless compact output (`name[n]{cols}`, `all rows:`, short table names) for the
  two large catalog results. No field hidden, no text clipped.
- No `@n` references or pipeline: the warehouse already does that work in SQL.

## Results

Tool definitions, measured without a model: 6.2k tokens to 1.3k (-79%) per call.
Compact output, lossless: -14% and -15% characters on the two catalog tools.

End to end, 8 questions (10 turns), one repetition, two identical native backends
as a noise control:

| | Native A | Native B (control) | Phrasebook |
|---|---|---|---|
| Input tokens | 1.00 | 0.89 | 0.75 |
| Cost | 1.00 | 0.90 | 0.77 |
| Tool rounds per turn | 3.6 | 3.1 | 3.3 |
| Tool errors | 1 | 0 | 0 |

Phrasebook used about 21% fewer tokens than the mean of the two native runs, about
twice the native-to-native noise (11%). Answer quality was not graded in this run.

## Why the gain is 21% and not 2x to 4x

1. **Little left to compress.** This benchmark already found it: filesystem and git
   (12 to 14 tools, plain text) tie with native. The data agent looks like those
   servers, not like GitHub: few tools and outputs already shaped for the model.
2. **The native baseline was already "phrasebook-like".** Curated outputs, structured
   errors that carry the fix, caps and history compaction are most of what a
   phrasebook adds. The GitHub baseline had none of it.
3. **The rounds depend on each other.** Find tables, read schemas, write SQL, read
   results, fix. The model cannot write the query before it sees the columns. 45% of
   `run` calls carried more than one command, yet rounds per turn did not move,
   because what got batched was what native parallel calls already batched.
4. **The ceiling matches the result.** Definitions were about 19% of each call and
   the phrasebook removed 15 of those points; compact output added 4 to 5 points.
   Expected ceiling about 20%; measured 21%.
5. **Caching discounts what the phrasebook removes.** Tool definitions are the
   static prefix that caches best, so the saving in money trails the saving in
   tokens.

## What a Gemini Flash-Lite did differently

- **It called a native tool name that no longer existed**, because the long system
  prompt named it; the framework raised and the turn failed. One line in the
  glossary ("these are commands of `run`, never call them directly") removed it in
  the next run (0 of 10 turns).
- **It batched little.** Before that line and an explicit "send independent steps
  together" instruction, 69% of `run` calls carried one command; after, 55%.
- These are signals, not a model comparison: no larger model was run on the same
  tasks, and the long prompt pushes step-by-step work regardless of the model.

## A related idea that lost: data glossaries

A second experiment replaced catalog discovery with **data glossaries**: one call
returns the tables, columns, rules, metrics and reference SQL for a domain or for a
query purpose, and preloads the schemas. This is a glossary of *knowledge*, not of
*commands*.

- 16 purpose glossaries were derived from about 4,700 real questions classified by
  intent with Gemini Flash (sessions used for evaluation excluded). Reference SQL
  passed a literal allowlist, so names, codes and ids were dropped.
- Evaluation: 75 real conversations that users had approved (99 turns) were replayed
  on every variant; a blind judge (Gemini Flash) scored each answer 1 to 5 against
  the approved one.

| | Native | Domain glossaries | Purpose glossaries |
|---|---|---|---|
| Input tokens per turn | 1.00 | 0.99 | 0.88 |
| Tool rounds per turn | 4.3 | 4.0 | 3.7 |
| Judge score, gradable turns (n=69) | 4.04 | 3.78 (-0.24, 95% CI [-0.49, -0.01]) | 3.72 (-0.29, [-0.49, -0.12]) |
| Judge score, turns with SQL (n=45) | 4.00 | 3.53 (-0.43) | 3.56 (-0.41, [-0.68, -0.16]) |

Purpose glossaries saved 12% and answered worse: worse than native on 17 of 69
turns, better on 3. The judge's reasons: the wrong source table (the glossary held
six tables and the right one was a seventh), missing business filters, and more
truncated answers. A phrasebook changes *how* tools are called and leaves
exploration intact; a data glossary changes *what the model sees* and cuts the
exploration that found the right table.

## Lessons for anyone porting a phrasebook

1. **Estimate the ceiling first.** Share of each call taken by tool definitions,
   times the share you can remove, plus the compressible share of outputs. If the
   tools are few and already model-friendly, expect tens of percent, not multiples.
2. **The big wins are engine fixes, not wording.** As in v4.2 and the real-GitHub
   round, the engine should repair what the model gets wrong: here, accepting the
   table-name shapes the model writes on its own removed a whole round each time.
3. **Rewrite the system prompt with the glossary.** Two interfaces in one context
   compete, and the longer one wins.
4. **Check the baseline against production before measuring.** A catalog permission
   error in the test environment made every schema lookup fail; turns cost 3x and
   took 11 rounds instead of 3.4, and the first conclusions were wrong.
5. **Measure noise and quality, not only tokens.** The same question took 2x more
   tokens between two identical runs; a native-vs-native control and a graded
   replay of approved conversations were what made the results readable.
6. **Persisted state has limits.** Preloading full schemas for every glossary table
   pushed the session document over the store's per-document size limit; cache
   column names only.

## Limits

- One team, one agent, one model family; 8 questions for the phrasebook run (one
  repetition) and 99 turns for the glossary replay.
- The judge is from the same model family as the agent; no judge-noise control.
- 30 of 99 replayed turns depended on earlier turns missing from the export and
  were graded as not evaluable.
- The small-model variant of this repo (`glossary4s`: notes and recipes for small
  models) was not tried; it is the obvious next arm for Flash-Lite.
