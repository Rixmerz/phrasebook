// Git server tasks. Frozen before any glossary for this server existed.
// The repository is the server's current directory; checks run git on the disk.
import type { DiskTask } from "../fs/tasks.ts";

export type SeedCommit = { author: string; message: string; files: Record<string, string>; date: string };

// History on main: 5 commits. feature/login branches after "add login".
export const GIT_MAIN: SeedCommit[] = [
  { author: "ana", message: "initial commit", files: { "README.md": "# app\n" }, date: "2026-09-01T10:00:00Z" },
  { author: "ana", message: "add login", files: { "src/login.ts": "export const login = () => true;\n" }, date: "2026-09-02T10:00:00Z" },
  { author: "carla", message: "add config", files: { "config.example.json": "{}\n" }, date: "2026-09-03T10:00:00Z" },
  { author: "ana", message: "fix typo", files: { "README.md": "# App\n" }, date: "2026-09-04T10:00:00Z" },
  { author: "bruno", message: "add docs", files: { "docs/intro.md": "Intro\n" }, date: "2026-09-05T10:00:00Z" },
];
export const GIT_FEATURE_FROM = 2; // branch created after the 2nd commit ("add login")
export const GIT_FEATURE: SeedCommit[] = [
  { author: "bruno", message: "login form", files: { "src/form.ts": "export const form = 1;\n" }, date: "2026-09-06T10:00:00Z" },
];
// Working tree after seeding (on main): README.md modified, config.json staged, notes.txt and scratch.txt untracked.
export const GIT_WORKTREE = { modified: { "README.md": "# App\n\nWork in progress.\n" }, staged: { "config.json": '{"debug": true}\n' }, untracked: { "notes.txt": "notes\n", "scratch.txt": "tmp\n" } };

export function git(dir: string, ...args: string[]) {
  const out = new Deno.Command("git", { args: ["-C", dir, ...args], stdout: "piped", stderr: "piped" }).outputSync();
  return new TextDecoder().decode(out.stdout).trim();
}

const lc = (s: string) => s.toLowerCase();
const headMessage = (d: string) => git(d, "log", "-1", "--format=%s");

export const gitTasks: DiskTask[] = [
  {
    id: "git-untracked",
    prompt: "¿Qué archivos sin seguimiento (untracked) hay en el repositorio? Responde solo con los nombres.",
    check: (_d, t) => t.includes("notes.txt") && t.includes("scratch.txt") && !t.includes("config.json") && !t.includes("README"),
  },
  {
    id: "git-commit-one",
    prompt: 'Haz commit solo de notes.txt con el mensaje "add notes". No incluyas ningún otro archivo.',
    check: (d) => headMessage(d) === "add notes" && git(d, "show", "--name-only", "--format=", "HEAD") === "notes.txt",
  },
  {
    id: "git-last-author",
    prompt: "¿Quién hizo el último commit de la rama main? Responde solo con el nombre.",
    check: (_d, t) => /\bbruno\b/i.test(t) && !/\bana\b/i.test(t),
  },
  {
    id: "git-count-main",
    prompt: "¿Cuántos commits tiene la rama main? Responde solo con el número.",
    check: (_d, t) => t.trim().replace(/\D/g, "") === "5",
  },
  {
    id: "git-new-branch",
    prompt: "Crea la rama release/1.0 a partir de main y cámbiate a ella.",
    check: (d) => git(d, "rev-parse", "--abbrev-ref", "HEAD") === "release/1.0" && git(d, "rev-parse", "release/1.0") === git(d, "rev-parse", "main"),
  },
  {
    id: "git-unstaged",
    prompt: "¿Qué archivo tiene cambios sin agregar al stage (unstaged)? Responde solo con el nombre.",
    check: (_d, t) => t.includes("README.md") && !t.includes("config.json") && !t.includes("notes.txt"),
  },
  {
    id: "git-who-added-login",
    prompt: "¿Quién creó el archivo src/login.ts y con qué mensaje de commit? Responde: <autor>, <mensaje>.",
    check: (_d, t) => /\bana\b/i.test(t) && lc(t).includes("add login"),
  },
  {
    id: "git-branches-contain",
    prompt: 'Qué ramas contienen el commit con mensaje "add login"? Responde solo con los nombres de las ramas.',
    check: (_d, t) => /\bmain\b/.test(t) && t.includes("feature/login"),
  },
  {
    id: "git-stage-readme",
    prompt: "Agrega README.md al stage, sin hacer commit.",
    check: (d) => git(d, "diff", "--cached", "--name-only").split("\n").includes("README.md") && headMessage(d) === "add docs",
  },
  {
    id: "git-unstage-all",
    prompt: "Saca del stage todo lo que esté en el stage, sin perder los cambios de los archivos.",
    check: (d) => git(d, "diff", "--cached", "--name-only") === "" && Deno.readTextFileSync(`${d}/config.json`) === GIT_WORKTREE.staged["config.json"] &&
      headMessage(d) === "add docs",
  },
];
