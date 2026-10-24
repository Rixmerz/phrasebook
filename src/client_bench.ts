// Runs GitHub tasks through Claude Code itself (headless), to measure the arms
// inside a real client: its own system prompt, caching and tool handling.
// Isolation: --bare (no hooks, plugins, CLAUDE.md or OAuth; auth only from
// ANTHROPIC_API_KEY), --strict-mcp-config with only the test server, built-in
// tools disallowed, and a fresh temporary working directory per run.
// --auth=subscription runs on the logged-in Claude Code plan instead of ANTHROPIC_API_KEY:
// --bare forbids OAuth, so each arm runs inside clients/<suite>/<arm>/, a folder whose
// .mcp.json is preconfigured (written once below; the per-run mock token comes in through
// ${PHRASEBOOK_TOKEN}). Only project settings load: no user CLAUDE.md, plugins or hooks.
// Runs stay off the API ledger.
// Usage: deno run -A src/client_bench.ts --suite=github --models=a,b --arms=native,glossary [--reps=1] [--tasks=..] [--auth=api|subscription]
import { parseArgs } from "@std/cli/parse-args";
import { loadEnv } from "./env.ts";
import { startMock } from "./github/mock.ts";
import { ghTasks, seed } from "./github/tasks.ts";
import { hardSeed, hardTasks } from "./github/hard.ts";
import { blind3Seed, blind3Tasks } from "./github/blind3tasks.ts";
import type { GhTask } from "./github/tasks.ts";
import type { State } from "./github/mock.ts";
import { LEDGER, ledgerTotal } from "./cost.ts";
import { notionBlindTasks } from "./notion/blindtasks.ts";
import { notionBlind2Tasks } from "./notion/blind2tasks.ts";
import { notionBlind3Tasks } from "./notion/blind3tasks.ts";
import { NOTION_SERVER } from "./notion/suite.ts";
import { endRun, mockUrl, newRun } from "./notion/mock.ts";

await loadEnv();
const flags = parseArgs(Deno.args, {
  string: ["suite", "models", "arms", "reps", "tasks", "out", "concurrency", "usd-cap", "auth"],
  default: { suite: "github", models: "claude-haiku-5-5", arms: "native,glossary", reps: "1", concurrency: "4", "usd-cap": "70", auth: "api" },
});

const SUB = flags.auth === "subscription";
const GH = new URL("../vendor/github-mcp/github-mcp-server", import.meta.url).pathname;
const PROXY = new URL("./proxy.ts", import.meta.url).pathname;
const NOTION_TABLE = new URL("../glossaries/notion-auto.json", import.meta.url).pathname;
// glossary4s: the same runtime with the small-model table (recipes, server instructions).
const NOTION_SMALL = new URL("../glossaries/notion-small.json", import.meta.url).pathname;
const port = (startMock(0).addr as Deno.NetAddr).port;
const host = `http://127.0.0.1:${port}`;
const mock = (path: string, token: string, init: RequestInit = {}) =>
  fetch(host + path, { ...init, headers: { authorization: `token ${token}` } }).then((r) => r.json());

type Task = { id: string; prompt: string; check: (state: never, finalText: string) => boolean };
type Server = { command: string; args: string[]; env: Record<string, string> };
// begin seeds a fresh workspace for the token; end returns its final state and unhandled calls.
type ClientSuite = {
  tasks: Task[];
  begin: (token: string) => Promise<void>;
  end: (token: string) => Promise<{ state: unknown; gaps: string[] }>;
  server: (arm: string, token: string) => Server;
};
const baseEnv = () => ({ PATH: Deno.env.get("PATH") ?? "", HOME: Deno.env.get("HOME") ?? "" });
// A proxy arm wraps the native server: glossary (v2), glossary4 (v4 runtime), with a table for non-GitHub servers.
const proxied = (arm: string, name: string, native: Server, table?: string): Server => ({
  command: "deno",
  args: ["run", "-A", PROXY, `--name=${name}`, ...(arm.startsWith("glossary4") ? ["--runtime=v4"] : []), ...(table ? [`--table=${table}`] : []),
    "--", native.command, ...native.args],
  env: native.env,
});

