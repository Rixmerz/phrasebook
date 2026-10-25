// Fourth blind GitHub set: procedural writes (conditions, close reasons, missing branches,
// multi-file PRs, edits on a non-default branch) plus pipeline counts, over the octo/trailmap
// seed of blind3. Written after github-small.json was tuned on github-hard and frozen before
// any arm ran on it; never tuned on afterwards.
import type { State } from "./mock.ts";
import type { GhTask } from "./tasks.ts";
import { blind3Seed } from "./blind3tasks.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`blind4tasks: ${msg}`);
}

const base = blind3Seed();
const openPrs = base.repos[0].pulls.filter((p) => p.state === "open" && !p.draft && p.base === "main");
assert(openPrs.length >= 2, "need two open main PRs");
const prFlags = openPrs[0].number; // touches config/flags.json
const prQueue = openPrs[1].number; // touches only app/src/sync/queue.ts

export function blind4Seed(): State {
  const s = blind3Seed();
  const r = s.repos[0];
  const file = (filename: string) => ({ filename, status: "modified", additions: 2, deletions: 1, patch: "" });
  const a = r.pulls.find((p) => p.number === prFlags)!;
  a.files = [file("config/flags.json"), file("README.md")];
  r.files[a.head] = { ...r.files[a.head], "config/flags.json": r.files.main["config/flags.json"].replace("256", "300") };
  const b = r.pulls.find((p) => p.number === prQueue)!;
  b.files = [file("app/src/sync/queue.ts")];
  r.files[b.head] = { ...r.files[b.head], "app/src/sync/queue.ts": "export const MAX_RETRIES = 6;\nexport const BACKOFF_MS = 2000;\n" };
  return s;
}

const pristine = blind4Seed();
const issues = pristine.repos[0].issues;
const open = issues.filter((i) => i.state === "open");
const has = (i: { labels: string[] }, l: string) => i.labels.includes(l);
const toComplete = open.filter((i) => has(i, "bug") && has(i, "sync") && i.comments.length >= 1)[2];
const dupPair = open.filter((i) => has(i, "map") && i.comments.length === 0).slice(0, 2);
assert(!!toComplete && dupPair.length === 2, "no issues for close tasks");
const [dupOrig, dupCopy] = [dupPair[0], dupPair[1]];
const offlineP1 = open.filter((i) => has(i, "offline") && has(i, "p1")).length;
assert(offlineP1 >= 3, "offlineP1 too small");
const authByMs: Record<string, number> = {};
for (const i of open.filter((i) => has(i, "auth"))) {
  const m = i.labels.find((l) => ["v4.1", "v4.2", "v5.0"].includes(l));
  if (m) authByMs[m] = (authByMs[m] ?? 0) + 1;
}
assert(Object.keys(authByMs).length === 3, "auth milestones incomplete");
const renataNoMs = open.filter((i) => i.assignees.includes("renata") && !i.labels.some((l) => ["v4.1", "v4.2", "v5.0"].includes(l))).map((i) => i.number);
assert(renataNoMs.length >= 2 && renataNoMs.length <= 15, `renataNoMs ${renataNoMs.length}`);
assert(!pristine.repos[0].branches["feat/heatmap"], "feat/heatmap exists");

export const blind4Truth = { prFlags, prQueue, toComplete: toComplete.number, dupOrig: dupOrig.number, dupCopy: dupCopy.number, offlineP1, authByMs, renataNoMs };

const repo = (s: State) => s.repos[0];
const iss = (s: State, n: number) => repo(s).issues.find((i) => i.number === n)!;
const pr = (s: State, n: number) => repo(s).pulls.find((p) => p.number === n)!;
const ints = (t: string) => new Set((t.match(/\d+/g) ?? []).map(Number));
const noneMerged = (s: State) => repo(s).pulls.every((p) => p.merged === pristine.repos[0].pulls.find((q) => q.number === p.number)?.merged);

