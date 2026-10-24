// GitHub benchmark tasks over a seeded fake repository (octo/app).
// Prompts are in Spanish, as the user talks; checks read the fake's state.
import type { Issue, Pull, Repo, State } from "./mock.ts";

export type GhTask = {
  id: string;
  prompt: string;
  check: (s: State, finalText: string) => boolean;
};

const day = (d: number) => new Date(Date.UTC(2026, 8, d)).toISOString();
const issue = (number: number, title: string, labels: string[], assignees: string[], state: "open" | "closed" = "open", d = number): Issue => ({
  number, title, body: `Details for: ${title}`, state, state_reason: state === "closed" ? "completed" : null,
  labels, assignees, author: "carla", comments: [], created_at: day(d), updated_at: day(d),
});

export function seed(): State {
  const files = {
    "README.md": "# app\n\nDemo application.\n",
    "package.json": '{\n  "name": "app",\n  "version": "1.4.2"\n}\n',
    "src/login.ts": "export function login() {\n  return true;\n}\n",
    "src/ui/button.tsx": "export const Button = () => null;\n",
  };
  const feature = { ...files, "src/login.ts": "export function login(user: string) {\n  return user.length > 0;\n}\n", "src/session.ts": "export const ttl = 3600;\n" };
  const commits = [
    ...["ana", "bruno", "ana", "bruno", "carla", "bruno", "ana", "bruno"].map((author, i) => ({
      sha: (i + 1).toString(16).padStart(2, "0").repeat(20), message: `change ${i + 1}`, author, date: day(20 - i), branch: "main",
    })),
  ];
  const pulls: Pull[] = [
    {
      number: 10, title: "Validate login input", body: "Adds user validation.", state: "open", merged: false, merge_method: null,
      head: "feat/login", base: "main", author: "ana", draft: false,
      files: [
        { filename: "src/login.ts", status: "modified", additions: 2, deletions: 1, patch: "" },
        { filename: "src/session.ts", status: "added", additions: 1, deletions: 0, patch: "" },
      ],
      comments: [], created_at: day(15), updated_at: day(15),
    },
    {
      number: 11, title: "Darker button theme", body: "Theme tweak.", state: "open", merged: false, merge_method: null,
      head: "feat/theme", base: "main", author: "bruno", draft: false,
      files: [{ filename: "src/ui/button.tsx", status: "modified", additions: 3, deletions: 1, patch: "" }],
      comments: [], created_at: day(18), updated_at: day(18),
    },
  ];
  const repo: Repo = {
    owner: "octo", name: "app", default_branch: "main",
    branches: { main: commits[0].sha, "feat/login": "aa".repeat(20), "feat/theme": "bb".repeat(20) },
    files: { main: files, "feat/login": feature, "feat/theme": { ...files, "src/ui/button.tsx": "export const Button = () => 'dark';\n" } },
    issues: [
      issue(1, "Login fails with empty password", ["bug"], ["ana"]),
      issue(2, "Add dark mode", ["enhancement", "ui"], []),
      issue(3, "Crash on logout", ["bug"], ["bruno"]),
      issue(4, "Button misaligned on mobile", ["bug"], ["ana"]),
      issue(5, "Old flaky test", ["test"], [], "closed"),
      issue(6, "Typo in README", ["docs"], []),
      issue(7, "Session expires too early", ["bug"], ["ana"], "closed"),
      issue(8, "Slow dashboard", ["performance"], ["bruno"]),
    ],
    pulls, commits, labels: ["bug", "enhancement", "ui", "test", "docs", "performance"],
  };
  return { repos: [repo], users: ["ana", "bruno", "carla", "octo"], me: "octo", nextId: 900 };
}

const app = (s: State) => s.repos[0];
const iss = (s: State, n: number) => app(s).issues.find((i) => i.number === n);
const nums = (text: string) => new Set((text.match(/\d+/g) ?? []).map(Number));
const sameSet = (a: Set<number>, b: number[]) => b.every((x) => a.has(x)) && [...a].every((x) => b.includes(x));

