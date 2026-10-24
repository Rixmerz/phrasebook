// Held-out tasks, third blind set, written without access to the arms or earlier tasks
// (only blindtasks.ts as a format reference and mock.ts for what the fake serves).
// Repo octo/trailmap: a hiking mobile app. 260 issues and 72 pull requests over three base
// branches, so listings need several pages of 100. Every expected answer is computed from
// the generator below; rankings and sets are asserted unambiguous at module load.
import type { Comment, Issue, Pull, State } from "./mock.ts";
import type { GhTask } from "./tasks.ts";
import { seed } from "./tasks.ts";

const PEOPLE = ["mateo", "sofia", "lucas", "valen", "tomas", "renata", "nico", "paula", "joaquin", "isidora"];
const AREAS = ["map", "offline", "sync", "auth", "onboarding", "notifications"];
const KINDS = ["bug", "feature", "chore", "a11y"];
const MILESTONES = ["v4.1", "v4.2", "v5.0"];
const PRIORITIES = ["p0", "p1", "p2"];
const BASES = ["main", "main", "main", "release/4.1", "release/4.2"];
const N_ISSUES = 260;
const N_PULLS = 72;
const PR_BASE = 400;

function rng(seedValue: number) {
  let x = seedValue;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

const pick = <T>(rand: () => number, xs: T[]) => xs[Math.floor(rand() * xs.length)];
const skewed = (rand: () => number, xs: string[], power: number) => xs[Math.min(xs.length - 1, Math.floor(Math.pow(rand(), power) * xs.length))];
const day = (d: number) => new Date(Date.UTC(2026, 3, 1 + (d % 150), d % 24, (d * 7) % 60)).toISOString();

const DEVICES = ["Pixel 8, Android 15", "iPhone 13, iOS 18.2", "Galaxy A54, Android 14", "iPhone SE, iOS 17.6", "Moto G84, Android 14"];
const SUBJECTS: Record<string, string[]> = {
  map: ["contour lines flicker when zooming", "trail colors unreadable in satellite view", "elevation profile misaligned", "POI pins overlap at zoom 12"],
  offline: ["downloaded region disappears after update", "tile cache grows without limit", "offline routing ignores closed trails", "resume of interrupted downloads"],
  sync: ["recorded track duplicated after sync", "conflict when editing a route on two devices", "sync stalls on metered networks", "favorites lost after reinstall"],
  auth: ["Apple sign-in loops on iPad", "session expires during long hikes", "password reset email delayed", "magic link opens the browser"],
  onboarding: ["location permission prompt shown twice", "tutorial cannot be skipped", "units picker defaults to imperial", "welcome carousel crops text"],
  notifications: ["weather alerts arrive late", "sunset reminder fires twice", "push token not refreshed", "quiet hours ignored"],
};

function body(rand: () => number, kind: string, area: string, subject: string) {
  if (kind === "bug") {
    return `### Steps to reproduce\n1. Open the ${area} screen\n2. ${subject.charAt(0).toUpperCase() + subject.slice(1)}\n3. Go back and reopen the app\n\n` +
      `### Expected\nThe app keeps working normally.\n\n### Device\n${pick(rand, DEVICES)}\n`;
  }
  if (kind === "a11y") return `VoiceOver/TalkBack issue in **${area}**: ${subject}.\n\n- [ ] audit labels\n- [ ] check contrast\n`;
  if (kind === "chore") return `Housekeeping for ${area}: ${subject}.`;
  return `## Proposal\nAs a hiker I want the ${area} module to handle "${subject}" better.\n\n## Notes\nSee the design doc in Figma.\n`;
}

function build() {
  const rand = rng(20261024);
  const issues: Issue[] = [];
  for (let n = 1; n <= N_ISSUES; n++) {
    const area = pick(rand, AREAS);
    const kind = rand() < 0.4 ? "bug" : pick(rand, KINDS);
    const subject = pick(rand, SUBJECTS[area]);
    const labels = [kind, area];
    if (rand() < 0.7) labels.push(pick(rand, MILESTONES));
    if (rand() < 0.5) labels.push(skewed(rand, PRIORITIES, 1.3));
    if (rand() < 0.07) labels.push("stale");
    const r = rand();
    const first = skewed(rand, PEOPLE, 1.5);
    let assignees: string[] = r < 0.2 ? [] : [first];
    if (r > 0.88) {
      const second = pick(rand, PEOPLE);
      if (second !== first) assignees = [first, second];
    }
    const ncomments = Math.floor(rand() * 5);
    const comments: Comment[] = Array.from({ length: ncomments }, (_, k) => {
      const who = pick(rand, PEOPLE);
      const text = pick(rand, ["Can reproduce on my device.", "Looking into it.", "Is this still happening on 4.1.2?", "Added logs below.\n\n```\nE/TrailSync: timeout after 30s\n```"]);
      return { id: 50000 + n * 10 + k, body: text, user: { login: who, id: 3000 + PEOPLE.indexOf(who) }, created_at: day(n + k) };
    });
    const closed = rand() < 0.38;
    issues.push({
      number: n, title: `[${area}] ${subject.charAt(0).toUpperCase() + subject.slice(1)} (#${n})`,
      body: body(rand, kind, area, subject), state: closed ? "closed" : "open",
      state_reason: closed ? (rand() < 0.28 ? "not_planned" : "completed") : null,
      labels, assignees, author: skewed(rand, PEOPLE, 1.1), comments, created_at: day(n), updated_at: day(n + 2),
    });
  }
  const pulls: Pull[] = [];
  for (let k = 1; k <= N_PULLS; k++) {
    const number = PR_BASE + k;
    const t1 = 1 + Math.floor(rand() * N_ISSUES);
    const t2 = rand() < 0.25 ? 1 + Math.floor(rand() * N_ISSUES) : 0;
    const base = pick(rand, BASES);
    const state = rand() < 0.55 ? "open" : "closed";
    const author = skewed(rand, PEOPLE, 1.8);
    const closes = t2 && t2 !== t1 ? `Closes #${t1}\nCloses #${t2}` : `Closes #${t1}`;
    const prBody = rand() < 0.5
      ? `## Summary\nTouches the code behind #${t1}.\n\n${closes}\n\n## Testing\n- [x] unit tests\n- [ ] manual QA on ${pick(rand, DEVICES)}\n`
      : `${closes}`;
    pulls.push({
      number, title: `${pick(rand, ["Fix", "Refactor", "Handle", "Polish"])} ${issues[t1 - 1].labels[1]} flow (#${t1})`, body: prBody,
      state, merged: state === "closed" && rand() < 0.65, merge_method: null, head: `dev/${author}/i${t1}-${k}`, base, author,
      draft: state === "open" && rand() < 0.15, files: [], comments: [], created_at: day(k * 2), updated_at: day(k * 2 + 1),
    });
  }
  return { issues, pulls };
}

const FLAGS_MAIN = '{\n  "offline_tiles_max_mb": 256,\n  "min_android_sdk": 26,\n  "min_ios": "15.0",\n  "experimental": {\n    "route_3d": false,\n    "live_share": true\n  }\n}\n';
const FLAGS_R42 = FLAGS_MAIN.replace('"offline_tiles_max_mb": 256', '"offline_tiles_max_mb": 512').replace('"min_android_sdk": 26', '"min_android_sdk": 24');
const FLAGS_R41 = FLAGS_MAIN.replace('"min_android_sdk": 26', '"min_android_sdk": 23');
const FLAGS_EDITED = FLAGS_MAIN.replace('"offline_tiles_max_mb": 256', '"offline_tiles_max_mb": 384');
const GPX_DOC = "# GPX import\n\n- Max file size: 20 MB\n- Supported versions: GPX 1.1\n";
const NEW_BRANCH = "docs/gpx-limits";

export function blind3Seed(): State {
  const s = seed();
  const r = s.repos[0];
  r.name = "trailmap";
  const { issues, pulls } = build();
  r.issues = issues;
  r.pulls = pulls;
  const main = {
    "README.md": "# trailmap\n\nOffline-first hiking maps for iOS and Android.\n",
    "config/flags.json": FLAGS_MAIN,
    "app/src/sync/queue.ts": "export const MAX_RETRIES = 5;\nexport const BACKOFF_MS = 2000;\n",
  };
  r.files = {
    main,
    "release/4.1": { ...main, "config/flags.json": FLAGS_R41 },
    "release/4.2": { ...main, "config/flags.json": FLAGS_R42 },
  };
  r.branches = { main: "c3".repeat(20), "release/4.1": "d4".repeat(20), "release/4.2": "e5".repeat(20) };
  for (const p of pulls) {
    r.branches[p.head] = p.number.toString(16).padStart(4, "0").repeat(10);
    r.files[p.head] = { ...r.files[p.base] };
  }
  r.commits = [];
  r.labels = [...KINDS, ...AREAS, ...MILESTONES, ...PRIORITIES, "stale"];
  s.users = [...PEOPLE, "octo"];
  return s;
}

// ---- Truth, computed from the same generator ----
const { issues, pulls } = build();
const open = issues.filter((i) => i.state === "open");
const closed = issues.filter((i) => i.state === "closed");
const has = (i: Issue, l: string) => i.labels.includes(l);
const milestoneOf = (i: Issue) => i.labels.find((l) => MILESTONES.includes(l));
const closesOf = (p: Pull) => [...p.body.matchAll(/Closes #(\d+)/g)].map((m) => Number(m[1]));
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`blind3tasks: ${msg}`);
}

// Lookups
const factIssue = issues.find((i) =>
  i.number > 120 && i.assignees.length === 1 && milestoneOf(i) && i.comments.length >= 2 && i.author !== i.assignees[0]
)!;
assert(!!factIssue, "no issue for the facts lookup");
const prLookup = pulls.filter((p) => p.base === "release/4.1" && p.merged)[1];
assert(!!prLookup, "no merged PR on release/4.1");
const joinPr = pulls.filter((p) => closesOf(p).length === 1 && issues[closesOf(p)[0] - 1].assignees.length === 1)[9];
const joinIssue = issues[closesOf(joinPr)[0] - 1];

// Aggregations
const openSyncBugs = open.filter((i) => has(i, "bug") && has(i, "sync")).length;
const prCounts = new Map<string, number>();
for (const p of pulls) prCounts.set(p.author, (prCounts.get(p.author) ?? 0) + 1);
const prRanking = [...prCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const top3Authors = prRanking.slice(0, 3);
assert(prRanking.length > 3 && prRanking[0][1] > prRanking[1][1] && prRanking[1][1] > prRanking[2][1] && prRanking[2][1] > prRanking[3][1], "PR author ranking is tied");
const closedByOpenPr = new Set(pulls.filter((p) => p.state === "open").flatMap(closesOf));
const p0NoPr = open.filter((i) => has(i, "p0") && !closedByOpenPr.has(i.number)).map((i) => i.number);
assert(p0NoPr.length >= 3 && p0NoPr.length <= 25, `p0NoPr size ${p0NoPr.length}`);
assert(open.some((i) => has(i, "p0") && closedByOpenPr.has(i.number)), "set difference removes nothing");
const v42Open = open.filter((i) => has(i, "v4.2"));
const pctUnassignedV42 = Math.round((1000 * v42Open.filter((i) => i.assignees.length === 0).length) / v42Open.length) / 10;
const completedV41 = closed.filter((i) => i.state_reason === "completed" && has(i, "v4.1")).length;
// The author is picked so the answer differs from the open-only and closed-only counts.
const featAuthor = PEOPLE.slice(3).find((u) =>
  issues.some((i) => i.author === u && has(i, "feature") && i.state === "closed") &&
  issues.some((i) => i.author === u && has(i, "feature") && i.state === "open"))!;
assert(!!featAuthor, "no author with features in both states");
const authorFeatures = issues.filter((i) => i.author === featAuthor && has(i, "feature")).length;

// Writes
const moveOffline = open.filter((i) => has(i, "offline") && has(i, "v4.1")).map((i) => i.number);
const staleOpen = open.filter((i) => has(i, "stale")).map((i) => i.number);
const r41OpenPrs = pulls.filter((p) => p.state === "open" && p.base === "release/4.1").map((p) => p.number);
const tomasOpen = open.filter((i) => i.assignees.includes("tomas")).map((i) => i.number);
assert(moveOffline.length >= 2, "moveOffline too small");
assert(staleOpen.length >= 3, "staleOpen too small");
assert(r41OpenPrs.length >= 3, "r41OpenPrs too small");
assert(tomasOpen.length >= 3, "tomasOpen too small");
assert(closed.some((i) => i.assignees.includes("tomas")), "no closed tomas issue to leave alone");
assert(new Set(pulls.map((p) => p.base)).size === 3, "PRs do not cover three bases");

export const blind3Truth = {
  factIssue: { number: factIssue.number, author: factIssue.author, assignee: factIssue.assignees[0], milestone: milestoneOf(factIssue)!, comments: factIssue.comments.length },
  prLookup: { number: prLookup.number, base: prLookup.base, author: prLookup.author, head: prLookup.head },
  joinPr: { number: joinPr.number, issue: joinIssue.number, assignee: joinIssue.assignees[0] },
  r42MinAndroidSdk: 24,
  openSyncBugs, top3Authors, p0NoPr, pctUnassignedV42, completedV41, featAuthor, authorFeatures,
  moveOffline, staleOpen, r41OpenPrs, tomasOpen,
  sizes: { issues: issues.length, open: open.length, closed: closed.length, pulls: pulls.length, openPulls: pulls.filter((p) => p.state === "open").length },
};

// ---- Checks ----
const repo = (s: State) => s.repos[0];
const iss = (s: State, n: number) => repo(s).issues.find((i) => i.number === n)!;
const pr = (s: State, n: number) => repo(s).pulls.find((p) => p.number === n)!;
const numbers = (t: string) => (t.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(",", ".")));
const firstNumber = (t: string) => numbers(t)[0];
const intSet = (t: string) => new Set((t.match(/\d+/g) ?? []).map(Number));
const sameSet = (got: Set<number>, want: number[]) => want.every((x) => got.has(x)) && [...got].every((x) => want.includes(x));
const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9./_-]+/g)?.map((w) => w.replace(/[.,]+$/, "")) ?? []);
const peopleIn = (t: string) => PEOPLE.filter((p) => words(t).has(p));
const sorted = (xs: string[]) => [...xs].sort().join();

