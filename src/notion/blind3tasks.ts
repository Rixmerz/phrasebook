// Third blind Notion task set: 12 tasks (8 read, 4 write) over the same seeded workspace.
// Written 2026-10-24 after glossary 4.1, and frozen (sha256) before any run.
// No glossary, engine or proxy change is allowed after the freeze. Truths come from `seed()`.
import type { Page, State } from "./seed.ts";
import { PROJECTS_DS, seed, TASKS_DS } from "./seed.ts";
import { type NotionTask, unchangedExcept } from "./blindtasks.ts";

const S0 = seed();
const norm = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");
const tasksOf = (s: State) => s.pages.filter((p) => p.parent.kind === "data_source" && p.parent.id === TASKS_DS && !p.in_trash);
const T0 = tasksOf(S0);
const PR0 = S0.pages.filter((p) => p.parent.kind === "data_source" && p.parent.id === PROJECTS_DS && !p.in_trash);
const open = (t: Page) => t.props.Estado !== "Hecha";
const owners = (t: Page) => t.props.Responsable as string[];
const tags = (t: Page) => t.props.Etiquetas as string[];
const est = (t: Page) => (t.props.Estimación as number | null) ?? 0;
const userName = (id: string) => S0.users.find((u) => u.id === id)!.name;
const NOTES = S0.pages.find((p) => p.props.title === "Notas de reunión")!;
const MEETINGS = S0.pages.filter((p) => p.parent.kind === "page" && p.parent.id === NOTES.id);
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`blind3tasks: ${msg}`);
}
const titleCount = (title: unknown) => T0.filter((t) => t.props.Nombre === title).length;

const numbers = (text: string) => (text.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".")));
const isNumber = (n: number) => (_s: State, text: string) => {
  const ns = numbers(text);
  return ns.length > 0 && ns.every((x) => x === n);
};
const PROJECT_NAMES = PR0.map((p) => p.props.Nombre as string);
const isProject = (want: string) => (_s: State, text: string) => {
  const got = PROJECT_NAMES.filter((n) => norm(text).includes(norm(n)));
  return got.length === 1 && got[0] === want;
};
const PEOPLE = S0.users.filter((u) => u.type === "person").map((u) => u.name);
const isPerson = (want: string) => (_s: State, text: string) => {
  const got = PEOPLE.filter((n) => norm(text).includes(norm(n)) || norm(text).includes(norm(n.split(" ")[0])));
  return got.length === 1 && got[0] === want;
};

// ---- truths ----------------------------------------------------------------------------
// q1: open tasks due in November
const q1 = T0.filter((t) => open(t) && typeof t.props.Vence === "string" && (t.props.Vence as string).startsWith("2026-11")).length;
// q2: active project with the most open tasks
const openBy = PR0.filter((p) => p.props.Estado === "Activo")
  .map((p) => [p, T0.filter((t) => open(t) && (t.props.Proyecto as string[]).includes(p.id)).length] as [Page, number])
  .sort((a, b) => b[1] - a[1]);
assert(openBy[0][1] > openBy[1][1], "q2 has no unique winner");
const q2 = openBy[0][0].props.Nombre as string;
// q3: open bug-tagged tasks with no Estimación
const q3 = T0.filter((t) => open(t) && tags(t).includes("bug") && t.props.Estimación == null).length;
// q4: person with the most points in open Alta tasks (each owner counts the full estimate)
const pts = new Map<string, number>();
for (const t of T0.filter((t) => open(t) && t.props.Prioridad === "Alta")) for (const o of owners(t)) pts.set(o, (pts.get(o) ?? 0) + est(t));
const ranked = [...pts].sort((a, b) => b[1] - a[1]);
assert(ranked[0][1] > ranked[1][1], "q4 has no unique winner");
const q4 = userName(ranked[0][0]);
// q5: total number of to-dos across all meetings
const q5 = S0.blocks.filter((b) => !b.in_trash && b.type === "to_do" && MEETINGS.some((m) => m.id === b.parent)).length;
// q6: tasks with a non-empty Notas
const q6 = T0.filter((t) => ((t.props.Notas as string) ?? "") !== "").length;
// q7: tasks with two or more owners
const q7 = T0.filter((t) => owners(t).length >= 2).length;
// q8: sum of Estimación of open frontend tasks in S4
const q8 = T0.filter((t) => open(t) && t.props.Sprint === "S4" && tags(t).includes("frontend")).reduce((a, t) => a + est(t), 0);

