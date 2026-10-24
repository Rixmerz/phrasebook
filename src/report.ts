// Summarizes a benchmark log: pass rate, tokens, turns and latency per model
// and arm, then per task, then the breakdown of invalid calls.
// Usage: deno run -A src/report.ts results/<file>.jsonl
const file = Deno.args[0];
if (!file) {
  console.error("Usage: deno run -A src/report.ts <results.jsonl>");
  Deno.exit(1);
}

type Run = {
  kind: "run"; model: string; arm: string; task: string; success: boolean; turns: number;
  latency_ms: number; input_tokens: number; output_tokens: number; stop: string;
  calls: { outcome: string }[]; harness_gaps?: string[];
  cache_write_tokens?: number; cache_read_tokens?: number;
};

// USD per million tokens (input, output). Cache writes bill at 1.25x input, reads at 0.1x.
const PRICES: Record<string, [number, number]> = {
  "haiku-4-5": [1, 5], "haiku-5-5": [0.1, 0.5], "sonnet-5-5": [2, 10], "opus-5-5": [4, 20],
};
const cost = (r: Run) => {
  const [pin, pout] = PRICES[short(r.model)] ?? [0, 0];
  return (r.input_tokens * pin + (r.cache_write_tokens ?? 0) * pin * 1.25 + (r.cache_read_tokens ?? 0) * pin * 0.1 +
    r.output_tokens * pout) / 1e6;
};
type Defs = { kind: "definitions"; model: string; native: number; glossary: number; code?: number; glossary2?: number };

const rows = Deno.readTextFileSync(file).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const allRuns = rows.filter((r): r is Run => r.kind === "run");
// Runs that hit a route the fake backend lacks are our gap, not the model's: leave them out.
const runs = allRuns.filter((r) => !r.harness_gaps?.length);
if (allRuns.length !== runs.length) console.log(`Excluded ${allRuns.length - runs.length} runs with harness gaps`);
const defs = rows.filter((r): r is Defs => r.kind === "definitions");
const short = (m: string) => m.replace("claude-", "").replace(/-\d{8}$/, "");
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

console.log("Tool definition tokens");
for (const d of defs) console.log(`  ${short(d.model).padEnd(12)} native=${d.native} glossary=${d.glossary} code=${d.code ?? "-"}${d.glossary2 ? ` glossary2=${d.glossary2}` : ""}`);

const groups = new Map<string, Run[]>();
for (const r of runs) {
  const k = `${short(r.model)}|${r.arm}`;
  groups.set(k, [...(groups.get(k) ?? []), r]);
}

console.log("\nPer model and arm");
console.log("  model        arm       pass      in/run  out/run  cache r/w/run   turns  p50 s  USD/run   errors");
for (const [k, rs] of groups) {
  const [m, a] = k.split("|");
  const pass = rs.filter((r) => r.success).length;
  const avg = (f: (r: Run) => number) => Math.round(rs.reduce((s, r) => s + f(r), 0) / rs.length);
  const errs = rs.filter((r) => r.stop.startsWith("error")).length;
  console.log(
    `  ${m.padEnd(12)} ${a.padEnd(9)} ${`${pass}/${rs.length}`.padEnd(9)} ` +
      `${String(avg((r) => r.input_tokens)).padStart(6)}  ${String(avg((r) => r.output_tokens)).padStart(7)}  ` +
      `${`${avg((r) => r.cache_read_tokens ?? 0)}/${avg((r) => r.cache_write_tokens ?? 0)}`.padStart(13)}  ` +
      `${(rs.reduce((s, r) => s + r.turns, 0) / rs.length).toFixed(1).padStart(5)}  ` +
      `${(median(rs.map((r) => r.latency_ms)) / 1000).toFixed(1).padStart(5)}  ` +
      `${(rs.reduce((s, r) => s + cost(r), 0) / rs.length).toFixed(5).padStart(8)}  ${errs}`,
  );
}

console.log(`\nPass rate per task (model: ${["native", "toolsearch", "glossary", "glossary2", "glossary3-legend", "glossary3-feedback", "glossary4", "code", "codesearch", "ptc"].filter((a) => runs.some((r) => r.arm === a)).join(" / ")})`);
const taskIds = [...new Set(runs.map((r) => r.task))];
const models = [...new Set(runs.map((r) => short(r.model)))];
const arms = ["native", "toolsearch", "glossary", "glossary2", "glossary3-legend", "glossary3-feedback", "glossary4", "code", "codesearch", "ptc"].filter((a) => runs.some((r) => r.arm === a));
for (const t of taskIds) {
  const cells = models.map((m) => {
    const parts = arms.map((a) => {
      const rs = runs.filter((r) => r.task === t && short(r.model) === m && r.arm === a);
      return rs.length ? `${rs.filter((r) => r.success).length}/${rs.length}` : "-";
    });
    return `${m}: ${parts.join(" ")}`;
  });
  console.log(`  ${t.padEnd(20)} ${cells.join("   ")}`);
}

console.log("\nInvalid calls by kind");
const kinds = new Map<string, number>();
for (const r of runs) for (const c of r.calls) {
  if (c.outcome === "ok") continue;
  const k = `${short(r.model)}|${r.arm}|${c.outcome}`;
  kinds.set(k, (kinds.get(k) ?? 0) + 1);
}
if (!kinds.size) console.log("  none");
for (const [k, n] of [...kinds].sort()) console.log(`  ${k.replaceAll("|", "  ")}  ${n}`);

const total = runs.reduce((s, r) => s + cost(r), 0);
console.log(`\nTotal cost of these runs: ${total.toFixed(2)} USD`);
