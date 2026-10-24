// Real-GitHub set, NOT blind: written by the glossary's author from the seeded sandbox, after
// v4.3 and before any run on real GitHub. Its job is to check that mock results carry over to
// the real API, not to add evidence of superiority. Truths come from the frozen snapshot
// results/real-snapshot.json, taken right after seeding. Frozen in results/real-freeze.sha256.
// The benchmark token cannot write file contents, so there are no file-edit tasks.
import type { Issue, State } from "../mock.ts";
import type { GhTask } from "../tasks.ts";

const SNAP: State = JSON.parse(Deno.readTextFileSync(new URL("../../../results/real-snapshot.json", import.meta.url)));
export const realSnapshot = SNAP;
const issues = SNAP.repos[0].issues;
const open = issues.filter((i) => i.state === "open");
const has = (i: Issue, ...ls: string[]) => ls.every((l) => i.labels.includes(l));
const PRIOS = ["p0", "p1", "p2"];

const numbersIn = (t: string) => new Set((t.match(/\d+/g) ?? []).map(Number));
const sameSet = (t: string, want: number[]) => {
  const got = numbersIn(t);
  return want.every((n) => got.has(n)) && [...got].filter((n) => n > 0 && n <= 200 && !want.includes(n)).length === 0;
};
const firstNumber = (t: string) => Number((t.match(/\d+/) ?? ["NaN"])[0]);

const openBugs = open.filter((i) => has(i, "bug")).length;
const p0Open = open.filter((i) => has(i, "p0")).map((i) => i.number);
const v11BugsUnassigned = open.filter((i) => has(i, "v1.1", "bug") && !i.assignees.length).map((i) => i.number);
const notPlanned = issues.filter((i) => i.state_reason === "not_planned").length;
const threeComments = open.filter((i) => i.comments.length === 3).map((i) => i.number);
const apiOpen = open.filter((i) => has(i, "api"));
const pctApiAssigned = Math.round((100 * apiOpen.filter((i) => i.assignees.length).length) / apiOpen.length);
const releasePrs = SNAP.repos[0].pulls.filter((p) => p.base === "release/1.0").map((p) => p.number);
const draftPrs = SNAP.repos[0].pulls.filter((p) => p.draft).map((p) => p.number);
const cliNoPrio = open.filter((i) => has(i, "cli", "bug") && !i.labels.some((l) => PRIOS.includes(l))).map((i) => i.number);
const p0Unassigned = open.filter((i) => has(i, "p0") && !i.assignees.length).map((i) => i.number);
const CLOSE_TARGET = 104;
const CLOSE_COMMENT = "Duplicado de #116";

// Every issue outside `except` must match the snapshot.
function untouched(s: State, except: number[]) {
  const live = new Map(s.repos[0].issues.map((i) => [i.number, i]));
  return issues.every((i) => {
    if (except.includes(i.number)) return true;
    const l = live.get(i.number);
    return !!l && l.state === i.state && l.labels.join() === i.labels.join() &&
      l.assignees.join() === i.assignees.join() && l.comments.length === i.comments.length;
  });
}
const liveIssue = (s: State, n: number) => s.repos[0].issues.find((i) => i.number === n)!;
const snapIssue = (n: number) => issues.find((i) => i.number === n)!;

export const realTasks: (GhTask & { writes?: boolean })[] = [
  {
    id: "r-open-bugs",
    prompt: "¿Cuántos issues abiertos con la etiqueta bug hay en Rixmerz/phrasebook-sandbox? Responde solo con el número.",
    check: (_s, t) => firstNumber(t) === openBugs,
  },
  {
    id: "r-p0-open",
    prompt: "En Rixmerz/phrasebook-sandbox, ¿qué issues abiertos tienen la etiqueta p0? Responde solo con los números, separados por comas.",
    check: (_s, t) => sameSet(t, p0Open),
  },
  {
    id: "r-v11-bugs-unassigned",
    prompt: "En Rixmerz/phrasebook-sandbox, lista los issues abiertos con las etiquetas v1.1 y bug que no tienen a nadie asignado. Responde solo con los números, separados por comas.",
    check: (_s, t) => sameSet(t, v11BugsUnassigned),
  },
  {
    id: "r-not-planned",
    prompt: "¿Cuántos issues de Rixmerz/phrasebook-sandbox se cerraron como no planificados (not planned)? Responde solo con el número.",
    check: (_s, t) => firstNumber(t) === notPlanned,
  },
  {
    id: "r-three-comments",
    prompt: "En Rixmerz/phrasebook-sandbox, ¿qué issues abiertos tienen exactamente 3 comentarios? Responde solo con los números, separados por comas.",
    check: (_s, t) => sameSet(t, threeComments),
  },
  {
    id: "r-pct-api-assigned",
    prompt: "De los issues abiertos con la etiqueta api en Rixmerz/phrasebook-sandbox, ¿qué porcentaje tiene a alguien asignado? Responde solo con el porcentaje redondeado a entero.",
    check: (_s, t) => firstNumber(t) === pctApiAssigned,
  },
  {
    id: "r-release-prs",
    prompt: "¿Qué pull requests de Rixmerz/phrasebook-sandbox apuntan a la rama release/1.0? Responde solo con los números, separados por comas.",
    check: (_s, t) => sameSet(t, releasePrs),
  },
  {
    id: "r-draft-prs",
    prompt: "¿Qué pull requests de Rixmerz/phrasebook-sandbox están en borrador (draft)? Responde solo con los números, separados por comas.",
    check: (_s, t) => sameSet(t, draftPrs),
  },
  {
    id: "r-config-timeout",
    prompt: "¿Qué valor tiene request_timeout_s en config/settings.yaml de Rixmerz/phrasebook-sandbox (rama main)? Responde solo con el número.",
    check: (_s, t) => firstNumber(t) === 30,
  },
  {
    id: "w-label-cli-bugs",
    writes: true,
    prompt: "En Rixmerz/phrasebook-sandbox, agrega la etiqueta p1 a cada issue abierto con las etiquetas cli y bug que no tenga ninguna etiqueta de prioridad (p0, p1 o p2). No cambies nada más.",
    check: (s) => cliNoPrio.every((n) => liveIssue(s, n).labels.join() === [...snapIssue(n).labels, "p1"].sort().join()) && untouched(s, cliNoPrio),
  },
  {
    id: "w-assign-p0",
    writes: true,
    prompt: "En Rixmerz/phrasebook-sandbox, asígname a mí todos los issues abiertos con la etiqueta p0 que no tengan a nadie asignado. No cambies nada más.",
    check: (s) => p0Unassigned.every((n) => liveIssue(s, n).assignees.join() === "Rixmerz") && untouched(s, p0Unassigned),
  },
  {
    id: "w-close-duplicate",
    writes: true,
    prompt: `En Rixmerz/phrasebook-sandbox, cierra el issue #${CLOSE_TARGET} como no planificado (not planned) y deja este comentario exacto, sin comillas: ${CLOSE_COMMENT}`,
    check: (s) => {
      const i = liveIssue(s, CLOSE_TARGET);
      const added = i.comments.slice(snapIssue(CLOSE_TARGET).comments.length);
      return i.state === "closed" && i.state_reason === "not_planned" && added.length === 1 &&
        added[0].body.trim().replace(/\.$/, "") === CLOSE_COMMENT && untouched(s, [CLOSE_TARGET]);
    },
  },
];

export const REAL_TRUTH = { openBugs, p0Open, v11BugsUnassigned, notPlanned, threeComments, pctApiAssigned, releasePrs, draftPrs, cliNoPrio, p0Unassigned };
