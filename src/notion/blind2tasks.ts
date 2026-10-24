// Second blind Notion task set: 12 tasks (8 read, 4 write) over the same seeded workspace.
// Written 2026-10-24 after the glossary fixes of that day, and frozen (sha256) before any run.
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
const est = (t: Page) => (t.props.Estimación as number | null) ?? 0;
const userId = (first: string) => S0.users.find((u) => u.name.startsWith(first + " "))!.id;
const blocksOf = (s: State, pageId: string) => s.blocks.filter((b) => b.parent === pageId && !b.in_trash);
const NOTES = S0.pages.find((p) => p.props.title === "Notas de reunión")!;
const MEETINGS = S0.pages.filter((p) => p.parent.kind === "page" && p.parent.id === NOTES.id);
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`blind2tasks: ${msg}`);
}
const unique = <T>(xs: T[], msg: string): T => {
  assert(xs.length === 1, msg);
  return xs[0];
};
const titleCount = (title: unknown) => T0.filter((t) => t.props.Nombre === title).length;

const numbers = (text: string) => (text.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".")));
const isNumber = (n: number) => (_s: State, text: string) => {
  const ns = numbers(text);
  return ns.length > 0 && ns.every((x) => x === n);
};
const ALL_TITLES = [...new Set(T0.map((t) => t.props.Nombre as string))];
const isTitles = (want: string[]) => (_s: State, text: string) =>
  JSON.stringify(ALL_TITLES.filter((t) => norm(text).includes(norm(t))).sort()) === JSON.stringify([...new Set(want)].sort());
const topicOf = (m: Page) => (m.props.title as string).replace(/ \(.*\)$/, "");
const TOPICS = MEETINGS.map(topicOf);
const isTopic = (want: string) => (_s: State, text: string) => {
  const got = TOPICS.filter((t) => norm(text).includes(norm(t)));
  return got.length === 1 && got[0] === want;
};

// ---- truths ----------------------------------------------------------------------------
const CARLA = userId("Carla");
const q1 = T0.filter((t) => open(t) && t.props.Prioridad === "Baja" && owners(t).length === 0).length;
const q2 = T0.filter((t) => open(t) && t.props.Sprint === "S2" && owners(t).includes(CARLA)).reduce((a, t) => a + est(t), 0);
const q3 = T0.filter((t) => t.props.Estado === "Bloqueada" && tags(t).includes("infra")).map((t) => t.props.Nombre as string);
const q4 = PR0.filter((p) => p.props.Estado === "Pausado").reduce((a, p) => a + (p.props.Presupuesto as number), 0);
const pending = MEETINGS.map((m) => [m, blocksOf(S0, m.id).filter((b) => b.type === "to_do" && !b.checked).length] as [Page, number])
  .sort((a, b) => b[1] - a[1]);
assert(pending[0][1] > pending[1][1], "q5 has no unique winner");
const q5 = topicOf(pending[0][0]);
const q6 = T0.filter((t) => open(t) && (t.props.Proyecto as string[]).length === 0).length;
const q7 = T0.filter((t) => t.props.Estado === "Hecha" && t.props.Revisada === true && t.props.Sprint === "S3").length;
const meetingIds = new Set(MEETINGS.map((m) => m.id));
const q8 = S0.comments.filter((c) => meetingIds.has(c.page)).length;

// w1: raise a unique open Baja task to Alta
const w1 = T0.find((t) => open(t) && t.props.Prioridad === "Baja" && titleCount(t.props.Nombre) === 1)!;
// w2: remove "docs" from a unique task that has docs and at least one other tag
const w2 = T0.find((t) => tags(t).includes("docs") && tags(t).length > 1 && titleCount(t.props.Nombre) === 1)!;
// w3: add a step to the onboarding guide
const GUIDE = S0.pages.find((p) => p.props.title === "Guía de onboarding")!;
const W3_TEXT = "Pedir acceso a Grafana a Bruno.";
// w4: uncheck a checked agreement in "Planificación S2"
const plan2 = unique(MEETINGS.filter((m) => topicOf(m) === "Planificación S2"), "plan S2");
const checked = blocksOf(S0, plan2.id).filter((b) => b.type === "to_do" && b.checked);
const w4: Block = checked.find((b) => checked.filter((x) => x.text === b.text).length === 1)!;

for (const [k, v] of Object.entries({ q1, q2, q4, q6, q7, q8 })) assert(v > 0, `${k} is zero`);
assert(q3.length > 0 && q3.length <= 10 && new Set(q3).size === q3.length, "q3 shape");
assert(!!w1 && !!w2 && !!w4, "write targets");

