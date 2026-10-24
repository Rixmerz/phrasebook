// Data-heavy GitHub tasks over a repository with 240 issues: aggregation,
// filtering across pages, and bulk writes. This is where code mode should win;
// the tasks exist to find out by how much, and whether the glossary breaks.
// Frozen before the tool-search and code-search arms and the auto glossary were built.
import type { Issue, State } from "./mock.ts";
import type { GhTask } from "./tasks.ts";
import { seed } from "./tasks.ts";

const PEOPLE = ["ana", "bruno", "carla", "diego", "elena"];
const AREAS = ["login", "dashboard", "export", "billing", "search", "crash", "upload", "settings"];

// Deterministic pseudo-random generator, so every run sees the same repository.
function rng(seedValue: number) {
  let x = seedValue;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

export function bulkIssues(): Issue[] {
  const rand = rng(42);
  const out: Issue[] = [];
  for (let n = 1; n <= 240; n++) {
    const area = AREAS[Math.floor(rand() * AREAS.length)];
    const kind = rand() < 0.55 ? "bug" : rand() < 0.5 ? "enhancement" : "chore";
    const labels = [kind];
    if (rand() < 0.15) labels.push("stale");
    if (area === "billing" && rand() < 0.5) labels.push("finance");
    const assignees = rand() < 0.2 ? [] : [PEOPLE[Math.floor(rand() * PEOPLE.length)]];
    const closed = rand() < 0.35;
    const reason = closed ? (rand() < 0.3 ? "not_planned" : "completed") : null;
    const month = rand() < 0.4 ? 8 : 9; // August or September 2026
    const day = 1 + Math.floor(rand() * 28);
    const created = new Date(Date.UTC(2026, month - 1, day, Math.floor(rand() * 24))).toISOString();
    out.push({
      number: n, title: `${area[0].toUpperCase()}${area.slice(1)}: issue ${n}`, body: `Report about ${area}.`,
      state: closed ? "closed" : "open", state_reason: reason, labels, assignees,
      author: PEOPLE[Math.floor(rand() * PEOPLE.length)], comments: [], created_at: created, updated_at: created,
    });
  }
  return out;
}

export function bulkSeed(): State {
  const s = seed();
  const r = s.repos[0];
  r.name = "big";
  r.issues = bulkIssues();
  r.pulls = [];
  r.labels = ["bug", "enhancement", "chore", "stale", "finance", "p1"];
  return s;
}

const truth = bulkIssues();
const open = truth.filter((i) => i.state === "open");
const big = (s: State) => s.repos[0];
const nums = (text: string) => new Set((text.match(/\d+/g) ?? []).map(Number));
const sameSet = (a: Set<number>, b: number[]) => b.every((x) => a.has(x)) && [...a].every((x) => b.includes(x));

const openBugsAna = open.filter((i) => i.labels.includes("bug") && i.assignees.includes("ana")).length;
const loadByPerson = Object.fromEntries(PEOPLE.map((p) => [p, open.filter((i) => i.assignees.includes(p)).length]));
const busiest = Object.entries(loadByPerson).sort((a, b) => b[1] - a[1])[0][0];
const staleOpen = open.filter((i) => i.labels.includes("stale")).map((i) => i.number);
const crashOpen = open.filter((i) => /crash/i.test(i.title)).map((i) => i.number);
const septCreated = truth.filter((i) => i.created_at.startsWith("2026-09")).length;
const unassignedOpenBugs = open.filter((i) => i.labels.includes("bug") && i.assignees.length === 0).map((i) => i.number);
const oldestOpenBugs = open.filter((i) => i.labels.includes("bug")).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
  .slice(0, 5).map((i) => i.number);
const closed = truth.filter((i) => i.state === "closed");
const notPlannedPct = Math.round((100 * closed.filter((i) => i.state_reason === "not_planned").length) / closed.length);

// Exposed for the README and for sanity checks; not shown to models.
export const bulkTruth = {
  openBugsAna, busiest, loadByPerson, staleOpen, crashOpen, septCreated, unassignedOpenBugs, oldestOpenBugs, notPlannedPct,
};

export const bulkTasks: GhTask[] = [
  {
    id: "d-count-filter",
    prompt: "¿Cuántos issues abiertos con la etiqueta bug están asignados a ana en octo/big? Responde solo con el número.",
    check: (_s, t) => t.trim().replace(/\D/g, "") === String(openBugsAna),
  },
  {
    id: "d-busiest",
    prompt: "En octo/big, ¿qué persona tiene más issues abiertos asignados? Responde solo con el usuario.",
    check: (_s, t) => new RegExp(`\\b${busiest}\\b`, "i").test(t) && PEOPLE.filter((p) => p !== busiest).every((p) => !new RegExp(`\\b${p}\\b`, "i").test(t)),
  },
  {
    id: "d-close-stale",
    prompt: "En octo/big, cierra como no planificados todos los issues abiertos que tengan la etiqueta stale. No toques ningún otro.",
    check: (s) => big(s).issues.every((i) => {
      const was = truth.find((x) => x.number === i.number)!;
      if (staleOpen.includes(i.number)) return i.state === "closed" && i.state_reason === "not_planned";
      return i.state === was.state && i.state_reason === was.state_reason;
    }),
  },
  {
    id: "d-label-crash",
    prompt: "En octo/big, agrega la etiqueta p1 a cada issue abierto cuyo título mencione crash, sin quitarle sus otras etiquetas.",
    check: (s) => big(s).issues.every((i) => {
      const was = truth.find((x) => x.number === i.number)!;
      const want = crashOpen.includes(i.number) ? [...was.labels, "p1"] : was.labels;
      return want.length === i.labels.length && want.every((l) => i.labels.includes(l));
    }),
  },
  {
    id: "d-count-month",
    prompt: "¿Cuántos issues de octo/big (abiertos o cerrados) se crearon en septiembre de 2026? Responde solo con el número.",
    check: (_s, t) => t.trim().replace(/\D/g, "") === String(septCreated),
  },
  {
    id: "d-unassigned-bugs",
    prompt: "Lista los números de los issues abiertos de octo/big con etiqueta bug y sin nadie asignado. Solo los números, separados por coma.",
    check: (_s, t) => sameSet(nums(t), unassignedOpenBugs),
  },
  {
    id: "d-comment-oldest",
    prompt: 'En octo/big, deja el comentario "triaged" en los 5 issues abiertos con etiqueta bug más antiguos (por fecha de creación).',
    check: (s) => big(s).issues.every((i) => {
      const has = i.comments.some((c) => /triaged/i.test(c.body));
      return has === oldestOpenBugs.includes(i.number) && i.comments.length <= 1;
    }),
  },
  {
    id: "d-pct-not-planned",
    prompt:
      "En octo/big, ¿qué porcentaje de los issues cerrados se cerró como no planificado? Responde solo con el porcentaje redondeado a entero.",
    check: (_s, t) => (t.match(/\d+/) ?? [""])[0] === String(notPlannedPct),
  },
];
