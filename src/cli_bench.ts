// Runs GitHub tasks through a vendor's own coding CLI, for runners who have a subscription and no
// API key: Codex CLI (ChatGPT login) or Gemini CLI (Google login). The CLI talks to the same MCP
// servers as the other runners (src/client_bench.ts, src/openai_bench.ts): the real
// github-mcp-server against the fake GitHub, directly (native) or through src/proxy.ts.
// Each CLI runs headless in an empty folder with its own tools turned off (no shell, files, web
// or sub-agents), so the model reaches GitHub only through the MCP server. Any other tool it still
// uses is logged in `foreign_tools`, and such a run is reported, not trusted. Tokens are the ones
// the CLI reports. See docs/runner-guide.md.
//
// Usage: deno run -A src/cli_bench.ts --cli=codex|gemini --model=<id> [--suite=github-beacon]
//          [--arms=native,glossary4s,glossary4] [--reps=3] [--tasks=id,id] [--concurrency=2]
//          [--runner=your-name] [--out=results/runs/xv-<runner>-<cli>-<model>-es.jsonl]
//          [--bin=path/to/codex] [--cli-args='["-c","model_reasoning_effort=\"low\""]'] [--timeout-min=10]
// A run already in --out is skipped, so an interrupted round resumes; runs cut short by the CLI
// (usage limit, network, crash) go to <out>.errors.jsonl and are retried on the next start.
import { parseArgs } from "@std/cli/parse-args";
import { startMock, type State } from "./github/mock.ts";
import type { GhTask } from "./github/tasks.ts";
import { blind3Seed, blind3Tasks } from "./github/blind3tasks.ts";
import { blind4Seed, blind4Tasks } from "./github/blind4tasks.ts";
import { privateSets } from "./github/private_sets.ts";

const flags = parseArgs(Deno.args, {
  string: ["cli", "model", "suite", "arms", "reps", "tasks", "concurrency", "runner", "out", "bin", "cli-args", "timeout-min"],
  default: { suite: "github-beacon", arms: "native,glossary4s,glossary4", reps: "3", concurrency: "2", runner: "", "cli-args": "[]", "timeout-min": "10" },
});
const CLI = flags.cli as "codex" | "gemini";
if (CLI !== "codex" && CLI !== "gemini") throw new Error("--cli=codex or --cli=gemini");
if (!flags.model) throw new Error("--model is required (the exact model id; the CLI's default is not recorded)");
if (!flags.runner) throw new Error("--runner is required (your short identifier, e.g. your GitHub user)");
const MODEL = flags.model;
const BIN = flags.bin ?? CLI;
const CLI_ARGS: string[] = JSON.parse(flags["cli-args"]);
const TIMEOUT_MS = Number(flags["timeout-min"]) * 60_000;
// Versions this runner was written and tested against; another version may expose other tools.
const TESTED = { codex: "0.165.0", gemini: "0.66.0" };

const ARMS = ["native", "glossary4", "glossary4s", "native-trimmed", "native-compact", "native-trimmed-compact"];
const arms = flags.arms.split(",");
for (const a of arms) if (!ARMS.includes(a)) throw new Error(`arm ${a}: use ${ARMS.join(", ")} (code mode needs the API runner)`);

const SUITES: Record<string, { tasks: GhTask[]; seed: () => State }> = {
  "github-blind3": { tasks: blind3Tasks, seed: blind3Seed },
  "github-blind4": { tasks: blind4Tasks, seed: blind4Seed },
};
for (const p of privateSets) {
  SUITES[`github-${p.name}`] = { tasks: p.tasks("es"), seed: p.seed };
  SUITES[`github-${p.name}-en`] = { tasks: p.tasks("en"), seed: p.seed };
}
const suite = SUITES[flags.suite];
if (!suite) throw new Error(`unknown suite ${flags.suite}: ${Object.keys(SUITES).join(", ")} (private sets go in private/<name>/)`);

const ROOT = new URL("../", import.meta.url).pathname;
const GH = `${ROOT}vendor/github-mcp/github-mcp-server`;
const PROXY = `${ROOT}src/proxy.ts`;
const GITHUB_SMALL = `${ROOT}glossaries/github-small.json`;
// Run folders live in the repo, not /tmp: Gemini CLI refuses settings under a world-writable directory.
const RUNS_DIR = `${ROOT}.cli-runs`;
const port = (startMock(0).addr as Deno.NetAddr).port;
const host = `http://127.0.0.1:${port}`;
const mock = (path: string, token: string, init: RequestInit = {}) =>
  fetch(host + path, { ...init, headers: { authorization: `token ${token}` } }).then((r) => r.json());

