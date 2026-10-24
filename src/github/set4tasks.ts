// Fourth task set, NOT blind: written by the glossary's author after reading the v4.1 logs,
// before v4.2 was built, and frozen first (results/set4-freeze.sha256). Some tasks touch the
// weak spots v4.2 targets (closing reasons, multi-step writes, small file edits), so it can
// favor v4.2; the blind sets 1-3 stay the unbiased evidence.
// Repo octo/billing: an invoicing service. 230 issues and 64 pull requests over two bases.
import type { Comment, Issue, Pull, State } from "./mock.ts";
import type { GhTask } from "./tasks.ts";
import { seed } from "./tasks.ts";

const PEOPLE = ["amaru", "beatriz", "cami", "dante", "emilia", "franco", "gala", "ignacio", "josefa"];
const AREAS = ["invoices", "taxes", "webhooks", "exports", "ledger"];
const KINDS = ["bug", "feature", "chore"];
const SEVERITY = ["sev1", "sev2", "sev3"];
const BASES = ["main", "main", "hotfix/2.9"];
const PR_BASE = 600;

function rng(seedValue: number) {
  let x = seedValue;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}
const pick = <T>(rand: () => number, xs: T[]) => xs[Math.floor(rand() * xs.length)];
const skewed = (rand: () => number, xs: string[], p: number) => xs[Math.min(xs.length - 1, Math.floor(Math.pow(rand(), p) * xs.length))];
const day = (d: number) => new Date(Date.UTC(2026, 1, 1 + (d % 200), d % 24, (d * 11) % 60)).toISOString();

function build() {
  const rand = rng(424242);
  const issues: Issue[] = [];
  for (let n = 1; n <= 230; n++) {
    const area = pick(rand, AREAS);
    const kind = rand() < 0.45 ? "bug" : pick(rand, KINDS);
    const labels = [kind, area];
    if (kind === "bug" && rand() < 0.8) labels.push(skewed(rand, SEVERITY, 1.4));
    if (rand() < 0.08) labels.push("wontfix-candidate");
    const r = rand();
    const assignees = r < 0.22 ? [] : [skewed(rand, PEOPLE, 1.4)];
    const nc = Math.floor(rand() * 5);
    const comments: Comment[] = Array.from({ length: nc }, (_, k) => {
      const who = pick(rand, PEOPLE);
      return { id: 70000 + n * 10 + k, body: pick(rand, ["Seen in prod.", "Repro attached.", "Low priority?", "Fixed by the last deploy?"]), user: { login: who, id: 4000 + PEOPLE.indexOf(who) }, created_at: day(n + k) };
    });
    const closed = rand() < 0.42;
    issues.push({
      number: n, title: `[${area}] ${kind === "bug" ? "Wrong totals" : kind === "feature" ? "Support" : "Clean up"} case ${n}`,
      body: kind === "bug" ? `Invoice totals differ in ${area}.\n\nSteps:\n1. Create invoice\n2. Export\n` : `Request for ${area}.`,
      state: closed ? "closed" : "open", state_reason: closed ? (rand() < 0.33 ? "not_planned" : "completed") : null,
      labels, assignees, author: skewed(rand, PEOPLE, 1.2), comments, created_at: day(n), updated_at: day(n + 3),
    });
  }
  const pulls: Pull[] = [];
  for (let k = 1; k <= 64; k++) {
    const t = 1 + Math.floor(rand() * 230);
    const base = pick(rand, BASES);
    const state = rand() < 0.5 ? "open" : "closed";
    const author = skewed(rand, PEOPLE, 1.6);
    pulls.push({
      number: PR_BASE + k, title: `Fix ${issues[t - 1].labels[1]} case ${t}`, body: `Resolves #${t}.\n\nChecklist:\n- [x] tests\n`,
      state, merged: state === "closed" && rand() < 0.7, merge_method: null, head: `feat/${author}-${k}`, base, author,
      draft: false, files: [], comments: [], created_at: day(k * 3), updated_at: day(k * 3 + 1),
    });
  }
  return { issues, pulls };
}

