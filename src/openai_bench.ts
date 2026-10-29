// Runs GitHub tasks with any model behind an OpenAI-compatible Chat Completions API
// (OpenAI, Gemini, OpenRouter, Together, Groq, vLLM, Ollama, LM Studio...), for the cross-vendor round.
// The model talks to the same MCP servers as the Claude Code runs (src/client_bench.ts): the real
// github-mcp-server against the fake GitHub, either directly (native) or through src/proxy.ts
// (phrasebook and ablation arms). This file is only the agent loop; see docs/runner-guide.md.
//
// Usage: deno run -A src/openai_bench.ts --model=gpt-5.1 [--base-url=https://api.openai.com/v1]
//          [--key-env=OPENAI_API_KEY] [--suite=github-beacon] [--arms=native,glossary4s,glossary4]
//          [--reps=3] [--tasks=id,id] [--concurrency=4] [--max-turns=20] [--extra='{"reasoning_effort":"low"}']
//          [--price-in=USD/Mtok --price-out=USD/Mtok] [--drop-fields=reasoning_content] [--schemas=full|gemini]
//          [--runner=your-name] [--out=results/runs/xv-<model>.jsonl]
// A run already in --out (same model, arm, task, rep) is skipped, so an interrupted round resumes;
// runs that ended in an API error go to <out>.errors.jsonl and are retried.
import { parseArgs } from "@std/cli/parse-args";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMock, type State } from "./github/mock.ts";
import type { GhTask } from "./github/tasks.ts";
import { blind3Seed, blind3Tasks } from "./github/blind3tasks.ts";
import { blind4Seed, blind4Tasks } from "./github/blind4tasks.ts";
import { privateSets } from "./github/private_sets.ts";
import type { McpTool } from "./mcp.ts";
import { codeTool, runCode } from "./codemode.ts";
import { Ajv } from "ajv";

const flags = parseArgs(Deno.args, {
  string: ["suite", "model", "base-url", "key-env", "arms", "reps", "tasks", "concurrency", "max-turns", "extra", "price-in", "price-out",
    "drop-fields", "schemas", "runner", "out", "max-output-chars"],
  default: {
    suite: "github-beacon", "base-url": "https://api.openai.com/v1", "key-env": "OPENAI_API_KEY",
    arms: "native,glossary4s,glossary4", reps: "3", concurrency: "4", "max-turns": "20", extra: "{}", schemas: "full",
    "price-in": "0", "price-out": "0", "drop-fields": "", runner: "", "max-output-chars": "100000",
  },
});
if (!flags.model) throw new Error("--model is required");
const MODEL = flags.model;
const BASE = flags["base-url"].replace(/\/$/, "");
const KEY = flags["key-env"] ? Deno.env.get(flags["key-env"]) ?? "" : "";
if (flags["key-env"] && !KEY && !/localhost|127\.0\.0\.1/.test(BASE)) throw new Error(`set ${flags["key-env"]} (or pass --key-env= for a local server)`);
const EXTRA = JSON.parse(flags.extra);
const MAX_TURNS = Number(flags["max-turns"]);
// Claude Code caps an MCP result at 25k tokens; about the same in characters, for every vendor alike.
const MAX_OUTPUT = Number(flags["max-output-chars"]);
const DROP = flags["drop-fields"].split(",").filter(Boolean);
const PRICE = { in: Number(flags["price-in"]), out: Number(flags["price-out"]) };

const ARMS = ["native", "code", "glossary4", "glossary4s", "native-trimmed", "native-compact", "native-trimmed-compact"];
const arms = flags.arms.split(",");
for (const a of arms) if (!ARMS.includes(a)) throw new Error(`arm ${a}: use ${ARMS.join(", ")}`);

const SUITES: Record<string, { tasks: GhTask[]; seed: () => State }> = {
  // Public sets, already run with Claude: a cheap way to check the setup end to end.
  "github-blind3": { tasks: blind3Tasks, seed: blind3Seed },
  "github-blind4": { tasks: blind4Tasks, seed: blind4Seed },
};
for (const p of privateSets) {
  SUITES[`github-${p.name}`] = { tasks: p.tasks("es"), seed: p.seed };
  SUITES[`github-${p.name}-en`] = { tasks: p.tasks("en"), seed: p.seed };
}
const suite = SUITES[flags.suite];
if (!suite) throw new Error(`unknown suite ${flags.suite}: ${Object.keys(SUITES).join(", ")} (private sets go in private/<name>/)`);

const GH = new URL("../vendor/github-mcp/github-mcp-server", import.meta.url).pathname;
const PROXY = new URL("./proxy.ts", import.meta.url).pathname;
const GITHUB_SMALL = new URL("../glossaries/github-small.json", import.meta.url).pathname;
const port = (startMock(0).addr as Deno.NetAddr).port;
const host = `http://127.0.0.1:${port}`;
const mock = (path: string, token: string, init: RequestInit = {}) =>
  fetch(host + path, { ...init, headers: { authorization: `token ${token}` } }).then((r) => r.json());