// The same server command lines as client_bench.ts and openai_bench.ts.
function server(arm: string, token: string) {
  const env = { PATH: Deno.env.get("PATH") ?? "", HOME: Deno.env.get("HOME") ?? "", GITHUB_PERSONAL_ACCESS_TOKEN: token };
  const native = { command: GH, args: ["stdio", "--toolsets=default", `--gh-host=${host}`] };
  if (arm === "native") return { ...native, env };
  return {
    command: Deno.execPath(),
    args: ["run", "-A", PROXY, "--name=github", ...(arm.startsWith("native-") ? [`--passthrough=${arm.slice("native-".length)}`] : []),
      ...(arm.startsWith("glossary4") ? ["--runtime=v4"] : []), ...(arm === "glossary4s" ? [`--notes=${GITHUB_SMALL}`] : []),
      "--", native.command, ...native.args],
    env,
  };
}

// Codex CLI features turned off: everything that is not the model, its messages and MCP tools.
const CODEX_OFF = ["shell_tool", "unified_exec", "multi_agent", "goals", "view_image", "image_generation", "apps", "plugins",
  "browser_use", "computer_use", "sleep_tool", "tool_suggest", "skill_search", "memories", "hooks", "in_app_browser"];
// Gemini CLI built-in tools excluded (0.66.0 names; unknown names are ignored).
const GEMINI_OFF = ["update_topic", "list_directory", "read_file", "grep_search", "glob", "replace", "write_file", "web_fetch",
  "run_shell_command", "list_background_processes", "read_background_output", "google_web_search", "write_todos", "enter_plan_mode",
  "exit_plan_mode", "invoke_agent", "activate_skill", "read_many_files", "save_memory", "ask_user", "complete_task", "get_internal_docs",
  "take_snapshot", "tracker_add_dependency", "tracker_create_task", "tracker_get_task", "tracker_list_tasks", "tracker_update_task", "tracker_visualize"];
// MCP plumbing both CLIs add on their own; it only reaches the same server.
const MCP_HELPERS = ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"];