export const NOTION_BLIND2_TRUTH = { q1, q2, q3, q4, q5, q6, q7, q8, w1: w1.props.Nombre, w2: w2.props.Nombre, w4: w4.text };

const OPEN = "(abierta = Estado distinto de Hecha)";
const page = (s: State, id: string) => s.pages.find((p) => p.id === id)!;

export const notionBlind2Tasks: NotionTask[] = [
  {
    id: "n2-baja-sin-responsable",
    prompt: `En Tareas, ¿cuántas tareas abiertas ${OPEN} con Prioridad Baja no tienen ningún responsable? Responde solo con el número.`,
    check: isNumber(q1),
  },
  {
    id: "n2-carla-s2",
    prompt: `En Tareas, ¿cuántos puntos de Estimación suman las tareas abiertas ${OPEN} del Sprint S2 que tienen a Carla Soto entre sus responsables? Responde solo con el número.`,
    check: isNumber(q2),
  },
  {
    id: "n2-infra-bloqueadas",
    prompt: "En Tareas, ¿qué tareas están en Estado Bloqueada y tienen la etiqueta infra? Responde solo con sus nombres, uno por línea.",
    check: isTitles(q3),
  },
  {
    id: "n2-presupuesto-pausados",
    prompt: "En Proyectos, ¿cuál es la suma del Presupuesto de los proyectos en Estado Pausado? Responde solo con el número, sin separador de miles.",
    check: isNumber(q4),
  },
  {
    id: "n2-reunion-pendientes",
    prompt: "Entre las páginas dentro de \"Notas de reunión\", ¿qué reunión tiene más acuerdos (to-dos) sin marcar? Responde solo con el tema de la reunión, sin la fecha.",
    check: isTopic(q5),
  },
  {
    id: "n2-sin-proyecto",
    prompt: `En Tareas, ¿cuántas tareas abiertas ${OPEN} no están relacionadas con ningún Proyecto? Responde solo con el número.`,
    check: isNumber(q6),
  },
  {
    id: "n2-revisadas-s3",
    prompt: "En Tareas, ¿cuántas tareas del Sprint S3 están en Estado Hecha y tienen marcada la casilla Revisada? Responde solo con el número.",
    check: isNumber(q7),
  },
  {
    id: "n2-comentarios-reuniones",
    prompt: "¿Cuántos comentarios hay en total en las páginas de reunión dentro de \"Notas de reunión\"? Responde solo con el número.",
    check: isNumber(q8),
  },
  {
    id: "n2-subir-prioridad",
    writes: true,
    prompt: `En Tareas, cambia la Prioridad de la tarea "${w1.props.Nombre}" a Alta. No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => page(s, w1.id).props.Prioridad === "Alta" &&
      unchangedExcept(s, { pages: [w1.id] }) &&
      JSON.stringify({ ...page(s, w1.id).props, Prioridad: null }) === JSON.stringify({ ...w1.props, Prioridad: null }),
  },
  {
    id: "n2-quitar-docs",
    writes: true,
    prompt: `En Tareas, quita la etiqueta docs de la tarea "${w2.props.Nombre}" y deja sus otras etiquetas. No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => {
      const p = page(s, w2.id);
      const want = tags(w2).filter((x) => x !== "docs").sort();
      return JSON.stringify([...tags(p)].sort()) === JSON.stringify(want) && unchangedExcept(s, { pages: [w2.id] }) &&
        JSON.stringify({ ...p.props, Etiquetas: null }) === JSON.stringify({ ...w2.props, Etiquetas: null });
    },
  },
  {
    id: "n2-onboarding-paso",
    writes: true,
    prompt: `En la página "Guía de onboarding", agrega al final un párrafo con el texto "${W3_TEXT}". No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => {
      const added = s.blocks.filter((b) => b.parent === GUIDE.id && !b.in_trash && !S0.blocks.some((x) => x.id === b.id));
      return added.length === 1 && added[0].text === W3_TEXT && unchangedExcept(s, { newBlocksUnder: [GUIDE.id] });
    },
  },
  {
    id: "n2-desmarcar-acuerdo",
    writes: true,
    prompt: `En la reunión "Planificación S2", desmarca el acuerdo "${w4.text}" (déjalo sin completar). No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => {
      const b = s.blocks.find((x) => x.id === w4.id);
      return !!b && !b.in_trash && b.checked === false && b.text === w4.text && unchangedExcept(s, { blocks: [w4.id] });
    },
  },
];
