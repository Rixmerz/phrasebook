# Where v3 spends and fails: input for v4

Source: every v3-feedback run on Haiku 5.5, Sonnet 5.5 and Opus 5.5 (332 runs,
321 passed) in blind, calc, bulk2, exact, regression, safety and Opus logs.

## Cost structure

On the blind suite (Sonnet 5.5) a v3 run costs 0.0131 USD against 0.0144 for code mode:

| | code mode | v3 |
|---|---|---|
| cache reads | 37.6k tok, 0.0075 | 13.5k tok, 0.0027 |
| cache writes | 1.3k tok, 0.0032 | 2.5k tok, 0.0062 |
| output | 0.0037 | 0.0041 |

Small definitions save on cache reads, but reads cost 0.1x. Tool results are new
content, written to cache at 1.25x and read again on every later turn: they are
47% of a v3 run's cost. v3 also takes more turns (2.88 vs 2.67 for code mode).

## Findings

1. **Tables carry every column.** Tool results have a median of 223 chars, but the
   mean is 2,020 and the 90th percentile is 6,745. Lists print every field: bodies,
   two timestamps, and for PRs nested head/base objects with two 40-char SHAs and the
   repo name per row. `list pr ... all` for 37 PRs returned 11,806 chars when the task
   needed number and body (about 1,300).
2. **Feedback lines repeat.** The `->` lines are 30% of all result chars. "order: newest
   first (default)..." appeared 78 times, and the "act on every row" and "filter or count
   here" hints came with every list, including on the second and third list of the same run.
3. **Pipes on a single object fail.** The top error (35 of the parse errors):
   `get issue ... | select ...` and `get file ... | select ...` answer "This result has no
   list to pipe into". Models also issued one `get issue` per number instead of a batch.
4. **Filters the server lacks are errors.** `list issue ... assignees=` and `state_reason=`
   fail with "Unknown key" (15 errors), although the engine could apply them as `| where`.
5. **Remaining misses are reasoning or prompt ambiguity**, not the language:
   ties listed partially (c-most-commented), a wrong percentage, exact bodies with
   markdown changes, and a prompt with a period inside the quotes.

## v4 levers, by expected effect

1. Compact default columns per record type (issue: number, title, state, labels,
   assignees, comments; PR: number, title, state, author, head, base), nested objects
   flattened to their name (`head.ref`), SHAs only when asked, constant columns lifted
   into one header line, and a single line naming the hidden fields (`more: body,
   created_at, ...; add | select ...`).
2. Each hint once per run: conventions on first use only; the next-step hints only
   when the result is truncated, empty or an error.
3. `select` and `where` on single objects; batched gets (`get issue o/r#1,5,9`).
4. Unknown list filters become client-side `where` steps automatically, with a one-line note.

Expected: tool-result tokens down by half or more on list-heavy runs. Because they are
about half of the cost, that is about 25% per run. Fewer error turns should also bring
turns back to code mode's level.
Must be checked on frozen tasks that no v4 change was tuned on: a new blind set written
by another agent (the current one has been inspected), with the preregistration written first.
