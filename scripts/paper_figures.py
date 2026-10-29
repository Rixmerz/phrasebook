"""Figures for the paper. Run after src/paper_tables.ts:  python3 scripts/paper_figures.py"""
import json
import pathlib

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "paper" / "figures"
OUT.mkdir(parents=True, exist_ok=True)
plt.rcParams.update({"font.size": 9, "font.family": "serif", "axes.spines.top": False, "axes.spines.right": False})
NATIVE, PHRASE, HELP = "#4c6a92", "#c2553a", "#e3a587"

# Tokens of tool definitions per request (count_tokens, Sonnet 5.5 / Haiku 5.5 tokenizer), docs/RESULTS.md.
servers = [  # name, tools, native, phrasebook
    ("memory", 9, 1961, 716), ("git", 12, 2409, 815), ("filesystem", 14, 2779, 734),
    ("GitHub default", 46, 19384, 1719), ("GitHub all", 91, 40480, 2569),
]
fig, ax = plt.subplots(figsize=(3.4, 2.4))
xs = [s[1] for s in servers]
ax.plot(xs, [s[2] / 1000 for s in servers], "o-", color=NATIVE, label="native MCP tools")
ax.plot(xs, [s[3] / 1000 for s in servers], "s-", color=PHRASE, label="phrasebook (full)")
ax.plot([46, 91], [0.807, 0.807], "^--", color=HELP, label="phrasebook (progressive)")
for name, n, nat, pb in servers:
    if n >= 46:
        ax.annotate(f"{nat / pb:.1f}x", (n, nat / 1000), textcoords="offset points", xytext=(-22, 4), fontsize=8)
ax.set_xlabel("tools in the server")
ax.set_ylabel("definition tokens (thousands)")
ax.legend(frameon=False, fontsize=7.5)
fig.tight_layout()
fig.savefig(OUT / "scaling.pdf")

# Cost of each rival relative to the phrasebook on the blind sets, with 95% bootstrap intervals.
data = json.loads((ROOT / "paper" / "tables" / "summary.json").read_text())
MODEL = {"haiku-4-5": "H4.5", "haiku-5-5": "H5.5", "sonnet-5-5": "S5.5", "opus-5-5": "O5.5"}
COLOR = {"native": NATIVE, "code": "#5b8c5a", "ptc": "#8a6bb1", "glossary4": PHRASE}
NAME = {"native": "native", "code": "code mode", "ptc": "PTC", "glossary4": "phrasebook (plain)"}
OFFSET = {"native": 0.22, "code": 0.0, "ptc": -0.22, "glossary4": -0.22}
for key in ("api", "client"):
    rows = data[key]
    fig, ax = plt.subplots(figsize=(3.4, 0.24 * len(rows) + 1.0))
    seen = set()
    for i, r in enumerate(rows):
        y = len(rows) - i
        for c in r["cmps"]:
            ax.errorbar(c["ratio"], y + OFFSET[c["arm"]], xerr=[[c["ratio"] - c["lo"]], [c["hi"] - c["ratio"]]], fmt="o", ms=2.5,
                        color=COLOR[c["arm"]], label=None if c["arm"] in seen else NAME[c["arm"]], capsize=0, lw=1)
            seen.add(c["arm"])
    ax.axvline(1, color="0.5", lw=0.8, ls=":")
    ax.set_xscale("log")
    ax.xaxis.set_minor_formatter(matplotlib.ticker.NullFormatter())
    ax.set_xticks([0.25, 0.5, 1, 2, 4, 8])
    ax.set_xticklabels(["0.25", "0.5", "1", "2", "4", "8"])
    ax.set_yticks(range(len(rows), 0, -1))
    ax.set_yticklabels([f"{r['block']}, {MODEL[r['model']]}" for r in rows], fontsize=6.5)
    ax.set_ylim(0.4, len(rows) + 0.6)
    ax.set_xlabel("cost relative to the phrasebook (log scale)", fontsize=7.5)
    ax.legend(frameon=False, fontsize=6.5, loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=3)
    fig.tight_layout()
    fig.savefig(OUT / f"cost-{key}.pdf")
print("wrote", *sorted(p.name for p in OUT.iterdir()))