const toml = (v: unknown): string =>
  typeof v === "string" ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(toml).join(",")}]`
  : `{${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}=${toml(x)}`).join(",")}}`;

function command(task: GhTask, arm: string, token: string, dir: string): { args: string[]; env: Record<string, string> } {
  const s = server(arm, token);
  if (CLI === "codex") {
    return {
      args: ["exec", "--json", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "-s", "read-only", "-C", dir, "-m", MODEL,
        ...CODEX_OFF.flatMap((f) => ["--disable", f]), "-c", 'web_search="disabled"',
        "-c", `mcp_servers.gh.command=${toml(s.command)}`, "-c", `mcp_servers.gh.args=${toml(s.args)}`, "-c", `mcp_servers.gh.env=${toml(s.env)}`,
        "-c", "mcp_servers.gh.startup_timeout_sec=60", "-c", "mcp_servers.gh.tool_timeout_sec=120",
        // Headless Codex refuses an MCP tool that needs approval; every GitHub tool is approved up front.
        "-c", `mcp_servers.gh.default_tools_approval_mode="approve"`,
        ...CLI_ARGS, task.prompt],
      env: {},
    };
  }
  const settings = {
    mcpServers: { gh: { command: s.command, args: s.args, env: s.env, trust: true, timeout: 120_000 } },
    tools: { exclude: GEMINI_OFF },
    privacy: { usageStatisticsEnabled: false },
  };
  Deno.writeTextFileSync(`${dir}/settings.json`, JSON.stringify(settings, null, 1));
  return {
    args: ["-p", task.prompt, "-m", MODEL, "--output-format", "stream-json", "--approval-mode", "yolo", "--skip-trust",
      "--allowed-mcp-server-names", "gh", ...CLI_ARGS],
    env: { GEMINI_CLI_SYSTEM_SETTINGS_PATH: `${dir}/settings.json` },
  };
}

type Parsed = {
  finalText: string; error: string; turns: number; input: number; cached: number; output: number; reasoning: number;
  calls: { tool: string; input: unknown; isError: boolean }[]; foreign: string[];
};

function parse(stdout: string): Parsed {
  const p: Parsed = { finalText: "", error: "", turns: 0, input: 0, cached: 0, output: 0, reasoning: 0, calls: [], foreign: [] };
  const events = stdout.split("\n").filter((l) => l.trim().startsWith("{")).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
  if (CLI === "codex") {
    for (const e of events) {
      const it = e.item;
      if (e.type === "item.completed" && it) {
        if (it.type === "agent_message") p.finalText = it.text ?? "";
        else if (it.type === "mcp_tool_call") {
          p.calls.push({ tool: it.server === "gh" ? it.tool : `${it.server}/${it.tool}`, input: it.arguments, isError: it.status === "failed" });
          if (it.server !== "gh") p.foreign.push(`${it.server}/${it.tool}`);
        } else if (!["reasoning", "error", "todo_list"].includes(it.type)) p.foreign.push(it.type);
      }
      if (e.type === "turn.completed") {
        const u = e.usage ?? {};
        p.input += u.input_tokens ?? 0;
        p.cached += u.cached_input_tokens ?? 0;
        p.output += u.output_tokens ?? 0;
        p.reasoning += u.reasoning_output_tokens ?? 0;
        p.turns++;
      }
      if (e.type === "turn.failed") p.error = e.error?.message ?? "turn failed";
      if (e.type === "error" && !p.error) p.error = e.message ?? "error";
    }
    // Codex reports one turn per prompt; count model steps as tool calls plus the final answer.
    p.turns = p.calls.length + (p.finalText ? 1 : 0);
  } else {
    let text = "";
    for (const e of events) {
      if (e.type === "message" && e.role === "assistant") text = e.delta ? text + (e.content ?? "") : (e.content ?? "");
      if (e.type === "tool_use") {
        text = ""; // only the answer after the last tool call is the final one
        const name = String(e.tool_name);
        p.calls.push({ tool: name.replace(/^mcp_gh_/, ""), input: e.parameters, isError: false });
        if (!name.startsWith("mcp_gh_") && !MCP_HELPERS.includes(name)) p.foreign.push(name);
      }
      if (e.type === "tool_result" && e.status === "error") {
        const c = p.calls.at(-1);
        if (c) c.isError = true;
      }
      if (e.type === "result") {
        const s = e.stats ?? {};
        p.input = s.input_tokens ?? 0;
        p.cached = s.cached ?? 0;
        p.output = s.output_tokens ?? 0;
        if (e.status !== "success") p.error = JSON.stringify(e.error ?? e.status);
      }
      if (e.type === "error" && !p.error) p.error = e.message ?? "error";
    }
    p.finalText = text;
    p.turns = p.calls.length + (text ? 1 : 0);
    if (!events.some((e) => e.type === "result") && !p.error) p.error = "no result event";
  }
  return p;
}

// Kills any process left with this run's token in its environment (Linux only; elsewhere a no-op).
function killLeftovers(token: string) {
  let entries: Iterable<Deno.DirEntry>;
  try {
    entries = Deno.readDirSync("/proc");
  } catch {
    return;
  }
  for (const e of entries) {
    const pid = Number(e.name);
    if (!pid || pid === Deno.pid) continue;
    try {
      if (Deno.readTextFileSync(`/proc/${pid}/environ`).includes(token)) Deno.kill(pid, "SIGKILL");
    } catch {
      // gone already, or not ours to read
    }
  }
}

async function cliVersion(): Promise<string> {
  try {
    const o = await new Deno.Command(BIN, { args: ["--version"], stdout: "piped", stderr: "piped" }).output();
    return new TextDecoder().decode(o.stdout).trim().split(/\s+/).at(-1) ?? "";
  } catch {
    throw new Error(`cannot run ${BIN}: install it (see docs/runner-guide.md) or pass --bin`);
  }
}
const VERSION = await cliVersion();
if (VERSION !== TESTED[CLI]) console.log(`warning: ${CLI} ${VERSION}; this runner was tested with ${TESTED[CLI]}. Install that version if you can.`);

async function runOnce(arm: string, task: GhTask, rep: number) {
  const token = `xvcli-${crypto.randomUUID()}`;
  await mock("/__seed", token, { method: "POST", body: JSON.stringify(suite.seed()) });
  const dir = `${RUNS_DIR}/${token}`;
  Deno.mkdirSync(dir, { recursive: true, mode: 0o755 });
  Deno.chmodSync(dir, 0o755);
  const { args, env } = command(task, arm, token, dir);
  const t0 = performance.now();
  const child = new Deno.Command(BIN, {
    args, cwd: dir, env: { ...env, PHRASEBOOK_TOKEN: token, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
    stdin: "null", stdout: "piped", stderr: "piped",
  }).spawn();
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }, TIMEOUT_MS);
  const out = await child.output();
  clearTimeout(timer);
  killLeftovers(token);
  const latency = Math.round(performance.now() - t0);
  const stdout = new TextDecoder().decode(out.stdout);
  const p = parse(stdout);
  if (!p.error && out.code !== 0) p.error = `exit ${out.code}: ${new TextDecoder().decode(out.stderr).trim().slice(-500)}`;
  if (latency >= TIMEOUT_MS) p.error = `timeout after ${flags["timeout-min"]} min`;
  const state = await mock("/__state", token);
  const gaps = await mock("/__unhandled", token) as string[];
  await mock("/__drop", token);
  Deno.removeSync(dir, { recursive: true });
  return {
    kind: "run", suite: flags.suite, client: `${CLI}-cli`, cli_version: VERSION, runner: flags.runner, model: MODEL, arm, task: task.id, rep,
    success: !p.error && !p.foreign.length && task.check(state as State, p.finalText), harness_gaps: gaps,
    turns: p.turns, stop: p.error ? `error: ${p.error}` : "end", latency_ms: latency,
    // input_tokens counts every prompt token, cached ones included (cached_tokens is the part read from cache).
    input_tokens: p.input, output_tokens: p.output, cached_tokens: p.cached, reasoning_tokens: p.reasoning, usd: 0,
    calls: p.calls, invalid_calls: p.calls.filter((c) => c.isError).length, foreign_tools: p.foreign,
    final_text: p.finalText, cli_args: CLI_ARGS, events: stdout.length > 400_000 ? stdout.slice(0, 400_000) : stdout,
  };
}

