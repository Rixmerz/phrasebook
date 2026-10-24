// Fourth blind Notion task set: 12 tasks (8 read, 4 write) over the same seeded workspace.
// Written 2026-10-24 after the small-model glossary (glossary4s), frozen (sha256) before any run.
// No glossary, engine or proxy change is allowed after the freeze. Truths come from `seed()`.
import type { Block, Page, State } from "./seed.ts";
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
const userId = (first: string) => S0.users.find((u) => u.name.startsWith(first + " "))!.id;
const blocksOf = (s: State, pageId: string) => s.blocks.filter((b) => b.parent === pageId && !b.in_trash);
const NOTES = S0.pages.find((p) => p.props.title === "Notas de reunión")!;
const MEETINGS = S0.pages.filter((p) => p.parent.kind === "page" && p.parent.id === NOTES.id);
const topicOf = (m: Page) => (m.props.title as string).replace(/ \(.*\)$/, "");
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`blind4tasks: ${msg}`);
}
const titleCount = (title: unknown) => T0.filter((t) => t.props.Nombre === title).length;

const numbers = (text: string) => (text.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".")));
const isNumber = (n: number) => (_s: State, text: string) => {
  const ns = numbers(text);
  return ns.length > 0 && ns.every((x) => x === n);
};
const isSprint = (want: string) => (_s: State, text: string) => {
  const got = ["S1", "S2", "S3", "S4"].filter((s) => new RegExp(`\\b${s}\\b`).test(text));
  return got.length === 1 && got[0] === want;
};

// ---- truths ----------------------------------------------------------------------------
const DIEGO = userId("Diego");
const q1 = T0.filter((t) => open(t) && t.props.Prioridad === null).length;
const q2 = PR0.filter((p) => p.props.Estado === "Activo").reduce((a, p) => a + (p.props.Presupuesto as number), 0);
const bySprint = ["S1", "S2", "S3", "S4"].map((s) => [s, T0.filter((t) => open(t) && t.props.Sprint === s).length] as [string, number])
  .sort((a, b) => b[1] - a[1]);
assert(bySprint[0][1] > bySprint[1][1], "q3 has no unique winner");
const q3 = bySprint[0][0];
const q4 = T0.filter((t) => open(t) && t.props.Prioridad === "Alta" && String(t.props.Vence ?? "").startsWith("2026-10")).length;
const q5 = T0.filter((t) => tags(t).includes("backend") && tags(t).includes("bug")).length;
const q6 = T0.filter((t) => t.props.Estado === "Hecha" && t.props.Revisada === false).length;
const q7 = MEETINGS.flatMap((m) => blocksOf(S0, m.id)).filter((b) => b.type === "to_do" && b.checked).length;
const q8 = T0.filter((t) => open(t) && owners(t).includes(DIEGO)).length;

// w1: move a unique non-S4 task to Sprint S4
const w1 = T0.find((t) => t.props.Sprint !== "S4" && titleCount(t.props.Nombre) === 1)!;
// w2: add the bug tag to a unique task without it, keeping its other tags
const w2 = T0.find((t) => !tags(t).includes("bug") && tags(t).length > 0 && titleCount(t.props.Nombre) === 1 && t.id !== w1.id)!;
// w3: check an unchecked agreement in "Retro de octubre"
const retro = MEETINGS.find((m) => topicOf(m) === "Retro de octubre")!;
const unchecked = blocksOf(S0, retro.id).filter((b) => b.type === "to_do" && !b.checked);
const w3: Block | undefined = unchecked.find((b) => unchecked.filter((x) => x.text === b.text).length === 1);
// w4: comment on a unique task
const w4 = T0.find((t) => titleCount(t.props.Nombre) === 1 && t.id !== w1.id && t.id !== w2.id && open(t))!;
const W4_TEXT = "Revisado en la daily del jueves.";

for (const [k, v] of Object.entries({ q1, q2, q4, q5, q6, q7, q8 })) assert(v > 0, `${k} is zero`);
assert(!!w1 && !!w2 && !!w3 && !!w4, "write targets");

export const NOTION_BLIND4_TRUTH = { q1, q2, q3, q4, q5, q6, q7, q8, w1: w1.props.Nombre, w2: w2.props.Nombre, w3: w3!.text, w4: w4.props.Nombre };

