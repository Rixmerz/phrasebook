// The real-GitHub suite: the same github-mcp-server binary, pointed at api.github.com with the
// sandbox token. Every call outside Rixmerz/phrasebook-sandbox is refused before it leaves.
// After each run, anything the agent changed is put back to the frozen snapshot, so runs
// stay independent. Write tasks must run at --concurrency=1, apart from the read tasks.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpTool } from "../../mcp.ts";
import type { Suite, ToolResult } from "../../suites.ts";
import { makeGithubSuite } from "../../suites.ts";
import { all, api, NAME, OWNER, REPO, tokenFromEnv } from "./api.ts";
import { fetchState } from "./snapshot.ts";
import { realSnapshot, realTasks } from "./tasks.ts";

const GH_BINARY = new URL("../../../vendor/github-mcp/github-mcp-server", import.meta.url).pathname;

// Allowlist: a call must name the sandbox as owner and repo, or be get_me or a search (which
// gets a repo: qualifier). Anything else (create_repository, fork_repository, ...) is refused,
// because the write-capable token reaches the owner's other repositories too.
const DENIED = new Set(["create_repository", "fork_repository"]);
function allowed(name: string, args: Record<string, unknown>): boolean {
  if (DENIED.has(name)) return false;
  if (name === "get_me" || name.startsWith("search_")) return true;
  const owner = String(args.owner ?? "").toLowerCase(), repo = String(args.repo ?? "").toLowerCase();
  return owner === OWNER.toLowerCase() && repo === NAME.toLowerCase();
}

async function startReal(token: string) {
  const transport = new StdioClientTransport({
    command: GH_BINARY,
    args: ["stdio", "--toolsets=default"],
    env: { PATH: Deno.env.get("PATH") ?? "", GITHUB_PERSONAL_ACCESS_TOKEN: token },
    stderr: "ignore",
  });
  const client = new Client({ name: "phrasebook", version: "0.1.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!allowed(name, args)) return { text: `this benchmark only allows ${REPO}`, isError: true };
    // Searches without a repo qualifier would hit all of GitHub.
    if (typeof args.query === "string" && !/\brepo:/i.test(args.query)) args = { ...args, query: `repo:${REPO} ${args.query}` };
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { type: string; text?: string; resource?: { text?: string } }[])
      .map((c) => c.text ?? c.resource?.text ?? "")
      .join("\n");
    return { text, isError: Boolean(res.isError) };
  }
  return { tools: tools as McpTool[], call, close: () => client.close() };
}

// Puts every issue or PR touched since `since` back to the snapshot: state, labels, assignees,
// and deletes comments the snapshot lacks. Returns the numbers it had to restore.
async function restore(token: string, since: string): Promise<number[]> {
  const touched = await all(token, `/repos/${REPO}/issues?state=all&since=${since}`);
  const snapIssues = new Map(realSnapshot.repos[0].issues.map((i) => [i.number, i]));
  const snapPulls = new Map(realSnapshot.repos[0].pulls.map((p) => [p.number, p]));
  const fixed: number[] = [];
  for (const t of touched) {
    const s = snapIssues.get(t.number);
    const p = snapPulls.get(t.number);
    const keepComments = new Set((s?.comments ?? []).map((c) => c.id));
    for (const c of t.comments ? await all(token, `/repos/${REPO}/issues/${t.number}/comments`) : []) {
      if (!keepComments.has(c.id)) await api(token, "DELETE", `/repos/${REPO}/issues/comments/${c.id}`);
    }
    const want = s
      ? { state: s.state, ...(s.state === "closed" ? { state_reason: s.state_reason } : {}), labels: s.labels, assignees: s.assignees }
      : { state: p!.state, labels: [], assignees: [] };
    await api(token, "PATCH", `/repos/${REPO}/issues/${t.number}`, want);
    fixed.push(t.number);
  }
  return fixed;
}

// Restored state must equal the snapshot on every issue, or later runs would be graded wrong.
async function assertPristine(token: string) {
  const live = await fetchState(token);
  const byNum = new Map(live.repos[0].issues.map((i) => [i.number, i]));
  for (const s of realSnapshot.repos[0].issues) {
    const l = byNum.get(s.number);
    // Reopening sets state_reason to "reopened"; for open issues it carries no meaning here.
    const reason = (i: { state: string; state_reason: string | null }) => (i.state === "open" ? null : i.state_reason);
    if (!l || l.state !== s.state || reason(l) !== reason(s) || l.labels.join() !== s.labels.join() ||
      l.assignees.join() !== s.assignees.join() || l.comments.length !== s.comments.length) {
      throw new Error(`sandbox issue #${s.number} differs from the snapshot after restore`);
    }
  }
  for (const p of live.repos[0].pulls) {
    if (p.state !== "open" || p.merged) throw new Error(`sandbox PR #${p.number} is ${p.merged ? "merged" : p.state}`);
  }
}

export function makeRealSuite(): Suite {
  const base = makeGithubSuite("github-real", realTasks, () => realSnapshot);
  // SANDBOX_TOKEN (the gh CLI login) can write; the fine-grained token in the env file is read-only.
  const token = Deno.env.get("SANDBOX_TOKEN") ?? tokenFromEnv();
  return {
    ...base,
    async start(taskId) {
      const task = realTasks.find((t) => t.id === taskId)!;
      const since = new Date(Date.now() - 5000).toISOString();
      const server = await startReal(token);
      return {
        tools: server.tools,
        call: server.call,
        async finish(finalText) {
          await server.close();
          const success = task.writes ? task.check(await fetchState(token), finalText) : task.check(realSnapshot, finalText);
          const fixed = await restore(token, since);
          if (fixed.length) await assertPristine(token);
          return { success, harnessGaps: [] };
        },
      };
    },
    async listTools() {
      const s = await startReal(token);
      await s.close();
      return s.tools;
    },
  };
}

if (import.meta.main && Deno.args[0] === "--check-pristine") {
  await assertPristine(Deno.env.get("SANDBOX_TOKEN") ?? tokenFromEnv());
  console.log("sandbox matches the snapshot");
}
