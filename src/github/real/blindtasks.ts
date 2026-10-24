// Blind real-GitHub set, written 2026-10-24 by an agent that saw only the frozen snapshot
// (results/real-snapshot.json) and the format example (src/github/real/tasks.ts, mock.ts types).
// It never saw the systems being compared. Every truth is computed from the snapshot below.
import type { Issue, State } from "../mock.ts";
import type { GhTask } from "../tasks.ts";

const SNAP: State = JSON.parse(Deno.readTextFileSync(new URL("../../../results/real-snapshot.json", import.meta.url)));
const repo = SNAP.repos[0];
const issues = repo.issues;
const open = issues.filter((i) => i.state === "open");
const closed = issues.filter((i) => i.state === "closed");
const has = (i: Issue, ...ls: string[]) => ls.every((l) => i.labels.includes(l));
const AREAS = ["api", "cli", "infra", "ui"];
const VERSIONS = ["v1.0", "v1.1"];

// Drop label names and repo/branch names that carry digits, so echoed context does not count.
const clean = (t: string) =>
  t.replace(/phrasebook-sandbox/gi, " ").replace(/release\/\d+(\.\d+)*/gi, " ").replace(/\bv\d+(\.\d+)*/gi, " ").replace(/\bp\d\b/gi, " ");
const numbersIn = (t: string) => new Set((clean(t).match(/\d+/g) ?? []).map(Number));
const sameSet = (t: string, want: number[]) => {
  const got = numbersIn(t);
  return want.every((n) => got.has(n)) && [...got].filter((n) => n > 0 && n <= 200 && !want.includes(n)).length === 0;
};
const firstNumber = (t: string) => Number((clean(t).match(/\d+(\.\d+)?/) ?? ["NaN"])[0]);

// --- read truths ---
const uiP1OpenUnassigned = open.filter((i) => has(i, "ui", "p1") && !i.assignees.length).length;
const urgentByArea = Object.fromEntries(AREAS.map((a) => [a, open.filter((i) => has(i, a) && has(i, "p0")).length]));
const urgentSorted = Object.entries(urgentByArea).sort((a, b) => b[1] - a[1]);
const topArea = urgentSorted[0][0];
const WORKAROUND = "Is there a workaround?";
const workaroundOpen = open.filter((i) => i.comments.some((c) => c.body.includes(WORKAROUND))).map((i) => i.number);
const pctNotPlanned = Math.round((100 * closed.filter((i) => i.state_reason === "not_planned").length) / closed.length);
const allV10Bugs = issues.filter((i) => has(i, "v1.0", "bug")).length;
const p0OpenNoVersion = open.filter((i) => has(i, "p0") && !i.labels.some((l) => VERSIONS.includes(l))).map((i) => i.number);
const openPrsPlusCliBugs = repo.pulls.filter((p) => p.state === "open").length + open.filter((i) => has(i, "cli", "bug")).length;
const commented = issues.filter((i) => i.comments.length > 0);
const avgComments = Math.round((10 * commented.reduce((s, i) => s + i.comments.length, 0)) / commented.length) / 10;
const maxUploadMb = Number(repo.files.main["config/settings.yaml"].match(/max_upload_mb:\s*(\d+)/)![1]);

// --- write targets ---
const infraP1Unassigned = open.filter((i) => has(i, "infra", "p1", "bug") && !i.assignees.length).map((i) => i.number);
const DOCS_P2_NOVER = open.filter((i) => has(i, "docs", "p2") && !i.labels.some((l) => VERSIONS.includes(l)) && !i.assignees.length).map((i) => i.number);
const REOPEN_TARGET = 117; // closed p0 cli bug
const REOPEN_COMMENT = "Reabierto: el fallo volvió a aparecer en la build nocturna";

function untouched(s: State, except: number[]) {
  const live = new Map(s.repos[0].issues.map((i) => [i.number, i]));
  return issues.every((i) => {
    if (except.includes(i.number)) return true;
    const l = live.get(i.number);
    return !!l && l.state === i.state && (l.state_reason ?? null) === (i.state_reason ?? null) &&
      [...l.labels].sort().join() === [...i.labels].sort().join() &&
      [...l.assignees].sort().join() === [...i.assignees].sort().join() && l.comments.length === i.comments.length;
  });
}
const liveIssue = (s: State, n: number) => s.repos[0].issues.find((i) => i.number === n)!;
const snapIssue = (n: number) => issues.find((i) => i.number === n)!;
const sameExceptLabels = (s: State, n: number) => {
  const l = liveIssue(s, n), o = snapIssue(n);
  return l.state === o.state && l.assignees.join() === o.assignees.join() && l.comments.length === o.comments.length;
};