const pristine = blind3Seed();
const seededIssue = new Map(pristine.repos[0].issues.map((i) => [i.number, i]));
const seededPull = new Map(pristine.repos[0].pulls.map((p) => [p.number, p]));
const issueSame = (a: Issue, b: Issue) =>
  a.state === b.state && a.state_reason === b.state_reason && sorted(a.labels) === sorted(b.labels) &&
  sorted(a.assignees) === sorted(b.assignees) && a.comments.length === b.comments.length && a.title === b.title && a.body === b.body;
const pullSame = (a: Pull, b: Pull) =>
  a.state === b.state && a.merged === b.merged && a.base === b.base && a.title === b.title && a.comments.length === b.comments.length;
type Allow = { issues?: number[]; pulls?: number[]; branches?: string[]; newPulls?: number };
// True when nothing outside the allowed objects changed: issues, PRs, branches and files.
function othersUntouched(s: State, allow: Allow = {}) {
  const r = repo(s);
  const p = pristine.repos[0];
  if (r.issues.length !== p.issues.length) return false;
  if (r.pulls.length !== p.pulls.length + (allow.newPulls ?? 0)) return false;
  const okIssues = r.issues.every((i) => allow.issues?.includes(i.number) || (seededIssue.has(i.number) && issueSame(i, seededIssue.get(i.number)!)));
  const okPulls = r.pulls.every((x) => allow.pulls?.includes(x.number) || !seededPull.has(x.number) || pullSame(x, seededPull.get(x.number)!));
  const branches = new Set([...Object.keys(r.branches), ...Object.keys(p.branches)]);
  const okBranches = [...branches].every((b) => allow.branches?.includes(b) || (r.branches[b] !== undefined && p.branches[b] !== undefined));
  const okFiles = Object.keys(p.files).every((b) => allow.branches?.includes(b) || JSON.stringify(r.files[b] ?? {}) === JSON.stringify(p.files[b]));
  return okIssues && okPulls && okBranches && okFiles;
}