const OPEN = "(abierta = Estado distinto de Hecha)";
const page = (s: State, id: string) => s.pages.find((p) => p.id === id)!;

export const notionBlind4Tasks: NotionTask[] = [
  {
    id: "n4-sin-prioridad",
    prompt: `En Tareas, ¿cuántas tareas abiertas ${OPEN} no tienen Prioridad asignada? Responde solo con el número.`,
    check: isNumber(q1),
  },
  {
    id: "n4-presupuesto-activos",
    prompt: "En Proyectos, ¿cuál es la suma del Presupuesto de los proyectos en Estado Activo? Responde solo con el número, sin separador de miles.",
    check: isNumber(q2),
  },
  {
    id: "n4-sprint-cargado",
    prompt: `En Tareas, ¿qué Sprint tiene más tareas abiertas ${OPEN}? Responde solo con el nombre del Sprint.`,
    check: isSprint(q3),
  },
  {
    id: "n4-alta-octubre",
    prompt: `En Tareas, ¿cuántas tareas abiertas ${OPEN} con Prioridad Alta vencen (propiedad Vence) en octubre de 2026? Responde solo con el número.`,
    check: isNumber(q4),
  },
  {
    id: "n4-backend-bug",
    prompt: "En Tareas, ¿cuántas tareas tienen a la vez las etiquetas backend y bug? Responde solo con el número.",
    check: isNumber(q5),
  },
  {
    id: "n4-hechas-sin-revisar",
    prompt: "En Tareas, ¿cuántas tareas en Estado Hecha no tienen marcada la casilla Revisada? Responde solo con el número.",
    check: isNumber(q6),
  },
  {
    id: "n4-acuerdos-marcados",
    prompt: "¿Cuántos acuerdos (to-dos) marcados como completados hay en total en las páginas de reunión dentro de \"Notas de reunión\"? Responde solo con el número.",
    check: isNumber(q7),
  },
  {
    id: "n4-diego-abiertas",
    prompt: `En Tareas, ¿cuántas tareas abiertas ${OPEN} tienen a Diego entre sus responsables? Responde solo con el número.`,
    check: isNumber(q8),
  },
  {
    id: "n4-mover-sprint",
    writes: true,
    prompt: `En Tareas, cambia el Sprint de la tarea "${w1.props.Nombre}" a S4. No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => page(s, w1.id).props.Sprint === "S4" && unchangedExcept(s, { pages: [w1.id] }) &&
      JSON.stringify({ ...page(s, w1.id).props, Sprint: null }) === JSON.stringify({ ...w1.props, Sprint: null }),
  },
  {
    id: "n4-agregar-bug",
    writes: true,
    prompt: `En Tareas, agrega la etiqueta bug a la tarea "${w2.props.Nombre}" y deja sus otras etiquetas. No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => {
      const p = page(s, w2.id);
      const want = [...tags(w2), "bug"].sort();
      return JSON.stringify([...tags(p)].sort()) === JSON.stringify(want) && unchangedExcept(s, { pages: [w2.id] }) &&
        JSON.stringify({ ...p.props, Etiquetas: null }) === JSON.stringify({ ...w2.props, Etiquetas: null });
    },
  },
  {
    id: "n4-marcar-retro",
    writes: true,
    prompt: `En la reunión "Retro de octubre", marca como completado el acuerdo "${w3!.text}". No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => {
      const b = s.blocks.find((x) => x.id === w3!.id);
      return !!b && !b.in_trash && b.checked === true && b.text === w3!.text && unchangedExcept(s, { blocks: [w3!.id] });
    },
  },
  {
    id: "n4-comentar-tarea",
    writes: true,
    prompt: `En Tareas, agrega un comentario a la tarea "${w4.props.Nombre}" con el texto exacto "${W4_TEXT}". No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => {
      const ids0 = new Set(S0.comments.map((c) => c.id));
      const added = s.comments.filter((c) => !ids0.has(c.id));
      return added.length === 1 && added[0].page === w4.id && added[0].text.trim() === W4_TEXT && unchangedExcept(s, { newComments: 1 });
    },
  },
];