export const ghTasks: GhTask[] = [
  {
    id: "count-open-bugs",
    prompt: "¿Cuántos issues abiertos con la etiqueta bug hay en octo/app? Responde solo con el número.",
    check: (_s, t) => t.trim().replace(/\D/g, "") === "3",
  },
  {
    id: "search-qualifiers",
    prompt: "En octo/app, ¿qué issues abiertos con etiqueta bug están asignados a ana? Responde solo con los números separados por coma.",
    check: (_s, t) => sameSet(nums(t), [1, 4]),
  },
  {
    id: "close-with-comment",
    prompt: 'Cierra el issue #3 de octo/app como completado y déjale el comentario "Resuelto en #10".',
    check: (s) => iss(s, 3)?.state === "closed" && !!iss(s, 3)?.comments.some((c) => c.body.includes("Resuelto en #10")),
  },
  {
    id: "create-issue-multiline",
    prompt:
      "Crea un issue en octo/app titulado \"Release checklist 1.5\" con la etiqueta release, " +
      "y en el cuerpo una lista con tres líneas: \"- [ ] changelog\", \"- [ ] tag\", \"- [ ] deploy\".",
    check: (s) => {
      const i = app(s).issues.find((x) => /release checklist 1\.5/i.test(x.title));
      if (!i || !i.labels.includes("release")) return false;
      const lines = i.body.split("\n").map((l) => l.trim());
      return ["- [ ] changelog", "- [ ] tag", "- [ ] deploy"].every((x) => lines.includes(x));
    },
  },
  {
    id: "pr-files",
    prompt: "¿Qué archivos cambia el PR #10 de octo/app? Responde solo con las rutas, una por línea.",
    check: (_s, t) => t.includes("src/login.ts") && t.includes("src/session.ts") && !t.includes("button"),
  },
  {
    id: "merge-squash",
    prompt: "Mergea el PR #10 de octo/app usando squash.",
    check: (s) => {
      const p = app(s).pulls.find((x) => x.number === 10)!;
      return p.merged && p.merge_method === "squash";
    },
  },
  {
    id: "read-file",
    prompt: "¿Qué versión declara el package.json de octo/app en main? Responde solo con la versión.",
    check: (_s, t) => /\b1\.4\.2\b/.test(t),
  },
  {
    id: "branch-file-pr",
    prompt:
      "En octo/app: crea la rama docs/guide desde main, agrega el archivo docs/guide.md con este contenido de dos líneas:\n" +
      "# Guide\nRun `deno task dev` to start.\n" +
      "y abre un PR de esa rama hacia main titulado \"Add guide\".",
    check: (s) => {
      const r = app(s);
      const content = r.files["docs/guide"]?.["docs/guide.md"] ?? "";
      const pr = r.pulls.find((p) => p.head === "docs/guide" && p.base === "main");
      return !!r.branches["docs/guide"] && content.includes("# Guide\n") && content.includes("deno task dev") &&
        !r.files.main["docs/guide.md"] && !!pr && /add guide/i.test(pr.title);
    },
  },
  {
    id: "comment-newest-pr",
    prompt: 'Deja el comentario "LGTM" en el pull request abierto más reciente de octo/app.',
    check: (s) => {
      const r = app(s);
      return !!r.pulls.find((p) => p.number === 11)?.comments.some((c) => /lgtm/i.test(c.body)) &&
        !r.pulls.find((p) => p.number === 10)?.comments.length;
    },
  },
  {
    id: "add-label-keep",
    prompt: "Agrega la etiqueta ui al issue #4 de octo/app sin quitarle las etiquetas que ya tiene.",
    check: (s) => {
      const l = iss(s, 4)?.labels ?? [];
      return l.includes("ui") && l.includes("bug");
    },
  },
  {
    id: "count-commits-author",
    prompt: "¿Cuántos commits hizo bruno en la rama main de octo/app? Responde solo con el número.",
    check: (_s, t) => t.trim().replace(/\D/g, "") === "4",
  },
  {
    id: "close-not-planned",
    prompt: "El issue #6 de octo/app no se va a hacer: ciérralo como no planificado.",
    check: (s) => iss(s, 6)?.state === "closed" && iss(s, 6)?.state_reason === "not_planned",
  },
];
