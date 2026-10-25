// Fifth blind Notion task set: 12 tasks (8 read, 4 write) over the same seeded workspace.
// Written 2026-10-24 after the people-filter recipe in glossary4s, frozen (sha256) before any run.
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
const userId = (first: string) => S0.users.find((u) => u.name.startsWith(first + " "))!.id;
const blocksOf = (s: State, pageId: string) => s.blocks.filter((b) => b.parent === pageId && !b.in_trash);
const NOTES = S0.pages.find((p) => p.props.title === "Notas de reunión")!;
const MEETINGS = S0.pages.filter((p) => p.parent.kind === "page" && p.parent.id === NOTES.id);
const topicOf = (m: Page) => (m.props.title as string).replace(/ \(.*\)$/, "");
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`blind5tasks: ${msg}`);
}
const titleCount = (title: unknown) => T0.filter((t) => t.props.Nombre === title).length;

const numbers = (text: string) => (text.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".")));
const isNumber = (n: number) => (_s: State, text: string) => {
  const ns = numbers(text);
  return ns.length > 0 && ns.every((x) => x === n);
};

// ---- truths ----------------------------------------------------------------------------
const q1 = T0.filter((t) => open(t) && t.props.Prioridad === "Media" && t.props.Sprint === "S3").length;
const q2 = T0.filter((t) => t.props.Estado === "Bloqueada").reduce((a, t) => a + ((t.props.Estimación as number | null) ?? 0), 0);
const rich = [...PR0].sort((a, b) => (b.props.Presupuesto as number) - (a.props.Presupuesto as number));
assert((rich[0].props.Presupuesto as number) > (rich[1].props.Presupuesto as number), "q3 has no unique winner");
const q3 = rich[0].props.Nombre as string;
const q4 = T0.filter((t) => String(t.props.Notas).includes("staging")).length;
const q5 = T0.filter((t) => open(t) && tags(t).includes("frontend") && owners(t).length === 0).length;
const q6 = T0.filter((t) => open(t) && t.props.Prioridad === "Alta" && owners(t).includes(userId("Bruno"))).length;
const demo = MEETINGS.find((m) => topicOf(m) === "Demo a clientes")!;
const q7 = blocksOf(S0, demo.id).filter((b) => b.type === "bulleted_list_item").length;
const portal = PR0.find((p) => p.props.Nombre === "Portal de socios")!;
const q8 = T0.filter((t) => open(t) && (t.props.Proyecto as string[]).includes(portal.id)).length;
const PROJECT_NAMES = PR0.map((p) => p.props.Nombre as string);
const isProject = (want: string) => (_s: State, text: string) => {
  const got = PROJECT_NAMES.filter((n) => norm(text).includes(norm(n)));
  return got.length === 1 && got[0] === want;
};

// w1: give Prioridad Media to a unique task with none
const w1 = T0.find((t) => t.props.Prioridad === null && titleCount(t.props.Nombre) === 1)!;
// w2: assign Elena Mora to a unique open task with no owner
const ELENA = userId("Elena");
const w2 = T0.find((t) => open(t) && owners(t).length === 0 && titleCount(t.props.Nombre) === 1 && t.id !== w1.id)!;
// w3: add an agreement to "Planificación S3"
const plan3 = MEETINGS.find((m) => topicOf(m) === "Planificación S3")!;
const W3_TEXT = "Revisar alertas de staging (Bruno)";
// w4: move a unique Bloqueada task to En curso
const w4 = T0.find((t) => t.props.Estado === "Bloqueada" && titleCount(t.props.Nombre) === 1 && t.id !== w1.id && t.id !== w2.id)!;

for (const [k, v] of Object.entries({ q1, q2, q4, q5, q6, q7, q8 })) assert(v > 0, `${k} is zero`);
assert(!!w1 && !!w2 && !!plan3 && !!w4, "write targets");

