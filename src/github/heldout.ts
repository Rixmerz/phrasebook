// Held-out GitHub tasks. Written and frozen before the v2 glossary existed,
// and run once, so v2 cannot have been tuned on them.
// They use their own seed so the original 12 tasks stay reproducible.
import type { State } from "./mock.ts";
import { type GhTask, seed } from "./tasks.ts";

export function heldoutSeed(): State {
  const s = seed();
  const r = s.repos[0];
  const at = (d: number) => new Date(Date.UTC(2026, 8, d)).toISOString();
  r.issues.find((i) => i.number === 1)!.comments = [
    { id: 701, body: "Can reproduce on Firefox.", user: { login: "bruno", id: 1 }, created_at: at(2) },
    { id: 702, body: "Same on Chrome.", user: { login: "ana", id: 2 }, created_at: at(3) },
  ];
  for (const n of [2, 6]) r.issues.find((i) => i.number === n)!.author = "ana";
  r.commits.push(
    { sha: "c1".repeat(20), message: "validate user", author: "ana", date: at(14), branch: "feat/login" },
    { sha: "c2".repeat(20), message: "add session ttl", author: "ana", date: at(15), branch: "feat/login" },
  );
  return s;
}

const app = (s: State) => s.repos[0];
const iss = (s: State, n: number) => app(s).issues.find((i) => i.number === n);
const nums = (text: string) => new Set((text.match(/\d+/g) ?? []).map(Number));
const sameSet = (a: Set<number>, b: number[]) => b.every((x) => a.has(x)) && [...a].every((x) => b.includes(x));
const words = (t: string) => t.toLowerCase();

export const heldoutTasks: GhTask[] = [
  {
    id: "h-pr-author",
    prompt: "¿Quién abrió el PR #11 de octo/app? Responde solo con el usuario.",
    check: (_s, t) => /\bbruno\b/i.test(t) && !/\bana\b/i.test(t),
  },
  {
    id: "h-closed-issues",
    prompt: "¿Qué issues de octo/app están cerrados? Responde solo con los números separados por coma.",
    check: (_s, t) => sameSet(nums(t), [5, 7]),
  },
  {
    id: "h-reopen",
    prompt: "Reabre el issue #7 de octo/app.",
    check: (s) => iss(s, 7)?.state === "open",
  },
  {
    id: "h-rename-pr",
    prompt: 'Cambia el título del PR #11 de octo/app a "Dark theme for buttons".',
    check: (s) => app(s).pulls.find((p) => p.number === 11)?.title === "Dark theme for buttons",
  },
  {
    id: "h-assign",
    prompt: "Asigna el issue #2 de octo/app a bruno.",
    check: (s) => !!iss(s, 2)?.assignees.includes("bruno"),
  },
  {
    id: "h-dir-list",
    prompt: "¿Qué hay dentro de la carpeta src en la rama main de octo/app? Responde solo con los nombres.",
    check: (_s, t) => words(t).includes("login.ts") && /\bui\b/.test(words(t)) && !words(t).includes("session.ts"),
  },
  {
    id: "h-comment-count",
    prompt: "¿Cuántos comentarios tiene el issue #1 de octo/app? Responde solo con el número.",
    check: (_s, t) => t.trim().replace(/\D/g, "") === "2",
  },
  {
    id: "h-delete-file",
    prompt: 'Borra el archivo README.md de la rama feat/theme de octo/app con el mensaje "remove readme".',
    check: (s) => !("README.md" in (app(s).files["feat/theme"] ?? {})) && "README.md" in app(s).files.main,
  },
  {
    id: "h-pr-commit-count",
    prompt: "¿Cuántos commits tiene el PR #10 de octo/app? Responde solo con el número.",
    check: (_s, t) => t.trim().replace(/\D/g, "") === "2",
  },
  {
    id: "h-branches",
    prompt: "¿Qué ramas tiene octo/app? Responde solo con los nombres separados por coma.",
    check: (_s, t) => ["main", "feat/login", "feat/theme"].every((b) => words(t).includes(b)),
  },
  {
    id: "h-issues-by-author",
    prompt: "¿Qué issues de octo/app abrió ana? Responde solo con los números separados por coma.",
    check: (_s, t) => sameSet(nums(t), [2, 6]),
  },
];
