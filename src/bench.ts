// Runs every task of a suite against each model and arm, and logs one JSONL line per run.
// Usage: deno run -A src/bench.ts --suite=memory|github --models=a,b --arms=native,glossary,code
//        (arms also: glossary2, when the suite has a v2 glossary)
//        [--reps=1] [--tasks=id,id] [--concurrency=8] [--budget=tokens] [--out=file] [--cache]
import Anthropic from "@anthropic-ai/sdk";
import { Ajv } from "ajv";
import { parseArgs } from "@std/cli/parse-args";
import { loadEnv } from "./env.ts";
import type { McpTool } from "./mcp.ts";
import { codeTool, runCode } from "./codemode.ts";
import { type Session, type Suite, suites } from "./suites.ts";
import { extraArms } from "./arms_extra.ts";
import { LEDGER, ledgerTotal, usd } from "./cost.ts";

await loadEnv();
const flags = parseArgs(Deno.args, {
  boolean: ["cache"],
  string: ["suite", "models", "arms", "reps", "tasks", "out", "budget", "concurrency", "usd-cap"],
  default: {
    suite: "memory",
    models: "claude-haiku-4-5-20251001,claude-sonnet-5-5",
    arms: "native,glossary,code",
    reps: "1",
    budget: "1500000",
    concurrency: "8",
    // Stop when the shared ledger (all processes, this study phase) reaches this many USD.
    "usd-cap": "70",
  },
});

const suite: Suite = suites[flags.suite];
if (!suite) throw new Error(`Unknown suite "${flags.suite}". Use: ${Object.keys(suites).join(", ")}`);
const MAX_TURNS = 12;
// Hard stop for the whole run, in input + output tokens, so a bug cannot burn the budget.
const BUDGET = Number(flags.budget);
const USD_CAP = Number(flags["usd-cap"]);

// Parallel runs hit rate limits more often; let the SDK back off instead of failing the run.
const client = new Anthropic({ maxRetries: 8 });
const ajv = new Ajv({ strict: false });
let spent = 0;

type CallLog = { tool: string; input: unknown; outcome: string; detail?: string };

const asNative = (tools: McpTool[]): Anthropic.Tool[] =>
  tools.map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema as Anthropic.Tool.InputSchema }));

function toolsFor(arm: string, mcpTools: McpTool[]): Anthropic.Tool[] {
  if (extraArms[arm]) return extraArms[arm].tools(mcpTools, suite) as Anthropic.Tool[];
  if (arm === "native") return asNative(mcpTools);
  if (arm === "code") return [codeTool(mcpTools)];
  if (arm === "glossary2") {
    if (!suite.glossaryTool2) throw new Error(`suite ${suite.name} has no glossary v2`);
    return [suite.glossaryTool2 as Anthropic.Tool];
  }
  return [suite.glossaryTool as Anthropic.Tool];
}

async function runOnce(model: string, arm: string, taskId: string, rep: number) {
  const session = await suite.start(taskId);
  const validators = new Map(session.tools.map((t) => [t.name, ajv.compile(t.inputSchema)]));
  const tools = toolsFor(arm, session.tools);

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: suite.promptOf(taskId) }];
  const usage = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
  const calls: CallLog[] = [];
  let finalText = "";
  let stop = "";
  let turns = 0;
  let container: string | undefined;
  const t0 = performance.now();

  try {
    // A programmatic tool call pauses the code and costs a request but no model decision,
    // so the ptc arm gets a larger request cap; its model turns are still counted in "turns".
    const maxRequests = extraArms[arm]?.keepContainer ? MAX_TURNS * 6 : MAX_TURNS;
    while (turns < maxRequests) {
      if (spent > BUDGET) throw new Error(`budget of ${BUDGET} tokens exhausted`);
      if (ledgerTotal() > USD_CAP) throw new Error(`ledger reached the ${USD_CAP} USD cap`);
      turns++;
      // With --cache, mirror a real client: cache tools + system, and the conversation so far.
      const systemText = suite.system + (extraArms[arm]?.systemSuffix ? " " + extraArms[arm].systemSuffix : "");
      const system = flags.cache
        ? [{ type: "text" as const, text: systemText, cache_control: { type: "ephemeral" as const } }]
        : systemText;
      const sent = flags.cache ? withCacheBreakpoint(messages) : messages;
      const extra: Record<string, unknown> = { ...(extraArms[arm]?.request ?? {}), ...(container ? { container } : {}) };
      // Arms that need beta features (e.g. tool search) go through the beta endpoint.
      const res = (extra.betas
        ? await client.beta.messages.create({ model, max_tokens: 4096, system, tools, messages: sent, ...extra } as never)
        : await client.messages.create({ model, max_tokens: 4096, system, tools, messages: sent, ...extra } as never)) as Anthropic.Message;
      usage.input += res.usage.input_tokens;
      usage.output += res.usage.output_tokens;
      usage.cache_write += res.usage.cache_creation_input_tokens ?? 0;
      usage.cache_read += res.usage.cache_read_input_tokens ?? 0;
      spent += res.usage.input_tokens + res.usage.output_tokens + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0);
      stop = res.stop_reason ?? "";
      if (extraArms[arm]?.keepContainer) container = (res as { container?: { id: string } }).container?.id ?? container;
      messages.push({ role: "assistant", content: res.content });
      finalText = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      // Server-side tools can pause a long turn; send it back to continue.
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (stop === "pause_turn" && uses.length === 0) continue;
      if ((stop !== "tool_use" && stop !== "pause_turn") || uses.length === 0) break;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) {
        const out = await dispatch(arm, u, session, validators, calls);
        results.push({ type: "tool_result", tool_use_id: u.id, content: out.text || "(empty)", is_error: out.isError });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    stop = `error: ${(e as Error).message}`;
  }

  const { success, harnessGaps } = await session.finish(finalText);
  return {
    model, arm, task: taskId, rep,
    // A route the fake backend lacks is our gap, not the model's: such runs are excluded from scoring.
    success: !stop.startsWith("error") && success, harness_gaps: harnessGaps,
    turns, stop, latency_ms: Math.round(performance.now() - t0),
    input_tokens: usage.input, output_tokens: usage.output,
    cache_write_tokens: usage.cache_write, cache_read_tokens: usage.cache_read, cached: Boolean(flags.cache),
    calls, invalid_calls: calls.filter((c) => c.outcome !== "ok").length,
    final_text: finalText, messages,
  };
}