function githubSuite(tasks: GhTask[], seedFn: () => State): ClientSuite {
  return {
    tasks: tasks as Task[],
    begin: (token) => mock("/__seed", token, { method: "POST", body: JSON.stringify(seedFn()) }),
    async end(token) {
      const state = await mock("/__state", token);
      const gaps = await mock("/__unhandled", token) as string[];
      await mock("/__drop", token);
      return { state, gaps };
    },
    server(arm, token) {
      const native = { command: GH, args: ["stdio", "--toolsets=default", `--gh-host=${host}`], env: { GITHUB_PERSONAL_ACCESS_TOKEN: token, ...baseEnv() } };
      return arm === "native" || arm === "native-defer" ? native : proxied(arm, "github", native);
    },
  };
}

function notionSuite(tasks: Task[]): ClientSuite {
  return {
    tasks,
    begin: (token) => Promise.resolve(newRun(token)),
    end: (token) => {
      const r = endRun(token);
      return Promise.resolve({ state: r.state, gaps: r.gaps });
    },
    server(arm, token) {
      const native = { command: "npx", args: NOTION_SERVER, env: { NOTION_TOKEN: token, BASE_URL: mockUrl(), ...baseEnv() } };
      if (arm === "glossary") throw new Error("notion has no v2 glossary; use glossary4");
      return arm === "native" ? native : proxied(arm, "notion", native, arm === "glossary4s" ? NOTION_SMALL : NOTION_TABLE);
    },
  };
}

const SUITES: Record<string, ClientSuite> = {
  github: githubSuite(ghTasks, seed),
  "github-hard": githubSuite(hardTasks.filter((t) => t.id !== "x-least-loaded"), hardSeed),
  "github-blind3": githubSuite(blind3Tasks, blind3Seed),
  "notion-blind": notionSuite(notionBlindTasks as Task[]),
  "notion-blind2": notionSuite(notionBlind2Tasks as Task[]),
  "notion-blind3": notionSuite(notionBlind3Tasks as Task[]),
};
const suite = SUITES[flags.suite];

const DISALLOWED = ["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Task", "Agent", "Read", "Glob", "Grep",
  // Runs must not reach other sessions or start workflows: a peer could hand them the answer.
  "SendMessage", "ListAgents", "Workflow", "Skill",
  // Claude Code's own task list: small models take "Tareas" (tasks) for it and never open the server.
  "TaskList", "TaskCreate", "TaskGet", "TaskUpdate", "TaskStop", "TodoWrite"];

const mcpConfig = (arm: string, token: string) => ({ mcpServers: { [flags.suite.startsWith("notion") ? "notion" : "gh"]: suite.server(arm, token) } });

// One folder per arm with its MCP servers already configured, reused by every run.
const folders = new Map<string, string>();
function armFolder(arm: string): string {
  if (folders.has(arm)) return folders.get(arm)!;
  const dir = new URL(`../clients/${flags.suite}/${arm}/`, import.meta.url).pathname;
  Deno.mkdirSync(`${dir}.claude`, { recursive: true });
  const cfg = mcpConfig(arm, "${PHRASEBOOK_TOKEN}");
  Deno.writeTextFileSync(`${dir}.mcp.json`, JSON.stringify(cfg, null, 2) + "\n");
  Deno.writeTextFileSync(`${dir}.claude/settings.json`, JSON.stringify({ enableAllProjectMcpServers: true }, null, 2) + "\n");
  folders.set(arm, dir);
  return dir;
}

