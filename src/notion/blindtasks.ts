// Blind Notion task set: 16 tasks (11 read, 5 write) over the seeded workspace.
// Written 2026-10-24 by an agent that saw only seed.ts and a plain description of Notion's
// capabilities (not the mock, the suite, nor how the agent accesses Notion).
// Every truth is computed from `seed()`; nothing is hard-coded.
import type { Block, Page, State } from "./seed.ts";
import { PROJECTS_DS, seed, TASKS_DS } from "./seed.ts";

export type NotionTask = { id: string; prompt: string; check: (s: State, finalText: string) => boolean; writes?: boolean };

const S0 = seed();
const norm = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");
const userName = (s: State, id: string) => s.users.find((u) => u.id === id)!.name;
const userId = (name: string) => S0.users.find((u) => u.name === name)!.id;
const tasksOf = (s: State) => s.pages.filter((p) => p.parent.kind === "data_source" && p.parent.id === TASKS_DS && !p.in_trash);
const projectsOf = (s: State) => s.pages.filter((p) => p.parent.kind === "data_source" && p.parent.id === PROJECTS_DS && !p.in_trash);
const T0 = tasksOf(S0);
const PR0 = projectsOf(S0);
const open = (t: Page) => t.props.Estado !== "Hecha";
const owners = (t: Page) => t.props.Responsable as string[];
const est = (t: Page) => (t.props.Estimación as number | null) ?? 0;
const projectId = (name: string) => PR0.find((p) => p.props.Nombre === name)!.id;
const meeting = (s: State, prefix: string) => s.pages.find((p) => typeof p.props.title === "string" && (p.props.title as string).startsWith(prefix))!;
const blocksOf = (s: State, pageId: string) => s.blocks.filter((b) => b.parent === pageId && !b.in_trash);
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`blindtasks: ${msg}`);
}
function uniqueMax<K>(entries: [K, number][]): K {
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  assert(sorted.length > 1 && sorted[0][1] > sorted[1][1], "ranking has no unique winner");
  return sorted[0][0];
}
function uniqueTask(title: string, extra: (t: Page) => boolean = () => true): Page {
  const xs = T0.filter((t) => t.props.Nombre === title && extra(t));
  assert(xs.length === 1, `task "${title}" is not unique`);
  return xs[0];
}

// ---- answer checkers -------------------------------------------------------------------
const numbers = (text: string) => (text.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(",", ".")));
const isNumber = (n: number) => (_s: State, text: string) => {
  const ns = numbers(text);
  return ns.length > 0 && ns[ns.length - 1] === n && ns.filter((x) => x !== n).length === 0;
};
const FIRST = S0.users.filter((u) => u.type === "person").map((u) => norm(u.name.split(" ")[0]));
const namesIn = (text: string) => FIRST.filter((f) => new RegExp(`\\b${f}\\b`).test(norm(text)));
const isNames = (names: string[]) => (_s: State, text: string) => {
  const want = names.map((n) => norm(n.split(" ")[0])).sort();
  const got = namesIn(text).sort();
  return JSON.stringify(want) === JSON.stringify(got);
};
const ALL_TITLES = [...new Set(T0.map((t) => t.props.Nombre as string))];
const titlesIn = (text: string) => ALL_TITLES.filter((t) => norm(text).includes(norm(t)));
const isTitles = (titles: string[]) => (_s: State, text: string) => {
  const want = [...new Set(titles)].sort();
  return JSON.stringify(titlesIn(text).sort()) === JSON.stringify(want);
};
const PROJECT_NAMES = PR0.map((p) => p.props.Nombre as string);
const isProject = (name: string) => (_s: State, text: string) => {
  const got = PROJECT_NAMES.filter((n) => norm(text).includes(norm(n)));
  return got.length === 1 && got[0] === name;
};