// The same server command lines as client_bench.ts.
function server(arm: string, token: string) {
  const env = { PATH: Deno.env.get("PATH") ?? "", HOME: Deno.env.get("HOME") ?? "", GITHUB_PERSONAL_ACCESS_TOKEN: token };
  const native = { command: GH, args: ["stdio", "--toolsets=default", `--gh-host=${host}`] };
  // Code mode runs the model's code locally (src/codemode.ts) against the native server.
  if (arm === "native" || arm === "code") return { ...native, env };
  return {
    command: Deno.execPath(),
    args: ["run", "-A", PROXY, "--name=github", ...(arm.startsWith("native-") ? [`--passthrough=${arm.slice("native-".length)}`] : []),
      ...(arm.startsWith("glossary4") ? ["--runtime=v4"] : []), ...(arm === "glossary4s" ? [`--notes=${GITHUB_SMALL}`] : []),
      "--", native.command, ...native.args],
    env,
  };
}

const ajv = new Ajv({ strict: false });
const SYSTEM = "You work on GitHub through the provided tool(s). Complete the user's request, " +
  "then reply briefly. When asked for a specific answer, give only that answer.";

type Schema = Record<string, unknown>;
// Gemini's OpenAI endpoint accepts a subset of JSON Schema.
function forGemini(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(forGemini);
  if (!s || typeof s !== "object") return s;
  const out: Schema = {};
  for (const [k, v] of Object.entries(s as Schema)) {
    if (["$schema", "additionalProperties", "default", "examples", "title"].includes(k)) continue;
    out[k] = k === "properties" ? Object.fromEntries(Object.entries(v as Schema).map(([p, x]) => [p, forGemini(x)])) : forGemini(v);
  }
  return out;
}

type Msg = Record<string, unknown> & { role: string };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

const RETRY = [408, 409, 429, 500, 502, 503, 504, 529];
async function chat(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    let wait = 0;
    let detail: string;
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(600_000),
      });
      if (res.ok) return await res.json();
      status = res.status;
      wait = Number(res.headers.get("retry-after")) || 0;
      detail = (await res.text()).slice(0, 500);
    } catch (e) {
      detail = (e as Error).message; // network error or timeout: retried
    }
    if ((status && !RETRY.includes(status)) || attempt >= 7) throw new Error(`HTTP ${status || "-"}: ${detail}`);
    await new Promise((r) => setTimeout(r, 1000 * (wait || 2 ** Math.min(attempt + 1, 6))));
  }
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