export const realBlindTasks: (GhTask & { writes?: boolean })[] = [
  {
    id: "rb-ui-p1-unassigned",
    prompt: "En Rixmerz/phrasebook-sandbox, ¿cuántos issues abiertos tienen a la vez las etiquetas ui y p1 y no tienen a nadie asignado? Responde solo con el número.",
    check: (_s, t) => firstNumber(t) === uiP1OpenUnassigned,
  },
  {
    id: "rb-top-urgent-area",
    prompt: "En Rixmerz/phrasebook-sandbox, considerando solo issues abiertos con la etiqueta p0, ¿cuál de las etiquetas de área (api, cli, infra, ui) tiene más issues? Responde solo con el nombre de la etiqueta.",
    check: (_s, t) => {
      const words: string[] = t.toLowerCase().match(/[a-z]+/g) ?? [];
      return words.includes(topArea) && AREAS.filter((a) => a !== topArea && words.includes(a)).length === 0;
    },
  },
  {
    id: "rb-workaround-comments",
    prompt: `En Rixmerz/phrasebook-sandbox, ¿qué issues abiertos tienen algún comentario que diga exactamente "${WORKAROUND}"? Responde solo con los números, separados por comas.`,
    check: (_s, t) => sameSet(t, workaroundOpen),
  },
  {
    id: "rb-pct-not-planned",
    prompt: "De todos los issues cerrados de Rixmerz/phrasebook-sandbox, ¿qué porcentaje se cerró como no planificado (not planned)? Responde solo con el porcentaje redondeado a entero.",
    check: (_s, t) => firstNumber(t) === pctNotPlanned,
  },
  {
    id: "rb-all-v10-bugs",
    prompt: "En Rixmerz/phrasebook-sandbox, contando todos los issues (abiertos y cerrados), ¿cuántos tienen las etiquetas v1.0 y bug? Responde solo con el número.",
    check: (_s, t) => firstNumber(t) === allV10Bugs,
  },
  {
    id: "rb-p0-no-version",
    prompt: "En Rixmerz/phrasebook-sandbox, ¿qué issues abiertos tienen la etiqueta p0 pero ninguna etiqueta de versión (ni v1.0 ni v1.1)? Responde solo con los números, separados por comas.",
    check: (_s, t) => sameSet(t, p0OpenNoVersion),
  },
  {
    id: "rb-prs-plus-cli-bugs",
    prompt: "En Rixmerz/phrasebook-sandbox, suma la cantidad de pull requests abiertos y la cantidad de issues abiertos (sin contar pull requests) que tienen las etiquetas cli y bug. Responde solo con el total.",
    check: (_s, t) => firstNumber(t) === openPrsPlusCliBugs,
  },
  {
    id: "rb-avg-comments",
    prompt: "En Rixmerz/phrasebook-sandbox, contando todos los issues (abiertos y cerrados) que tienen al menos un comentario, ¿cuál es el promedio de comentarios por issue? Responde solo con el número redondeado a un decimal.",
    check: (_s, t) => Math.abs(firstNumber(t.replace(",", ".")) - avgComments) < 0.051,
  },
  {
    id: "rb-config-upload",
    prompt: "En Rixmerz/phrasebook-sandbox, rama main, ¿qué valor tiene max_upload_mb en config/settings.yaml? Responde solo con el número.",
    check: (_s, t) => firstNumber(t) === maxUploadMb,
  },
  {
    id: "rb-w-assign-infra-p1-bugs",
    writes: true,
    prompt: "En Rixmerz/phrasebook-sandbox, asigna a Rixmerz cada issue abierto con las etiquetas infra, p1 y bug que no tenga a nadie asignado. No cambies nada más.",
    check: (s) => infraP1Unassigned.every((n) => liveIssue(s, n).assignees.join() === "Rixmerz" && liveIssue(s, n).state === "open") && untouched(s, infraP1Unassigned),
  },
  {
    id: "rb-w-label-docs-p2",
    writes: true,
    prompt: "En Rixmerz/phrasebook-sandbox, agrega la etiqueta v1.1 a cada issue abierto con las etiquetas docs y p2 que no tenga etiqueta de versión (ni v1.0 ni v1.1) y no tenga a nadie asignado. No cambies nada más.",
    check: (s) =>
      DOCS_P2_NOVER.every((n) => [...liveIssue(s, n).labels].sort().join() === [...snapIssue(n).labels, "v1.1"].sort().join() && sameExceptLabels(s, n)) &&
      untouched(s, DOCS_P2_NOVER),
  },
  {
    id: "rb-w-reopen",
    writes: true,
    prompt: `En Rixmerz/phrasebook-sandbox, reabre el issue cerrado #${REOPEN_TARGET} y deja este comentario exacto, sin comillas: ${REOPEN_COMMENT}`,
    check: (s) => {
      const i = liveIssue(s, REOPEN_TARGET);
      const added = i.comments.slice(snapIssue(REOPEN_TARGET).comments.length);
      return i.state === "open" && added.length === 1 && added[0].body.trim().replace(/\.$/, "") === REOPEN_COMMENT &&
        i.labels.join() === snapIssue(REOPEN_TARGET).labels.join() && untouched(s, [REOPEN_TARGET]);
    },
  },
];

export const REAL_BLIND_TRUTH = {
  uiP1OpenUnassigned, urgentByArea, topArea, workaroundOpen, pctNotPlanned, allV10Bugs, p0OpenNoVersion,
  openPrsPlusCliBugs, avgComments, maxUploadMb, infraP1Unassigned, DOCS_P2_NOVER,
  reopen: { target: REOPEN_TARGET, snapState: snapIssue(REOPEN_TARGET).state },
};
