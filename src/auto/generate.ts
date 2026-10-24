// One-shot glossary generator: a model reads a server's tool list and writes the
// engine's command table, then the static validator checks it. On failure the
// validator's errors go back to the model, at most 2 times. Output is never
// edited by hand.
// Usage: deno run -A src/auto/generate.ts <name> <tools.json> [--server-label=...] [--effort=high] [--max-tokens=64000]
import Anthropic from "@anthropic-ai/sdk";
import { parseArgs } from "@std/cli/parse-args";
import { loadEnv } from "../env.ts";
import { LEDGER, usd } from "../cost.ts";
import type { McpTool } from "../mcp.ts";
import type { Command, Table } from "./engine.ts";
import { validateTable } from "./validate.ts";

const MODEL = "claude-opus-5-5";
const MAX_REPAIRS = 2;

const ENGINE_SPEC = `You design a "glossary" for an MCP server: one tool that takes short command lines
instead of many JSON tool calls. A generic engine runs your design; you only write the table.

How the engine reads a command line:
- Each line is: some command words, values, in ANY order. Example: "merge pr octo/app#10 method=squash".
- Command words pick the command. A command is identified by the SET of its words after folding
  (order does not matter). Folding lowercases and maps words through your "fold" table
  (plurals and synonyms, e.g. files->file, show->get). Never rely on stripping a trailing "s".
- If no command matches and the line contains one of your "genericVerbs" (e.g. get, list), the
  engine retries without it. So "get pr files" can reach a command whose words are "files pr".
- key=value fills a parameter. "rename" maps a short glossary key to the tool's parameter name.
  Values are converted using the tool's JSON schema (numbers, booleans, comma-separated lists,
  JSON arrays for arrays of objects). Enum values are matched case-insensitively.
- targetStyle "github": a token like owner/repo or owner/repo#12 fills the command's
  target_owner / target_repo / target_number parameters. targetStyle "none": no such tokens.
- Any other bare or quoted token fills the command's "positional" parameters, in order.
  Quoted tokens are always values, never command words.
- "fixed" sets parameters the command always sends (e.g. a method selecting a sub-operation).
- "needs" (owner|repo|number) makes the engine demand that part of the target.
- Missing required parameters, unknown keys and unknown commands produce errors that show usage
  lines and the closest commands, so the model can correct itself.

Rules for a good table:
- Cover EVERY tool with at least one command. Map only to real parameters of that tool.
- Words are the system's nouns plus common verbs (get, list, create, update, delete, add, ...).
  Prefer the words a user of this system would naturally write.
- No two commands may have the same folded word set. Watch plurals that collide with other
  nouns and verbs that are also nouns.
- Put the most important required parameters in "positional" when it reads naturally
  (e.g. "read file notes/a.md"), and keep key=value for the rest.
- Every command has a "usage" line (its words first, then target/positionals/keys with [optional]
  in brackets) and one concrete "example" that must parse to that command and pass the tool's
  schema.
- The "glossary" text is what the agent sees instead of the tool definitions. Keep it short:
  a header with the line syntax and target syntax, then one line per noun listing its verbs and
  keys, important enum values written out, and 2-4 examples. Say that word order is free and
  plurals are fine. Do not repeat the per-tool descriptions; name only what the agent needs to
  ask precisely (nouns, values, keys).

Small example of the format, for an unrelated "todo" server with tools add_task(title, due?)
and list_tasks(status: open|done):
{"glossary":"Todo. One command per line: <verb> <noun> [value] [key=value].\\nWord order is free.\\n  task  add <title> [due=YYYY-MM-DD] | list [status=open|done]\\nExample: add task \\"Pay rent\\" due=2026-10-01",
 "targetStyle":"none","genericVerbs":["get","list","show"],"fold":[{"from":"tasks","to":"task"}],
 "commands":[
  {"words":["add","task"],"tool":"add_task","fixed":[],"rename":[],"positional":["title"],"target_owner":"","target_repo":"","target_number":"","needs":"","usage":"add task <title> [due=YYYY-MM-DD]","example":"add task \\"Pay rent\\" due=2026-10-01"},
  {"words":["list","task"],"tool":"list_tasks","fixed":[],"rename":[],"positional":[],"target_owner":"","target_repo":"","target_number":"","needs":"","usage":"list task [status=open|done]","example":"list task status=open"}]}`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["glossary", "targetStyle", "genericVerbs", "fold", "commands"],
  properties: {
    glossary: { type: "string" },
    targetStyle: { type: "string", enum: ["github", "none"] },
    genericVerbs: { type: "array", items: { type: "string" } },
    fold: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["from", "to"], properties: { from: { type: "string" }, to: { type: "string" } } },
    },
    commands: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["words", "tool", "fixed", "rename", "positional", "target_owner", "target_repo", "target_number", "needs", "usage", "example"],
        properties: {
          words: { type: "array", items: { type: "string" } },
          tool: { type: "string" },
          fixed: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["param", "value"], properties: { param: { type: "string" }, value: { type: "string" } } },
          },
          rename: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["key", "param"], properties: { key: { type: "string" }, param: { type: "string" } } },
          },
          positional: { type: "array", items: { type: "string" } },
          target_owner: { type: "string" },
          target_repo: { type: "string" },
          target_number: { type: "string" },
          needs: { type: "string", enum: ["", "owner", "repo", "number"] },
          usage: { type: "string" },
          example: { type: "string" },
        },
      },
    },
  },
};

