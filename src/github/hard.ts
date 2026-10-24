// Hard GitHub tasks: multi-step work, lookups the prompt does not spell out,
// conditions, and requests that must be refused instead of improvised.
// Frozen before the tool-search and code-search arms and the auto glossary were built.
import type { State } from "./mock.ts";
import type { GhTask } from "./tasks.ts";
import { heldoutSeed } from "./heldout.ts";

export function hardSeed(): State {
  const s = heldoutSeed();
  const r = s.repos[0];
  const at = (d: number) => new Date(Date.UTC(2026, 8, d)).toISOString();
  r.branches["fix/dashboard"] = "dd".repeat(20);
  r.files["fix/dashboard"] = { ...r.files.main, "src/dashboard.ts": "export const cacheMs = 5000;\n" };
  r.pulls.push({
    number: 12, title: "Cache dashboard queries", body: "Closes #8.\n\nAdds a 5s cache.", state: "open", merged: false,
    merge_method: null, head: "fix/dashboard", base: "main", author: "carla", draft: false,
    files: [{ filename: "src/dashboard.ts", status: "added", additions: 1, deletions: 0, patch: "" }],
    comments: [], created_at: at(19), updated_at: at(19),
  });
  return s;
}

const app = (s: State) => s.repos[0];
const iss = (s: State, n: number) => app(s).issues.find((i) => i.number === n);
const nums = (text: string) => new Set((text.match(/\d+/g) ?? []).map(Number));
const sameSet = (a: Set<number>, b: number[]) => b.every((x) => a.has(x)) && [...a].every((x) => b.includes(x));

export const hardTasks: GhTask[] = [
  {
    id: "x-fix-branch-pr",
    prompt:
      "Para el issue #1 de octo/app: crea una rama fix/login-empty-password desde main, agrega al final de README.md " +
      "la línea \"Login rejects empty passwords.\" en esa rama, y abre un PR hacia main cuyo cuerpo diga \"Fixes #1\".",
    check: (s) => {
      const r = app(s);
      const readme = r.files["fix/login-empty-password"]?.["README.md"] ?? "";
      const pr = r.pulls.find((p) => p.head === "fix/login-empty-password" && p.base === "main");
      return readme.startsWith("# app") && readme.trimEnd().endsWith("Login rejects empty passwords.") &&
        !r.files.main["README.md"].includes("empty passwords") && !!pr && /fixes #1\b/i.test(pr.body);
    },
  },
  {
    id: "x-merge-by-branch",
    prompt: "Mergea el pull request de octo/app que viene de la rama feat/theme.",
    check: (s) => !!app(s).pulls.find((p) => p.number === 11)?.merged && !app(s).pulls.find((p) => p.number === 10)?.merged,
  },
  {
    id: "x-least-loaded",
    prompt:
      "En octo/app, asigna el issue del botón desalineado a la persona (entre ana y bruno) que tenga menos issues abiertos asignados. " +
      "Quítale la asignación actual.",
    check: (s) => {
      const a = iss(s, 4)?.assignees ?? [];
      return a.length === 1 && a[0] === "bruno";
    },
  },
  {
    id: "x-uncommented",
    prompt: "¿Qué issues abiertos de octo/app asignados a ana no tienen ningún comentario? Responde solo con los números.",
    check: (_s, t) => sameSet(nums(t), [4]),
  },
  {
    id: "x-missing-branch",
    prompt: 'Abre un PR en octo/app desde la rama docs/old hacia main titulado "Old docs".',
    // The branch does not exist: the right move is to say so, not to create it.
    check: (s, t) => !app(s).pulls.some((p) => /old docs/i.test(p.title)) && !app(s).branches["docs/old"] &&
      /(no existe|not exist|doesn't exist|no se encontr|not found|no hay)/i.test(t),
  },
  {
    id: "x-move-label",
    prompt: "En octo/app, mueve la etiqueta ui del issue #2 al issue #4, sin tocar sus otras etiquetas.",
    check: (s) => {
      const a = iss(s, 2)?.labels ?? [];
      const b = iss(s, 4)?.labels ?? [];
      return !a.includes("ui") && a.includes("enhancement") && b.includes("ui") && b.includes("bug");
    },
  },
  {
    id: "x-reopen-latest",
    prompt: "En octo/app, reabre el issue cerrado con número más alto y asígnalo a carla.",
    check: (s) => iss(s, 7)?.state === "open" && !!iss(s, 7)?.assignees.includes("carla") && iss(s, 5)?.state === "closed",
  },
  {
    id: "x-label-summary",
    prompt:
      "¿Cuántos issues abiertos tiene cada etiqueta en octo/app? Responde una línea por etiqueta con el formato etiqueta: número, " +
      "solo etiquetas con al menos uno.",
    check: (_s, t) => {
      const want: Record<string, number> = { bug: 3, enhancement: 1, ui: 1, docs: 1, performance: 1 };
      const got: Record<string, number> = {};
      for (const m of t.matchAll(/([a-z]+)\s*:\s*(\d+)/gi)) got[m[1].toLowerCase()] = Number(m[2]);
      return Object.keys(want).every((k) => got[k] === want[k]) && Object.keys(got).every((k) => k in want);
    },
  },
  {
    id: "x-two-files-pr",
    prompt:
      "En octo/app crea la rama chore/meta desde main con dos archivos nuevos: .editorconfig con el contenido \"root = true\" " +
      "y CODEOWNERS con el contenido \"* @octo\". Luego abre un PR de esa rama hacia main titulado \"Repo metadata\".",
    check: (s) => {
      const f = app(s).files["chore/meta"] ?? {};
      return (f[".editorconfig"] ?? "").includes("root = true") && (f["CODEOWNERS"] ?? "").includes("* @octo") &&
        !app(s).files.main["CODEOWNERS"] && app(s).pulls.some((p) => p.head === "chore/meta" && /repo metadata/i.test(p.title));
    },
  },
  {
    id: "x-pr-references",
    prompt: "¿Cuál es el título del issue que cierra el PR #12 de octo/app? Responde solo con el título.",
    check: (_s, t) => /slow dashboard/i.test(t),
  },
  {
    id: "x-conditional-merge",
    prompt:
      "En octo/app: si el PR #10 modifica src/session.ts, mérgealo con squash; si no, déjale el comentario \"needs session changes\".",
    check: (s) => {
      const p = app(s).pulls.find((x) => x.number === 10)!;
      return p.merged && p.merge_method === "squash" && p.comments.length === 0;
    },
  },
  {
    id: "x-close-dupes",
    prompt:
      "En octo/app, el issue #4 duplica al #1 según el equipo. Cierra el #4 como no planificado y déjale el comentario \"Duplicate of #1\". " +
      "No toques el #1.",
    check: (s) => iss(s, 4)?.state === "closed" && iss(s, 4)?.state_reason === "not_planned" &&
      !!iss(s, 4)?.comments.some((c) => /duplicate of #1/i.test(c.body)) && iss(s, 1)?.state === "open" &&
      iss(s, 1)?.comments.length === 2,
  },
];
