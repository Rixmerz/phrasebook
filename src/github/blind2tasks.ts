// Second held-out task set, written blind by an independent author (no access to the arms or the glossary).
// Repo octo/telemetry, an observability backend: 260 issues and 72 pull requests, so listings need several pages.
// Every expected answer is computed from the generator below, never written by hand.
import type { Comment, Issue, Pull, State } from "./mock.ts";
import type { GhTask } from "./tasks.ts";
import { seed } from "./tasks.ts";

const PEOPLE = ["mateo", "sofia", "tomas", "valentina", "lucas", "renata", "nicolas", "paula", "joaquin", "isidora", "bastian"];
const AREAS = ["ingest", "alerting", "dashboards", "storage", "query-api"];
const KINDS = ["bug", "feature", "chore", "docs"];
const PRIORITIES = ["p1", "p2", "p3"];
const N_ISSUES = 260;
const N_PULLS = 72;
const PR_BASE = 500; // PR numbers never collide with issue numbers
const RELEASE = "release/4.2";

function rng(seedValue: number) {
  let x = seedValue;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

const pick = <T>(rand: () => number, xs: T[]) => xs[Math.floor(rand() * xs.length)];
const day = (d: number) => new Date(Date.UTC(2026, 3, 1 + (d % 120), d % 24, (d * 7) % 60)).toISOString();

const SUBJECTS: Record<string, string[]> = {
  ingest: ["OTLP receiver", "batch processor", "Kafka consumer", "log shipper", "span sampler"],
  alerting: ["silence rules", "PagerDuty route", "alert grouping", "threshold evaluator", "notification templates"],
  dashboards: ["heatmap panel", "time picker", "dashboard import", "panel legend", "variable dropdown"],
  storage: ["compaction job", "retention sweeper", "WAL replay", "block index", "cold tier upload"],
  "query-api": ["PromQL parser", "range query cache", "label values endpoint", "query timeout", "pagination cursor"],
};
const SYMPTOMS = [
  "Seen in staging after the last deploy.", "Customers on the EU cluster reported it twice this week.",
  "Only happens under high cardinality.", "Repro steps are in the linked runbook.", "Logs show repeated retries.",
  "Memory grows slowly until the pod restarts.", "Not reproducible locally yet.", "Started after the Go upgrade.",
];
const PR_LINES = [
  "Adds a regression test for the reported case.", "Refactors the hot path to avoid an extra allocation.",
  "Benchmarks show roughly 12% less CPU on the ingest node.", "No config changes are needed for existing users.",
  "Feature-flagged behind `telemetry.experimental` for now.", "Updates the docs page accordingly.",
  "Reviewed with the on-call team on Tuesday.", "Rollback is safe: the change is backwards compatible.",
];

function build() {
  const rand = rng(20267);
  const issues: Issue[] = [];
  for (let n = 1; n <= N_ISSUES; n++) {
    const area = pick(rand, AREAS);
    const kind = rand() < 0.4 ? "bug" : pick(rand, KINDS);
    const prio = PRIORITIES[Math.floor(Math.pow(rand(), 1.3) * 3)];
    const labels = [kind, area, prio];
    if (rand() < 0.06) labels.push("obsolete");
    if (rand() < 0.1) labels.push("good-first-issue");
    const r = rand();
    // Skewed assignment so rankings have a clear order.
    const assignees = r < 0.22 ? [] : [PEOPLE[Math.min(PEOPLE.length - 1, Math.floor(Math.pow(rand(), 1.8) * PEOPLE.length))]];
    const ncomments = Math.floor(rand() * 5);
    const comments: Comment[] = Array.from({ length: ncomments }, (_, k) => {
      const who = pick(rand, PEOPLE);
      return { id: n * 100 + k, body: `${pick(rand, SYMPTOMS)} (${who})`, user: { login: who, id: 2000 + PEOPLE.indexOf(who) }, created_at: day(n + k) };
    });
    const closed = rand() < 0.3;
    const subject = pick(rand, SUBJECTS[area]);
    const verb = kind === "bug" ? "fails intermittently" : kind === "feature" ? "should support multi-tenant mode" : kind === "chore" ? "needs dependency bump" : "is undocumented";
    const body = rand() < 0.5
      ? `The ${subject} ${verb}. ${pick(rand, SYMPTOMS)}`
      : `## Context\nThe ${subject} ${verb}.\n\n## Notes\n- ${pick(rand, SYMPTOMS)}\n- ${pick(rand, SYMPTOMS)}\n`;
    issues.push({
      number: n, title: `${subject} ${verb}`, body, state: closed ? "closed" : "open",
      state_reason: closed ? (rand() < 0.25 ? "not_planned" : "completed") : null,
      labels, assignees, author: pick(rand, PEOPLE), comments, created_at: day(n), updated_at: day(n + 2),
    });
  }
  const pulls: Pull[] = [];
  for (let k = 1; k <= N_PULLS; k++) {
    const number = PR_BASE + k;
    const target = 1 + Math.floor(rand() * N_ISSUES);
    const st = rand();
    const state = st < 0.5 ? "open" : "closed";
    const merged = state === "closed" && rand() < 0.65;
    const base = rand() < 0.3 ? RELEASE : "main";
    const author = PEOPLE[Math.min(PEOPLE.length - 1, Math.floor(Math.pow(rand(), 1.5) * PEOPLE.length))];
    const lines = [pick(rand, PR_LINES), pick(rand, PR_LINES)];
    const multi = rand() < 0.45;
    const body = multi
      ? `### Summary\n${lines[0]}\n\n### Details\n- ${lines[1]}\n- Touches the ${pick(rand, AREAS)} module.\n\nCloses #${target}`
      : `${lines[0]} ${lines[1]} Closes #${target}.`;
    const t = issues[target - 1];
    pulls.push({
      number, title: `${t.labels[0] === "bug" ? "fix" : "feat"}(${t.labels[1]}): ${t.title.split(" ").slice(0, 3).join(" ")}`,
      body, state, merged, merge_method: merged ? "squash" : null, head: `${author}/i${target}-${k}`, base, author,
      draft: state === "open" && rand() < 0.15, files: [], comments: [], created_at: day(k * 1.5 | 0), updated_at: day((k * 1.5 | 0) + 1),
    });
  }
  return { issues, pulls };
}

const RETENTION_MAIN = "# Storage retention policy\nretention:\n  # days of raw samples\n  retention_days: 30\n  downsample_after_days: 7\n\ncompaction:\n  interval: 2h\n";
const RETENTION_RELEASE = RETENTION_MAIN.replace("retention_days: 30", "retention_days: 21");
const RETENTION_EDITED = RETENTION_MAIN.replace("retention_days: 30", "retention_days: 45");
const RUNBOOK = "# Ingest runbook\n\n1. Check the OTLP receiver dashboard.\n2. Restart the batch processor if the queue exceeds 10000.\n";
const RUNBOOK_BRANCH = "docs/ingest-runbook";
const RUNBOOK_PATH = "docs/runbooks/ingest.md";
const RUNBOOK_TITLE = "Add ingest runbook";

function mainFiles(): Record<string, string> {
  return {
    "README.md": "# telemetry\n\nMetrics, logs and traces backend for octo.\n",
    "config/retention.yaml": RETENTION_MAIN,
    "cmd/ingest/main.go": "package main\n\nfunc main() {}\n",
  };
}

export function blind2Seed(): State {
  const s = seed();
  const r = s.repos[0];
  r.name = "telemetry";
  const { issues, pulls } = build();
  r.issues = issues;
  r.pulls = pulls;
  const main = mainFiles();
  r.files = { main, [RELEASE]: { ...main, "config/retention.yaml": RETENTION_RELEASE } };
  r.branches = { main: "c3".repeat(20), [RELEASE]: "d4".repeat(20) };
  for (const p of pulls) {
    r.branches[p.head] = p.number.toString(16).padStart(4, "0").repeat(10);
    r.files[p.head] = { ...r.files[p.base] };
  }
  r.labels = [...KINDS, ...AREAS, ...PRIORITIES, "obsolete", "good-first-issue", "backlog"];
  s.users = [...PEOPLE, "octo"];
  return s;
}

// ---- Truth, computed from the same generator ----
const { issues, pulls } = build();
const open = issues.filter((i) => i.state === "open");
const has = (i: Issue, l: string) => i.labels.includes(l);
const ref = (p: Pull) => Number(p.body.match(/#(\d+)/)![1]);
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`blind2tasks: ${msg}`);
}
const strictTop = (entries: [string, number][], k: number) => {
  const r = [...entries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (let j = 0; j < k; j++) assert(r[j] !== undefined && (r[j + 1] === undefined || r[j][1] > r[j + 1][1]), `ranking tie at ${j}: ${JSON.stringify(r)}`);
  return r.slice(0, k);
};
const countBy = (xs: string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()];
};

// Lookups
const labelIssue = issues.find((i) => i.number > 120 && i.assignees.length === 1 && i.labels.length >= 4)!;
const basePr = pulls.find((p) => p.number > PR_BASE + 40 && p.base === RELEASE)!;
const refCounts = countBy(pulls.map((p) => String(ref(p))));
const uniqRefPr = pulls.find((p) => p.number > PR_BASE + 20 && refCounts.find(([k]) => k === String(ref(p)))![1] === 1)!;
const uniqRefIssue = ref(uniqRefPr);

// Aggregations
const openP1Alerting = open.filter((i) => has(i, "alerting") && has(i, "p1")).length;
const topMergers = strictTop(countBy(pulls.filter((p) => p.merged).map((p) => p.author)), 3);
const prRefs = new Set(pulls.map(ref));
const ingestBugsNoPr = open.filter((i) => has(i, "bug") && has(i, "ingest") && !prRefs.has(i.number)).map((i) => i.number);
const openReleasePrs = pulls.filter((p) => p.state === "open" && p.base === RELEASE).map((p) => p.number);
const pctUnassigned = Math.round((1000 * open.filter((i) => i.assignees.length === 0).length) / open.length) / 10;

// Writes
const obsolete = open.filter((i) => has(i, "obsolete")).map((i) => i.number);
const backlog = open.filter((i) => has(i, "storage") && has(i, "chore") && i.assignees.length === 0).map((i) => i.number);
const releaseTargets = [...new Set(pulls.filter((p) => p.state === "open" && p.base === RELEASE).map(ref))]
  .filter((n) => issues[n - 1].state === "open").sort((a, b) => a - b);

assert(ingestBugsNoPr.length >= 2 && obsolete.length >= 3 && backlog.length >= 2 && releaseTargets.length >= 3, "write/aggregation sets too small");
assert(openReleasePrs.length >= 3, "too few open release PRs");
assert(issues.every((i) => !/#\d/.test(i.body)), "issue bodies must not reference numbers");

export const blind2Truth = {
  labelIssue: { number: labelIssue.number, labels: labelIssue.labels, assignee: labelIssue.assignees[0] },
  basePr: { number: basePr.number, base: basePr.base, author: basePr.author },
  uniqRef: { issue: uniqRefIssue, pr: uniqRefPr.number },
  releaseRetention: 21,
  openP1Alerting, topMergers, ingestBugsNoPr, openReleasePrs: openReleasePrs.length, pctUnassigned,
  obsolete, backlog, releaseTargets,
  sizes: { issues: issues.length, open: open.length, pulls: pulls.length, openPulls: pulls.filter((p) => p.state === "open").length, merged: pulls.filter((p) => p.merged).length },
};

// ---- Checks ----
const repo = (s: State) => s.repos[0];
const iss = (s: State, n: number) => repo(s).issues.find((i) => i.number === n)!;
const clean = (t: string) => t.replace(/(\d)[.,](\d{3})\b/g, "$1$2");
const numbers = (t: string) => (clean(t).match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(",", ".")));
const firstNumber = (t: string) => numbers(t)[0];
const intSet = (t: string) => new Set((t.match(/\d+/g) ?? []).map(Number));
const sameSet = (got: Set<number>, want: number[]) => want.every((x) => got.has(x)) && [...got].every((x) => want.includes(x));
const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9][a-z0-9./_-]*[a-z0-9]|[a-z0-9]/g) ?? []);
const seededIssues = new Map(issues.map((i) => [i.number, i]));
const seededPulls = new Map(pulls.map((p) => [p.number, p]));
const SEEDED_MAIN = mainFiles();

