# Paper

Draft of the arXiv paper. Build with LaTeX (`latexmk -pdf main.tex`) after regenerating the
tables and figures from the scored runs:

```sh
deno run -A src/paper_tables.ts     # paper/tables/*.tex and summary.json, from results/runs/
python3 scripts/paper_figures.py    # paper/figures/*.pdf (needs matplotlib)
cd paper && latexmk -pdf main.tex
```

Every `\todo{}` in `main.tex` prints in red. Before submission, none may be left.

## Done (no API spend)

- Manuscript draft with every section, from the numbers in `docs/RESULTS.md`.
- Main tables recomputed from `results/runs/`, with Holm correction over every comparison
  (new: most pass-rate differences are not significant once corrected; cost differences are).
- Figures: definition tokens vs server size; cost ratios with intervals.
- Ablation arms `native-compact`, `native-trimmed`, `native-trimmed-compact`
  (`src/arms/ablations.ts`, tested, not run).
- Draft preregistration of the final round: `docs/preregistration-paper.md`.
- History rewrite disclosed under threats to validity.

## Open, in order

1. Run the ablation arms on github-blind3 (Haiku 5.5, Sonnet 5.5; about 10 to 20 USD).
2. Cross-vendor adapter in `src/bench.ts` (OpenAI, Google, an open-weights model) and its runs.
3. Final round per `docs/preregistration-paper.md`: human-written set, external timestamp.
4. English subset (part of the final round).
5. Optional: one public MCP benchmark.
6. Appendices B and C (grader issues, preregistration scorecard), author list, AI-use
   statement, repository URL and archival DOI (Zenodo).
7. Check every entry in `refs.bib` against its source, and add BFCL, MCP-Bench, MCPMark and
   MCP-Universe with verified references.
8. arXiv: category (cs.CL or cs.SE, cross-list cs.AI) and endorsement if needed.