// ---- "nothing else changed" ------------------------------------------------------------
type Allow = { pages?: string[]; blocks?: string[]; newBlocksUnder?: string[]; newComments?: number };
/** True when the state matches S0 except on the allowed targets. last_edited_* fields are ignored. */
export function unchangedExcept(s: State, allow: Allow = {}): boolean {
  const ap = new Set(allow.pages ?? []), ab = new Set(allow.blocks ?? []), nb = new Set(allow.newBlocksUnder ?? []);
  if (s.pages.length !== S0.pages.length) return false;
  for (const p0 of S0.pages) {
    const p = s.pages.find((x) => x.id === p0.id);
    if (!p) return false;
    if (ap.has(p0.id)) continue;
    if (p.in_trash !== p0.in_trash || JSON.stringify(p.parent) !== JSON.stringify(p0.parent)) return false;
    if (JSON.stringify(p.props) !== JSON.stringify(p0.props)) return false;
  }
  for (const b0 of S0.blocks) {
    const b = s.blocks.find((x) => x.id === b0.id);
    if (!b) return false;
    if (ab.has(b0.id)) continue;
    if (b.in_trash !== b0.in_trash || b.text !== b0.text || b.checked !== b0.checked || b.type !== b0.type || b.parent !== b0.parent) return false;
  }
  const ids0 = new Set(S0.blocks.map((b) => b.id));
  for (const b of s.blocks) if (!ids0.has(b.id) && !(nb.has(b.parent))) return false;
  if (s.comments.length !== S0.comments.length + (allow.newComments ?? 0)) return false;
  for (const c0 of S0.comments) {
    const c = s.comments.find((x) => x.id === c0.id);
    if (!c || c.text !== c0.text || c.page !== c0.page) return false;
  }
  return true;
}
const page = (s: State, id: string) => s.pages.find((p) => p.id === id)!;
const sameSet = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// ---- truths ----------------------------------------------------------------------------
const ANA = userId("Ana Ruiz"), BRUNO = userId("Bruno Díaz"), DIEGO = userId("Diego Paz");

// r2: Ana's open tasks, Prioridad Media or Alta
const r2 = T0.filter((t) => open(t) && owners(t).includes(ANA) && ["Media", "Alta"].includes(t.props.Prioridad as string)).length;
// r3: sum of Estimación of open S1 tasks
const r3 = T0.filter((t) => open(t) && t.props.Sprint === "S1").reduce((a, t) => a + est(t), 0);
// r4: person with most open tasks
const r4 = userName(S0, uniqueMax(S0.users.filter((u) => u.type === "person").map((u) => [u.id, T0.filter((t) => open(t) && owners(t).includes(u.id)).length] as [string, number])));
// r5: overdue (Vence before 2026-10-15, not Hecha)
const r5 = T0.filter((t) => open(t) && t.props.Vence !== null && (t.props.Vence as string) < "2026-10-15").length;
// r6: open task titles of project "Migración a Postgres 17"
const r6 = T0.filter((t) => open(t) && (t.props.Proyecto as string[]).includes(projectId("Migración a Postgres 17"))).map((t) => t.props.Nombre as string);
// r7: active project with most pending points
const ACTIVE = PR0.filter((p) => p.props.Estado === "Activo");
const r7 = uniqueMax(ACTIVE.map((p) => [p.props.Nombre as string, T0.filter((t) => open(t) && (t.props.Proyecto as string[]).includes(p.id)).reduce((a, t) => a + est(t), 0)] as [string, number]));
// r8: people named in the unchecked agreements of "Demo a clientes"
const demo = meeting(S0, "Demo a clientes");
const r8 = [...new Set(blocksOf(S0, demo.id).filter((b) => b.type === "to_do" && !b.checked).map((b) => S0.users.find((u) => b.text.includes(`(${u.name.split(" ")[0]})`))!.name))];
// r9: onboarding guide — who gives staging access
const guide = S0.pages.find((p) => p.props.title === "Guía de onboarding")!;
const stagingLine = blocksOf(S0, guide.id).find((b) => b.text.includes("staging a "))!;
const r9 = S0.users.find((u) => stagingLine.text.includes(u.name.split(" ")[0]))!.name;
// r10: task with the most comments
const r10page = uniqueMax(T0.map((t) => [t, S0.comments.filter((c) => c.page === t.id).length] as [Page, number]));
const r10 = r10page.props.Nombre as string;
// r11: open tasks tagged both backend and bug
const r11 = T0.filter((t) => open(t) && (t.props.Etiquetas as string[]).includes("backend") && (t.props.Etiquetas as string[]).includes("bug")).length;
// r12: leader of the active project with the largest budget
const r12 = userName(S0, (uniqueMax(ACTIVE.map((p) => [p, p.props.Presupuesto as number] as [Page, number])).props.Líder as string[])[0]);

