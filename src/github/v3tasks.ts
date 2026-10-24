// Held-out tasks for glossary v3, frozen before v3 was built.
// - bulk2: a different 300-issue repository (octo/big2), aggregation and bulk writes.
// - exact: file content that must survive byte for byte (quotes, backslashes, tabs,
//   trailing spaces, trailing newline).
import type { Issue, State } from "./mock.ts";
import type { GhTask } from "./tasks.ts";
import { seed } from "./tasks.ts";
import { hardSeed } from "./hard.ts";

const PEOPLE = ["ana", "bruno", "carla", "diego", "elena", "felipe"];
const AREAS = ["Billing", "Login", "Search", "Upload", "Reports", "Settings", "Sync"];

function rng(seedValue: number) {
  let x = seedValue;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

export function bulk2Issues(): Issue[] {
  const rand = rng(7);
  const out: Issue[] = [];
  for (let n = 1; n <= 300; n++) {
    const area = AREAS[Math.floor(rand() * AREAS.length)];
    const r = rand();
    const kind = r < 0.5 ? "bug" : r < 0.8 ? "enhancement" : "chore";
    const labels = [kind];
    if (rand() < 0.12) labels.push("wontfix");
    if (rand() < 0.2) labels.push("needs-info");
    const assignees = rand() < 0.25 ? [] : [PEOPLE[Math.floor(rand() * PEOPLE.length)]];
    const closed = rand() < 0.4;
    const month = rand() < 0.5 ? 8 : 9;
    const day = 1 + Math.floor(rand() * 28);
    const created = new Date(Date.UTC(2026, month - 1, day, Math.floor(rand() * 24))).toISOString();
    out.push({
      number: n, title: `${area}: report ${n}`, body: `Area ${area}.`, state: closed ? "closed" : "open",
      state_reason: closed ? "completed" : null, labels, assignees, author: PEOPLE[Math.floor(rand() * PEOPLE.length)],
      comments: [], created_at: created, updated_at: created,
    });
  }
  return out;
}

export function bulk2Seed(): State {
  const s = seed();
  const r = s.repos[0];
  r.name = "big2";
  r.issues = bulk2Issues();
  r.pulls = [];
  r.labels = ["bug", "enhancement", "chore", "wontfix", "needs-info", "billing-review"];
  return s;
}

const truth = bulk2Issues();
const open = truth.filter((i) => i.state === "open");
const closedBugsDiego = truth.filter((i) => i.state === "closed" && i.labels.includes("bug") && i.assignees.includes("diego")).length;
const labelCounts: Record<string, number> = {};
for (const i of open) for (const l of i.labels) labelCounts[l] = (labelCounts[l] ?? 0) + 1;
const topLabel = Object.entries(labelCounts).sort((a, b) => b[1] - a[1])[0][0];
const wontfixOpen = open.filter((i) => i.labels.includes("wontfix")).map((i) => i.number);
const billingOpen = open.filter((i) => i.title.startsWith("Billing")).map((i) => i.number);
const augustOpen = open.filter((i) => i.created_at.startsWith("2026-08")).length;
const elenaEnh = open.filter((i) => i.labels.includes("enhancement") && i.assignees.includes("elena")).map((i) => i.number);

export const bulk2Truth = { closedBugsDiego, labelCounts, topLabel, wontfixOpen, billingOpen, augustOpen, elenaEnh };

const big = (s: State) => s.repos[0];
const nums = (text: string) => new Set((text.match(/\d+/g) ?? []).map(Number));
const sameSet = (a: Set<number>, b: number[]) => b.every((x) => a.has(x)) && [...a].every((x) => b.includes(x));
const unchangedExcept = (s: State, touched: number[], ok: (i: Issue, was: Issue) => boolean) =>
  big(s).issues.every((i) => {
    const was = truth.find((x) => x.number === i.number)!;
    if (touched.includes(i.number)) return ok(i, was);
    return i.state === was.state && i.labels.length === was.labels.length && was.labels.every((l) => i.labels.includes(l));
  });

export const bulk2Tasks: GhTask[] = [
  {
    id: "b2-closed-bugs-diego",
    prompt: "¿Cuántos issues cerrados con etiqueta bug están asignados a diego en octo/big2? Responde solo con el número.",
    check: (_s, t) => t.trim().replace(/\D/g, "") === String(closedBugsDiego),
  },
  {
    id: "b2-top-label",
    prompt: "Entre los issues abiertos de octo/big2, ¿qué etiqueta aparece en más issues? Responde solo con la etiqueta.",
    check: (_s, t) => new RegExp(`\\b${topLabel}\\b`, "i").test(t) &&
      Object.keys(labelCounts).filter((l) => l !== topLabel).every((l) => !new RegExp(`\\b${l}\\b`, "i").test(t)),
  },
  {
    id: "b2-close-wontfix",
    prompt: "En octo/big2, cierra como no planificados todos los issues abiertos con la etiqueta wontfix. No toques ningún otro.",
    check: (s) => unchangedExcept(s, wontfixOpen, (i) => i.state === "closed" && i.state_reason === "not_planned"),
  },
  {
    id: "b2-label-billing",
    prompt:
      "En octo/big2, agrega la etiqueta billing-review a cada issue abierto cuyo título empiece con \"Billing\", sin quitarle sus otras etiquetas.",
    check: (s) => unchangedExcept(s, billingOpen, (i, was) =>
      i.state === was.state && i.labels.includes("billing-review") && was.labels.every((l) => i.labels.includes(l)) &&
      i.labels.length === was.labels.length + 1),
  },
  {
    id: "b2-august-open",
    prompt: "¿Cuántos issues abiertos de octo/big2 se crearon en agosto de 2026? Responde solo con el número.",
    check: (_s, t) => t.trim().replace(/\D/g, "") === String(augustOpen),
  },
  {
    id: "b2-elena-enh",
    prompt: "Lista los números de los issues abiertos de octo/big2 con etiqueta enhancement asignados a elena. Solo los números, separados por coma.",
    check: (_s, t) => sameSet(nums(t), elenaEnh),
  },
];

// Exact-content tasks on octo/app, with files whose bytes are easy to damage.
export const ENV_FILE = 'API_URL="https://api.example.com"\nTOKEN_HINT=\'none\'\n\tINDENTED=yes\nWIN_PATH=C:\\tools\\bin\nTRAILING=spaces   \n';
export const NOTES_FILE = "line one  \nline two\n\n";
export const CHANGELOG = '## 1.5.0\n- Fixed "login" crash\n- Path: C:\\app\\bin\n';

export function exactSeed(): State {
  const s = hardSeed();
  const r = s.repos[0];
  for (const branch of Object.keys(r.files)) {
    r.files[branch] = { ...r.files[branch], "config/app.env": ENV_FILE, "docs/notes.md": NOTES_FILE };
  }
  delete r.files["feat/theme"]["config/app.env"];
  return s;
}

const app = (s: State) => s.repos[0];

export const exactTasks: GhTask[] = [
  {
    id: "e-copy-to-branch",
    prompt: "En octo/app, copia config/app.env de la rama main a la rama feat/theme (misma ruta), con exactamente el mismo contenido.",
    check: (s) => app(s).files["feat/theme"]?.["config/app.env"] === ENV_FILE && app(s).files.main["config/app.env"] === ENV_FILE,
  },
  {
    id: "e-backup-branch",
    prompt:
      "En octo/app, crea la rama backup/env desde main y agrega en ella el archivo backup/app.env con exactamente el contenido de config/app.env.",
    check: (s) => !!app(s).branches["backup/env"] && app(s).files["backup/env"]?.["backup/app.env"] === ENV_FILE,
  },
  {
    id: "e-changelog",
    prompt:
      "En la rama main de octo/app, crea el archivo docs/CHANGELOG.md con exactamente este contenido (incluido el salto de línea final):\n" +
      "```\n" + CHANGELOG + "```",
    check: (s) => app(s).files.main["docs/CHANGELOG.md"] === CHANGELOG,
  },
  {
    id: "e-pr-body-file",
    prompt: "En la rama main de octo/app, crea el archivo docs/pr12.md cuyo contenido sea exactamente el cuerpo del PR #12, sin agregar nada.",
    check: (s) => app(s).files.main["docs/pr12.md"] === "Closes #8.\n\nAdds a 5s cache.",
  },
  {
    id: "e-notes-copy",
    prompt: "En la rama main de octo/app, duplica docs/notes.md como docs/notes-copy.md, idéntico byte a byte.",
    check: (s) => app(s).files.main["docs/notes-copy.md"] === NOTES_FILE && app(s).files.main["docs/notes.md"] === NOTES_FILE,
  },
];