async function runOnce(model: string, arm: string, task: Task, rep: number) {
  const token = `client-${crypto.randomUUID()}`;
  await suite.begin(token);
  const dir = SUB ? armFolder(arm) : Deno.makeTempDirSync({ prefix: "phrasebook-client-" });
  const cfg = `${dir}/mcp.json`;
  if (!SUB) Deno.writeTextFileSync(cfg, JSON.stringify(mcpConfig(arm, token)));
  const t0 = performance.now();
  const cmd = new Deno.Command("claude", {
    args: [
      "-p", task.prompt,
      ...(SUB ? ["--setting-sources", "project", "--disable-slash-commands"] : ["--bare", "--strict-mcp-config", "--mcp-config", cfg]), "--model", model,
      ...(Deno.env.get("PHRASEBOOK_TRACE") ? ["--output-format", "stream-json", "--verbose"] : ["--output-format", "json"]),
      "--no-session-persistence", "--max-turns", "15",
      "--allowedTools", `mcp__${flags.suite.startsWith("notion") ? "notion" : "gh"}`, "--disallowedTools", ...DISALLOWED,
    ],
    cwd: dir,
    env: {
      ...(SUB ? { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", PHRASEBOOK_TOKEN: token, ENABLE_CLAUDEAI_MCP_SERVERS: "false" } : { ANTHROPIC_API_KEY: Deno.env.get("ANTHROPIC_API_KEY")! }), PATH: Deno.env.get("PATH") ?? "", HOME: Deno.env.get("HOME") ?? "",
      // native-defer: Claude Code's own deferred MCP tool loading (tool search), forced on.
      ...(arm === "native-defer" ? { ENABLE_TOOL_SEARCH: "true" } : {}),
    },
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  const latency = Math.round(performance.now() - t0);
  let res: Record<string, unknown> = {};
  try {
    const raw = new TextDecoder().decode(out.stdout);
    // With PHRASEBOOK_TRACE the output is a JSON event stream: keep it, and read the final result event.
    if (Deno.env.get("PHRASEBOOK_TRACE")) Deno.writeTextFileSync(`scratch/trace-${model}-${arm}-${task.id}-${rep}.jsonl`, raw);
    res = Deno.env.get("PHRASEBOOK_TRACE") ? JSON.parse(raw.trim().split("\n").at(-1)!) : JSON.parse(raw);
  } catch {
    res = { is_error: true, result: new TextDecoder().decode(out.stderr).slice(0, 500) };
  }
  const { state, gaps } = await suite.end(token);
  if (!SUB) Deno.removeSync(dir, { recursive: true });
  const finalText = String(res.result ?? "");
  const usage = (res.usage ?? {}) as Record<string, number>;
  return {
    kind: "run", suite: flags.suite, client: "claude-code", auth: flags.auth, model, arm, task: task.id, rep,
    success: !res.is_error && task.check(state as never, finalText), harness_gaps: gaps,
    turns: Number(res.num_turns ?? 0), latency_ms: latency, usd: Number(res.total_cost_usd ?? 0),
    input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0,
    cache_write_tokens: usage.cache_creation_input_tokens ?? 0, cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    is_error: Boolean(res.is_error), subtype: res.subtype, final_text: finalText,
  };
}

const models = flags.models.split(",");
const arms = flags.arms.split(",");
const tasks = flags.tasks ? suite.tasks.filter((t) => flags.tasks!.split(",").includes(t.id)) : suite.tasks;
const reps = Number(flags.reps);
const outFile = flags.out ?? `results/client-${flags.suite}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
const USD_CAP = Number(flags["usd-cap"]);

const jobs: [string, string, Task, number][] = [];
for (const m of models) for (const a of arms) for (const t of tasks) for (let r = 1; r <= reps; r++) jobs.push([m, a, t, r]);
let next = 0;
async function worker() {
  while (next < jobs.length) {
    if (!SUB && ledgerTotal() > USD_CAP) {
      console.log(`ledger reached the ${USD_CAP} USD cap, stopping`);
      return;
    }
    const [m, a, t, r] = jobs[next++];
    const row = await runOnce(m, a, t, r);
    Deno.writeTextFileSync(outFile, JSON.stringify(row) + "\n", { append: true });
    if (!SUB) Deno.writeTextFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), suite: `client:${flags.suite}`, model: m, arm: a, task: t.id, usd: row.usd }) + "\n", { append: true });
    console.log(
      `${row.harness_gaps.length ? "GAP " : row.success ? "PASS" : "FAIL"}  ${m.padEnd(26)} ${a.padEnd(9)} ${t.id.padEnd(22)} ` +
        `turns=${row.turns} in=${row.input_tokens} cr=${row.cache_read_tokens} cw=${row.cache_write_tokens} out=${row.output_tokens} usd=${row.usd.toFixed(4)} ${latency(row.latency_ms)}` +
        (row.is_error ? `  error=${row.subtype} ${row.final_text.slice(0, 100)}` : ""),
    );
  }
}
const latency = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
await Promise.all(Array.from({ length: Math.max(1, Number(flags.concurrency)) }, worker));
console.log(`ledger total (this phase): ${ledgerTotal().toFixed(2)} USD\nlog: ${outFile}`);
Deno.exit(0);
