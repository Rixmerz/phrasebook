// Held-out ("blind") git tasks: a new repository history and new tasks, written without
// looking at any glossary. Every expected answer is computed from the seed below.
import type { DiskTask } from "../fs/tasks.ts";
import { git, type SeedCommit } from "./tasks.ts";

// ---------- deterministic seed ----------

const day = (k: number) => new Date(Date.UTC(2026, 7, k, 10)).toISOString().replace(".000Z", "Z");
let n = 0;
const c = (author: string, message: string, files: Record<string, string>): SeedCommit => ({ author, message, files, date: day(++n) });

// main: 28 commits, one per day from 2026-08-01.
export const GITB_MAIN: SeedCommit[] = [
  c("ana", "initial commit", { "README.md": "# tienda\n", "src/api.ts": "export const TIMEOUT_MS = 1000;\n" }),
  c("ana", "add db module", { "src/db.ts": "export const POOL = 5;\n" }),
  c("bruno", "add app config", { "config/app.yaml": "port: 8080\n" }),
  c("carla", "add intro docs", { "docs/intro.md": "Intro\n" }),
  c("ana", "raise db pool", { "src/db.ts": "export const POOL = 10;\n" }),
  c("diego", "add ci script", { "scripts/ci.sh": "#!/bin/sh\necho ci\n" }),
  c("bruno", "add users route", { "src/users.ts": "export const users = [];\n" }),
  c("ana", "longer api timeout", { "src/api.ts": "export const TIMEOUT_MS = 2000;\n" }),
  c("diego", "docs: setup guide", { "docs/setup.md": "Setup\n" }),
  c("carla", "docs: api reference", { "docs/api.md": "API\n" }),
  c("bruno", "config: log level", { "config/app.yaml": "port: 8080\nlog: info\n" }),
  c("ana", "db retries", { "src/db.ts": "export const POOL = 10;\nexport const RETRIES = 3;\n" }),
  c("diego", "docs: ci notes", { "docs/ci.md": "CI\n" }),
  c("ana", "orders module", { "src/orders.ts": "export const orders = [];\n" }),
  c("carla", "fix readme title", { "README.md": "# Tienda\n" }),
  c("bruno", "users pagination", { "src/users.ts": "export const users = [];\nexport const PAGE = 20;\n" }),
  c("ana", "orders totals", { "src/orders.ts": "export const orders = [];\nexport const total = 0;\n" }),
  c("elena", "docs: faq", { "docs/faq.md": "FAQ\n" }),
  c("diego", "db pool from env", { "src/db.ts": "export const POOL = Number(Deno.env.get(\"POOL\") ?? 10);\nexport const RETRIES = 3;\n" }),
  c("ana", "api base url", { "src/api.ts": "export const TIMEOUT_MS = 2000;\nexport const BASE = \"/api\";\n" }),
  // feature/pagos branches here (after commit 20)
  c("bruno", "config: port 9090", { "config/app.yaml": "port: 9090\nlog: info\n" }),
  c("carla", "docs: update intro", { "docs/intro.md": "Intro\n\nShop backend.\n" }),
  c("ana", "users sorting", { "src/users.ts": "export const users = [];\nexport const PAGE = 20;\nexport const SORT = \"name\";\n" }),
  c("bruno", "orders status", { "src/orders.ts": "export const orders = [];\nexport const total = 0;\nexport const STATUS = \"new\";\n" }),
  // hotfix/login branches here (after commit 24)
  c("elena", "readme badges", { "README.md": "# Tienda\n\n[ci]\n" }),
  c("ana", "api retries", { "src/api.ts": "export const TIMEOUT_MS = 2000;\nexport const BASE = \"/api\";\nexport const RETRIES = 2;\n" }),
  c("carla", "db: lower retries", { "src/db.ts": "export const POOL = Number(Deno.env.get(\"POOL\") ?? 10);\nexport const RETRIES = 2;\n" }),
  c("bruno", "ci: cache deps", { "scripts/ci.sh": "#!/bin/sh\necho cache\necho ci\n" }),
];
export const GITB_PAGOS_FROM = 20;
export const GITB_PAGOS: SeedCommit[] = [
  c("diego", "pagos: module skeleton", { "src/pagos.ts": "export const pagos = [];\n" }),
  c("diego", "pagos: webhook", { "src/pagos.ts": "export const pagos = [];\nexport const HOOK = \"/hook\";\n" }),
  c("elena", "pagos: docs", { "docs/pagos.md": "Pagos\n" }),
  c("diego", "pagos: retries", { "src/pagos.ts": "export const pagos = [];\nexport const HOOK = \"/hook\";\nexport const RETRIES = 5;\n" }),
];
export const GITB_HOTFIX_FROM = 24;
export const GITB_HOTFIX: SeedCommit[] = [
  c("carla", "hotfix: login redirect", { "src/login.ts": "export const REDIRECT = \"/home\";\n" }),
  c("ana", "hotfix: login test", { "tests/login.test.ts": "// login\n" }),
];

