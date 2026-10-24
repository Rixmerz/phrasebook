// Filesystem server tasks. Frozen before any glossary for this server existed.
// The workspace is the server's current directory; checks read the disk.

export type DiskTask = {
  id: string;
  prompt: string;
  check: (dir: string, finalText: string) => boolean;
};

export const FS_SEED: Record<string, string> = {
  "README.md": "# Demo\n\nA small demo project.\n",
  "notes/todo.md": "- buy milk\n- call ana\n",
  "notes/ideas.md": "idea one\nidea two\n",
  "notes/meeting.md": "Meeting with Ana and Bruno on Monday.\n",
  "src/app.ts": 'export const version = "2.3.1";\nexport function main() {\n  return version;\n}\n',
  "src/util.ts": "export const add = (a: number, b: number) => a + b;\n",
  "logs/2026-09-01.log": "INFO start\nERROR disk full\nINFO retry\nERROR timeout\nINFO done\n",
  "logs/2026-09-02.log": "INFO start\nINFO done\n",
  "logs/2026-09-03.log": "INFO start\n" + "INFO tick\n".repeat(40) + "INFO done\n",
};

const read = (dir: string, p: string) => {
  try {
    return Deno.readTextFileSync(`${dir}/${p}`);
  } catch {
    return null;
  }
};
const lines = (s: string | null) => (s ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
const lc = (s: string) => s.toLowerCase();

export const fsTasks: DiskTask[] = [
  {
    id: "fs-read-version",
    prompt: "¿Qué versión declara src/app.ts? Responde solo con la versión.",
    check: (_d, t) => /\b2\.3\.1\b/.test(t),
  },
  {
    id: "fs-create-file",
    prompt: 'Crea el archivo docs/setup.md con dos líneas: "# Setup" y "Run deno task dev".',
    check: (d) => {
      const l = lines(read(d, "docs/setup.md"));
      return l.length === 2 && l[0] === "# Setup" && l[1] === "Run deno task dev";
    },
  },
  {
    id: "fs-append-todo",
    prompt: 'Agrega "- pay rent" como última línea de notes/todo.md sin borrar lo que ya tiene.',
    check: (d) => {
      const l = lines(read(d, "notes/todo.md"));
      return l.join("|") === "- buy milk|- call ana|- pay rent";
    },
  },
  {
    id: "fs-move",
    prompt: "Mueve notes/ideas.md a archive/ideas.md.",
    check: (d) => read(d, "notes/ideas.md") === null && read(d, "archive/ideas.md") === "idea one\nidea two\n",
  },
  {
    id: "fs-count-errors",
    prompt: "¿Cuántas líneas con ERROR tiene logs/2026-09-01.log? Responde solo con el número.",
    check: (_d, t) => t.trim().replace(/\D/g, "") === "2",
  },
  {
    id: "fs-list-ts",
    prompt: "¿Qué archivos .ts hay en el proyecto? Responde solo con las rutas, una por línea.",
    check: (_d, t) => t.includes("src/app.ts") && t.includes("src/util.ts") && (t.match(/\.ts\b/g) ?? []).length === 2,
  },
  {
    id: "fs-edit-version",
    prompt: "En src/app.ts cambia la versión a 2.4.0, sin tocar el resto del archivo.",
    check: (d) => read(d, "src/app.ts") === 'export const version = "2.4.0";\nexport function main() {\n  return version;\n}\n',
  },
  {
    id: "fs-largest-log",
    prompt: "¿Cuál es el archivo más grande dentro de la carpeta logs? Responde solo con el nombre del archivo.",
    check: (_d, t) => t.includes("2026-09-03.log") && !t.includes("2026-09-01") && !t.includes("2026-09-02"),
  },
  {
    id: "fs-mentions-ana",
    prompt: "¿Qué archivos dentro de notes mencionan a Ana? Responde solo con las rutas, una por línea.",
    check: (_d, t) => lc(t).includes("todo.md") && lc(t).includes("meeting.md") && !lc(t).includes("ideas.md"),
  },
  {
    id: "fs-backup-readme",
    prompt: "Crea la carpeta backup y copia ahí README.md con exactamente el mismo contenido.",
    check: (d) => read(d, "backup/README.md") === FS_SEED["README.md"] && read(d, "README.md") === FS_SEED["README.md"],
  },
];
