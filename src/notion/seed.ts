// State and seed for the Notion mock: a small product team's workspace with a task database
// (90 rows), a project database (8 rows), meeting notes with to-dos, and comments.
// Deterministic: the same seed every run, so task truths can be computed from it.

export type User = { id: string; name: string; email: string | null; type: "person" | "bot" };
export type PropType =
  | "title" | "rich_text" | "status" | "select" | "multi_select" | "people" | "number" | "date" | "checkbox" | "relation";
export type Option = { id: string; name: string; color: string };
export type PropSchema = { id: string; name: string; type: PropType; options?: Option[]; relation?: string };
export type DataSource = { id: string; database_id: string; title: string; parent: string; properties: PropSchema[] };
// Property values in a flat form; the mock renders them in Notion's shapes.
export type Value = string | number | boolean | string[] | null;
export type Parent = { kind: "data_source"; id: string } | { kind: "page"; id: string } | { kind: "workspace" };
export type Page = {
  id: string; parent: Parent; props: Record<string, Value>;
  created_time: string; last_edited_time: string; created_by: string; last_edited_by: string; in_trash: boolean;
};
export type BlockType = "paragraph" | "heading_1" | "heading_2" | "heading_3" | "bulleted_list_item" | "numbered_list_item" | "to_do" | "quote" | "divider";
export type Block = {
  id: string; parent: string; type: BlockType; text: string; checked?: boolean;
  created_time: string; last_edited_time: string; created_by: string; in_trash: boolean;
};
export type Comment = { id: string; page: string; discussion: string; text: string; created_by: string; created_time: string };
export type State = {
  users: User[]; me: string; dataSources: DataSource[]; pages: Page[];
  blocks: Block[]; children: Record<string, string[]>; comments: Comment[]; nextId: number;
};

function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

