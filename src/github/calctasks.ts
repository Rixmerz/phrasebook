// Held-out tasks for glossary v3.2: arithmetic across results, joins between two
// queries, and exact content without a trailing newline. Frozen before v3.2 was built.
import type { Comment, Issue, Pull, State } from "./mock.ts";
import type { GhTask } from "./tasks.ts";
import { seed } from "./tasks.ts";

const PEOPLE = ["ana", "bruno", "carla", "diego", "elena", "felipe", "gaby"];
const AREAS = ["Auth", "Cart", "Export", "Mobile", "Payments", "Search"];

function rng(seedValue: number) {
  let x = seedValue;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

function build() {
  const rand = rng(11);
  const day = (d: number) => new Date(Date.UTC(2026, 8, 1 + (d % 28), d % 24)).toISOString();
  const issues: Issue[] = [];
  for (let n = 1; n <= 120; n++) {
    const area = AREAS[Math.floor(rand() * AREAS.length)];
    const labels = [rand() < 0.45 ? "bug" : rand() < 0.6 ? "enhancement" : "chore"];
    const assignees = rand() < 0.2 ? [] : [PEOPLE[Math.floor(rand() * 5)]]; // only the first five people get issues
    const ncomments = Math.floor(rand() * 7);
    const comments: Comment[] = Array.from({ length: ncomments }, (_, k) => ({
      id: n * 100 + k, body: `note ${k + 1}`, user: { login: PEOPLE[k % PEOPLE.length], id: k }, created_at: day(n + k),
    }));
    issues.push({
      number: n, title: `${area}: issue ${n}`, body: `About ${area}.`, state: rand() < 0.3 ? "closed" : "open",
      state_reason: null, labels, assignees, author: PEOPLE[Math.floor(rand() * PEOPLE.length)], comments,
      created_at: day(n), updated_at: day(n),
    });
  }
  for (const i of issues) if (i.state === "closed") i.state_reason = "completed";
  const pulls: Pull[] = [];
  for (let k = 0; k < 24; k++) {
    const number = 200 + k;
    pulls.push({
      number, title: `Change ${k}`, body: `Work on #${1 + Math.floor(rand() * 120)}.`, state: rand() < 0.65 ? "open" : "closed",
      merged: false, merge_method: null, head: `feat/c${k}`, base: "main", author: PEOPLE[2 + Math.floor(rand() * 5)], draft: false,
      files: [], comments: [], created_at: day(k), updated_at: day(k),
    });
  }
  return { issues, pulls };
}

export const VERSION_FILE = "2.0.1";

export function calcSeed(): State {
  const s = seed();
  const r = s.repos[0];
  r.name = "calc";
  const { issues, pulls } = build();
  r.issues = issues;
  r.pulls = pulls;
  for (const p of pulls) {
    r.branches[p.head] = (p.number.toString(16).padStart(2, "0")).repeat(20).slice(0, 40);
    r.files[p.head] = { ...r.files.main };
  }
  r.files.main = { ...r.files.main, VERSION: VERSION_FILE };
  r.labels = ["bug", "enhancement", "chore"];
  s.users = [...PEOPLE, "octo"];
  return s;
}

const { issues, pulls } = build();
const open = issues.filter((i) => i.state === "open");
const openBugs = open.filter((i) => i.labels.includes("bug"));
const pctBug = Math.round((100 * openBugs.length) / open.length);
const avgBugComments = Math.round((10 * openBugs.reduce((s, i) => s + i.comments.length, 0)) / openBugs.length) / 10;
const carlaComments = issues.filter((i) => i.assignees.includes("carla")).reduce((s, i) => s + i.comments.length, 0);
const openAssignees = new Set(open.flatMap((i) => i.assignees));
const openPrAuthors = new Set(pulls.filter((p) => p.state === "open").map((p) => p.author));
const assignedNoPr = [...openAssignees].filter((p) => !openPrAuthors.has(p)).sort();
const prsByAssigned = pulls.filter((p) => p.state === "open" && openAssignees.has(p.author)).length;
const maxComments = Math.max(...open.map((i) => i.comments.length));
const mostCommented = open.filter((i) => i.comments.length === maxComments).map((i) => i.number);

export const calcTruth = { pctBug, avgBugComments, carlaComments, assignedNoPr, prsByAssigned, mostCommented, openCount: open.length };

const app = (s: State) => s.repos[0];
const firstNumber = (t: string) => (t.match(/-?\d+(?:[.,]\d+)?/) ?? [""])[0].replace(",", ".");

export const calcTasks: GhTask[] = [
  {
    id: "c-pct-bugs",
    prompt: "¿Qué porcentaje de los issues abiertos de octo/calc tiene la etiqueta bug? Responde solo con el porcentaje redondeado a entero.",
    check: (_s, t) => firstNumber(t) === String(pctBug),
  },
  {
    id: "c-avg-comments",
    prompt:
      "¿Cuál es el promedio de comentarios por issue abierto con etiqueta bug en octo/calc? Responde solo con el número redondeado a 1 decimal.",
    check: (_s, t) => Number(firstNumber(t)) === avgBugComments,
  },
  {
    id: "c-sum-comments",
    prompt: "¿Cuántos comentarios suman en total los issues de octo/calc asignados a carla, abiertos o cerrados? Responde solo con el número.",
    check: (_s, t) => firstNumber(t) === String(carlaComments),
  },
  {
    id: "c-assigned-no-pr",
    prompt:
      "En octo/calc, ¿qué personas tienen al menos un issue abierto asignado pero no son autoras de ningún PR abierto? " +
      "Responde solo con los usuarios separados por coma.",
    check: (_s, t) => {
      const got = new Set((t.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => [...PEOPLE].includes(w)));
      return assignedNoPr.every((p) => got.has(p)) && [...got].every((p) => assignedNoPr.includes(p));
    },
  },
  {
    id: "c-prs-by-assigned",
    prompt:
      "En octo/calc, ¿cuántos PR abiertos fueron abiertos por personas que también tienen al menos un issue abierto asignado? Responde solo con el número.",
    check: (_s, t) => firstNumber(t) === String(prsByAssigned),
  },
  {
    id: "c-most-commented",
    prompt: "¿Qué issue abierto de octo/calc tiene más comentarios? Responde solo con el número del issue (si hay empate, todos separados por coma).",
    check: (_s, t) => {
      const got = new Set((t.match(/\d+/g) ?? []).map(Number));
      return mostCommented.every((n) => got.has(n)) && [...got].every((n) => mostCommented.includes(n));
    },
  },
  {
    id: "c-copy-version",
    prompt: "En la rama main de octo/calc, crea docs/version.txt con exactamente el mismo contenido que VERSION (ojo: no termina en salto de línea).",
    check: (s) => app(s).files.main["docs/version.txt"] === VERSION_FILE,
  },
  {
    id: "c-tag-no-newline",
    prompt: "En la rama main de octo/calc, crea el archivo docs/tag.txt cuyo contenido sea exactamente v2.0.1, sin salto de línea final.",
    check: (s) => app(s).files.main["docs/tag.txt"] === "v2.0.1",
  },
];