// True when nothing outside the allowed issues changed: issue state/labels/comments, every seeded PR,
// no new issues or PRs (unless allowed), and the main and release file trees (unless allowed).
function untouched(s: State, o: { issues?: number[]; newPull?: boolean; mainFile?: string; newBranch?: string } = {}) {
  const r = repo(s);
  const issuesOk = r.issues.length === issues.length && r.issues.every((i) => {
    if (o.issues?.includes(i.number)) return true;
    const x = seededIssues.get(i.number);
    return !!x && x.state === i.state && x.state_reason === i.state_reason && x.labels.join() === i.labels.join() &&
      x.comments.length === i.comments.length && x.assignees.join() === i.assignees.join() && x.title === i.title && x.body === i.body;
  });
  const pullsOk = r.pulls.length === pulls.length + (o.newPull ? 1 : 0) && r.pulls.every((p) => {
    const x = seededPulls.get(p.number);
    if (!x) return !!o.newPull;
    return x.state === p.state && x.merged === p.merged && x.base === p.base && x.title === p.title && x.body === p.body && x.comments.length === p.comments.length;
  });
  const mainOk = Object.keys(SEEDED_MAIN).every((f) => f === o.mainFile || r.files.main[f] === SEEDED_MAIN[f]) &&
    Object.keys(r.files.main).length === Object.keys(SEEDED_MAIN).length;
  const relOk = r.files[RELEASE]?.["config/retention.yaml"] === RETENTION_RELEASE;
  const branchesOk = Object.keys(r.branches).length === pulls.length + 2 + (o.newBranch ? 1 : 0);
  return issuesOk && pullsOk && mainOk && relOk && branchesOk;
}