const RATES_MAIN = "# Tax rates per country\nrates:\n  CL: 0.19\n  PE: 0.18\n  CO: 0.19\n\n# rounding mode for totals\nrounding: half_even\n";
const RATES_HOTFIX = RATES_MAIN.replace("PE: 0.18", "PE: 0.16");
const RATES_EDITED = RATES_MAIN.replace("PE: 0.18", "PE: 0.17");
const LIMITS = '{\n  "max_lines": 500,\n  "max_attachments": 10,\n  "retry": {\n    "webhooks": 5\n  }\n}\n';
const LIMITS_EDITED = LIMITS.replace('"webhooks": 5', '"webhooks": 8');
const CHANGELOG = "# Changelog\n\n## 2.9.1\n- Fix PE tax rate\n";

export function set4Seed(): State {
  const s = seed();
  const r = s.repos[0];
  r.name = "billing";
  const { issues, pulls } = build();
  r.issues = issues;
  r.pulls = pulls;
  const main = { "README.md": "# billing\n", "config/rates.yaml": RATES_MAIN, "config/limits.json": LIMITS };
  r.files = { main, "hotfix/2.9": { ...main, "config/rates.yaml": RATES_HOTFIX } };
  r.branches = { main: "f1".repeat(20), "hotfix/2.9": "f2".repeat(20) };
  for (const p of pulls) {
    r.branches[p.head] = p.number.toString(16).padStart(4, "0").repeat(10);
    r.files[p.head] = { ...r.files[p.base] };
  }
  r.labels = [...KINDS, ...AREAS, ...SEVERITY, "wontfix-candidate", "triaged"];
  s.users = [...PEOPLE, "octo"];
  return s;
}

// ---- Truth ----
const { issues, pulls } = build();
const open = issues.filter((i) => i.state === "open");
const closed = issues.filter((i) => i.state === "closed");
const has = (i: Issue, l: string) => i.labels.includes(l);
const assert = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`set4: ${what}`);
};

