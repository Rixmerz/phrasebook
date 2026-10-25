// Sixth blind Notion task set: 12 tasks (8 read, 4 write) over the same seeded workspace.
// Written 2026-10-24 after the unknown-field pipeline error and the markdown warning in glossary4s,
// frozen (sha256) before any run. No glossary, engine or proxy change is allowed after the freeze.
import type { Block, Page, State } from "./seed.ts";
import { PROJECTS_DS, seed, TASKS_DS } from "./seed.ts";
import { type NotionTask, unchangedExcept } from "./blindtasks.ts";

const S0 = seed();
const norm = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");
const T0 = S0.pages.filter((p) => p.parent.kind === "data_source" && p.parent.id === TASKS_DS && !p.in_trash);
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
  if (!cond) throw new Error(`blind6tasks: ${msg}`);
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
const isOneOf = (names: string[], want: string) => (_s: State, text: string) => {
  const got = names.filter((n) => norm(text).includes(norm(n)));
  return got.length === 1 && got[0] === want;
};

// ---- truths ----------------------------------------------------------------------------
const q1 = T0.filter((t) => open(t) && String(t.props.Vence ?? "").startsWith("2026-11")).length;
const q2 = T0.filter((t) => open(t) && t.props.Estimación === null).length;
const active = PR0.filter((p) => p.props.Estado === "Activo").sort((a, b) => (a.props.Presupuesto as number) - (b.props.Presupuesto as number));
assert((active[0].props.Presupuesto as number) < (active[1].props.Presupuesto as number), "q3 has no unique winner");
const q3 = active[0].props.Nombre as string;
const q4 = T0.filter((t) => tags(t).includes("bug") && tags(t).includes("backend")).length;
const checkout = PR0.find((p) => p.props.Nombre === "Checkout nuevo")!;
const FIRST_NAMES = S0.users.slice(0, 6).map((u) => u.name.split(" ")[0]);
const q5 = S0.users.find((u) => u.id === (checkout.props.Líder as string[])[0])!.name.split(" ")[0];
const q6 = T0.filter((t) => open(t) && t.props.Sprint === "S4" && owners(t).includes(userId("Diego")))
  .reduce((a, t) => a + ((t.props.Estimación as number | null) ?? 0), 0);
const demo = MEETINGS.find((m) => topicOf(m) === "Demo a clientes")!;
const q7 = blocksOf(S0, demo.id).filter((b) => b.type === "to_do" && !b.checked).length;
const blocked = new Set(T0.filter((t) => t.props.Estado === "Bloqueada").map((t) => t.id));
const q8 = S0.comments.filter((c) => blocked.has(c.page)).length;

// w1: tick Revisada on a unique Hecha task that is not reviewed
const w1 = T0.findLast((t) => t.props.Estado === "Hecha" && t.props.Revisada === false && titleCount(t.props.Nombre) === 1)!;
// w2: move a unique open S2 task to Sprint S3
const w2 = T0.findLast((t) => open(t) && t.props.Sprint === "S2" && titleCount(t.props.Nombre) === 1 && t.id !== w1.id)!;
// w3: check the postmortem agreement in "Retro de octubre"
const w3m = MEETINGS.find((m) => topicOf(m) === "Retro de octubre")!;
const w3: Block = unique(blocksOf(S0, w3m.id).filter((b) => b.type === "to_do" && !b.checked && b.text.startsWith("Escribir postmortem")), "w3");
// w4: comment on a unique Bloqueada task
const w4 = T0.findLast((t) => t.props.Estado === "Bloqueada" && titleCount(t.props.Nombre) === 1 && t.id !== w1.id && t.id !== w2.id)!;
const W4_TEXT = "Lo vemos en la daily.";

for (const [k, v] of Object.entries({ q1, q2, q4, q6, q7, q8 })) assert(v > 0, `${k} is zero`);
assert(!!w1 && !!w2 && !!w3 && !!w4, "write targets");

