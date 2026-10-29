// Ablation arms for the paper: native MCP tools with one ingredient of the glossary added,
// so the saving can be split between the command language and the rest.
// - native-compact: native tools; JSON results shaped as the glossary shapes them
//   (noise fields dropped, users and labels collapsed, lists as tables), without hiding
//   any field, since native has no `| select` to bring one back.
// - native-trimmed: native tools with each description cut to its first sentence and
//   parameter descriptions removed; names, types, enums and required keys stay.
// - native-trimmed-compact: both.
import type Anthropic from "@anthropic-ai/sdk";
import { Ajv } from "ajv";
import type { CallLog, ExtraArm } from "../arms_extra.ts";
import type { McpTool } from "../mcp.ts";
import type { Session } from "../suites.ts";
import { flatten } from "../v3/compact.ts";
import { type Json, render, simplify } from "../v3/format.ts";

type Schema = Record<string, unknown>;

export function firstSentence(text: string): string {
  const para = text.trim().split(/\n\s*\n/)[0].replace(/\s+/g, " ");
  const m = para.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : para).trim();
}

// Drops every `description` (and `title`/`examples`) inside a JSON schema, keeping its shape.
export function stripSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(stripSchema);
  if (!s || typeof s !== "object") return s;
  const out: Schema = {};
  for (const [k, v] of Object.entries(s as Schema)) {
    if (k === "description" || k === "title" || k === "examples") continue;
    // Under `properties` the keys are parameter names, which must all stay.
    out[k] = k === "properties" && v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Schema).map(([p, x]) => [p, stripSchema(x)]))
      : stripSchema(v);
  }
  return out;
}

export function trimTools(tools: McpTool[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: firstSentence(t.description ?? ""),
    input_schema: stripSchema(t.inputSchema) as Anthropic.Tool.InputSchema,
  }));
}

const asNative = (tools: McpTool[]): Anthropic.Tool[] =>
  tools.map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema as Anthropic.Tool.InputSchema }));

// Lossless shaping of a tool result: JSON is simplified and printed as key lines and tables;
// anything else (plain text, errors) passes through unchanged.
export function compactResult(text: string): string {
  let data: Json;
  try {
    data = JSON.parse(text);
  } catch {
    return text;
  }
  if (data === null || typeof data !== "object") return text;
  return render(flatten(simplify(data)));
}

const ajv = new Ajv({ strict: false });
const validators = new WeakMap<McpTool, ReturnType<typeof ajv.compile>>();

function ablationArm(trim: boolean, compact: boolean): ExtraArm {
  const arm: ExtraArm = { tools: (mcp) => (trim ? trimTools(mcp) : asNative(mcp)) };
  if (compact) {
    // Same validation as the native arm in bench.ts, then the shaped result.
    arm.dispatch = async (u: Anthropic.ToolUseBlock, session: Session, calls: CallLog[]) => {
      const input = u.input as Record<string, unknown>;
      const tool = session.tools.find((t) => t.name === u.name);
      if (!tool) {
        calls.push({ tool: u.name, input, outcome: "unknown_tool" });
        return { text: `Unknown tool ${u.name}`, isError: true };
      }
      let validate = validators.get(tool);
      if (!validate) validators.set(tool, validate = ajv.compile(tool.inputSchema));
      if (!validate(input)) {
        const detail = ajv.errorsText(validate.errors);
        calls.push({ tool: u.name, input, outcome: "schema_violation", detail });
        return { text: `Invalid input: ${detail}`, isError: true };
      }
      const r = await session.call(u.name, input);
      calls.push({ tool: u.name, input, outcome: r.isError ? "backend_error" : "ok", detail: r.isError ? r.text : undefined });
      return r.isError ? r : { text: compactResult(r.text), isError: false };
    };
  }
  return arm;
}

export const nativeCompactArm = ablationArm(false, true);
export const nativeTrimmedArm = ablationArm(true, false);
export const nativeTrimmedCompactArm = ablationArm(true, true);