export const NOTION_BLIND5_TRUTH = { q1, q2, q3, q4, q5, q6, q7, q8, w1: w1.props.Nombre, w2: w2.props.Nombre, w4: w4.props.Nombre };

const OPEN = "(abierta = Estado distinto de Hecha)";
const page = (s: State, id: string) => s.pages.find((p) => p.id === id)!;
const onlyChanged = (s: State, t0: Page, key: string) => unchangedExcept(s, { pages: [t0.id] }) &&
  JSON.stringify({ ...page(s, t0.id).props, [key]: null }) === JSON.stringify({ ...t0.props, [key]: null });

export const notionBlind5Tasks: NotionTask[] = [
  { id: "n5-media-s3", prompt: `En Tareas, ¿cuántas tareas abiertas ${OPEN} del Sprint S3 tienen Prioridad Media? Responde solo con el número.`, check: isNumber(q1) },
  { id: "n5-estimacion-bloqueadas", prompt: "En Tareas, ¿cuántos puntos de Estimación suman las tareas en Estado Bloqueada? Responde solo con el número.", check: isNumber(q2) },
  { id: "n5-mayor-presupuesto", prompt: "En Proyectos, ¿qué proyecto tiene el Presupuesto más alto? Responde solo con el nombre del proyecto.", check: isProject(q3) },
  { id: "n5-notas-staging", prompt: "En Tareas, ¿cuántas tareas mencionan staging en la propiedad Notas? Responde solo con el número.", check: isNumber(q4) },
  { id: "n5-frontend-sin-responsable", prompt: `En Tareas, ¿cuántas tareas abiertas ${OPEN} con la etiqueta frontend no tienen responsable? Responde solo con el número.`, check: isNumber(q5) },
  { id: "n5-bruno-alta", prompt: `En Tareas, ¿cuántas tareas abiertas ${OPEN} con Prioridad Alta tienen a Bruno entre sus responsables? Responde solo con el número.`, check: isNumber(q6) },
  { id: "n5-asistentes-demo", prompt: "En la reunión \"Demo a clientes\" (dentro de \"Notas de reunión\"), ¿cuántas personas aparecen como asistentes? Responde solo con el número.", check: isNumber(q7) },
  { id: "n5-portal-abiertas", prompt: `¿Cuántas tareas abiertas ${OPEN} están relacionadas con el proyecto "Portal de socios"? Responde solo con el número.`, check: isNumber(q8) },
  {
    id: "n5-poner-prioridad", writes: true,
    prompt: `En Tareas, pon la Prioridad de la tarea "${w1.props.Nombre}" en Media. No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => page(s, w1.id).props.Prioridad === "Media" && onlyChanged(s, w1, "Prioridad"),
  },
  {
    id: "n5-asignar-elena", writes: true,
    prompt: `En Tareas, asigna a Elena Mora como responsable de la tarea "${w2.props.Nombre}". No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => JSON.stringify(owners(page(s, w2.id))) === JSON.stringify([ELENA]) && onlyChanged(s, w2, "Responsable"),
  },
  {
    id: "n5-agregar-acuerdo", writes: true,
    prompt: `En la reunión "Planificación S3", agrega al final un acuerdo (to-do sin marcar) con el texto "${W3_TEXT}". No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => {
      const added = s.blocks.filter((b) => b.parent === plan3.id && !b.in_trash && !S0.blocks.some((x) => x.id === b.id));
      return added.length === 1 && added[0].type === "to_do" && !added[0].checked && added[0].text === W3_TEXT &&
        unchangedExcept(s, { newBlocksUnder: [plan3.id] });
    },
  },
  {
    id: "n5-desbloquear", writes: true,
    prompt: `En Tareas, cambia el Estado de la tarea "${w4.props.Nombre}" a En curso. No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => page(s, w4.id).props.Estado === "En curso" && onlyChanged(s, w4, "Estado"),
  },
];
