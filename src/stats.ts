// Confidence intervals over benchmark logs.
// Pass rate: Wilson 95% interval per suite, model and arm.
// Arm vs reference arm: difference in pass rate and ratio of mean cost, with 95%
// intervals from a bootstrap that resamples tasks (runs of one task are not
// independent, so the task is the unit), on tasks both arms ran.
// Usage: deno run -A src/stats.ts --ref=glossary3-feedback results/a.jsonl results/b.jsonl ...
import { parseArgs } from "@std/cli/parse-args";
import { usd } from "./cost.ts";

const flags = parseArgs(Deno.args, { string: ["ref", "iters"], default: { ref: "glossary3-feedback", iters: "4000" } });
const ITERS = Number(flags.iters);

type Run = {
  kind: "run"; suite: string; model: string; arm: string; task: string; success: boolean; stop: string;
  harness_gaps?: string[]; input_tokens: number; output_tokens: number; cache_write_tokens?: number; cache_read_tokens?: number;
};

const runs: Run[] = [];
for (const f of flags._.map(String)) {
  for (const l of Deno.readTextFileSync(f).split("\n").filter(Boolean)) {
    const r = JSON.parse(l);
    // Harness gaps and our own budget aborts are not the model's outcome.
    if (r.kind === "run" && !r.harness_gaps?.length && !/budget of|USD cap/.test(r.stop)) runs.push(r);
  }
}
const short = (m: string) => m.replace("claude-", "").replace(/-\d{8}$/, "");
const cost = (r: Run) => usd(r.model, r);

function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

// Deterministic generator so reruns print the same intervals.
let x = 7;
const rand = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const f2 = (v: number) => v.toFixed(2);

const key = (r: Run) => `${r.suite}|${short(r.model)}`;
const cells = new Map<string, Map<string, Run[]>>();
for (const r of runs) {
  const c = cells.get(key(r)) ?? new Map<string, Run[]>();
  c.set(r.arm, [...(c.get(r.arm) ?? []), r]);
  cells.set(key(r), c);
}

console.log(`Reference arm: ${flags.ref}. Intervals are 95%; differences and ratios are arm vs reference.\n`);
console.log("suite           model        arm                  pass   [95% CI]        Δpass vs ref [95% CI]   cost ratio vs ref [95% CI]");
for (const [k, byArm] of [...cells].sort()) {
  const [suite, model] = k.split("|");
  const ref = byArm.get(flags.ref);
  for (const [arm, rs] of [...byArm].sort()) {
    const n = rs.length, ok = rs.filter((r) => r.success).length;
    const [lo, hi] = wilson(ok, n);
    let cmp = "";
    if (ref && arm !== flags.ref) {
      const tasks = [...new Set(rs.map((r) => r.task))].filter((t) => ref.some((r) => r.task === t));
      const by = (xs: Run[], t: string) => xs.filter((r) => r.task === t);
      const stat = (ts: string[]) => {
        const a = ts.flatMap((t) => by(rs, t)), b = ts.flatMap((t) => by(ref, t));
        return [mean(a.map((r) => +r.success)) - mean(b.map((r) => +r.success)), mean(a.map(cost)) / mean(b.map(cost))];
      };
      const [d0, r0] = stat(tasks);
      const ds: number[] = [], rsx: number[] = [];
      for (let i = 0; i < ITERS; i++) {
        const sample = tasks.map(() => tasks[Math.floor(rand() * tasks.length)]);
        const [d, q] = stat(sample);
        ds.push(d);
        rsx.push(q);
      }
      cmp = `${(d0 >= 0 ? "+" : "") + f2(d0)} [${f2(pct(ds, 0.025))}, ${f2(pct(ds, 0.975))}]`.padEnd(24) +
        `${f2(r0)}x [${f2(pct(rsx, 0.025))}, ${f2(pct(rsx, 0.975))}]  (${tasks.length} tasks)`;
    }
    console.log(
      `${suite.padEnd(15)} ${model.padEnd(12)} ${arm.padEnd(20)} ${`${ok}/${n}`.padEnd(6)} [${f2(lo)}, ${f2(hi)}]    ${cmp}`,
    );
  }
}