const notPlannedWebhooks = closed.filter((i) => has(i, "webhooks") && i.state_reason === "not_planned").length;
const completedBugs = closed.filter((i) => has(i, "bug") && i.state_reason === "completed");
const completedBugsByArea = new Map<string, number>();
for (const i of completedBugs) completedBugsByArea.set(i.labels[1], (completedBugsByArea.get(i.labels[1]) ?? 0) + 1);
const areaRank = [...completedBugsByArea.entries()].sort((a, b) => b[1] - a[1]);
assert(areaRank[0][1] > areaRank[1][1], "top area tie");
const topArea = areaRank[0];
const sev1Unassigned = open.filter((i) => has(i, "sev1") && i.assignees.length === 0).map((i) => i.number);
assert(sev1Unassigned.length >= 2, "sev1 unassigned too small");
const openPrTargets = new Set(pulls.filter((p) => p.state === "open").map((p) => Number(p.body.match(/#(\d+)/)![1])));
const sev2NoPr = open.filter((i) => has(i, "sev2") && !openPrTargets.has(i.number)).map((i) => i.number);
const hotfixMerged = pulls.filter((p) => p.base === "hotfix/2.9" && p.merged).length;
const wontfix = open.filter((i) => has(i, "wontfix-candidate")).map((i) => i.number);
assert(wontfix.length >= 4, "wontfix too small");
const exportsOpenBugs = open.filter((i) => has(i, "bug") && has(i, "exports")).map((i) => i.number);
const prOfIssue = pulls.find((p) => p.state === "open" && pulls.filter((q) => q.body.includes(`#${p.body.match(/#(\d+)/)![1]}.`)).length === 1)!;
const prTarget = Number(prOfIssue.body.match(/#(\d+)/)![1]);
const commentCountTop = [...open].sort((a, b) => b.comments.length - a.comments.length || a.number - b.number)[0];
const pctNotPlanned = Math.round((1000 * closed.filter((i) => i.state_reason === "not_planned").length) / closed.length) / 10;
const lookup = issues.find((i) => i.number > 100 && i.state === "closed" && i.assignees.length === 1 && i.comments.length >= 2)!;

export const set4Truth = {
  notPlannedWebhooks, topArea, sev1Unassigned, sev2NoPr, hotfixMerged, wontfix, exportsOpenBugs,
  pr: { number: prOfIssue.number, issue: prTarget }, commentCountTop: commentCountTop.number, pctNotPlanned,
  lookup: { number: lookup.number, reason: lookup.state_reason, assignee: lookup.assignees[0] },
};

// ---- Checks ----
const repo = (s: State) => s.repos[0];
const iss = (s: State, n: number) => repo(s).issues.find((i) => i.number === n)!;
const numbers = (t: string) => (t.replace(/(\d)[.,](\d{3})\b/g, "$1$2").match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(",", ".")));
const intSet = (t: string) => new Set((t.match(/\d+/g) ?? []).map(Number));
const sameSet = (got: Set<number>, want: number[]) => want.every((x) => got.has(x)) && [...got].every((x) => want.includes(x));
const words = (t: string) => new Set(t.toLowerCase().match(/[a-z_]+/g) ?? []);
const seeded = new Map(issues.map((i) => [i.number, i]));
const seededPulls = new Map(pulls.map((p) => [p.number, p]));
// Nothing outside `allowed` changed: issues, PRs, files on main and hotfix, branch count.
function untouched(s: State, allowed: number[], opts: { files?: boolean; branches?: number; pulls?: number } = {}) {
  const r = repo(s);
  const issuesOk = r.issues.every((i) => {
    if (allowed.includes(i.number)) return true;
    const o = seeded.get(i.number);
    return !!o && o.state === i.state && o.labels.join() === i.labels.join() && o.assignees.join() === i.assignees.join() &&
      o.comments.length === i.comments.length && o.state_reason === i.state_reason;
  }) && r.issues.length === issues.length;
  const pullsOk = r.pulls.length === pulls.length + (opts.pulls ?? 0) &&
    r.pulls.every((p) => !seededPulls.has(p.number) || (seededPulls.get(p.number)!.state === p.state && p.comments.length === 0));
  const filesOk = opts.files || (r.files.main["config/rates.yaml"] === RATES_MAIN && r.files.main["config/limits.json"] === LIMITS);
  const hotOk = r.files["hotfix/2.9"]["config/rates.yaml"] === RATES_HOTFIX;
  return issuesOk && pullsOk && filesOk && hotOk && Object.keys(r.branches).length === pulls.length + 2 + (opts.branches ?? 0);
}

export const set4Tasks: GhTask[] = [
  {
    id: "s4-lookup-reason",
    prompt: `En octo/billing, el issue #${lookup.number}: ¿con qué motivo se cerró (completed o not_planned) y a quién está asignado? Responde en el formato: motivo, usuario.`,
    check: (_s, t) => words(t).has(lookup.state_reason!) && words(t).has(lookup.assignees[0]) && !words(t).has(lookup.state_reason === "completed" ? "not_planned" : "completed"),
  },
  {
    id: "s4-pr-issue",
    prompt: `En octo/billing, ¿qué issue resuelve el pull request #${prOfIssue.number} según su descripción? Responde solo con el número del issue.`,
    check: (_s, t) => numbers(t)[0] === prTarget,
  },
  {
    id: "s4-hotfix-rate",
    prompt: "En octo/billing, ¿qué tasa tiene PE en config/rates.yaml en la rama hotfix/2.9? Responde solo con el número.",
    check: (_s, t) => numbers(t)[0] === 0.16,
  },
  {
    id: "s4-not-planned-webhooks",
    prompt: "¿Cuántos issues cerrados de octo/billing con la etiqueta webhooks se cerraron como \"not planned\"? Responde solo con el número.",
    check: (_s, t) => numbers(t)[0] === notPlannedWebhooks,
  },
  {
    id: "s4-top-completed-area",
    prompt: "Entre los issues cerrados de octo/billing con la etiqueta bug y motivo completed, ¿qué área (invoices, taxes, webhooks, exports o ledger) tiene más? " +
      "Responde en el formato: área, cantidad.",
    check: (_s, t) => words(t).has(topArea[0]) && numbers(t).includes(topArea[1]) && AREAS.filter((a) => words(t).has(a)).length === 1,
  },
  {
    id: "s4-pct-not-planned",
    prompt: "De todos los issues cerrados de octo/billing, ¿qué porcentaje se cerró como \"not planned\"? Responde solo con el porcentaje redondeado a 1 decimal.",
    check: (_s, t) => Math.abs(numbers(t)[0] - pctNotPlanned) < 0.051,
  },
  {
    id: "s4-sev2-no-pr",
    prompt: "En octo/billing cada pull request dice en su descripción qué issue resuelve (\"Resolves #N\"). ¿Qué issues abiertos con la etiqueta sev2 no son resueltos por ningún pull request abierto? " +
      "Responde solo con los números separados por coma.",
    check: (_s, t) => sameSet(intSet(t), sev2NoPr),
  },
  {
    id: "s4-hotfix-merged",
    prompt: "¿Cuántos pull requests de octo/billing hacia la rama hotfix/2.9 fueron mergeados? Responde solo con el número.",
    check: (_s, t) => numbers(t)[0] === hotfixMerged,
  },
  {
    id: "s4-most-commented",
    prompt: "¿Qué issue abierto de octo/billing tiene más comentarios? Si hay empate, el de número menor. Responde solo con el número.",
    check: (_s, t) => numbers(t)[0] === commentCountTop.number,
  },
  // --- Writes ---
  {
    id: "s4-close-wontfix",
    prompt: "En octo/billing, cierra como \"not planned\" todos los issues abiertos con la etiqueta wontfix-candidate y deja en cada uno el comentario exacto \"No se hará.\" (con el punto).",
    check: (s) => wontfix.every((n) => {
      const i = iss(s, n);
      return i.state === "closed" && i.state_reason === "not_planned" && i.comments.filter((c) => c.body.trim() === "No se hará.").length === 1;
    }) && untouched(s, wontfix),
  },
  {
    id: "s4-assign-sev1",
    prompt: "En octo/billing, asigna a dante todos los issues abiertos con la etiqueta sev1 que no tengan a nadie asignado.",
    check: (s) => sev1Unassigned.every((n) => iss(s, n).assignees.join() === "dante") && untouched(s, sev1Unassigned),
  },
  {
    id: "s4-triage-exports",
    prompt: "En octo/billing, agrega la etiqueta triaged a cada issue abierto que tenga las etiquetas bug y exports, sin quitar ninguna otra.",
    check: (s) => exportsOpenBugs.every((n) => [...iss(s, n).labels].sort().join() === [...seeded.get(n)!.labels, "triaged"].sort().join()) &&
      untouched(s, exportsOpenBugs),
  },
  {
    id: "s4-edit-rate",
    prompt: "En la rama main de octo/billing, cambia la tasa de PE en config/rates.yaml de 0.18 a 0.17 sin cambiar nada más del archivo.",
    check: (s) => repo(s).files.main["config/rates.yaml"] === RATES_EDITED && repo(s).files.main["config/limits.json"] === LIMITS && untouched(s, [], { files: true }),
  },
  {
    id: "s4-edit-retry",
    prompt: "En la rama main de octo/billing, en config/limits.json, sube retry.webhooks de 5 a 8 sin cambiar nada más del archivo.",
    check: (s) => repo(s).files.main["config/limits.json"] === LIMITS_EDITED && repo(s).files.main["config/rates.yaml"] === RATES_MAIN && untouched(s, [], { files: true }),
  },
  {
    id: "s4-changelog-pr",
    prompt: "En octo/billing, crea la rama release/2.9.1 desde hotfix/2.9, agrega el archivo CHANGELOG.md con este contenido exacto:\n" + CHANGELOG +
      "y abre un pull request de release/2.9.1 hacia main con el título exacto \"Release 2.9.1\".",
    check: (s) => {
      const r = repo(s);
      const pr = r.pulls.find((p) => p.head === "release/2.9.1" && p.base === "main" && p.state === "open");
      return r.files["release/2.9.1"]?.["CHANGELOG.md"] === CHANGELOG && r.files["release/2.9.1"]?.["config/rates.yaml"] === RATES_HOTFIX &&
        pr?.title.trim() === "Release 2.9.1" && untouched(s, [], { branches: 1, pulls: 1 });
    },
  },
];
