// Live state of the sandbox in the mock's State shape, so real-GitHub checks read like the
// mock ones. Run directly to save the frozen snapshot the task truths are computed from:
//   deno run -A src/github/real/snapshot.ts results/real-snapshot.json
import type { Comment, Issue, Pull, State } from "../mock.ts";
import { all, api, NAME, OWNER, REPO } from "./api.ts";

// deno-lint-ignore no-explicit-any
const comment = (c: any): Comment => ({ id: c.id, body: c.body, user: { login: c.user.login } as Comment["user"], created_at: c.created_at });

export async function fetchState(token: string, files: string[] = []): Promise<State> {
  const raw = await all(token, `/repos/${REPO}/issues?state=all`);
  const issues: Issue[] = [];
  for (const i of raw.filter((r) => !r.pull_request)) {
    issues.push({
      number: i.number, title: i.title, body: i.body ?? "", state: i.state, state_reason: i.state_reason,
      // deno-lint-ignore no-explicit-any
      labels: i.labels.map((l: any) => l.name).sort(), assignees: i.assignees.map((a: any) => a.login),
      author: i.user.login, created_at: i.created_at, updated_at: i.updated_at,
      comments: i.comments ? (await all(token, `/repos/${REPO}/issues/${i.number}/comments`)).map(comment) : [],
    });
  }
  const pulls: Pull[] = [];
  for (const p of await all(token, `/repos/${REPO}/pulls?state=all`)) {
    pulls.push({
      number: p.number, title: p.title, body: p.body ?? "", state: p.state, merged: !!p.merged_at, merge_method: null,
      head: p.head.ref, base: p.base.ref, author: p.user.login, draft: p.draft, files: [], comments: [],
      created_at: p.created_at, updated_at: p.updated_at,
    });
  }
  const main: Record<string, string> = {};
  for (const f of files) {
    const r = await api(token, "GET", `/repos/${REPO}/contents/${f}`).catch(() => null);
    if (r) main[f] = new TextDecoder().decode(Uint8Array.from(atob(r.content.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
  }
  return {
    repos: [{ owner: OWNER, name: NAME, default_branch: "main", branches: {}, files: { main }, issues, pulls, commits: [], labels: [] }],
    users: [OWNER], me: OWNER, nextId: 0,
  };
}

if (import.meta.main) {
  const { tokenFromEnv } = await import("./api.ts");
  const out = Deno.args[0] ?? "results/real-snapshot.json";
  const s = await fetchState(Deno.env.get("SEED_TOKEN") ?? tokenFromEnv(), ["config/settings.yaml", "CHANGELOG.md"]);
  Deno.writeTextFileSync(out, JSON.stringify(s, null, 1));
  console.log(`${s.repos[0].issues.length} issues, ${s.repos[0].pulls.length} pulls -> ${out}`);
}