const labelsAre = (s: State, n: number, want: string[]) => [...iss(s, n).labels].sort().join() === [...want].sort().join();

export const blind2Tasks: GhTask[] = [
  // --- Lookups ---
  {
    id: "c-issue-labels-assignee",
    prompt: `En octo/telemetry, ¿qué etiquetas tiene el issue #${labelIssue.number} y a quién está asignado? ` +
      "Responde en el formato: etiquetas separadas por coma; usuario.",
    check: (_s, t) => {
      const w = words(t);
      const allLabels = [...KINDS, ...AREAS, ...PRIORITIES, "obsolete", "good-first-issue"];
      const gotLabels = allLabels.filter((l) => w.has(l));
      const gotPeople = PEOPLE.filter((p) => w.has(p));
      return gotLabels.sort().join() === [...labelIssue.labels].sort().join() && gotPeople.length === 1 && gotPeople[0] === labelIssue.assignees[0];
    },
  },
  {
    id: "c-pr-base-author",
    prompt: `En octo/telemetry, ¿hacia qué rama base apunta el pull request #${basePr.number} y quién lo abrió? ` +
      "Responde en el formato: rama, usuario.",
    check: (_s, t) => {
      const w = words(t.replace(/[`*]/g, ""));
      const gotPeople = PEOPLE.filter((p) => w.has(p));
      return w.has(basePr.base) && !w.has("main") && gotPeople.length === 1 && gotPeople[0] === basePr.author;
    },
  },
  {
    id: "c-pr-for-issue",
    prompt: `En octo/telemetry, cada pull request dice en su descripción qué issue cierra ("Closes #N"). ` +
      `¿Qué pull request cierra el issue #${uniqRefIssue}? Responde solo con el número del pull request.`,
    check: (_s, t) => {
      const got = [...intSet(t)].filter((n) => n !== uniqRefIssue);
      return got.length === 1 && got[0] === uniqRefPr.number;
    },
  },
  {
    id: "c-release-retention",
    prompt: `En octo/telemetry, ¿qué valor tiene retention_days en config/retention.yaml en la rama ${RELEASE}? Responde solo con el número.`,
    check: (_s, t) => numbers(t.replace(/4\.2/g, "")).includes(21) && !numbers(t).includes(30),
  },
  // --- Aggregations / joins ---
  {
    id: "c-open-p1-alerting",
    prompt: "¿Cuántos issues abiertos de octo/telemetry tienen a la vez las etiquetas alerting y p1? Responde solo con el número.",
    check: (_s, t) => firstNumber(t.replace(/\bp1\b/gi, "")) === openP1Alerting,
  },
  {
    id: "c-top-mergers",
    prompt: "En octo/telemetry, ¿quiénes son las 3 personas con más pull requests mergeados (merged) como autoras? " +
      "Responde con una línea por persona, de mayor a menor, en el formato: usuario: cantidad.",
    check: (_s, t) => {
      const found = [...t.toLowerCase().matchAll(/([a-z]+)\W+(\d+)/g)].filter((m) => PEOPLE.includes(m[1])).map((m) => [m[1], Number(m[2])] as const);
      return found.length >= 3 && found.slice(0, 3).every(([u, c], k) => u === topMergers[k][0] && c === topMergers[k][1]);
    },
  },
  {
    id: "c-ingest-bugs-no-pr",
    prompt: "En octo/telemetry, cada pull request indica en su descripción el issue que cierra (\"Closes #N\"). " +
      "¿Qué issues abiertos con las etiquetas bug e ingest no son referenciados por ningún pull request (abierto o cerrado)? " +
      "Responde solo con los números de issue separados por coma.",
    check: (_s, t) => sameSet(intSet(t), ingestBugsNoPr),
  },
  {
    id: "c-open-release-prs",
    prompt: `¿Cuántos pull requests abiertos de octo/telemetry tienen como rama base ${RELEASE}? Responde solo con el número.`,
    check: (_s, t) => firstNumber(t.replace(/release\/4\.2/g, "")) === openReleasePrs.length,
  },
  {
    id: "c-pct-unassigned",
    prompt: "De los issues abiertos de octo/telemetry, ¿qué porcentaje no tiene a nadie asignado? " +
      "Responde solo con el porcentaje redondeado a 1 decimal.",
    check: (_s, t) => Math.abs(firstNumber(t) - pctUnassigned) < 0.051,
  },
  // --- Writes ---
  {
    id: "c-close-obsolete",
    prompt: "En octo/telemetry, cierra todos los issues abiertos que tengan la etiqueta obsolete, con motivo \"not planned\", " +
      "y deja en cada uno el comentario exacto \"Cerrado: ya no aplica tras la migración a v4.\" (con el punto final).",
    check: (s) =>
      obsolete.every((n) => {
        const i = iss(s, n);
        return i.state === "closed" && i.state_reason === "not_planned" && labelsAre(s, n, seededIssues.get(n)!.labels) &&
          i.comments.length === seededIssues.get(n)!.comments.length + 1 &&
          i.comments.filter((c) => c.body.trim() === "Cerrado: ya no aplica tras la migración a v4.").length === 1;
      }) && untouched(s, { issues: obsolete }),
  },
  {
    id: "c-label-backlog",
    prompt: "En octo/telemetry, agrega la etiqueta backlog a cada issue abierto que tenga las etiquetas storage y chore y no tenga a nadie asignado. " +
      "No quites ninguna etiqueta existente.",
    check: (s) =>
      backlog.every((n) => labelsAre(s, n, [...seededIssues.get(n)!.labels, "backlog"]) && iss(s, n).state === "open" &&
        iss(s, n).comments.length === seededIssues.get(n)!.comments.length) && untouched(s, { issues: backlog }),
  },
  {
    id: "c-edit-retention",
    prompt: "En la rama main de octo/telemetry, cambia retention_days de config/retention.yaml a 45. " +
      "No cambies nada más del archivo (comentarios, indentación, líneas en blanco y salto de línea final intactos).",
    check: (s) => repo(s).files.main["config/retention.yaml"] === RETENTION_EDITED && untouched(s, { mainFile: "config/retention.yaml" }),
  },
  {
    id: "c-runbook-pr",
    prompt: `En octo/telemetry, crea la rama ${RUNBOOK_BRANCH} a partir de main, agrega en ella el archivo ${RUNBOOK_PATH} con este contenido exacto ` +
      "(con salto de línea final):\n" + RUNBOOK +
      `y abre un pull request de ${RUNBOOK_BRANCH} hacia main con el título exacto: ${RUNBOOK_TITLE}`,
    check: (s) => {
      const r = repo(s);
      const pr = r.pulls.find((p) => p.head === RUNBOOK_BRANCH && p.base === "main" && p.state === "open");
      const br = r.files[RUNBOOK_BRANCH] ?? {};
      return br[RUNBOOK_PATH] === RUNBOOK && Object.keys(br).length === Object.keys(SEEDED_MAIN).length + 1 &&
        Object.entries(SEEDED_MAIN).every(([f, c]) => br[f] === c) && pr?.title.trim() === RUNBOOK_TITLE &&
        untouched(s, { newPull: true, newBranch: RUNBOOK_BRANCH });
    },
  },
  {
    id: "c-comment-release-targets",
    prompt: `En octo/telemetry, busca los pull requests abiertos cuya rama base sea ${RELEASE}; cada uno dice en su descripción qué issue cierra ("Closes #N"). ` +
      "En cada uno de esos issues que siga abierto, deja el comentario exacto: Planificado para 4.2.1",
    check: (s) =>
      releaseTargets.every((n) => {
        const i = iss(s, n);
        return i.comments.length === seededIssues.get(n)!.comments.length + 1 && i.comments.filter((c) => c.body.trim() === "Planificado para 4.2.1").length === 1 &&
          i.state === "open" && labelsAre(s, n, seededIssues.get(n)!.labels);
      }) && untouched(s, { issues: releaseTargets }),
  },
];