export const NOTION_BLIND6_TRUTH = { q1, q2, q3, q4, q5, q6, q7, q8, w1: w1.props.Nombre, w2: w2.props.Nombre, w3: [topicOf(w3m), w3.text], w4: w4.props.Nombre };

const OPEN = "(abierta = Estado distinto de Hecha)";
const page = (s: State, id: string) => s.pages.find((p) => p.id === id)!;
const onlyChanged = (s: State, t0: Page, key: string) => unchangedExcept(s, { pages: [t0.id] }) &&
  JSON.stringify({ ...page(s, t0.id).props, [key]: null }) === JSON.stringify({ ...t0.props, [key]: null });

export const notionBlind6Tasks: NotionTask[] = [
  { id: "n6-vencen-noviembre", prompt: `En Tareas, ¿cuántas tareas abiertas ${OPEN} vencen en noviembre de 2026 (propiedad Vence)? Responde solo con el número.`, check: isNumber(q1) },
  { id: "n6-sin-estimacion", prompt: `En Tareas, ¿cuántas tareas abiertas ${OPEN} no tienen Estimación? Responde solo con el número.`, check: isNumber(q2) },
  { id: "n6-activo-menor", prompt: "En Proyectos, entre los proyectos en Estado Activo, ¿cuál tiene el Presupuesto más bajo? Responde solo con el nombre del proyecto.", check: isOneOf(PR0.map((p) => p.props.Nombre as string), q3) },
  { id: "n6-bug-backend", prompt: "En Tareas, ¿cuántas tareas tienen a la vez las etiquetas bug y backend? Responde solo con el número.", check: isNumber(q4) },
  { id: "n6-lider-checkout", prompt: "En Proyectos, ¿quién es el Líder del proyecto \"Checkout nuevo\"? Responde solo con su nombre.", check: isOneOf(FIRST_NAMES, q5) },
  { id: "n6-diego-s4", prompt: `En Tareas, ¿cuántos puntos de Estimación suman las tareas abiertas ${OPEN} del Sprint S4 que tienen a Diego entre sus responsables? Responde solo con el número.`, check: isNumber(q6) },
  { id: "n6-demo-pendientes", prompt: "En la reunión \"Demo a clientes\" (dentro de \"Notas de reunión\"), ¿cuántos acuerdos (to-dos) siguen sin marcar? Responde solo con el número.", check: isNumber(q7) },
  { id: "n6-comentarios-bloqueadas", prompt: "¿Cuántos comentarios hay en total en las tareas que están en Estado Bloqueada? Responde solo con el número.", check: isNumber(q8) },
  {
    id: "n6-marcar-revisada", writes: true,
    prompt: `En Tareas, marca la casilla Revisada de la tarea "${w1.props.Nombre}". No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => page(s, w1.id).props.Revisada === true && onlyChanged(s, w1, "Revisada"),
  },
  {
    id: "n6-mover-sprint", writes: true,
    prompt: `En Tareas, cambia el Sprint de la tarea "${w2.props.Nombre}" a S3. No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => page(s, w2.id).props.Sprint === "S3" && onlyChanged(s, w2, "Sprint"),
  },
  {
    id: "n6-marcar-acuerdo", writes: true,
    prompt: `En la reunión "${topicOf(w3m)}", marca como completado el acuerdo "${w3.text}". No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => {
      const b = s.blocks.find((x) => x.id === w3.id);
      return !!b && !b.in_trash && b.checked === true && b.text === w3.text && unchangedExcept(s, { blocks: [w3.id] });
    },
  },
  {
    id: "n6-comentar-bloqueada", writes: true,
    prompt: `En Tareas, deja en la tarea "${w4.props.Nombre}" un comentario con el texto "${W4_TEXT}". No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => {
      const ids0 = new Set(S0.comments.map((c) => c.id));
      const added = s.comments.filter((c) => !ids0.has(c.id));
      return added.length === 1 && added[0].page === w4.id && added[0].text.trim() === W4_TEXT && unchangedExcept(s, { newComments: 1 });
    },
  },
];