// Copy of the history with a cache breakpoint on the last block, so earlier turns are read from cache.
// Blocks of programmatic tool calls (and their results) are not rendered for Claude and cannot carry
// cache_control, so the breakpoint goes on the last block that can.
function withCacheBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const copy = structuredClone(messages);
  const programmatic = new Set<string>();
  for (const m of copy) {
    if (typeof m.content === "string") continue;
    for (const b of m.content as { type: string; id?: string; caller?: { type: string } }[]) {
      if (b.type === "tool_use" && b.caller && b.caller.type !== "direct") programmatic.add(b.id!);
    }
  }
  for (let i = copy.length - 1; i >= 0; i--) {
    const m = copy[i];
    if (typeof m.content === "string") m.content = [{ type: "text", text: m.content }];
    const blocks = m.content as { type: string; id?: string; tool_use_id?: string; text?: string; cache_control?: { type: "ephemeral" } }[];
    for (let j = blocks.length - 1; j >= 0; j--) {
      const b = blocks[j];
      if (b.type === "tool_use" && programmatic.has(b.id!)) continue;
      if (b.type === "tool_result" && programmatic.has(b.tool_use_id!)) continue;
      if (b.type === "text" && !b.text) continue;
      b.cache_control = { type: "ephemeral" };
      return copy;
    }
  }
  return copy;
}

