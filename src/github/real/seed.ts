// Seeds the real sandbox repo Rixmerz/phrasebook-sandbox once, before the real-GitHub set is
// written. Run: deno run -A src/github/real/seed.ts
// Only this repo is touched. Requests are throttled to stay under GitHub's secondary limits
// for content creation (about 80 per minute). Re-running on a seeded repo is refused.
import { api, REPO, tokenFromEnv } from "./api.ts";

const PAUSE_MS = 1000;
const N_ISSUES = 120;
const LABELS: Record<string, string> = {
  bug: "d73a4a", feature: "a2eeef", chore: "cfd3d7", docs: "0075ca",
  api: "5319e7", ui: "fbca04", cli: "0e8a16", infra: "b60205",
  p0: "e11d21", p1: "eb6420", p2: "c2e0c6", "v1.0": "1d76db", "v1.1": "006b75",
};
const AREAS = ["api", "ui", "cli", "infra"];
const KINDS = ["bug", "bug", "feature", "chore", "docs"];
const SUBJECTS: Record<string, string[]> = {
  api: ["rate limit headers missing", "pagination cursor resets", "webhook retries never stop", "token refresh race", "500 on empty filter"],
  ui: ["dark mode contrast too low", "table header overlaps on mobile", "toast hides the save button", "date picker ignores locale", "focus lost after modal close"],
  cli: ["--json flag prints colors", "config path ignored on Windows", "progress bar flickers in tmux", "exit code 0 on failure", "completion script breaks zsh"],
  infra: ["nightly backup job times out", "staging certs expire early", "log volume fills the disk", "deploy lock never released", "metrics scrape misses pods"],
};

function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}
const rand = rng(424242);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Seeding needs Contents write, which the benchmark token lacks; the gh CLI login has it.
const token = Deno.env.get("SEED_TOKEN") ?? tokenFromEnv();
async function call(method: string, path: string, body?: unknown) {
  const res = await api(token, method, path, body);
  await sleep(PAUSE_MS);
  return res;
}

const existing = await call("GET", `/repos/${REPO}/issues?state=all&per_page=1`);
if (Array.isArray(existing) && existing.length) throw new Error(`${REPO} already has issues; refusing to seed twice`);

// Files on main, and a release branch cut from it.
const files: Record<string, string> = {
  "README.md": "# phrasebook-sandbox\n\nTest data for the Phrasebook benchmark. Not a real project.\n",
  "config/settings.yaml": "server:\n  port: 8080\n  workers: 4\nlimits:\n  max_upload_mb: 25\n  request_timeout_s: 30\nfeatures:\n  beta_dashboard: false\n  audit_log: true\n",
  "CHANGELOG.md": "# Changelog\n\n## 1.0.0\n\n- First release.\n",
};
// A failed earlier attempt may have created the files, branch and labels already; skip those.
const exists = (e: unknown) => String(e).includes(" 422 ");
for (const [path, content] of Object.entries(files)) {
  if (await call("GET", `/repos/${REPO}/contents/${path}`).catch(() => null)) continue;
  await call("PUT", `/repos/${REPO}/contents/${path}`, { message: `Add ${path}`, content: btoa(content) });
}
const main = await call("GET", `/repos/${REPO}/git/ref/heads/main`);
await call("POST", `/repos/${REPO}/git/refs`, { ref: "refs/heads/release/1.0", sha: main.object.sha }).catch((e) => {
  if (!exists(e)) throw e;
});

for (const [name, color] of Object.entries(LABELS)) {
  await call("POST", `/repos/${REPO}/labels`, { name, color }).catch((e) => {
    if (!exists(e)) throw e;
  });
}

// Issues: one kind, one area, usually a priority and a milestone label.
const comments = ["Can reproduce on the latest build.", "Same here.", "Looking into it this week.", "Is there a workaround?", "Fixed in my local branch, PR soon."];
for (let i = 1; i <= N_ISSUES; i++) {
  const area = pick(AREAS), kind = pick(KINDS);
  const labels = [kind, area];
  if (rand() < 0.75) labels.push(pick(["p0", "p1", "p1", "p2", "p2"]));
  if (rand() < 0.6) labels.push(pick(["v1.0", "v1.1"]));
  const title = `${pick(SUBJECTS[area])}${rand() < 0.5 ? "" : ` (${area})`}`;
  const assignees = rand() < 0.35 ? ["Rixmerz"] : [];
  const body = kind === "bug"
    ? `### Steps\n1. Use the ${area} part\n2. Hit: ${title}\n\n### Expected\nIt works.\n`
    : `Request for ${area}: ${title}.`;
  const issue = await call("POST", `/repos/${REPO}/issues`, { title, body, labels, assignees });
  const nComments = rand() < 0.2 ? 1 + Math.floor(rand() * 3) : 0;
  for (let c = 0; c < nComments; c++) await call("POST", `/repos/${REPO}/issues/${issue.number}/comments`, { body: pick(comments) });
  const r = rand();
  if (r < 0.18) await call("PATCH", `/repos/${REPO}/issues/${issue.number}`, { state: "closed", state_reason: "completed" });
  else if (r < 0.25) await call("PATCH", `/repos/${REPO}/issues/${issue.number}`, { state: "closed", state_reason: "not_planned" });
  console.log(`issue #${issue.number} ${labels.join(",")}`);
}

// Pull requests from feature branches, most into main, some into release/1.0.
const PRS = [
  { branch: "fix/rate-limit-headers", base: "main", title: "Send rate limit headers on every response", file: "docs/rate-limits.md" },
  { branch: "feat/dark-mode-contrast", base: "main", title: "Raise dark mode contrast to AA", file: "docs/theme.md" },
  { branch: "fix/cli-exit-code", base: "main", title: "Return a non-zero exit code on failure", file: "docs/cli-exit-codes.md" },
  { branch: "chore/backup-timeout", base: "main", title: "Give the nightly backup job 2h", file: "docs/backups.md" },
  { branch: "docs/webhooks", base: "main", title: "Document webhook retry policy", file: "docs/webhooks.md" },
  { branch: "hotfix/cert-renewal", base: "release/1.0", title: "Renew staging certs 30 days early", file: "docs/certs.md" },
  { branch: "hotfix/deploy-lock", base: "release/1.0", title: "Release the deploy lock on crash", file: "docs/deploy-lock.md" },
  { branch: "hotfix/token-refresh", base: "release/1.0", title: "Serialize token refresh", file: "docs/token-refresh.md" },
];
for (const pr of PRS) {
  const base = await call("GET", `/repos/${REPO}/git/ref/heads/${pr.base}`);
  await call("POST", `/repos/${REPO}/git/refs`, { ref: `refs/heads/${pr.branch}`, sha: base.object.sha });
  await call("PUT", `/repos/${REPO}/contents/${pr.file}`, {
    message: pr.title, branch: pr.branch, content: btoa(`# ${pr.title}\n\nNotes for this change.\n`),
  });
  const draft = rand() < 0.25;
  const p = await call("POST", `/repos/${REPO}/pulls`, { title: pr.title, head: pr.branch, base: pr.base, body: `Changes ${pr.file}.`, draft });
  console.log(`pr #${p.number} -> ${pr.base}${draft ? " (draft)" : ""}`);
}
console.log("seeded", REPO);