async function runOnce(arm: string, task: GhTask, rep: number) {
  const token = `xv-${crypto.randomUUID()}`;
  await mock("/__seed", token, { method: "POST", body: JSON.stringify(suite.seed()) });
  const client = new Client({ name: "phrasebook-openai", version: "0.1.0" });
  const t0 = performance.now();
  const usage = { input: 0, output: 0, cached: 0, reasoning: 0 };
  const calls: { tool: string; input: unknown; isError: boolean }[] = [];
  const messages: Msg[] = [];
  let finalText = "";
  let stop = "";
  let turns = 0;
  let defChars = 0;
  try {
    await client.connect(new StdioClientTransport({ ...server(arm, token), stderr: "ignore" }));
    const mcpTools = (await client.listTools()).tools as McpTool[];
    const instructions = client.getInstructions();
    const callMcp = async (name: string, a: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: a });
      return { text: (r.content as { text?: string; resource?: { text?: string } }[]).map((x) => x.text ?? x.resource?.text ?? "").join("\n"), isError: Boolean(r.isError) };
    };
    // Code mode validates each call against its schema first, as src/bench.ts does.
    const validators = new Map(mcpTools.map((t) => [t.name, ajv.compile(t.inputSchema)]));
    const callChecked = (name: string, a: Record<string, unknown>) => {
      const v = validators.get(name);
      if (!v) return Promise.resolve({ text: `Unknown tool ${name}`, isError: true });
      if (!v(a)) return Promise.resolve({ text: `Invalid input: ${ajv.errorsText(v.errors)}`, isError: true });
      return callMcp(name, a);
    };
    const exposed = arm === "code"
      ? [(({ name, description, input_schema }) => ({ name, description, inputSchema: input_schema }))(codeTool(mcpTools))]
      : mcpTools;
    const tools = exposed.map((t) => ({
      type: "function",
      function: {
        name: t.name, description: t.description ?? "",
        parameters: flags.schemas === "gemini" ? forGemini(t.inputSchema) : (({ $schema: _, ...rest }) => rest)(t.inputSchema as Schema),
      },
    }));
    defChars = JSON.stringify(tools).length + (instructions?.length ?? 0);
    // MCP clients put server instructions in the system prompt.
    messages.push({ role: "system", content: SYSTEM + (instructions ? `\n\nInstructions from the MCP server "github":\n${instructions}` : "") });
    messages.push({ role: "user", content: task.prompt });
    while (true) {
      if (turns >= MAX_TURNS) {
        stop = "max_turns";
        break;
      }
      turns++;
      const res = await chat({ model: MODEL, messages, tools, ...EXTRA });
      const u = (res.usage ?? {}) as Record<string, number & Record<string, number>>;
      usage.input += u.prompt_tokens ?? 0;
      usage.output += u.completion_tokens ?? 0;
      usage.cached += u.prompt_tokens_details?.cached_tokens ?? 0;
      usage.reasoning += u.completion_tokens_details?.reasoning_tokens ?? 0;
      const choice = (res.choices as { message: Msg & { content?: string | null; tool_calls?: ToolCall[] }; finish_reason: string }[])[0];
      if (!choice) throw new Error(`no choices: ${JSON.stringify(res).slice(0, 300)}`);
      const msg = { ...choice.message };
      for (const f of DROP) delete msg[f];
      messages.push(msg);
      stop = choice.finish_reason;
      if (typeof msg.content === "string" && msg.content.trim()) finalText = msg.content;
      const toolCalls = msg.tool_calls ?? [];
      if (!toolCalls.length) break;
      for (const c of toolCalls) {
        let args: Record<string, unknown> = {};
        let text: string;
        let isError = false;
        try {
          args = c.function.arguments ? JSON.parse(c.function.arguments) : {};
        } catch {
          isError = true;
        }
        if (isError) {
          text = `Error: the arguments are not valid JSON: ${c.function.arguments.slice(0, 200)}`;
        } else {
          const r = !exposed.some((t) => t.name === c.function.name)
            ? { text: `Unknown tool ${c.function.name}`, isError: true }
            : arm === "code"
            ? await runCode(String(args.code ?? ""), (name, a) => callChecked(name, a as Record<string, unknown>), (name, input, err) => calls.push({ tool: name, input, isError: err }))
            : await callMcp(c.function.name, args);
          isError = r.isError;
          text = r.text || "(empty)";
          if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + "\n[output truncated]";
        }
        calls.push({ tool: c.function.name, input: args, isError });
        messages.push({ role: "tool", tool_call_id: c.id, content: isError && !text.startsWith("Error") ? `Error: ${text}` : text });
      }
    }
  } catch (e) {
    stop = `error: ${(e as Error).message}`;
  }
  await client.close().catch(() => {});
  killLeftovers(token);
  const state = await mock("/__state", token);
  const gaps = await mock("/__unhandled", token) as string[];
  await mock("/__drop", token);
  return {
    kind: "run", suite: flags.suite, client: "openai-compatible", base_url: BASE, runner: flags.runner, model: MODEL, arm, task: task.id, rep,
    success: !stop.startsWith("error") && stop !== "max_turns" && task.check(state as State, finalText), harness_gaps: gaps,
    turns, stop, latency_ms: Math.round(performance.now() - t0),
    input_tokens: usage.input, output_tokens: usage.output, cached_tokens: usage.cached, reasoning_tokens: usage.reasoning,
    usd: (usage.input * PRICE.in + usage.output * PRICE.out) / 1e6, definition_chars: defChars,
    calls, invalid_calls: calls.filter((c) => c.isError).length, final_text: finalText, extra: EXTRA, messages,
  };
}

const out = flags.out ?? `results/runs/xv-${MODEL.replace(/[^\w.-]+/g, "_")}-${flags.suite}.jsonl`;
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
console.log(`${jobs.length} runs to do (${done.size} already in ${out})`);

let next = 0;
async function worker() {
  while (next < jobs.length) {
    const [a, t, r] = jobs[next++];
    const row = await runOnce(a, t, r);
    // A run cut short by the API is not a result: it goes to a side file and is retried on the next start.
    Deno.writeTextFileSync(row.stop.startsWith("error") ? errorsOut : out, JSON.stringify(row) + "\n", { append: true });
    console.log(
      `${row.stop.startsWith("error") ? "ERR " : row.harness_gaps.length ? "GAP " : row.success ? "PASS" : "FAIL"}  ${a.padEnd(22)} ${t.id.padEnd(24)} rep=${r} ` +
        `turns=${row.turns} in=${row.input_tokens} out=${row.output_tokens} ${row.latency_ms}ms` +
        (row.stop.startsWith("error") || row.stop === "max_turns" ? `  ${row.stop.slice(0, 200)}` : ""),
    );
  }
}
await Promise.all(Array.from({ length: Math.max(1, Number(flags.concurrency)) }, worker));

// Short summary of the whole file for this model.
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
  console.log(`${a.padEnd(22)} pass ${rs.filter((r) => r.success).length}/${rs.length}  mean in=${mean("input_tokens")} out=${mean("output_tokens")} turns=${(rs.reduce((s, r) => s + r.turns, 0) / rs.length).toFixed(1)}`);
}
const left = jobs.length - rows.filter((r) => jobs.some(([a, t, rep]) => r.arm === a && r.task === t.id && r.rep === rep)).length;
if (left) console.log(`${left} runs ended in an API error (see ${errorsOut}); run the same command again to retry them.`);
console.log(`log: ${out}`);
Deno.exit(0);