// w1: set Estimación of a unique open task that has none to 3
const w1 = T0.find((t) => open(t) && t.props.Estimación == null && titleCount(t.props.Nombre) === 1)!;
// w2: mark Revisada on a unique done, unreviewed task
const w2 = T0.find((t) => t.props.Estado === "Hecha" && t.props.Revisada === false && titleCount(t.props.Nombre) === 1)!;
// w3: comment on a project page
const w3 = PR0.find((p) => p.props.Estado === "Pausado")!;
const W3_TEXT = "Revisar si se reactiva en noviembre.";
// w4: move a unique En curso task to Bloqueada
const w4 = T0.find((t) => t.props.Estado === "En curso" && titleCount(t.props.Nombre) === 1 && t.id !== w1.id)!;

for (const [k, v] of Object.entries({ q1, q3, q5, q6, q7, q8 })) assert(v > 0, `${k} is zero`);
assert(!!w1 && !!w2 && !!w3 && !!w4, "write targets");

export const NOTION_BLIND3_TRUTH = { q1, q2, q3, q4, q5, q6, q7, q8, w1: w1.props.Nombre, w2: w2.props.Nombre, w3: w3.props.Nombre, w4: w4.props.Nombre };

const OPEN = "(abierta = Estado distinto de Hecha)";
const page = (s: State, id: string) => s.pages.find((p) => p.id === id)!;
const onlyChanged = (s: State, t: Page, key: string) => {
  const p = page(s, t.id);
  return unchangedExcept(s, { pages: [t.id] }) && !p.in_trash &&
    JSON.stringify({ ...p.props, [key]: null }) === JSON.stringify({ ...t.props, [key]: null });
};

export const notionBlind3Tasks: NotionTask[] = [
  {
    id: "n3-vencen-noviembre",
    prompt: `En Tareas, ¿cuántas tareas abiertas ${OPEN} tienen fecha Vence en noviembre de 2026? Responde solo con el número.`,
    check: isNumber(q1),
  },
  {
    id: "n3-proyecto-mas-abiertas",
    prompt: `Entre los proyectos en Estado Activo, ¿cuál tiene más tareas abiertas ${OPEN} relacionadas? Responde solo con el nombre del proyecto.`,
    check: isProject(q2),
  },
  {
    id: "n3-bugs-sin-estimar",
    prompt: `En Tareas, ¿cuántas tareas abiertas ${OPEN} con la etiqueta bug no tienen Estimación? Responde solo con el número.`,
    check: isNumber(q3),
  },
  {
    id: "n3-puntos-alta",
    prompt: `En Tareas, considerando solo las tareas abiertas ${OPEN} con Prioridad Alta, ¿qué persona suma más puntos de Estimación como responsable? (si una tarea tiene varios responsables, cuenta la estimación completa para cada uno) Responde solo con el nombre de la persona.`,
    check: isPerson(q4),
  },
  {
    id: "n3-total-acuerdos",
    prompt: "¿Cuántos acuerdos (to-dos), marcados o no, hay en total sumando todas las páginas de reunión dentro de \"Notas de reunión\"? Responde solo con el número.",
    check: isNumber(q5),
  },
  {
    id: "n3-con-notas",
    prompt: "En Tareas, ¿cuántas tareas tienen algo escrito en la propiedad Notas? Responde solo con el número.",
    check: isNumber(q6),
  },
  {
    id: "n3-varios-responsables",
    prompt: "En Tareas, ¿cuántas tareas tienen dos o más responsables? Responde solo con el número.",
    check: isNumber(q7),
  },
  {
    id: "n3-frontend-s4",
    prompt: `En Tareas, ¿cuántos puntos de Estimación suman las tareas abiertas ${OPEN} del Sprint S4 con la etiqueta frontend? Responde solo con el número.`,
    check: isNumber(q8),
  },
  {
    id: "n3-estimar",
    writes: true,
    prompt: `En Tareas, pon la Estimación de la tarea "${w1.props.Nombre}" en 3. No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => page(s, w1.id).props.Estimación === 3 && onlyChanged(s, w1, "Estimación"),
  },
  {
    id: "n3-marcar-revisada",
    writes: true,
    prompt: `En Tareas, marca la casilla Revisada de la tarea "${w2.props.Nombre}". No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => page(s, w2.id).props.Revisada === true && onlyChanged(s, w2, "Revisada"),
  },
  {
    id: "n3-comentar-proyecto",
    writes: true,
    prompt: `En Proyectos, agrega un comentario a la página del proyecto "${w3.props.Nombre}" con el texto exacto "${W3_TEXT}". No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => {
      const ids0 = new Set(S0.comments.map((c) => c.id));
      const added = s.comments.filter((c) => !ids0.has(c.id));
      return added.length === 1 && added[0].page === w3.id && added[0].text.trim() === W3_TEXT && unchangedExcept(s, { newComments: 1 });
    },
  },
  {
    id: "n3-bloquear",
    writes: true,
    prompt: `En Tareas, cambia el Estado de la tarea "${w4.props.Nombre}" a Bloqueada. No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => page(s, w4.id).props.Estado === "Bloqueada" && onlyChanged(s, w4, "Estado"),
  },
];