// UUIDs from a counter, so they are stable across runs.
export function uuid(n: number, kind: number): string {
  const h = (kind * 0x10000000 + n).toString(16).padStart(32, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20)}`;
}

export const TASKS_DB = uuid(1, 0xd), TASKS_DS = uuid(1, 0xe);
export const PROJECTS_DB = uuid(2, 0xd), PROJECTS_DS = uuid(2, 0xe);

export function seed(): State {
  const rand = rng(20261024);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const at = (day: number, hour = 10) => new Date(Date.UTC(2026, 8, 1 + day, hour)).toISOString();

  const people: [string, string][] = [
    ["Ana Ruiz", "ana@acme.test"], ["Bruno Díaz", "bruno@acme.test"], ["Carla Soto", "carla@acme.test"],
    ["Diego Paz", "diego@acme.test"], ["Elena Mora", "elena@acme.test"], ["Félix Vera", "felix@acme.test"],
  ];
  const users: User[] = people.map(([name, email], i) => ({ id: uuid(i + 1, 0x1), name, email, type: "person" }));
  const bot: User = { id: uuid(99, 0x1), name: "Phrasebook", email: null, type: "bot" };
  users.push(bot);
  const P = users.slice(0, 6).map((u) => u.id);

  let idn = 1;
  const pageId = () => uuid(idn++, 0x2);
  let bn = 1;
  const pages: Page[] = [];
  const blocks: Block[] = [];
  const children: Record<string, string[]> = {};
  const comments: Comment[] = [];

  const page = (parent: Parent, props: Record<string, Value>, day: number, by: string): Page => {
    const p: Page = {
      id: pageId(), parent, props, created_time: at(day), last_edited_time: at(day + Math.floor(rand() * 20), 15),
      created_by: by, last_edited_by: by, in_trash: false,
    };
    pages.push(p);
    return p;
  };
  const block = (parent: string, type: BlockType, text: string, day: number, by: string, checked?: boolean) => {
    const b: Block = { id: uuid(bn++, 0xb), parent, type, text, created_time: at(day), last_edited_time: at(day), created_by: by, in_trash: false };
    if (type === "to_do") b.checked = !!checked;
    blocks.push(b);
    (children[parent] ??= []).push(b.id);
    return b;
  };

  // Workspace root and the two databases' container page.
  const home = page({ kind: "workspace" }, { title: "Equipo Producto" }, 0, P[0]);
  block(home.id, "paragraph", "Espacio del equipo de producto de Acme: tareas, proyectos y notas de reunión.", 0, P[0]);

  let pid = 1;
  const propId = () => `p${(pid++).toString(36).padStart(3, "0")}`;
  const opts = (names: string[], colors: string[]) => names.map((name, i) => ({ id: propId(), name, color: colors[i % colors.length] }));
  const projectsDs: DataSource = {
    id: PROJECTS_DS, database_id: PROJECTS_DB, title: "Proyectos", parent: home.id,
    properties: [
      { id: "title", name: "Nombre", type: "title" },
      { id: propId(), name: "Estado", type: "select", options: opts(["Activo", "Pausado", "Cerrado"], ["green", "yellow", "gray"]) },
      { id: propId(), name: "Líder", type: "people" },
      { id: propId(), name: "Presupuesto", type: "number" },
      { id: propId(), name: "Inicio", type: "date" },
    ],
  };
  const tasksDs: DataSource = {
    id: TASKS_DS, database_id: TASKS_DB, title: "Tareas", parent: home.id,
    properties: [
      { id: "title", name: "Nombre", type: "title" },
      { id: propId(), name: "Estado", type: "status", options: opts(["Por hacer", "En curso", "Bloqueada", "Hecha"], ["default", "blue", "red", "green"]) },
      { id: propId(), name: "Prioridad", type: "select", options: opts(["Alta", "Media", "Baja"], ["red", "yellow", "gray"]) },
      { id: propId(), name: "Responsable", type: "people" },
      { id: propId(), name: "Sprint", type: "select", options: opts(["S1", "S2", "S3", "S4"], ["purple", "pink", "brown", "orange"]) },
      { id: propId(), name: "Estimación", type: "number" },
      { id: propId(), name: "Etiquetas", type: "multi_select", options: opts(["backend", "frontend", "infra", "docs", "bug"], ["blue", "green", "orange", "gray", "red"]) },
      { id: propId(), name: "Vence", type: "date" },
      { id: propId(), name: "Revisada", type: "checkbox" },
      { id: propId(), name: "Proyecto", type: "relation", relation: PROJECTS_DS },
      { id: propId(), name: "Notas", type: "rich_text" },
    ],
  };

  const projectNames = ["Checkout nuevo", "App móvil 2.0", "Migración a Postgres 17", "Portal de socios", "Rediseño de onboarding", "Facturación electrónica", "Panel de métricas", "Búsqueda interna"];
  const projects = projectNames.map((name, i) =>
    page({ kind: "data_source", id: PROJECTS_DS }, {
      Nombre: name,
      Estado: i < 5 ? "Activo" : i < 7 ? "Pausado" : "Cerrado",
      Líder: [P[i % 6]],
      Presupuesto: 5000 + 2500 * Math.floor(rand() * 9),
      Inicio: `2026-0${7 + (i % 3)}-${String(1 + Math.floor(rand() * 27)).padStart(2, "0")}`,
    }, 1, P[0])
  );

  const verbs = ["Revisar", "Corregir", "Documentar", "Migrar", "Probar", "Diseñar", "Optimizar", "Automatizar", "Medir", "Limpiar"];
  const objects = ["el login con SSO", "la tabla de precios", "los webhooks de pago", "el formulario de alta", "las alertas de latencia",
    "el reporte mensual", "la caché de sesiones", "el flujo de reembolso", "los permisos de admin", "el buscador de socios",
    "la exportación a CSV", "el modo offline", "las notificaciones push", "el job de respaldos", "la API de inventario"];
  const notes = ["", "", "", "Depende del equipo de datos.", "Pedir acceso a staging.", "Ver hilo en Slack del lunes.", "Cliente lo pidió con urgencia."];
  const tasks: Page[] = [];
  for (let i = 0; i < 90; i++) {
    const r = rand();
    const status = r < 0.3 ? "Por hacer" : r < 0.55 ? "En curso" : r < 0.65 ? "Bloqueada" : "Hecha";
    const tags = ["backend", "frontend", "infra", "docs", "bug"].filter(() => rand() < 0.3);
    const owner = rand() < 0.85 ? [P[Math.floor(rand() * 6)]] : [];
    if (owner.length && rand() < 0.1) owner.push(P[(P.indexOf(owner[0]) + 1) % 6]);
    const t = page({ kind: "data_source", id: TASKS_DS }, {
      Nombre: `${pick(verbs)} ${pick(objects)}`,
      Estado: status,
      Prioridad: rand() < 0.9 ? pick(["Alta", "Media", "Media", "Baja"]) : null,
      Responsable: owner,
      Sprint: pick(["S1", "S2", "S3", "S4"]),
      Estimación: rand() < 0.85 ? pick([1, 2, 3, 5, 8, 13]) : null,
      Etiquetas: tags,
      Vence: rand() < 0.8 ? `2026-${rand() < 0.5 ? "10" : "11"}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}` : null,
      Revisada: status === "Hecha" ? rand() < 0.6 : false,
      Proyecto: rand() < 0.8 ? [pick(projects).id] : [],
      Notas: pick(notes),
    }, 2 + Math.floor(rand() * 30), pick(P));
    tasks.push(t);
  }

  // Meeting notes: attendees, agreements as to-dos (some done), and a closing paragraph.
  const notesRoot = page({ kind: "page", id: home.id }, { title: "Notas de reunión" }, 3, P[0]);
  const topics = ["Planificación S1", "Revisión de incidentes", "Planificación S2", "Demo a clientes", "Planificación S3", "Retro de octubre"];
  const actions = ["Actualizar el tablero de riesgos", "Enviar minuta al equipo", "Agendar demo con Ventas", "Revisar costos de la nube",
    "Cerrar tickets duplicados", "Preparar presupuesto Q1", "Definir dueños de alertas", "Escribir postmortem del corte"];
  topics.forEach((topic, i) => {
    const day = 5 + i * 9;
    const by = P[i % 6];
    const m = page({ kind: "page", id: notesRoot.id }, { title: `${topic} (${at(day).slice(0, 10)})` }, day, by);
    block(m.id, "heading_2", "Asistentes", day, by);
    for (const u of users.slice(0, 6).filter(() => rand() < 0.7)) block(m.id, "bulleted_list_item", u.name, day, by);
    block(m.id, "heading_2", "Acuerdos", day, by);
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const who = users[Math.floor(rand() * 6)];
      block(m.id, "to_do", `${pick(actions)} (${who.name.split(" ")[0]})`, day, by, rand() < 0.5);
    }
    block(m.id, "paragraph", i % 2 ? "Próxima reunión en dos semanas." : "Sin bloqueos nuevos.", day, by);
  });

  const guide = page({ kind: "page", id: home.id }, { title: "Guía de onboarding" }, 2, P[1]);
  [["heading_1", "Bienvenida"], ["paragraph", "Esta guía resume lo que necesitas en tu primera semana."],
    ["heading_2", "Accesos"], ["numbered_list_item", "Pedir cuenta de GitHub a Diego."], ["numbered_list_item", "Pedir acceso a staging a Carla."],
    ["numbered_list_item", "Instalar la VPN corporativa."], ["heading_2", "Reglas del equipo"],
    ["bulleted_list_item", "Las tareas Alta se revisan en 24 horas."], ["bulleted_list_item", "Todo deploy pasa por staging."],
    ["quote", "Si no está en el tablero, no existe."], ["divider", ""], ["paragraph", "Dudas: canal #producto."]]
    .forEach(([type, text]) => block(guide.id, type as BlockType, text, 2, P[1]));

  // Comments on tasks and meeting notes.
  const remarks = ["¿Esto sigue bloqueado?", "Lo tomo yo mañana.", "Necesito más contexto.", "Listo para revisión.",
    "Subí la estimación a 8.", "Esperando respuesta de Ventas.", "Ya está en staging."];
  let cn = 1;
  for (let k = 0; k < 28; k++) {
    const target = rand() < 0.8 ? pick(tasks) : pick(pages.filter((p) => p.parent.kind === "page" && p.parent.id === notesRoot.id));
    const id = uuid(cn++, 0xc);
    const reply = comments.filter((c) => c.page === target.id);
    comments.push({
      id, page: target.id, discussion: reply.length && rand() < 0.5 ? reply[0].discussion : uuid(cn, 0xf),
      text: pick(remarks), created_by: pick(P), created_time: at(20 + Math.floor(rand() * 30), 8 + Math.floor(rand() * 9)),
    });
  }
  comments.sort((a, b) => a.created_time.localeCompare(b.created_time));

  return {
    users, me: bot.id, dataSources: [projectsDs, tasksDs], pages, blocks, children, comments,
    nextId: 1000,
  };
}
