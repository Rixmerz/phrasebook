// Tables for the paper, computed from the scored runs in results/runs/ (no API calls).
// Only blind sets: tasks written by an agent that saw no phrasebook, engine or result,
// frozen before the arm they test was run. Graders are the frozen ones, amendments aside.
// Per cell: pass with a Wilson 95% interval; vs the phrasebook arm, an exact McNemar test on
// runs paired by (task, rep) with Holm correction over every comparison in the table, and the
// cost ratio with a 95% bootstrap interval that resamples tasks.
// Usage: deno run -A src/paper_tables.ts [--out=paper/tables]
import { parseArgs } from "@std/cli/parse-args";
import { shortModel, usd } from "./cost.ts";

const flags = parseArgs(Deno.args, { string: ["out", "iters"], default: { out: "paper/tables", iters: "4000" } });
const ITERS = Number(flags.iters);
const RUNS = new URL("../results/runs/", import.meta.url).pathname;

type Run = { suite: string; model: string; arm: string; task: string; rep: number; success: boolean; usd: number; turns: number };

function load(files: string[]): Run[] {
  const out: Run[] = [];
  for (const f of files) {
    for (const l of Deno.readTextFileSync(RUNS + f).split("\n").filter(Boolean)) {
      const r = JSON.parse(l);
      // Harness gaps and our own budget aborts are not the model's outcome.
      if (r.kind !== "run" || r.harness_gaps?.length || /budget of|USD cap/.test(r.stop ?? "")) continue;
      // Cross-vendor runs (src/openai_bench.ts) are compared in tokens, since vendors price differently,
      // and keyed by runner as well as model, so two people running one model stay apart.
      if (r.client === "openai-compatible") {
        out.push({ suite: r.suite, model: `${r.model} (${r.runner || "?"})`, arm: r.arm, task: r.task, rep: r.rep, success: !!r.success, usd: r.input_tokens + r.output_tokens, turns: r.turns });
        continue;
      }
      // Claude Code runs carry the cost the client reported; API runs are priced from tokens.
      out.push({ suite: r.suite, model: shortModel(r.model), arm: r.arm, task: r.task, rep: r.rep, success: !!r.success, usd: r.usd ?? usd(r.model, r), turns: r.turns });
    }
  }
  return out;
}

// One block per blind set. `ref` is the phrasebook arm the others are compared with.
type Block = { label: string; files: string[]; ref: string; arms: string[]; note?: string; suite?: string };
const API: Block[] = [
  { label: "GitHub blind 1", files: ["blind-haiku55.jsonl", "blind-sonnet55.jsonl", "blind-opus55.jsonl"], ref: "glossary3-feedback", arms: ["native", "code", "ptc"], note: "v3" },
  { label: "GitHub blind 2", files: ["blind2.jsonl"], ref: "glossary4", arms: ["code"] },
  { label: "GitHub blind 3", files: ["blind3.jsonl", "blind3-opus.jsonl", "blind3-opus-v42.jsonl"], ref: "glossary4", arms: ["native", "code"] },
  { label: "Filesystem blind", files: ["fs-blind.jsonl"], ref: "glossary4", arms: ["native", "code"] },
  { label: "Git blind", files: ["git-blind.jsonl"], ref: "glossary4", arms: ["native", "code"] },
  { label: "GitHub real, blind", files: ["real-blind2-all.jsonl"], ref: "glossary4", arms: ["native", "code"] },
];
const CLIENT: Block[] = [
  { label: "GitHub blind 3", files: ["client-blind3.jsonl"], ref: "glossary4", arms: ["native"] },
  { label: "Notion blind 2", files: ["client-notion-blind2.jsonl"], ref: "glossary4", arms: ["native"] },
  { label: "Notion blind 3", files: ["client-notion-blind3.jsonl"], ref: "glossary4", arms: ["native"] },
  { label: "Notion blind 4", files: ["client-blind4-h45.jsonl"], ref: "glossary4s", arms: ["native", "glossary4"] },
  { label: "Notion blind 5", files: ["client-blind5-h45.jsonl"], ref: "glossary4s", arms: ["native", "glossary4"] },
  { label: "Notion blind 6", files: ["client-blind6-h45.jsonl"], ref: "glossary4s", arms: ["native", "glossary4"] },
  { label: "GitHub blind 4", files: ["client-ghblind4-h45.jsonl"], ref: "glossary4s", arms: ["native", "glossary4"] },
];

// Cross-vendor round (docs/preregistration-crossvendor.md): every xv-*.jsonl returned by an external
// runner (checked first with src/xv_check.ts), one block per language. "Cost" here is tokens per run.
const xvFiles = (() => {
  try {
    return [...Deno.readDirSync(RUNS)].map((e) => e.name).filter((n) => /^xv-.*\.jsonl$/.test(n) && !n.endsWith(".errors.jsonl")).sort();
  } catch {
    return [];
  }
})();
const CROSSVENDOR: Block[] = [
  { label: "Beacon (ES)", files: xvFiles, suite: "github-beacon", ref: "glossary4", arms: ["native", "code", "glossary4s", "native-trimmed-compact"] },
  { label: "Beacon (EN)", files: xvFiles, suite: "github-beacon-en", ref: "glossary4", arms: ["native", "code", "glossary4s", "native-trimmed-compact"] },
];