// Working tree after seeding (on main).
const lastOn = (commits: SeedCommit[], path: string) => [...commits].reverse().find((x) => path in x.files)!.files[path];
export const GITB_WORKTREE = {
  modified: {
    "src/api.ts": lastOn(GITB_MAIN, "src/api.ts").replace("TIMEOUT_MS = 2000", "TIMEOUT_MS = 4500"),
    "README.md": lastOn(GITB_MAIN, "README.md") + "\nWork in progress.\n",
  },
  staged: {
    "config/app.yaml": lastOn(GITB_MAIN, "config/app.yaml") + "workers: 4\n",
    "docs/changelog.md": "# Changelog\n\n- 0.3.0\n",
  },
  untracked: { "notes.txt": "todo\n", "tmp/debug.log": "debug\n" },
};

function write(dir: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    const full = `${dir}/${path}`;
    Deno.mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
    Deno.writeTextFileSync(full, content);
  }
}

function commit(dir: string, x: SeedCommit) {
  write(dir, x.files);
  git(dir, "add", ...Object.keys(x.files));
  const out = new Deno.Command("git", {
    args: ["-C", dir, "commit", "-q", "-m", x.message],
    env: {
      GIT_AUTHOR_NAME: x.author, GIT_AUTHOR_EMAIL: `${x.author}@example.com`, GIT_AUTHOR_DATE: x.date,
      GIT_COMMITTER_NAME: x.author, GIT_COMMITTER_EMAIL: `${x.author}@example.com`, GIT_COMMITTER_DATE: x.date,
    },
  }).outputSync();
  if (!out.success) throw new Error(`seed commit failed: ${new TextDecoder().decode(out.stderr)}`);
}

export function seedGitBlind(dir: string) {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "agent");
  git(dir, "config", "user.email", "agent@example.com");
  GITB_MAIN.slice(0, GITB_PAGOS_FROM).forEach((x) => commit(dir, x));
  git(dir, "branch", "feature/pagos");
  GITB_MAIN.slice(GITB_PAGOS_FROM, GITB_HOTFIX_FROM).forEach((x) => commit(dir, x));
  git(dir, "branch", "hotfix/login");
  GITB_MAIN.slice(GITB_HOTFIX_FROM).forEach((x) => commit(dir, x));
  git(dir, "checkout", "-q", "feature/pagos");
  GITB_PAGOS.forEach((x) => commit(dir, x));
  git(dir, "checkout", "-q", "hotfix/login");
  GITB_HOTFIX.forEach((x) => commit(dir, x));
  git(dir, "checkout", "-q", "main");
  write(dir, GITB_WORKTREE.modified);
  write(dir, GITB_WORKTREE.staged);
  git(dir, "add", ...Object.keys(GITB_WORKTREE.staged));
  write(dir, GITB_WORKTREE.untracked);
}

// ---------- expected answers, computed from the seed ----------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`git blind task invariant failed: ${msg}`);
}

const counts = new Map<string, number>();
for (const x of GITB_MAIN) counts.set(x.author, (counts.get(x.author) ?? 0) + 1);
export const GITB_RANKING = [...counts.entries()].sort((a, b) => b[1] - a[1]);
assert(GITB_RANKING.length >= 4, "enough authors");
GITB_RANKING.forEach(([a, k], i) => assert(i === 0 || GITB_RANKING[i - 1][1] > k, `tie in ranking at ${a}`));

const lastDb = [...GITB_MAIN].reverse().find((x) => "src/db.ts" in x.files)!;
const prevDb = [...GITB_MAIN].reverse().filter((x) => "src/db.ts" in x.files)[1];
assert(lastDb.author !== prevDb.author, "last db.ts author differs from the previous one");