const out = flags.out ?? `results/runs/xv-${flags.runner}-${CLI}-${MODEL.replace(/[^\w.-]+/g, "_")}-${flags.suite.endsWith("-en") ? "en" : "es"}.jsonl`;
Deno.mkdirSync(out.replace(/\/[^/]*$/, "") || ".", { recursive: true });
const errorsOut = out.replace(/(\.jsonl)?$/, ".errors.jsonl");
const done = new Set<string>();
try {
  for (const line of Deno.readTextFileSync(out).split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.kind === "run") done.add(`${r.model}|${r.arm}|${r.task}|${r.rep}`);
  }
} catch {
  // new file
}

const tasks = flags.tasks ? suite.tasks.filter((t) => flags.tasks!.split(",").includes(t.id)) : suite.tasks;
const jobs: [string, GhTask, number][] = [];
for (let r = 1; r <= Number(flags.reps); r++) for (const a of arms) for (const t of tasks) if (!done.has(`${MODEL}|${a}|${t.id}|${r}`)) jobs.push([a, t, r]);
console.log(`${CLI} ${VERSION}, model ${MODEL}: ${jobs.length} runs to do (${done.size} already in ${out})`);

let next = 0;
let streak = 0;
async function worker() {
  while (next < jobs.length) {
    const [a, t, r] = jobs[next++];
    const row = await runOnce(a, t, r);
    const failed = row.stop.startsWith("error");
    Deno.writeTextFileSync(failed ? errorsOut : out, JSON.stringify(row) + "\n", { append: true });
    console.log(
      `${failed ? "ERR " : row.harness_gaps.length ? "GAP " : row.foreign_tools.length ? "FRGN" : row.success ? "PASS" : "FAIL"}  ${a.padEnd(22)} ${t.id.padEnd(24)} rep=${r} ` +
        `calls=${row.calls.length} in=${row.input_tokens} out=${row.output_tokens} ${row.latency_ms}ms` +
        (failed ? `  ${row.stop.slice(0, 200)}` : "") + (row.foreign_tools.length ? `  foreign=${row.foreign_tools.join(",")}` : ""),
    );
    // A subscription's usage limit fails every run that follows: stop instead of burning through the list.
    streak = failed ? streak + 1 : 0;
    if (streak >= 5) {
      console.log("5 runs in a row failed in the CLI (often a usage limit). Stopping; run the same command later to resume.");
      next = jobs.length;
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, Number(flags.concurrency)) }, worker));

const rows = (() => {
  try {
    return Deno.readTextFileSync(out);
  } catch {
    return "";
  }
})().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind === "run" && r.model === MODEL);
for (const a of arms) {
  const rs = rows.filter((r) => r.arm === a && !r.harness_gaps.length);
  if (!rs.length) continue;
  const mean = (k: string) => Math.round(rs.reduce((s, r) => s + r[k], 0) / rs.length);
  console.log(`${a.padEnd(22)} pass ${rs.filter((r) => r.success).length}/${rs.length}  mean in=${mean("input_tokens")} out=${mean("output_tokens")}`);
}
const foreign = rows.filter((r) => r.foreign_tools?.length).length;
if (foreign) console.log(`${foreign} runs used a tool outside the GitHub server (FRGN): tell us, those runs are not valid.`);
const left = jobs.length - rows.filter((r) => jobs.some(([a, t, rep]) => r.arm === a && r.task === t.id && r.rep === rep)).length;
if (left) console.log(`${left} runs did not finish (see ${errorsOut}); run the same command again to retry them.`);
console.log(`log: ${out}`);
Deno.exit(0);
