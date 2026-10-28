// Pass rates with uncertainty for client_bench logs.
// Usage: deno run -A src/client_stats.ts results/a.jsonl [more.jsonl] [--a=glossary4s --b=native]
// Per model and arm: pass rate with a Wilson 95% interval. For each pair of arms on the same model:
// an exact McNemar test on runs paired by (task, rep), and a 95% bootstrap interval of the
// difference that resamples tasks, since reps of one task are not independent.
import { parseArgs } from "@std/cli/parse-args";

type Run = { model: string; arm: string; task: string; rep: number; success: boolean; usd: number };
const flags = parseArgs(Deno.args, { string: ["a", "b"] });
const runs: Run[] = [];
for (const f of flags._ as string[]) {
  for (const line of Deno.readTextFileSync(f).split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    // Harness gaps are not the model's outcome (as in paper_tables.ts).
    if (r.kind === "run" && !r.harness_gaps?.length) runs.push({ model: r.model, arm: r.arm, task: r.task, rep: r.rep, success: !!r.success, usd: r.usd ?? 0 });
  }
}

function wilson(k: number, n: number): [number, number] {
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
// Two-sided exact binomial test on the discordant pairs.
function mcnemar(b: number, c: number): number {
  const n = b + c;
  if (!n) return 1;
  const choose = (n: number, k: number) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
  let tail = 0;
  for (let i = 0; i <= Math.min(b, c); i++) tail += choose(n, i) / 2 ** n;
  return Math.min(1, 2 * tail);
}
// Seeded so reruns print the same interval.
function rng(seed: number) {
  let x = seed;
  return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const models = [...new Set(runs.map((r) => r.model))];
for (const model of models) {
  const mine = runs.filter((r) => r.model === model);
  const arms = [...new Set(mine.map((r) => r.arm))].filter((a) => !flags.a || a === flags.a || a === flags.b);
  console.log(`\n${model}`);
  for (const arm of arms) {
    const rs = mine.filter((r) => r.arm === arm);
    const k = rs.filter((r) => r.success).length;
    const [lo, hi] = wilson(k, rs.length);
    const usd = rs.reduce((s, r) => s + r.usd, 0);
    console.log(`  ${arm.padEnd(12)} ${k}/${rs.length} ${pct(k / rs.length)} [${pct(lo)}, ${pct(hi)}]  ${usd.toFixed(3)} USD`);
  }
  for (let i = 0; i < arms.length; i++) {
    for (let j = i + 1; j < arms.length; j++) {
      const key = (r: Run) => `${r.task}#${r.rep}`;
      const A = new Map(mine.filter((r) => r.arm === arms[i]).map((r) => [key(r), r.success]));
      const B = new Map(mine.filter((r) => r.arm === arms[j]).map((r) => [key(r), r.success]));
      const both = [...A.keys()].filter((k) => B.has(k));
      if (!both.length) continue;
      const b = both.filter((k) => A.get(k) && !B.get(k)).length;
      const c = both.filter((k) => !A.get(k) && B.get(k)).length;
      const tasks = [...new Set(both.map((k) => k.split("#")[0]))];
      const byTask = new Map(tasks.map((t) => [t, both.filter((k) => k.split("#")[0] === t)]));
      const rand = rng(20261025);
      const diffs: number[] = [];
      for (let it = 0; it < 5000; it++) {
        let d = 0, n = 0;
        for (let s = 0; s < tasks.length; s++) {
          for (const k of byTask.get(tasks[Math.floor(rand() * tasks.length)])!) { d += Number(A.get(k)) - Number(B.get(k)); n++; }
        }
        diffs.push(d / n);
      }
      diffs.sort((x, y) => x - y);
      const diff = (b - c) / both.length;
      console.log(`  ${arms[i]} - ${arms[j]}: ${diff >= 0 ? "+" : ""}${pct(diff)} [${pct(diffs[124])}, ${pct(diffs[4874])}] over ${tasks.length} tasks, ` +
        `discordant ${b}:${c}, McNemar p=${mcnemar(b, c).toFixed(3)}`);
    }
  }
}