// Commits on main dated 2026-08-08 .. 2026-08-18 (inclusive) touching anything under docs/.
const inWindow = GITB_MAIN.filter((x) => x.date >= "2026-08-08" && x.date < "2026-08-19");
const DOCS_IN_WINDOW = inWindow.filter((x) => Object.keys(x.files).some((p) => p.startsWith("docs/"))).length;
assert(DOCS_IN_WINDOW >= 3 && DOCS_IN_WINDOW < inWindow.length, "docs window non-trivial");
assert(GITB_MAIN.some((x) => x.date < "2026-08-08" && Object.keys(x.files).some((p) => p.startsWith("docs/"))), "docs commit before window");

const PAGOS_AHEAD = GITB_PAGOS.length;
const PAGOS_BEHIND = GITB_MAIN.length - GITB_PAGOS_FROM;
assert(PAGOS_AHEAD !== PAGOS_BEHIND, "ahead != behind");

const NEW_TIMEOUT = GITB_WORKTREE.modified["src/api.ts"].match(/TIMEOUT_MS = (\d+)/)![1];
const OLD_TIMEOUT = lastOn(GITB_MAIN, "src/api.ts").match(/TIMEOUT_MS = (\d+)/)![1];
assert(NEW_TIMEOUT !== OLD_TIMEOUT, "timeout changed");

// ---------- check helpers ----------