// w1: mark a unique task Hecha + Revisada
const w1 = uniqueTask("Limpiar la API de inventario");
assert(w1.props.Estado !== "Hecha" && w1.props.Revisada === false, "w1 already done");
// w2: replace Diego with Bruno in open S4 tasks
const w2 = T0.filter((t) => open(t) && t.props.Sprint === "S4" && owners(t).includes(DIEGO));
assert(w2.length > 0 && w2.length <= 8, "w2 size");
const w2want = Object.fromEntries(w2.map((t) => [t.id, [...new Set(owners(t).map((o) => (o === DIEGO ? BRUNO : o)))]]));
// w3: add a to-do to "Retro de octubre"
const retro = meeting(S0, "Retro de octubre");
const W3_TEXT = "Revisar costos de licencias (Ana)";
// w4: check the postmortem agreement in "Retro de octubre"
const w4blocks = blocksOf(S0, retro.id).filter((b) => b.type === "to_do" && b.text.startsWith("Escribir postmortem del corte"));
assert(w4blocks.length === 1 && !w4blocks[0].checked, "w4 target");
const w4: Block = w4blocks[0];
// w5: comment on the blocked Alta task with the highest Estimación
const w5 = uniqueMax(T0.filter((t) => t.props.Estado === "Bloqueada" && t.props.Prioridad === "Alta").map((t) => [t, est(t)] as [Page, number]));
const W5_TEXT = "Revisar en la próxima planificación.";

for (const [k, v] of Object.entries({ r2, r3, r5, r11 })) assert(v > 0, `${k} is zero`);
assert(r6.length > 0 && r6.length <= 12 && new Set(r6).size === r6.length, "r6 shape");
assert(r8.length > 0, "r8 empty");

export const NOTION_BLIND_TRUTH = {
  r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12,
  w1: { task: w1.props.Nombre, sprint: w1.props.Sprint },
  w2: w2.map((t) => ({ task: t.props.Nombre, sprint: t.props.Sprint, newOwners: w2want[t.id].map((id) => userName(S0, id)) })),
  w3: { meeting: retro.props.title, todo: W3_TEXT },
  w4: { meeting: retro.props.title, todo: w4.text },
  w5: { task: w5.props.Nombre, sprint: w5.props.Sprint, estimacion: w5.props.Estimación, comment: W5_TEXT },
};

const OPEN = "(abierta = Estado distinto de Hecha)";

