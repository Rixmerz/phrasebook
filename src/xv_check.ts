// Checks a cross-vendor log returned by an external runner before it joins results/runs/.
// Usage: deno run -A src/xv_check.ts results/runs/xv-<runner>-<model>-es.jsonl [more...]
// Per file: one runner, one model and one suite; every (arm, task, rep) present exactly once
// for the required arms; the task ids are the frozen set's; no API-error rows; gaps counted.
// Exits 1 if any file has a problem, so a bad file is caught before the tables are built.
import { parseArgs } from "@std/cli/parse-args";

const flags = parseArgs(Deno.args, { string: ["arms", "reps"], default: { reps: "3" } });
// API runs (src/openai_bench.ts) include code mode; subscription runs through a vendor CLI (src/cli_bench.ts) cannot.
const CLIENTS: Record<string, string[]> = {
  "openai-compatible": ["native", "glossary4s", "glossary4", "code"],
  "codex-cli": ["native", "glossary4s", "glossary4"],
  "gemini-cli": ["native", "glossary4s", "glossary4"],
};
const OPTIONAL = ["native-trimmed-compact"];
const REPS = Number(flags.reps);
const SUITES = ["github-beacon", "github-beacon-en"];

// The frozen task ids, from the private set when present (the ids are not secret, the prompts are).
let TASKS: string[] = [];
try {
  TASKS = JSON.parse(Deno.readTextFileSync(new URL("../private/beacon/tasks.json", import.meta.url))).map((t: { id: string }) => t.id);
} catch {
  console.log("note: private/beacon/tasks.json not found; task ids are not checked against the set");
}

let bad = 0;
for (const file of flags._ as string[]) {
  const problems: string[] = [];
  const rows = Deno.readTextFileSync(file).split("\n").filter(Boolean).map((l, i) => {
    try {
      return JSON.parse(l);
    } catch {
      problems.push(`line ${i + 1} is not JSON`);
      return null;
    }
  }).filter((r) => r?.kind === "run");
  const one = (k: string) => [...new Set(rows.map((r) => r[k]))];
  const [runners, models, suites, clients] = ["runner", "model", "suite", "client"].map(one);
  if (!rows.length) problems.push("no runs");
  if (runners.length !== 1 || !runners[0]) problems.push(`runner: ${JSON.stringify(runners)} (expected one non-empty --runner; ask them, then see below)`);
  if (models.length !== 1) problems.push(`models: ${JSON.stringify(models)} (one model per file)`);
  if (suites.length !== 1 || !SUITES.includes(suites[0])) problems.push(`suites: ${JSON.stringify(suites)} (one of ${SUITES.join(", ")})`);
  if (clients.length !== 1 || !CLIENTS[clients[0]]) problems.push(`client: ${JSON.stringify(clients)} (one of ${Object.keys(CLIENTS).join(", ")})`);
  const REQUIRED = flags.arms ? flags.arms.split(",") : CLIENTS[clients[0]] ?? [];
  const foreign = rows.filter((r) => r.foreign_tools?.length);
  if (foreign.length) problems.push(`${foreign.length} runs used a tool outside the GitHub server (${[...new Set(foreign.flatMap((r) => r.foreign_tools))].join(", ")}): the CLI setup leaked; ask the runner before using this file`);
  const versions = one("cli_version").filter(Boolean);
  if (versions.length > 1) problems.push(`several CLI versions in one file: ${versions.join(", ")}`);
  const errors = rows.filter((r) => String(r.stop).startsWith("error")).length;
  if (errors) problems.push(`${errors} API-error rows (the runner should rerun them; they must not be counted)`);
  const arms = one("arm");
  const unknownArms = arms.filter((a) => !REQUIRED.includes(a) && !OPTIONAL.includes(a));
  if (unknownArms.length) problems.push(`unexpected arms: ${unknownArms.join(", ")}`);
  if (TASKS.length) {
    const unknown = one("task").filter((t) => !TASKS.includes(t));
    if (unknown.length) problems.push(`unknown tasks: ${unknown.join(", ")}`);
  }
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(`${r.arm}|${r.task}|${r.rep}`, (seen.get(`${r.arm}|${r.task}|${r.rep}`) ?? 0) + 1);
  const dups = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  if (dups.length) problems.push(`${dups.length} duplicated (arm, task, rep), e.g. ${dups[0]}`);
  const ids = TASKS.length ? TASKS : one("task");
  for (const a of arms.filter((a) => REQUIRED.includes(a) || OPTIONAL.includes(a)).concat(REQUIRED.filter((a) => !arms.includes(a)))) {
    let missing = 0;
    for (const t of ids) for (let rep = 1; rep <= REPS; rep++) if (!seen.has(`${a}|${t}|${rep}`)) missing++;
    if (missing) problems.push(`${a}: ${missing} of ${ids.length * REPS} runs missing${OPTIONAL.includes(a) ? " (optional arm)" : ""}`);
  }
  const gaps = rows.filter((r) => r.harness_gaps?.length).length;
  const pass = (a: string) => `${rows.filter((r) => r.arm === a && r.success && !r.harness_gaps?.length).length}/${rows.filter((r) => r.arm === a && !r.harness_gaps?.length).length}`;
  console.log(`\n${file}\n  runner=${runners.join(",")} client=${clients.join(",")}${versions.length ? " " + versions.join(",") : ""} model=${models.join(",")} suite=${suites.join(",")} runs=${rows.length} gaps=${gaps}`);
  console.log(`  pass: ${arms.map((a) => `${a} ${pass(a)}`).join("  ")}`);
  const fatal = problems.filter((p) => !p.includes("(optional arm)"));
  for (const p of problems) console.log(`  ${p.includes("(optional arm)") ? "note" : "PROBLEM"}: ${p}`);
  if (fatal.length) bad++;
  else console.log("  OK: ready for results/runs/ and paper_tables.ts");
}
if (bad) {
  console.log(`\n${bad} file(s) with problems. A missing runner can be set without touching results:\n` +
    `  deno eval 'const [f,n]=Deno.args;Deno.writeTextFileSync(f,Deno.readTextFileSync(f).split("\\n").filter(Boolean).map(l=>{const r=JSON.parse(l);r.runner||=n;return JSON.stringify(r)}).join("\\n")+"\\n")' <file> <runner>`);
  Deno.exit(1);
}