const clean = (t: string) => t.replace(/[`*_]/g, "");
const firstInt = (t: string) => {
  const m = clean(t).match(/\d{1,3}(?:[.,  ]\d{3})+(?!\d)|\d+/);
  return m ? Number(m[0].replace(/\D/g, "")) : null;
};
const word = (w: string) => new RegExp(`(^|[^\\w/])${w.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![\\w])`, "i");

// Full state of a repository: refs, HEAD, index entries, and every non-.git file on disk.
type RepoState = { refs: Record<string, string>; head: string; index: Record<string, string>; files: Record<string, string> };
function state(dir: string): RepoState {
  const refs: Record<string, string> = {};
  for (const l of git(dir, "for-each-ref", "--format=%(refname) %(objectname)").split("\n").filter(Boolean)) {
    const [r, sha] = l.split(" ");
    refs[r] = sha;
  }
  const index: Record<string, string> = {};
  for (const l of git(dir, "ls-files", "-s").split("\n").filter(Boolean)) {
    const [meta, path] = l.split("\t");
    index[path] = meta;
  }
  const files: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const e of Deno.readDirSync(rel ? `${dir}/${rel}` : dir)) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (p === ".git") continue;
      if (e.isDirectory) walk(p);
      else files[p] = Deno.readTextFileSync(`${dir}/${p}`);
    }
  };
  walk("");
  return { refs, head: git(dir, "symbolic-ref", "-q", "HEAD"), index, files };
}

let baseline: RepoState | null = null;
function base(): RepoState {
  if (!baseline) {
    const d = Deno.makeTempDirSync({ prefix: "phrasebook-gitb-base-" });
    seedGitBlind(d);
    baseline = state(d);
    Deno.removeSync(d, { recursive: true });
  }
  return structuredClone(baseline);
}
const same = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]));
  }
  return v;
}

export const GITB_EXPECTED = { GITB_RANKING, lastDb, DOCS_IN_WINDOW, PAGOS_AHEAD, PAGOS_BEHIND, NEW_TIMEOUT };

export const gitBlindTasks: DiskTask[] = [
  // ---- reads ----
  {
    id: "gitb-staged",
    prompt: "¿Qué archivos están en el stage (listos para el próximo commit)? Responde solo con sus rutas, una por línea.",
    check: (_d, t) =>
      Object.keys(GITB_WORKTREE.staged).every((p) => t.includes(p)) &&
      ![...Object.keys(GITB_WORKTREE.modified), ...Object.keys(GITB_WORKTREE.untracked)].some((p) => t.includes(p)),
  },
  {
    id: "gitb-worktree-timeout",
    prompt: "En los cambios sin agregar al stage de src/api.ts, ¿qué valor nuevo se le da a TIMEOUT_MS? Responde solo con el número.",
    check: (_d, t) => firstInt(t) === Number(NEW_TIMEOUT),
  },
  {
    id: "gitb-last-db-change",
    prompt: "En la rama main, ¿quién hizo el último commit que modificó src/db.ts y con qué mensaje? Responde: <autor>, <mensaje>.",
    check: (_d, t) => word(lastDb.author).test(t) && t.toLowerCase().includes(lastDb.message) && !word(prevDb.author).test(t),
  },
  {
    id: "gitb-hotfix-only",
    prompt: "¿Qué commits tiene la rama hotfix/login que no estén en main? Responde solo con sus mensajes, uno por línea.",
    check: (_d, t) =>
      GITB_HOTFIX.every((x) => t.toLowerCase().includes(x.message)) &&
      !GITB_MAIN.slice(GITB_HOTFIX_FROM - 2).some((x) => t.toLowerCase().includes(x.message)),
  },
  // ---- aggregations ----
  {
    id: "gitb-author-ranking",
    prompt:
      "Ordena a los autores de los commits de la rama main de mayor a menor número de commits (no hay empates). Responde solo con los nombres, uno por línea, sin los números.",
    check: (_d, t) => {
      const pos = GITB_RANKING.map(([a]) => t.search(word(a)));
      return pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1]));
    },
  },
  {
    id: "gitb-docs-window",
    prompt:
      "¿Cuántos commits de la rama main con fecha entre el 2026-08-08 y el 2026-08-18 (ambos días incluidos) modificaron algún archivo dentro de docs/? Responde solo con el número.",
    check: (_d, t) => firstInt(t) === DOCS_IN_WINDOW,
  },
  {
    id: "gitb-pagos-ahead",
    prompt: "¿Cuántos commits tiene la rama feature/pagos que no están en main? Responde solo con el número.",
    check: (_d, t) => firstInt(t) === PAGOS_AHEAD,
  },
  // ---- writes ----
  {
    id: "gitb-commit-staged-plus-api",
    prompt:
      'Agrega src/api.ts al stage y haz un commit con todo lo que quede en el stage, con el mensaje exacto "release prep" (sin comillas). ' +
      "No incluyas README.md ni los archivos sin seguimiento.",
    check: (d) => {
      const b = base(), s = state(d);
      const parent = b.refs["refs/heads/main"];
      const newMain = s.refs["refs/heads/main"];
      if (!newMain || newMain === parent) return false;
      if (git(d, "log", "-1", "--format=%s%n%P", "main") !== `release prep\n${parent}`) return false;
      const changed = git(d, "show", "--name-only", "--format=", "main").split("\n").filter(Boolean).sort();
      const want = [...Object.keys(GITB_WORKTREE.staged), "src/api.ts"].sort();
      if (!same(changed, want)) return false;
      if (git(d, "show", "main:src/api.ts") + "\n" !== GITB_WORKTREE.modified["src/api.ts"]) return false;
      // Other refs, HEAD and the files on disk unchanged; index now equals the new commit's tree.
      const otherRefs = (r: RepoState) => Object.fromEntries(Object.entries(r.refs).filter(([k]) => k !== "refs/heads/main"));
      return same(otherRefs(s), otherRefs(b)) && s.head === "refs/heads/main" && same(s.files, b.files) &&
        git(d, "diff", "--cached", "--name-only") === "" && git(d, "diff", "--name-only") === "README.md";
    },
  },
  {
    id: "gitb-new-branch",
    prompt: "Crea la rama release/0.3 a partir de main y cámbiate a ella, conservando los cambios sin commit tal como están (en stage y fuera de él).",
    check: (d) => {
      const b = base(), s = state(d);
      const want = { ...b.refs, "refs/heads/release/0.3": b.refs["refs/heads/main"] };
      return same(s.refs, want) && s.head === "refs/heads/release/0.3" && same(s.index, b.index) && same(s.files, b.files);
    },
  },
  {
    id: "gitb-unstage-changelog",
    prompt:
      "Saca docs/changelog.md del stage sin borrar el archivo ni su contenido. config/app.yaml debe seguir en el stage y no debes hacer ningún commit.",
    check: (d) => {
      const b = base(), s = state(d);
      const wantIndex = { ...b.index };
      delete wantIndex["docs/changelog.md"];
      return same(s.refs, b.refs) && s.head === b.head && same(s.index, wantIndex) && same(s.files, b.files);
    },
  },
];