type Raw = {
  glossary: string; targetStyle: "github" | "none"; genericVerbs: string[]; fold: { from: string; to: string }[];
  commands: {
    words: string[]; tool: string; fixed: { param: string; value: string }[]; rename: { key: string; param: string }[];
    positional: string[]; target_owner: string; target_repo: string; target_number: string; needs: string; usage: string; example: string;
  }[];
};

function toTable(server: string, raw: Raw): Table {
  return {
    server,
    glossary: raw.glossary,
    targetStyle: raw.targetStyle,
    genericVerbs: raw.genericVerbs,
    fold: Object.fromEntries(raw.fold.map((f) => [f.from.toLowerCase(), f.to.toLowerCase()])),
    commands: raw.commands.map((c): Command => {
      const target: Command["target"] = {};
      if (c.target_owner) target.owner = c.target_owner;
      if (c.target_repo) target.repo = c.target_repo;
      if (c.target_number) target.number = c.target_number;
      return {
        words: c.words, tool: c.tool,
        ...(c.fixed.length ? { fixed: Object.fromEntries(c.fixed.map((f) => [f.param, f.value])) } : {}),
        ...(c.rename.length ? { rename: Object.fromEntries(c.rename.map((r) => [r.key, r.param])) } : {}),
        ...(c.positional.length ? { positional: c.positional } : {}),
        ...(Object.keys(target).length ? { target } : {}),
        ...(c.needs ? { needs: c.needs as Command["needs"] } : {}),
        usage: c.usage, example: c.example,
      };
    }),
  };
}

async function main() {
  await loadEnv();
  const flags = parseArgs(Deno.args, { string: ["server-label", "effort", "max-tokens"], default: { effort: "high", "max-tokens": "64000" } });
  const [name, toolsPath] = flags._.map(String);
  if (!name || !toolsPath) throw new Error("Usage: generate.ts <name> <tools.json>");
  const tools = JSON.parse(Deno.readTextFileSync(toolsPath)) as McpTool[];
  const label = flags["server-label"] ?? name;
  const client = new Anthropic();
  const logPath = `results/auto-gen/${name}.jsonl`;
  Deno.mkdirSync("results/auto-gen", { recursive: true });
  const log = (o: unknown) => Deno.writeTextFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), ...o as object }) + "\n", { append: true });

  const toolList = JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })));
  const messages: Anthropic.MessageParam[] = [{
    role: "user",
    content: `Design the glossary table for the MCP server "${label}" (${tools.length} tools). Its tools:\n\n${toolList}`,
  }];

  let table: Table | null = null;
  let errors: string[] = [];
  for (let round = 0; round <= MAX_REPAIRS; round++) {
    const stream = client.messages.stream({
      model: MODEL, max_tokens: Number(flags["max-tokens"]), system: ENGINE_SPEC, messages,
      output_config: { effort: flags.effort, format: { type: "json_schema", schema: SCHEMA } },
    } as never);
    const res = await stream.finalMessage();
    const cost = usd(MODEL, {
      input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens,
      cache_write_tokens: res.usage.cache_creation_input_tokens ?? 0, cache_read_tokens: res.usage.cache_read_input_tokens ?? 0,
    });
    Deno.writeTextFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), suite: name, model: MODEL, arm: "generate", task: `round-${round}`, usd: cost }) + "\n", { append: true });
    if (res.stop_reason !== "end_turn") throw new Error(`generation stopped: ${res.stop_reason}`);
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const raw = JSON.parse(text) as Raw;
    table = toTable(name, raw);
    errors = validateTable(table, tools);
    log({ round, usage: res.usage, usd: cost, commands: table.commands.length, errors });
    console.log(`round ${round}: ${table.commands.length} commands, ${errors.length} validator error(s), ${cost.toFixed(3)} USD`);
    if (!errors.length) break;
    if (round < MAX_REPAIRS) {
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: `The validator rejected the table:\n- ${errors.join("\n- ")}\n\nReturn the complete corrected table.` });
    }
  }
  if (!table) throw new Error("no table");
  const out = `glossaries/${name}.json`;
  Deno.writeTextFileSync(out, JSON.stringify(table, null, 1));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(Deno.readTextFileSync(out)))))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  Deno.writeTextFileSync("results/auto-freeze.sha256", `${hash}  ${out}  # generated ${new Date().toISOString()}, ${errors.length ? "FAILED validation" : "valid"}\n`, { append: true });
  console.log(`${out}: ${errors.length ? `still ${errors.length} error(s) after ${MAX_REPAIRS} repairs` : "valid"}; sha256 ${hash}`);
  if (errors.length) Deno.exit(2);
}

await main();
