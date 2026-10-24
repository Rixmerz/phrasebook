// Benchmark tasks. Prompts are in Spanish on purpose: that is how the user
// talks to the agent. Success is checked from the stored graph or the exact
// final answer, never by judging the model's prose.

export type Entity = { name: string; entityType: string; observations: string[] };
export type Relation = { from: string; to: string; relationType: string };
export type Graph = { entities: Entity[]; relations: Relation[] };

export type Task = {
  id: string;
  prompt: string;
  seed: Graph;
  check: (g: Graph, finalText: string) => boolean;
};

const lc = (s: string) => s.toLowerCase();
const find = (g: Graph, name: string) => g.entities.find((e) => lc(e.name) === lc(name));
const hasObs = (e: Entity | undefined, needle: string) =>
  !!e && e.observations.some((o) => lc(o).includes(lc(needle)));

const team: Graph = {
  entities: [
    { name: "Ana", entityType: "person", observations: ["backend developer"] },
    { name: "Bruno", entityType: "person", observations: ["designer"] },
    { name: "Carla", entityType: "person", observations: ["QA engineer"] },
    { name: "Diego", entityType: "person", observations: ["frontend developer"] },
    { name: "Mecha", entityType: "company", observations: ["software studio in Santiago"] },
    { name: "Nimbus", entityType: "company", observations: ["cloud provider"] },
  ],
  relations: [
    { from: "Ana", to: "Mecha", relationType: "works_at" },
    { from: "Carla", to: "Mecha", relationType: "works_at" },
    { from: "Bruno", to: "Nimbus", relationType: "works_at" },
    { from: "Diego", to: "Mecha", relationType: "works_at" },
    { from: "Carla", to: "Ana", relationType: "reviews" },
  ],
};

export const tasks: Task[] = [
  {
    id: "create-entity",
    prompt: 'Guarda a Elena, es una persona, y anota que "lidera el equipo de datos".',
    seed: { entities: [], relations: [] },
    check: (g) => {
      const e = find(g, "Elena");
      return !!e && /^person/.test(lc(e.entityType)) && hasObs(e, "datos");
    },
  },
  {
    id: "create-relation",
    prompt: "Bruno se cambió: ahora también trabaja en Mecha. Regístralo como relación.",
    seed: team,
    check: (g) =>
      g.relations.some((r) => r.from === "Bruno" && r.to === "Mecha" && /work/i.test(r.relationType)),
  },
  {
    id: "read-answer",
    prompt: "¿En qué empresa trabaja Bruno? Responde solo con el nombre de la empresa.",
    seed: team,
    check: (_g, text) => /\bnimbus\b/i.test(text) && !/\bmecha\b/i.test(text),
  },
  {
    id: "fan-out",
    prompt:
      'Agrega la observación "onboarding 2026" a todas las personas que trabajan en Mecha, y a nadie más.',
    seed: team,
    check: (g) =>
      ["Ana", "Carla", "Diego"].every((n) => hasObs(find(g, n), "onboarding 2026")) &&
      !hasObs(find(g, "Bruno"), "onboarding 2026"),
  },
  {
    id: "delete-cascade",
    prompt: "Carla dejó la empresa: bórrala del grafo junto con todas sus relaciones.",
    seed: team,
    check: (g) =>
      !find(g, "Carla") && !g.relations.some((r) => r.from === "Carla" || r.to === "Carla") &&
      g.entities.length === 5,
  },
  {
    id: "multi-hop",
    prompt: "¿Quién revisa el trabajo de Ana, y en qué empresa trabaja esa persona? Responde: <persona>, <empresa>.",
    seed: team,
    check: (_g, text) => /carla/i.test(text) && /mecha/i.test(text),
  },
  {
    id: "update-observation",
    prompt: 'Diego ya no es frontend: cambió su observación "frontend developer" por "mobile developer".',
    seed: team,
    check: (g) => {
      const d = find(g, "Diego");
      return hasObs(d, "mobile developer") && !hasObs(d, "frontend developer");
    },
  },
  {
    id: "bulk-create",
    prompt:
      "Registra el proyecto Atlas (tipo project). Ana, Diego y Elena trabajan en él; Elena es una persona nueva. " +
      "Crea lo que falte y todas las relaciones.",
    seed: team,
    check: (g) => {
      const atlas = find(g, "Atlas");
      const onAtlas = (n: string) =>
        g.relations.some((r) => lc(r.from) === lc(n) && lc(r.to) === "atlas");
      return !!atlas && /project/i.test(atlas.entityType) && !!find(g, "Elena") &&
        ["Ana", "Diego", "Elena"].every(onAtlas);
    },
  },
  {
    id: "no-op-guard",
    prompt: "Agrega a Bruno la observación \"designer\" solo si todavía no la tiene.",
    seed: team,
    check: (g) => find(g, "Bruno")!.observations.filter((o) => lc(o) === "designer").length === 1,
  },
  {
    id: "count-large",
    prompt: "¿Cuántas personas trabajan en la empresa Orbita? Responde solo con el número.",
    seed: largeGraph(),
    check: (_g, text) => text.trim().replace(/\D/g, "") === "17",
  },
  {
    id: "filter-large",
    prompt:
      'Agrega la observación "senior" a cada persona de Orbita que tenga la observación "8 years experience" o más años. ' +
      "No toques a nadie más.",
    seed: largeGraph(),
    check: (g) => {
      const people = g.entities.filter((e) => e.entityType === "person");
      return people.every((p) => {
        const years = Number(p.observations.find((o) => /years experience/.test(o))?.split(" ")[0] ?? 0);
        const atOrbita = g.relations.some((r) => r.from === p.name && r.to === "Orbita");
        return hasObs(p, "senior") === (atOrbita && years >= 8);
      });
    },
  },
  {
    id: "ambiguous-name",
    prompt: "Borra a Juan del grafo.",
    seed: {
      entities: [
        { name: "Juan Perez", entityType: "person", observations: ["sales"] },
        { name: "Juan Soto", entityType: "person", observations: ["support"] },
      ],
      relations: [],
    },
    // Right behavior: ask instead of guessing, so both must still exist.
    check: (g) => g.entities.length === 2,
  },
];

// 60 people across three companies, with years of experience. Deterministic.
function largeGraph(): Graph {
  const companies = ["Orbita", "Nimbus", "Mecha"];
  const entities: Entity[] = companies.map((c) => ({ name: c, entityType: "company", observations: [] }));
  const relations: Relation[] = [];
  for (let i = 0; i < 60; i++) {
    const name = `Person${String(i).padStart(2, "0")}`;
    const company = i < 17 ? "Orbita" : companies[1 + (i % 2)];
    entities.push({ name, entityType: "person", observations: [`${(i * 7) % 15} years experience`] });
    relations.push({ from: name, to: company, relationType: "works_at" });
  }
  return { entities, relations };
}