export const blind3Tasks: GhTask[] = [
  // --- Lookups ---
  {
    id: "t3-issue-facts",
    prompt: `En octo/trailmap, para el issue #${factIssue.number} dime quién lo abrió, a quién está asignado, ` +
      "qué etiqueta de milestone tiene (v4.1, v4.2 o v5.0) y cuántos comentarios tiene. " +
      "Responde en el formato: autor, asignado, milestone, comentarios.",
    check: (_s, t) => {
      const w = words(t);
      const ppl = peopleIn(t);
      const ms = MILESTONES.filter((m) => w.has(m));
      const rest = t.replace(/v\d+\.\d+/gi, "");
      return ppl.length === 2 && ppl.includes(factIssue.author) && ppl.includes(factIssue.assignees[0]) &&
        t.toLowerCase().indexOf(factIssue.author) < t.toLowerCase().indexOf(factIssue.assignees[0]) &&
        ms.length === 1 && ms[0] === milestoneOf(factIssue) && numbers(rest).includes(factIssue.comments.length);
    },
  },
  {
    id: "t3-pr-base-author",
    prompt: `En octo/trailmap, ¿hacia qué rama base apunta el pull request #${prLookup.number} y quién lo abrió? ` +
      "Responde en el formato: rama base, usuario.",
    check: (_s, t) => {
      const w = words(t);
      return w.has(prLookup.base) && !w.has("main") && !w.has("release/4.2") && peopleIn(t).join() === prLookup.author;
    },
  },
  {
    id: "t3-release-flag",
    prompt: "En octo/trailmap, ¿qué valor tiene min_android_sdk en config/flags.json en la rama release/4.2? Responde solo con el número.",
    check: (_s, t) => firstNumber(t) === 24,
  },
  {
    id: "t3-pr-issue-assignee",
    prompt: `En octo/trailmap, el pull request #${joinPr.number} indica en su descripción qué issue cierra ("Closes #N"). ` +
      "¿Qué issue es y a quién está asignado ese issue? Responde en el formato: número, usuario.",
    check: (_s, t) => numbers(t.replace(String(joinPr.number), "")).includes(joinIssue.number) && peopleIn(t).join() === joinIssue.assignees[0],
  },
  // --- Aggregations / joins ---
  {
    id: "t3-open-sync-bugs",
    prompt: "¿Cuántos issues abiertos de octo/trailmap tienen a la vez la etiqueta bug y la etiqueta sync? Responde solo con el número.",
    check: (_s, t) => firstNumber(t) === openSyncBugs,
  },
  {
    id: "t3-top-pr-authors",
    prompt: "En octo/trailmap, contando todos los pull requests (abiertos y cerrados), ¿quiénes son las 3 personas que más pull requests abrieron? " +
      "Responde con una línea por persona, de mayor a menor, en el formato: usuario: cantidad.",
    check: (_s, t) => {
      const found = [...t.toLowerCase().matchAll(/([a-z]+)\W+(\d+)/g)].filter((m) => PEOPLE.includes(m[1])).map((m) => [m[1], Number(m[2])]);
      return found.length >= 3 && found.slice(0, 3).every(([u, c], k) => u === top3Authors[k][0] && c === top3Authors[k][1]);
    },
  },
  {
    id: "t3-p0-without-pr",
    prompt: "En octo/trailmap, los pull requests indican en su descripción los issues que cierran con líneas \"Closes #N\" (puede haber más de una). " +
      "¿Qué issues abiertos con la etiqueta p0 no son cerrados por ningún pull request abierto? " +
      "Responde solo con los números de issue separados por coma.",
    check: (_s, t) => sameSet(intSet(t), p0NoPr),
  },
  {
    id: "t3-pct-unassigned-v42",
    prompt: "De los issues abiertos de octo/trailmap con la etiqueta v4.2, ¿qué porcentaje no tiene a nadie asignado? " +
      "Responde solo con el porcentaje redondeado a 1 decimal.",
    check: (_s, t) => Math.abs(firstNumber(t) - pctUnassignedV42) < 0.051,
  },
  {
    id: "t3-completed-v41",
    prompt: "¿Cuántos issues cerrados de octo/trailmap con la etiqueta v4.1 se cerraron como completados (state_reason completed)? " +
      "Responde solo con el número.",
    check: (_s, t) => firstNumber(t) === completedV41,
  },
  {
    id: "t3-author-features",
    prompt: `En octo/trailmap, contando issues abiertos y cerrados, ¿cuántos issues con la etiqueta feature abrió ${featAuthor}? Responde solo con el número.`,
    check: (_s, t) => firstNumber(t) === authorFeatures,
  },
  // --- Writes ---
  {
    id: "t3-move-offline-milestone",
    prompt: "En octo/trailmap, a cada issue abierto que tenga las etiquetas offline y v4.1, quítale v4.1 y agrégale v4.2, sin tocar sus otras etiquetas.",
    check: (s) =>
      moveOffline.every((n) => {
        const want = [...seededIssue.get(n)!.labels.filter((l) => l !== "v4.1"), "v4.2"];
        const i = iss(s, n);
        const o = seededIssue.get(n)!;
        return sorted(i.labels) === sorted(want) && i.state === o.state && i.comments.length === o.comments.length && sorted(i.assignees) === sorted(o.assignees);
      }) && othersUntouched(s, { issues: moveOffline }),
  },
  {
    id: "t3-close-stale",
    prompt: "En octo/trailmap, cierra todos los issues abiertos con la etiqueta stale con motivo \"not planned\" " +
      "y deja en cada uno el comentario exacto \"Cerrado por inactividad.\" (con el punto final).",
    check: (s) =>
      staleOpen.every((n) => {
        const i = iss(s, n);
        const o = seededIssue.get(n)!;
        return i.state === "closed" && i.state_reason === "not_planned" && i.comments.length === o.comments.length + 1 &&
          i.comments[i.comments.length - 1].body.trim() === "Cerrado por inactividad." && sorted(i.labels) === sorted(o.labels);
      }) && othersUntouched(s, { issues: staleOpen }),
  },
  {
    id: "t3-edit-flags",
    prompt: "En la rama main de octo/trailmap, cambia offline_tiles_max_mb de config/flags.json a 384. " +
      "No cambies nada más del archivo (mismo formato, misma indentación, mismo salto de línea final).",
    check: (s) => repo(s).files.main?.["config/flags.json"] === FLAGS_EDITED &&
      JSON.stringify({ ...repo(s).files.main, "config/flags.json": FLAGS_MAIN }) === JSON.stringify(pristine.repos[0].files.main) &&
      othersUntouched(s, { branches: ["main"] }),
  },
  {
    id: "t3-gpx-doc-pr",
    prompt: `En octo/trailmap, crea la rama ${NEW_BRANCH} a partir de release/4.2, agrega en ella el archivo docs/gpx.md con este contenido exacto ` +
      "(con salto de línea final):\n" + GPX_DOC +
      `y abre un pull request de ${NEW_BRANCH} hacia release/4.2 con el título exacto "Document GPX import limits".`,
    check: (s) => {
      const r = repo(s);
      const created = r.pulls.filter((p) => !seededPull.has(p.number));
      const p = created[0];
      return created.length === 1 && p.head === NEW_BRANCH && p.base === "release/4.2" && p.state === "open" &&
        p.title.trim() === "Document GPX import limits" &&
        JSON.stringify(r.files[NEW_BRANCH] ?? {}) === JSON.stringify({ ...pristine.repos[0].files["release/4.2"], "docs/gpx.md": GPX_DOC }) &&
        !!r.branches[NEW_BRANCH] && othersUntouched(s, { branches: [NEW_BRANCH], newPulls: 1 });
    },
  },
  {
    id: "t3-comment-r41-prs",
    prompt: "En octo/trailmap, deja el comentario exacto \"Por favor rebasear sobre release/4.2.\" en cada pull request abierto cuya rama base sea release/4.1.",
    check: (s) =>
      r41OpenPrs.every((n) => {
        const p = pr(s, n);
        const o = seededPull.get(n)!;
        return p.state === "open" && p.base === o.base && p.comments.length === o.comments.length + 1 &&
          p.comments[p.comments.length - 1].body.trim() === "Por favor rebasear sobre release/4.2.";
      }) && othersUntouched(s, { pulls: r41OpenPrs }),
  },
  {
    id: "t3-reassign-tomas",
    prompt: "En octo/trailmap, tomas se va de vacaciones: en cada issue abierto asignado a tomas, quítalo de los asignados y asigna a paula en su lugar, " +
      "manteniendo a cualquier otra persona que ya estuviera asignada. No toques los issues cerrados.",
    check: (s) =>
      tomasOpen.every((n) => {
        const o = seededIssue.get(n)!;
        const want = [...new Set([...o.assignees.filter((a) => a !== "tomas"), "paula"])];
        const i = iss(s, n);
        return sorted(i.assignees) === sorted(want) && i.state === o.state && sorted(i.labels) === sorted(o.labels) && i.comments.length === o.comments.length;
      }) && othersUntouched(s, { issues: tomasOpen }),
  },
];