export const notionBlindTasks: NotionTask[] = [
  {
    id: "nb-ana-media-alta",
    prompt: `En Tareas, ¿cuántas tareas abiertas ${OPEN} tienen a Ana Ruiz entre sus responsables y Prioridad Media o Alta? Responde solo con el número.`,
    check: isNumber(r2),
  },
  {
    id: "nb-puntos-s1",
    prompt: `¿Cuál es la suma de Estimación de las tareas abiertas ${OPEN} del Sprint S1? Las tareas sin estimación cuentan como 0. Responde solo con el número.`,
    check: isNumber(r3),
  },
  {
    id: "nb-mas-cargado",
    prompt: `¿Qué persona tiene más tareas abiertas ${OPEN} asignadas en Tareas? Una tarea con varios responsables cuenta para cada uno. Responde solo con el nombre completo de la persona.`,
    check: isNames([r4]),
  },
  {
    id: "nb-vencidas",
    prompt: `¿Cuántas tareas tienen fecha Vence anterior al 2026-10-15 y Estado distinto de Hecha? Ignora las tareas sin fecha. Responde solo con el número.`,
    check: isNumber(r5),
  },
  {
    id: "nb-postgres-abiertas",
    prompt: `¿Qué tareas abiertas ${OPEN} pertenecen al proyecto "Migración a Postgres 17"? Responde solo con los nombres de las tareas, separados por comas.`,
    check: isTitles(r6),
  },
  {
    id: "nb-proyecto-pendiente",
    prompt: `Entre los proyectos con Estado Activo, ¿cuál acumula más puntos pendientes, es decir, la mayor suma de Estimación de sus tareas abiertas ${OPEN}? Las tareas sin estimación cuentan como 0. Responde solo con el nombre del proyecto.`,
    check: isProject(r7),
  },
  {
    id: "nb-demo-acuerdos",
    prompt: `En la página de la reunión "Demo a clientes" (dentro de Notas de reunión), ¿a qué personas corresponden los acuerdos que siguen sin marcar? Responde solo con los nombres completos, separados por comas.`,
    check: isNames(r8),
  },
  {
    id: "nb-onboarding-staging",
    prompt: `Según la Guía de onboarding, ¿a quién hay que pedirle acceso a staging? Responde solo con el nombre completo de la persona.`,
    check: isNames([r9]),
  },
  {
    id: "nb-mas-comentada",
    prompt: `¿Qué tarea de la base Tareas tiene más comentarios? Responde solo con el nombre de la tarea.`,
    check: isTitles([r10]),
  },
  {
    id: "nb-backend-bug",
    prompt: `¿Cuántas tareas abiertas ${OPEN} tienen a la vez las etiquetas backend y bug? Responde solo con el número.`,
    check: isNumber(r11),
  },
  {
    id: "nb-lider-presupuesto",
    prompt: `De los proyectos con Estado Activo, ¿quién lidera el que tiene el mayor Presupuesto? Responde solo con el nombre completo de la persona.`,
    check: isNames([r12]),
  },
  {
    id: "nb-cerrar-tarea",
    writes: true,
    prompt: `Marca la tarea "Limpiar la API de inventario" como Hecha y como Revisada. No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => {
      const p = page(s, w1.id);
      if (!p || p.in_trash || p.props.Estado !== "Hecha" || p.props.Revisada !== true) return false;
      const { Estado: _a, Revisada: _b, ...rest } = p.props;
      const { Estado: _c, Revisada: _d, ...rest0 } = w1.props;
      return JSON.stringify(rest) === JSON.stringify(rest0) && unchangedExcept(s, { pages: [w1.id] });
    },
  },
  {
    id: "nb-reasignar-diego",
    writes: true,
    prompt: `Diego Paz sale de vacaciones. En todas las tareas abiertas ${OPEN} del Sprint S4 donde Diego Paz es responsable, reemplázalo por Bruno Díaz (conserva a los demás responsables que tenga la tarea). No cambies nada más. Cuando termines, responde solo con el número de tareas modificadas.`,
    check: (s) => {
      for (const t of w2) {
        const p = page(s, t.id);
        if (!p || p.in_trash || !sameSet(owners(p), w2want[t.id])) return false;
        const { Responsable: _a, ...rest } = p.props;
        const { Responsable: _b, ...rest0 } = t.props;
        if (JSON.stringify(rest) !== JSON.stringify(rest0)) return false;
      }
      return unchangedExcept(s, { pages: w2.map((t) => t.id) });
    },
  },
  {
    id: "nb-agregar-todo",
    writes: true,
    prompt: `En la página de la reunión "Retro de octubre" (dentro de Notas de reunión), agrega un nuevo acuerdo como to-do sin marcar con el texto exacto "${W3_TEXT}". No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => {
      const ids0 = new Set(S0.blocks.map((b) => b.id));
      const added = s.blocks.filter((b) => !ids0.has(b.id) && b.parent === retro.id && !b.in_trash);
      return added.length === 1 && added[0].type === "to_do" && added[0].text.trim() === W3_TEXT && !added[0].checked &&
        s.blocks.filter((b) => !ids0.has(b.id)).every((b) => b.parent === retro.id && (b === added[0] || b.in_trash)) &&
        unchangedExcept(s, { newBlocksUnder: [retro.id] });
    },
  },
  {
    id: "nb-marcar-acuerdo",
    writes: true,
    prompt: `En la reunión "Retro de octubre", marca como completado el acuerdo "${w4.text}". No cambies nada más. Cuando termines, responde solo con "listo".`,
    check: (s) => {
      const b = s.blocks.find((x) => x.id === w4.id);
      return !!b && !b.in_trash && b.checked === true && b.text === w4.text && unchangedExcept(s, { blocks: [w4.id] });
    },
  },
  {
    id: "nb-comentar-bloqueada",
    writes: true,
    prompt: `Entre las tareas con Estado Bloqueada y Prioridad Alta, busca la que tiene la mayor Estimación y agrégale un comentario con el texto exacto "${W5_TEXT}". No cambies nada más. Cuando termines, responde solo con el nombre de la tarea.`,
    check: (s) => {
      const ids0 = new Set(S0.comments.map((c) => c.id));
      const added = s.comments.filter((c) => !ids0.has(c.id));
      return added.length === 1 && added[0].page === w5.id && added[0].text.trim() === W5_TEXT && unchangedExcept(s, { newComments: 1 });
    },
  },
];
