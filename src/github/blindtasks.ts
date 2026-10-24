// Held-out tasks written blind by an independent author (no access to the glossary).
// Repo octo/shop: 240 issues and 60 pull requests, so listings need several pages of 100.
// Every expected answer is computed from the seed below, never written by hand.
import type { Comment, Issue, Pull, State } from "./mock.ts";
import type { GhTask } from "./tasks.ts";
import { seed } from "./tasks.ts";

const PEOPLE = ["ana", "bruno", "carla", "diego", "elena", "felipe", "gaby", "hugo", "ivan", "julia"];
const AREAS = ["checkout", "catalog", "payments", "search", "accounts"];
const KINDS = ["bug", "enhancement", "docs"];
const PR_BASE = 300;

function rng(seedValue: number) {
  let x = seedValue;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

const pick = <T>(rand: () => number, xs: T[]) => xs[Math.floor(rand() * xs.length)];
const day = (d: number) => new Date(Date.UTC(2026, 6, 1 + (d % 60), d % 24, d % 60)).toISOString();

function build() {
  const rand = rng(13);
  const issues: Issue[] = [];
  for (let n = 1; n <= 240; n++) {
    const area = pick(rand, AREAS);
    const kind = rand() < 0.45 ? "bug" : pick(rand, KINDS);
    const labels = [kind, area];
    if (rand() < 0.12) labels.push("needs-triage");
    if (rand() < 0.04) labels.push("duplicate");
    // Assignment is skewed so the ranking of assignees has a clear order.
    const r = rand();
    const assignees = r < 0.15 ? [] : [PEOPLE[Math.min(PEOPLE.length - 1, Math.floor(Math.pow(rand(), 1.6) * PEOPLE.length))]];
    const ncomments = Math.floor(rand() * 6);
    const comments: Comment[] = Array.from({ length: ncomments }, (_, k) => {
      const who = pick(rand, PEOPLE);
      return { id: n * 100 + k, body: `${who} checked this (${k + 1})`, user: { login: who, id: 1000 + PEOPLE.indexOf(who) }, created_at: day(n + k) };
    });
    const closed = rand() < 0.35;
    issues.push({
      number: n, title: `[${area}] ${kind === "bug" ? "Fix" : kind === "docs" ? "Document" : "Improve"} item ${n}`,
      body: `Reported in the ${area} area.`, state: closed ? "closed" : "open",
      state_reason: closed ? (rand() < 0.3 ? "not_planned" : "completed") : null,
      labels, assignees, author: pick(rand, PEOPLE), comments, created_at: day(n), updated_at: day(n + 1),
    });
  }
  const pulls: Pull[] = [];
  for (let k = 1; k <= 60; k++) {
    const number = PR_BASE + k;
    const target = 1 + Math.floor(rand() * 240);
    const state = rand() < 0.6 ? "open" : "closed";
    pulls.push({
      number, title: `Change ${k} for #${target}`, body: `Fixes #${target}.`, state, merged: state === "closed" && rand() < 0.7,
      merge_method: null, head: `fix/i${target}-${k}`, base: "main", author: pick(rand, PEOPLE), draft: false,
      files: [], comments: [], created_at: day(k * 2), updated_at: day(k * 2 + 1),
    });
  }
  return { issues, pulls };
}

const SHIPPING_MAIN = '{\n  "currency": "CLP",\n  "free_shipping_threshold": 39990,\n  "flat_rate": 3990\n}\n';
const SHIPPING_RELEASE = '{\n  "currency": "CLP",\n  "free_shipping_threshold": 34990,\n  "flat_rate": 4490\n}\n';
const SHIPPING_EDITED = SHIPPING_MAIN.replace("39990", "45000");
const TAX_CONTENT = '{\n  "rate": 0.19\n}\n';

export function blindSeed(): State {
  const s = seed();
  const r = s.repos[0];
  r.name = "shop";
  const { issues, pulls } = build();
  r.issues = issues;
  r.pulls = pulls;
  const main = {
    "README.md": "# shop\n\nStorefront for octo.\n",
    "config/shipping.json": SHIPPING_MAIN,
    "src/cart.ts": "export const MAX_ITEMS = 50;\n",
  };
  r.files = { main, "release/2.3": { ...main, "config/shipping.json": SHIPPING_RELEASE } };
  r.branches = { main: "a1".repeat(20), "release/2.3": "b2".repeat(20) };
  for (const p of pulls) {
    r.branches[p.head] = (p.number.toString(16).padStart(4, "0")).repeat(10);
    r.files[p.head] = { ...main };
  }
  r.labels = [...KINDS, ...AREAS, "needs-triage", "duplicate", "triaged"];
  s.users = [...PEOPLE, "octo"];
  return s;
}

// ---- Truth, computed from the same generator ----
const { issues, pulls } = build();
const open = issues.filter((i) => i.state === "open");
const closed = issues.filter((i) => i.state === "closed");
const has = (i: Issue, l: string) => i.labels.includes(l);

// Read tasks
const authorIssue = issues.filter((i) => i.number > 200 && i.comments.length >= 3)[0];
const lastCommentIssue = issues.filter((i) => i.number > 150 && i.comments.length >= 4)[0];
const lastCommenter = lastCommentIssue.comments[lastCommentIssue.comments.length - 1].user.login;
const headPr = pulls[37];

// Aggregations
const openCheckoutBugs = open.filter((i) => has(i, "bug") && has(i, "checkout")).length;
const pctNotPlanned = Math.round((1000 * closed.filter((i) => i.state_reason === "not_planned").length) / closed.length) / 10;
const counts = new Map<string, number>();
for (const i of open) for (const a of i.assignees) counts.set(a, (counts.get(a) ?? 0) + 1);
const ranking = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const top3 = ranking.slice(0, 3);
const top3Unique = ranking.length > 3 && ranking[2][1] > ranking[3][1] && top3[0][1] > top3[1][1] && top3[1][1] > top3[2][1];
const referencedByOpenPr = new Set(pulls.filter((p) => p.state === "open").map((p) => Number(p.body.match(/#(\d+)/)![1])));
const paymentBugsNoPr = open.filter((i) => has(i, "bug") && has(i, "payments") && !referencedByOpenPr.has(i.number)).map((i) => i.number);

// Writes
const dupes = open.filter((i) => has(i, "duplicate")).map((i) => i.number);
const carlaTriage = open.filter((i) => i.assignees.includes("carla") && has(i, "needs-triage")).map((i) => i.number);

export const blindTruth = {
  authorIssue: { number: authorIssue.number, author: authorIssue.author, comments: authorIssue.comments.length },
  lastComment: { number: lastCommentIssue.number, user: lastCommenter },
  headPr: { number: headPr.number, head: headPr.head },
  releaseThreshold: 34990,
  openCheckoutBugs, pctNotPlanned, top3, top3Unique, paymentBugsNoPr, dupes, carlaTriage,
  sizes: { issues: issues.length, open: open.length, closed: closed.length, pulls: pulls.length, openPulls: pulls.filter((p) => p.state === "open").length },
};

// ---- Checks ----
const shop = (s: State) => s.repos[0];
const iss = (s: State, n: number) => shop(s).issues.find((i) => i.number === n)!;
const numbers = (t: string) => (t.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(",", ".")));
const firstNumber = (t: string) => numbers(t)[0];
const intSet = (t: string) => new Set((t.match(/\d+/g) ?? []).map(Number));
const sameSet = (got: Set<number>, want: number[]) => want.every((x) => got.has(x)) && [...got].every((x) => want.includes(x));
const words = (t: string) => new Set(t.toLowerCase().match(/[a-z]+/g) ?? []);
const seeded = new Map(issues.map((i) => [i.number, i]));
// True when no issue outside `allowed` changed state, labels or comment count.
const othersUntouched = (s: State, allowed: number[]) =>
  shop(s).issues.every((i) => {
    if (allowed.includes(i.number)) return true;
    const o = seeded.get(i.number);
    return !o || (o.state === i.state && o.labels.join() === i.labels.join() && o.comments.length === i.comments.length);
  });

export const blindTasks: GhTask[] = [
  // --- Read / lookup ---
  {
    id: "b-issue-author",
    prompt: `En octo/shop, ¿quién abrió el issue #${authorIssue.number} y cuántos comentarios tiene? ` +
      "Responde en el formato: usuario, número.",
    check: (_s, t) => words(t).has(authorIssue.author) && numbers(t).includes(authorIssue.comments.length),
  },
  {
    id: "b-last-commenter",
    prompt: `En octo/shop, ¿quién escribió el comentario más reciente del issue #${lastCommentIssue.number}? Responde solo con el usuario.`,
    check: (_s, t) => {
      const got = PEOPLE.filter((p) => words(t).has(p));
      return got.length === 1 && got[0] === lastCommenter;
    },
  },
  {
    id: "b-pr-head",
    prompt: `En octo/shop, ¿cuál es el nombre de la rama de origen (head) del pull request #${headPr.number}? Responde solo con el nombre de la rama.`,
    check: (_s, t) => t.trim().replace(/[`'"*]/g, "").split(/\s+/).includes(headPr.head),
  },
  {
    id: "b-release-threshold",
    prompt: "En octo/shop, ¿qué valor tiene free_shipping_threshold en config/shipping.json en la rama release/2.3? " +
      "Responde solo con el número.",
    check: (_s, t) => firstNumber(t.replace(/(\d)[.,](\d{3})\b/g, "$1$2")) === 34990,
  },
  // --- Aggregation / join ---
  {
    id: "b-open-checkout-bugs",
    prompt: "¿Cuántos issues abiertos de octo/shop tienen a la vez la etiqueta bug y la etiqueta checkout? Responde solo con el número.",
    check: (_s, t) => firstNumber(t) === openCheckoutBugs,
  },
  {
    id: "b-pct-not-planned",
    prompt: "De los issues cerrados de octo/shop, ¿qué porcentaje se cerró con motivo \"not planned\" (state_reason not_planned)? " +
      "Responde solo con el porcentaje redondeado a 1 decimal.",
    check: (_s, t) => Math.abs(firstNumber(t) - pctNotPlanned) < 0.051,
  },
  {
    id: "b-top-assignees",
    prompt: "En octo/shop, ¿quiénes son las 3 personas con más issues abiertos asignados? " +
      "Responde con una línea por persona, de mayor a menor, en el formato: usuario: cantidad.",
    check: (_s, t) => {
      const found = [...t.toLowerCase().matchAll(/([a-z]+)\W+(\d+)/g)].filter((m) => PEOPLE.includes(m[1])).map((m) => [m[1], Number(m[2])]);
      return found.length >= 3 && found.slice(0, 3).every(([u, c], k) => u === top3[k][0] && c === top3[k][1]);
    },
  },
  {
    id: "b-payment-bugs-no-pr",
    prompt: "En octo/shop, cada pull request indica en su descripción el issue que resuelve (\"Fixes #N\"). " +
      "¿Qué issues abiertos con las etiquetas bug y payments no son referenciados por ningún pull request abierto? " +
      "Responde solo con los números de issue separados por coma.",
    check: (_s, t) => sameSet(intSet(t), paymentBugsNoPr),
  },
  // --- Writes ---
  {
    id: "b-close-duplicates",
    prompt: "En octo/shop, cierra todos los issues abiertos que tengan la etiqueta duplicate, con motivo \"not planned\", " +
      "y deja en cada uno el comentario exacto \"Cerrado por duplicado.\" (con el punto final).",
    check: (s) =>
      dupes.every((n) => {
        const i = iss(s, n);
        return i.state === "closed" && i.state_reason === "not_planned" &&
          i.comments.filter((c) => c.body.trim() === "Cerrado por duplicado.").length === 1;
      }) && othersUntouched(s, dupes),
  },
  {
    id: "b-retriage-carla",
    prompt: "En octo/shop, a cada issue abierto asignado a carla que tenga la etiqueta needs-triage, quítale needs-triage " +
      "y agrégale la etiqueta triaged, sin tocar sus otras etiquetas.",
    check: (s) =>
      carlaTriage.every((n) => {
        const want = [...seeded.get(n)!.labels.filter((l) => l !== "needs-triage"), "triaged"].sort();
        return [...iss(s, n).labels].sort().join() === want.join();
      }) && othersUntouched(s, carlaTriage),
  },
  {
    id: "b-edit-threshold",
    prompt: "En la rama main de octo/shop, cambia free_shipping_threshold de config/shipping.json a 45000. " +
      "No cambies nada más del archivo (mismo formato, misma indentación, mismo salto de línea final).",
    check: (s) => shop(s).files.main["config/shipping.json"] === SHIPPING_EDITED,
  },
  {
    id: "b-tax-pr",
    prompt: "En octo/shop, crea la rama hotfix/tax-rate a partir de main, agrega en ella el archivo config/tax.json con este contenido exacto " +
      "(dos espacios de indentación y salto de línea final):\n" + TAX_CONTENT +
      "y abre un pull request de hotfix/tax-rate hacia main con el título exacto: Add tax rate config",
    check: (s) => {
      const r = shop(s);
      const pr = r.pulls.find((p) => p.head === "hotfix/tax-rate" && p.base === "main" && p.state === "open");
      return r.files["hotfix/tax-rate"]?.["config/tax.json"] === TAX_CONTENT &&
        r.files["hotfix/tax-rate"]?.["config/shipping.json"] === SHIPPING_MAIN &&
        r.files.main["config/tax.json"] === undefined && pr?.title.trim() === "Add tax rate config";
    },
  },
];