export const blind4Tasks: GhTask[] = [
  {
    id: "b4-cond-close",
    prompt: `En octo/trailmap: si el PR #${prFlags} toca config/flags.json, ciérralo sin mergear y déjale el comentario "flags need review"; ` +
      "si no lo toca, mérgealo con rebase.",
    check: (s) => {
      const p = pr(s, prFlags);
      return p.state === "closed" && !p.merged && p.comments.some((c) => /flags need review/i.test(c.body));
    },
  },
  {
    id: "b4-cond-rebase",
    prompt: `En octo/trailmap: si el PR #${prQueue} toca config/flags.json, ciérralo sin mergear y déjale el comentario "flags need review"; ` +
      "si no lo toca, mérgealo con rebase.",
    check: (s) => {
      const p = pr(s, prQueue);
      return p.merged && p.merge_method === "rebase" && p.comments.length === 0;
    },
  },
  {
    id: "b4-close-completed",
    prompt: `En octo/trailmap, el issue #${toComplete.number} ya quedó resuelto: ciérralo como completado y comenta "Fixed in 4.1.3".`,
    check: (s) => {
      const i = iss(s, toComplete.number);
      return i.state === "closed" && i.state_reason === "completed" && i.comments.some((c) => /fixed in 4\.1\.3/i.test(c.body));
    },
  },
  {
    id: "b4-close-duplicate",
    prompt: `En octo/trailmap, cierra el issue #${dupCopy.number} como duplicado del #${dupOrig.number}. No toques el #${dupOrig.number}.`,
    check: (s) => iss(s, dupCopy.number).state === "closed" && iss(s, dupCopy.number).state_reason === "duplicate" &&
      iss(s, dupOrig.number).state === "open" && iss(s, dupOrig.number).comments.length === 0,
  },
  {
    id: "b4-missing-branch",
    prompt: "Mergea el pull request de octo/trailmap que viene de la rama feat/heatmap.",
    check: (s, t) => noneMerged(s) && /(no existe|not exist|doesn't exist|no se encontr|not found|no hay|ningún)/i.test(t),
  },
  {
    id: "b4-two-docs-pr",
    prompt: "En octo/trailmap crea la rama docs/import desde release/4.2 con dos archivos nuevos: docs/gpx.md con el contenido \"# GPX\" " +
      "y docs/kml.md con el contenido \"# KML\". Luego abre un PR de esa rama hacia release/4.2 titulado \"Import docs\".",
    check: (s) => {
      const f = repo(s).files["docs/import"] ?? {};
      return (f["docs/gpx.md"] ?? "").includes("# GPX") && (f["docs/kml.md"] ?? "").includes("# KML") &&
        (f["config/flags.json"] ?? "").includes('"offline_tiles_max_mb": 512') && !repo(s).files["release/4.2"]["docs/gpx.md"] &&
        repo(s).pulls.some((p) => p.head === "docs/import" && p.base === "release/4.2" && /import docs/i.test(p.title));
    },
  },
  {
    id: "b4-edit-release",
    prompt: "En la rama release/4.2 de octo/trailmap, cambia min_ios de \"15.0\" a \"16.0\" en config/flags.json, directo en esa rama, " +
      "sin tocar el resto del archivo.",
    check: (s) => {
      const f = repo(s).files["release/4.2"]["config/flags.json"] ?? "";
      return f.includes('"min_ios": "16.0"') && f.includes('"offline_tiles_max_mb": 512') && f.includes('"min_android_sdk": 24') &&
        repo(s).files.main["config/flags.json"].includes('"min_ios": "15.0"');
    },
  },
  {
    id: "b4-count-offline-p1",
    prompt: "¿Cuántos issues abiertos de octo/trailmap tienen a la vez las etiquetas offline y p1? Responde solo con el número.",
    check: (_s, t) => (t.match(/\d+/g) ?? []).map(Number)[0] === offlineP1,
  },
  {
    id: "b4-auth-by-milestone",
    prompt: "En octo/trailmap, de los issues abiertos con etiqueta auth, ¿cuántos hay por milestone (v4.1, v4.2, v5.0)? " +
      "Responde una línea por milestone con el formato milestone: número.",
    check: (_s, t) => {
      const got: Record<string, number> = {};
      for (const m of t.matchAll(/(v\d\.\d)\s*:\s*(\d+)/gi)) got[m[1]] = Number(m[2]);
      return Object.entries(authByMs).every(([k, v]) => got[k] === v);
    },
  },
  {
    id: "b4-renata-no-milestone",
    prompt: "¿Qué issues abiertos de octo/trailmap asignados a renata no tienen etiqueta de milestone (v4.1, v4.2 ni v5.0)? " +
      "Responde solo con los números.",
    check: (_s, t) => {
      const got = ints(t);
      return renataNoMs.every((n) => got.has(n)) && [...got].every((n) => renataNoMs.includes(n));
    },
  },
];