// Ablation round (docs/preregistration-ablation.md): native with one ingredient of the phrasebook at a time.
const ABLATION: Block[] = [
  { label: "GitHub blind 3", files: ["client-ablation.jsonl", "client-ablation-sonnet.jsonl"], ref: "glossary4", arms: ["native", "native-compact", "native-trimmed", "native-trimmed-compact"] },
];

function wilson(k: number, n: number): [number, number] {
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
function mcnemar(b: number, c: number): number {
  const n = b + c;
  if (!n) return 1;
  const choose = (n: number, k: number) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
  let tail = 0;
  for (let i = 0; i <= Math.min(b, c); i++) tail += choose(n, i) / 2 ** n;
  return Math.min(1, 2 * tail);
}
// Seeded so reruns print the same intervals.
let seed = 7;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))];

type Cmp = { arm: string; k: number; n: number; ratio: number; lo: number; hi: number; p: number; pHolm?: number };
type Row = { block: string; model: string; ref: string; note?: string; k: number; n: number; usd: number; turns: number; cmps: Cmp[] };

function analyse(blocks: Block[]): Row[] {
  const rows: Row[] = [];
  for (const b of blocks) {
    const runs = load(b.files.filter((f) => { try { return Deno.statSync(RUNS + f).isFile; } catch { return false; } }))
      .filter((r) => !b.suite || r.suite === b.suite);
    for (const model of [...new Set(runs.map((r) => r.model))]) {
      const mine = runs.filter((r) => r.model === model);
      const ref = mine.filter((r) => r.arm === b.ref);
      if (!ref.length) continue;
      const row: Row = {
        block: b.label, model, ref: b.ref, note: b.note, k: ref.filter((r) => r.success).length, n: ref.length,
        usd: mean(ref.map((r) => r.usd)), turns: mean(ref.map((r) => r.turns)), cmps: [],
      };
      for (const arm of b.arms) {
        const rs = mine.filter((r) => r.arm === arm);
        if (!rs.length) continue;
        const tasks = [...new Set(rs.map((r) => r.task))].filter((t) => ref.some((r) => r.task === t));
        const ratioOf = (ts: string[]) => {
          const a = ts.flatMap((t) => rs.filter((r) => r.task === t)), z = ts.flatMap((t) => ref.filter((r) => r.task === t));
          return mean(a.map((r) => r.usd)) / mean(z.map((r) => r.usd));
        };
        const boot: number[] = [];
        for (let i = 0; i < ITERS; i++) boot.push(ratioOf(tasks.map(() => tasks[Math.floor(rand() * tasks.length)])));
        // Pairs by (task, rep); a pooled cell with two runs of one rep pairs them in order.
        const key = (r: Run, i: number, all: Run[]) => `${r.task}#${r.rep}#${all.slice(0, i).filter((x) => x.task === r.task && x.rep === r.rep).length}`;
        const A = new Map(ref.map((r, i) => [key(r, i, ref), r.success]));
        const B = new Map(rs.map((r, i) => [key(r, i, rs), r.success]));
        const both = [...A.keys()].filter((k) => B.has(k));
        const onlyRef = both.filter((k) => A.get(k) && !B.get(k)).length, onlyArm = both.filter((k) => !A.get(k) && B.get(k)).length;
        row.cmps.push({ arm, k: rs.filter((r) => r.success).length, n: rs.length, ratio: ratioOf(tasks), lo: pct(boot, 0.025), hi: pct(boot, 0.975), p: mcnemar(onlyRef, onlyArm) });
      }
      rows.push(row);
    }
  }
  // Holm over every pass-rate comparison in the table.
  const all = rows.flatMap((r) => r.cmps).sort((a, b) => a.p - b.p);
  let run = 0;
  all.forEach((c, i) => c.pHolm = run = Math.max(run, Math.min(1, (all.length - i) * c.p)));
  return rows;
}

const MODEL: Record<string, string> = { "haiku-4-5": "Haiku 4.5", "haiku-5-5": "Haiku 5.5", "sonnet-5-5": "Sonnet 5.5", "opus-5-5": "Opus 5.5" };
const ARM: Record<string, string> = { "native-compact": "+ compact", "native-trimmed": "+ trimmed", "native-trimmed-compact": "+ both", native: "Native", code: "Code mode", ptc: "PTC", glossary4: "Phrasebook", glossary4s: "Phrasebook-S", "glossary3-feedback": "Phrasebook v3" };
const f2 = (x: number) => x.toFixed(2);
const pv = (p: number) => p < 0.001 ? "<0.001" : f2(p);