async function dispatch(
  arm: string,
  u: Anthropic.ToolUseBlock,
  session: Session,
  validators: Map<string, ReturnType<typeof ajv.compile>>,
  calls: CallLog[],
): Promise<{ text: string; isError: boolean }> {
  const input = u.input as Record<string, unknown>;

  const extraArm = extraArms[arm];
  if (extraArm?.dispatch) return await extraArm.dispatch(u, session, calls);

  if (arm === "native" || extraArm) {
    const validate = validators.get(u.name);
    if (!validate) {
      calls.push({ tool: u.name, input, outcome: "unknown_tool" });
      return { text: `Unknown tool ${u.name}`, isError: true };
    }
    if (!validate(input)) {
      const detail = ajv.errorsText(validate.errors);
      calls.push({ tool: u.name, input, outcome: "schema_violation", detail });
      return { text: `Invalid input: ${detail}`, isError: true };
    }
    const r = await session.call(u.name, input);
    calls.push({ tool: u.name, input, outcome: r.isError ? "backend_error" : "ok", detail: r.isError ? r.text : undefined });
    return r;
  }

  if (arm === "code") {
    if (typeof input.code !== "string") {
      calls.push({ tool: u.name, input, outcome: "schema_violation", detail: "code must be a string" });
      return { text: "Send {\"code\": \"...\"}", isError: true };
    }
    const r = await runCode(input.code, async (name, args) => {
      const validate = validators.get(name);
      if (!validate) return { text: `Unknown tool ${name}`, isError: true };
      if (!validate(args)) return { text: `Invalid input: ${ajv.errorsText(validate.errors)}`, isError: true };
      return await session.call(name, args);
    }, (name, args, isError, text) => {
      calls.push({ tool: name, input: args, outcome: isError ? (validators.has(name) ? "backend_error" : "unknown_tool") : "ok", detail: isError ? text : undefined });
    });
    if (r.isError) calls.push({ tool: u.name, input, outcome: "code_error", detail: r.text.slice(0, 500) });
    return r;
  }

  // Glossary arm: one string, parsed deterministically, then real MCP calls.
  if (typeof input.command !== "string") {
    calls.push({ tool: u.name, input, outcome: "schema_violation", detail: "command must be a string" });
    return { text: "Send {\"command\": \"...\"}", isError: true };
  }
  let parsed;
  try {
    parsed = arm === "glossary2" ? suite.parse2!(input.command, session.tools) : suite.parse(input.command, session.tools);
  } catch (e) {
    if (!suite.isCommandError(e)) throw e;
    calls.push({ tool: u.name, input, outcome: "parse_error", detail: e.message });
    return { text: e.message, isError: true };
  }
  const outputs: string[] = [];
  let anyError = false;
  for (const p of parsed) {
    const r = await session.call(p.tool, p.args);
    calls.push({ tool: p.tool, input: p.args, outcome: r.isError ? "backend_error" : "ok", detail: r.isError ? r.text : undefined });
    anyError ||= r.isError;
    outputs.push(r.text);
  }
  return { text: outputs.join("\n---\n"), isError: anyError };
}

// Static cost of the tool definitions alone, per model and arm.
async function definitionTokens(model: string, mcpTools: McpTool[]) {
  const base = { model, system: suite.system, messages: [{ role: "user" as const, content: "hi" }] };
  const none = (await client.messages.countTokens(base)).input_tokens;
  const count = async (arm: string) => (await client.messages.countTokens({ ...base, tools: toolsFor(arm, mcpTools) })).input_tokens - none;
  return {
    native: await count("native"), glossary: await count("glossary"), code: await count("code"),
    ...(suite.glossaryTool2 ? { glossary2: await count("glossary2") } : {}),
  };
}

const models = flags.models.split(",");
const arms = flags.arms.split(",");
const taskIds = flags.tasks ? flags.tasks.split(",") : suite.taskIds;
const reps = Number(flags.reps);
const out = flags.out ?? `results/${suite.name}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
Deno.mkdirSync("results", { recursive: true });

const mcpTools = await suite.listTools();
for (const m of models) {
  const d = await definitionTokens(m, mcpTools);
  console.log(`definition tokens  ${m}: ${Object.entries(d).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  Deno.writeTextFileSync(out, JSON.stringify({ kind: "definitions", suite: suite.name, model: m, ...d }) + "\n", { append: true });
}

const jobs: [string, string, string, number][] = [];
for (const m of models) for (const a of arms) for (const t of taskIds) for (let r = 1; r <= reps; r++) jobs.push([m, a, t, r]);

// Fixed-size worker pool; each run owns its own server and isolated state.
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const [m, a, t, r] = jobs[next++];
    const row = await runOnce(m, a, t, r);
    Deno.writeTextFileSync(LEDGER, JSON.stringify({
      ts: new Date().toISOString(), suite: suite.name, model: m, arm: a, task: t,
      usd: usd(m, { input_tokens: row.input_tokens, output_tokens: row.output_tokens, cache_write_tokens: row.cache_write_tokens, cache_read_tokens: row.cache_read_tokens }),
    }) + "\n", { append: true });
    Deno.writeTextFileSync(out, JSON.stringify({ kind: "run", suite: suite.name, ...row }) + "\n", { append: true });
    console.log(
      `${row.harness_gaps.length ? "GAP " : row.success ? "PASS" : "FAIL"}  ${m.padEnd(28)} ${a.padEnd(9)} ${t.padEnd(22)} ` +
        `turns=${row.turns} in=${row.input_tokens} out=${row.output_tokens} invalid=${row.invalid_calls} ${row.latency_ms}ms` +
        (row.stop.startsWith("error") ? `  ${row.stop}` : "") +
        (row.harness_gaps.length ? `  gaps=${row.harness_gaps.map((g) => g.slice(0, 80)).join(" | ")}` : ""),
    );
  }
}
await Promise.all(Array.from({ length: Math.max(1, Number(flags.concurrency)) }, worker));
console.log(`total tokens spent: ${spent}\nledger total (this phase): ${ledgerTotal().toFixed(2)} USD\nlog: ${out}`);
// The fake GitHub server keeps the process alive; exit explicitly.
Deno.exit(0);
