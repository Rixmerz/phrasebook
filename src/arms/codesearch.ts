// Arm "codesearch": code mode with progressive discovery, in the style of
// https://www.anthropic.com/engineering/code-execution-with-mcp.
// The model starts with only the server's tool names. It calls search_tools to
// read signatures or docs for the tools it needs, then execute to run code
// against them in the same permissionless Deno sandbox as the "code" arm.
import type Anthropic from "@anthropic-ai/sdk";
import { Ajv } from "ajv";
import { runCode } from "../codemode.ts";
import type { CallLog, ExtraArm } from "../arms_extra.ts";
import type { McpTool } from "../mcp.ts";
import type { Session } from "../suites.ts";

type Schema = { type?: string; enum?: unknown[]; properties?: Record<string, Schema>; items?: Schema; required?: string[]; description?: string };

// Same rendering as src/codemode.ts, with field docs optional.
function tsType(s: Schema | undefined, docs: boolean): string {
  if (!s) return "unknown";
  if (s.enum?.length) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (s.type === "string") return "string";
  if (s.type === "number" || s.type === "integer") return "number";
  if (s.type === "boolean") return "boolean";
  if (s.type === "array") return `${tsType(s.items, docs)}[]`;
  if (s.type === "object" || s.properties) {
    const req = new Set(s.required ?? []);
    const fields = Object.entries(s.properties ?? {}).map(([k, v]) =>
      `${docs && v.description ? `/** ${v.description.replace(/\*\//g, "")} */ ` : ""}${k}${req.has(k) ? "" : "?"}: ${tsType(v, docs)}`
    );
    return `{ ${fields.join("; ")} }`;
  }
  return "unknown";
}

export type Detail = "name" | "signature" | "full";

export function renderTool(t: McpTool, detail: Detail): string {
  if (detail === "name") return t.name;
  const sig = `tools.${t.name}(args: ${tsType(t.inputSchema as Schema, detail === "full")}): Promise<any>`;
  return detail === "full" ? `/** ${(t.description ?? "").replace(/\*\//g, "")} */\n${sig}` : sig;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

// Ranks tools by query-word overlap with name (weighted), description and
// parameter names. Plain and deterministic; the API-side BM25 is not used here.
export function searchTools(tools: McpTool[], query: string, limit = 8): McpTool[] {
  const q = words(query);
  if (!q.length) return tools.slice(0, limit);
  const scored = tools.map((t) => {
    const name = new Set(words(t.name));
    const params = new Set(words(Object.keys((t.inputSchema as Schema).properties ?? {}).join(" ")));
    const desc = words(t.description ?? "");
    const descSet = new Set(desc);
    let score = 0;
    for (const w of q) {
      if (name.has(w)) score += 3;
      else if ([...name].some((n) => n.startsWith(w) || w.startsWith(n))) score += 2;
      if (descSet.has(w)) score += 1;
      if (params.has(w)) score += 0.5;
    }
    return { t, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.t);
}

export function codesearchTools(mcpTools: McpTool[]) {
  return [
    {
      name: "search_tools",
      description:
        "Find tools of the API used by `execute` and read their definitions. " +
        'detail: "name" (names only), "signature" (TypeScript signature), "full" (signature plus docs). ' +
        "Read a tool's signature before calling it.\n\nAvailable tools: " + mcpTools.map((t) => t.name).join(", "),
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Words describing what you need, or a tool name." },
          detail: { type: "string", enum: ["name", "signature", "full"], description: "How much to return. Default: signature." },
          limit: { type: "number", description: "Max tools to return. Default 8." },
        },
        required: ["query"],
      },
    },
    {
      name: "execute",
      description:
        "Run JavaScript (an async function body). Call tools as `await tools.<name>(args)`; " +
        "use search_tools to read their signatures first. Only what you console.log comes back to you. " +
        "No network or filesystem.",
      input_schema: {
        type: "object" as const,
        properties: { code: { type: "string", description: "Body of an async function. Use await." } },
        required: ["code"],
      },
    },
  ];
}

const ajv = new Ajv({ strict: false });
const validatorCache = new WeakMap<McpTool[], Map<string, ReturnType<typeof ajv.compile>>>();

function validatorsFor(tools: McpTool[]) {
  let v = validatorCache.get(tools);
  if (!v) {
    v = new Map(tools.map((t) => [t.name, ajv.compile(t.inputSchema)]));
    validatorCache.set(tools, v);
  }
  return v;
}

async function dispatch(u: Anthropic.ToolUseBlock, session: Session, calls: CallLog[]) {
  const input = u.input as Record<string, unknown>;

  if (u.name === "search_tools") {
    if (typeof input.query !== "string") {
      calls.push({ tool: u.name, input, outcome: "schema_violation", detail: "query must be a string" });
      return { text: 'Send {"query": "..."}', isError: true };
    }
    const detail = (["name", "signature", "full"].includes(String(input.detail)) ? input.detail : "signature") as Detail;
    const limit = typeof input.limit === "number" && input.limit > 0 ? Math.min(input.limit, 50) : 8;
    // An exact tool name returns that tool first.
    const exact = session.tools.find((t) => t.name === input.query);
    const hits = exact ? [exact, ...searchTools(session.tools, input.query, limit).filter((t) => t !== exact)].slice(0, limit)
      : searchTools(session.tools, input.query, limit);
    calls.push({ tool: u.name, input, outcome: "ok" });
    return { text: hits.length ? hits.map((t) => renderTool(t, detail)).join("\n\n") : "No matching tools.", isError: false };
  }

  if (u.name === "execute") {
    if (typeof input.code !== "string") {
      calls.push({ tool: u.name, input, outcome: "schema_violation", detail: "code must be a string" });
      return { text: 'Send {"code": "..."}', isError: true };
    }
    const validators = validatorsFor(session.tools);
    const r = await runCode(input.code, async (name, args) => {
      const validate = validators.get(name);
      if (!validate) return { text: `Unknown tool ${name}. Use search_tools to find tools.`, isError: true };
      if (!validate(args)) return { text: `Invalid input: ${ajv.errorsText(validate.errors)}`, isError: true };
      return await session.call(name, args);
    }, (name, args, isError, text) => {
      calls.push({ tool: name, input: args, outcome: isError ? (validators.has(name) ? "backend_error" : "unknown_tool") : "ok", detail: isError ? text : undefined });
    });
    if (r.isError) calls.push({ tool: u.name, input, outcome: "code_error", detail: r.text.slice(0, 500) });
    return r;
  }

  calls.push({ tool: u.name, input, outcome: "unknown_tool" });
  return { text: `Unknown tool ${u.name}`, isError: true };
}

export const codesearchArm: ExtraArm = { tools: codesearchTools, dispatch };