function latex(rows: Row[], arms: string[], caption: string, label: string): string {
  const head = ["Set", "Model", "Phrasebook", ...arms.map((a) => ARM[a])].join(" & ");
  const lines = rows.map((r) => {
    const cells = arms.map((a) => {
      const c = r.cmps.find((x) => x.arm === a);
      if (!c) return "--";
      const sig = c.lo > 1 || c.hi < 1 ? "\\textbf{" + f2(c.ratio) + "$\\times$}" : f2(c.ratio) + "$\\times$";
      return `${c.k}/${c.n}${c.pHolm! < 0.05 ? "$^{*}$" : ""} \\newline {\\scriptsize ${sig}\\newline [${f2(c.lo)}, ${f2(c.hi)}]}`;
    });
    const refName = r.ref === "glossary4" ? "" : r.ref === "glossary4s" ? " (S)" : " (v3)";
    return [r.block, MODEL[r.model] ?? r.model.replace(/_/g, "\\_"), `${r.k}/${r.n}${refName}`, ...cells].join(" & ") + " \\\\";
  });
  return [
    "\\begin{table*}[t]", "\\centering", arms.length > 3 ? "\\footnotesize" : "\\small",
    `\\begin{tabular}{ll l${(arms.length > 3 ? "p{2.0cm}" : "p{2.6cm}").repeat(arms.length)}}`, "\\toprule", head + " \\\\", "\\midrule",
    ...lines, "\\bottomrule", "\\end{tabular}", `\\caption{${caption}}`, `\\label{${label}}`, "\\end{table*}", "",
  ].join("\n");
}

function text(rows: Row[]): string {
  return rows.map((r) =>
    `${r.block.padEnd(20)} ${r.model.padEnd(11)} ${ARM[r.ref].padEnd(14)} ${`${r.k}/${r.n}`.padEnd(6)} ${r.model.includes(" (") ? `${r.usd.toFixed(0)} tokens/run` : `${r.usd.toFixed(5)} USD/run`}  ` +
    r.cmps.map((c) => `${ARM[c.arm]} ${c.k}/${c.n} p=${pv(c.p)} holm=${pv(c.pHolm!)} cost ${f2(c.ratio)}x [${f2(c.lo)}, ${f2(c.hi)}]`).join("; ")
  ).join("\n");
}

const api = analyse(API), client = analyse(CLIENT), ablation = analyse(ABLATION), crossvendor = analyse(CROSSVENDOR);
console.log("Direct API, blind sets\n" + text(api) + "\n\nClaude Code, blind sets\n" + text(client) + "\n\nAblation (Claude Code)\n" + text(ablation) +
  (crossvendor.length ? "\n\nCross-vendor (cost column = tokens per run, not USD)\n" + text(crossvendor) : ""));

const capApi = "Blind sets through the API. Phrasebook column: pass count of the phrasebook arm (v4 engine unless marked v3). " +
  "Other columns: pass count, then mean cost per run relative to the phrasebook with a 95\\% bootstrap interval over tasks " +
  "(bold: interval excludes 1$\\times$; above 1 means the phrasebook is cheaper). $^{*}$: pass-rate difference significant " +
  "after Holm correction (exact McNemar test on paired runs). PTC costs count tokens only. Opus on GitHub blind 3 pools the v4.1 and v4.2 runs of the phrasebook.";
const capClient = "Blind sets through Claude Code (\\texttt{claude -p}, notional USD reported by the client). (S): the small-model " +
  "variant with notes and recipes, compared with native MCP and the plain phrasebook. Columns as in Table~\\ref{tab:api}.";
await Deno.mkdir(flags.out, { recursive: true });
await Deno.writeTextFile(`${flags.out}/api.tex`, latex(api, ["native", "code", "ptc"], capApi, "tab:api"));
await Deno.writeTextFile(`${flags.out}/client.tex`, latex(client, ["native", "glossary4"], capClient, "tab:client"));
const capAblation = "Ablation through Claude Code on GitHub blind 3 (3 repetitions). Native MCP with one ingredient of the phrasebook " +
  "at a time: results shaped as the phrasebook shapes them (compact), descriptions cut to their first sentence (trimmed), or both. " +
  "Columns as in Table~\\ref{tab:api}.";
await Deno.writeTextFile(`${flags.out}/ablation.tex`, latex(ablation, ["native", "native-compact", "native-trimmed", "native-trimmed-compact"], capAblation, "tab:ablation"));
const capXv = "Cross-vendor round on blind set 7 (orchard/beacon, Claude-generated from the brief alone), through an " +
  "OpenAI-compatible client against the same MCP servers. Model ids as reported by each provider; the runner who ran them in " +
  "parentheses. Ratios are mean input plus output tokens per run relative to the phrasebook, not USD. Columns otherwise as in Table~\\ref{tab:api}.";
if (crossvendor.length) await Deno.writeTextFile(`${flags.out}/crossvendor.tex`, latex(crossvendor, ["native", "code", "glossary4s", "native-trimmed-compact"], capXv, "tab:crossvendor"));
await Deno.writeTextFile(`${flags.out}/summary.json`, JSON.stringify({ api, client, ablation, crossvendor }, null, 1));
console.log(`\nWrote ${flags.out}/api.tex, client.tex, ablation.tex${crossvendor.length ? ", crossvendor.tex" : ""}, summary.json`);
