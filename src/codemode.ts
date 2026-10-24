// Arm C: code mode. The model gets one `execute` tool whose description is a
// TypeScript API generated from the MCP schemas, and writes code against it.
import type { McpTool } from "./mcp.ts";

export const CODE_TOOL_NAME = "execute";
const RUNNER = new URL("./sandbox_runner.ts", import.meta.url).pathname;
const CALL = "\u0000CALL ";
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 20_000;

type Schema = { type?: string | string[]; enum?: unknown[]; anyOf?: Schema[]; oneOf?: Schema[]; properties?: Record<string, Schema>; items?: Schema; required?: string[]; description?: string };

function tsType(s: Schema | undefined): string {
  if (!s) return "unknown";
  // Enums matter: GitHub tools pick sub-operations through a `method` enum.
  if (s.enum?.length) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  // Unions and nullable types (e.g. the git server's optional parameters).
  const alts = s.anyOf ?? s.oneOf;
  if (alts?.length) return [...new Set(alts.map(tsType))].join(" | ");
  if (Array.isArray(s.type)) return [...new Set(s.type.map((t) => tsType({ ...s, type: t })))].join(" | ");
  if (s.type === "null") return "null";
  if (s.type === "string") return "string";
  if (s.type === "number" || s.type === "integer") return "number";
  if (s.type === "boolean") return "boolean";
  if (s.type === "array") return `${tsType(s.items)}[]`;
  if (s.type === "object" || s.properties) {
    const req = new Set(s.required ?? []);
    const fields = Object.entries(s.properties ?? {}).map(
      ([k, v]) => `${v.description ? `/** ${v.description.replace(/\*\//g, "")} */ ` : ""}${k}${req.has(k) ? "" : "?"}: ${tsType(v)}`,
    );
    return `{ ${fields.join("; ")} }`;
  }
  return "unknown";
}

const ident = (n: string) => /^[A-Za-z_$][\w$]*$/.test(n);

export function codeTool(tools: McpTool[]) {
  const api = tools
    .map((t) => `  /** ${t.description ?? ""} */\n  ${ident(t.name) ? t.name : JSON.stringify(t.name)}(args: ${tsType(t.inputSchema as Schema)}): Promise<any>;`)
    .join("\n");
  // Names such as "API-post-search" are not identifiers: say how to call them.
  const quotedNote = tools.some((t) => !ident(t.name))
    ? `Tool names that are not identifiers are called with brackets, e.g. await tools["${tools.find((t) => !ident(t.name))!.name}"]({...}).\n\n`
    : "";
  return {
    name: CODE_TOOL_NAME,
    description:
      "Run JavaScript (an async function body) against the knowledge graph API below. " +
      "Only what you console.log comes back to you. No network or filesystem.\n\n" +
      `declare const tools: {\n${api}\n};\n\n` + quotedNote +
      'Example: const g = await tools.search_nodes({ query: "Ana" }); console.log(JSON.stringify(g));',
    input_schema: {
      type: "object" as const,
      properties: { code: { type: "string", description: "Body of an async function. Use await." } },
      required: ["code"],
    },
  };
}

export type ToolCaller = (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>;

// Runs model code in a permissionless Deno subprocess and bridges tool calls.
export async function runCode(code: string, callTool: ToolCaller, onCall: (name: string, args: unknown, isError: boolean, text: string) => void) {
  const child = new Deno.Command("deno", {
    args: ["run", "--no-prompt", "--quiet", "--v8-flags=--max-old-space-size=128", RUNNER],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    clearEnv: true,
    env: { PATH: Deno.env.get("PATH") ?? "", HOME: Deno.env.get("HOME") ?? "" },
  }).spawn();
  const writer = child.stdin.getWriter();
  const enc = new TextEncoder();
  await writer.write(enc.encode(JSON.stringify({ code }) + "\n"));

  const out: string[] = [];
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }, TIMEOUT_MS);

  const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.startsWith(CALL)) {
          const { name, args } = JSON.parse(line.slice(CALL.length));
          const r = await callTool(name, args ?? {});
          onCall(name, args, r.isError, r.text);
          await writer.write(enc.encode(JSON.stringify(r) + "\n"));
        } else out.push(line);
      }
    }
  } finally {
    clearTimeout(timer);
    try { await writer.close(); } catch { /* child exited */ }
  }
  const status = await child.status;
  const stderr = new TextDecoder().decode((await new Response(child.stderr).arrayBuffer()));
  if (buf) out.push(buf);
  let text = out.join("\n");
  if (timedOut) text += `\nError: timed out after ${TIMEOUT_MS / 1000}s`;
  if (!status.success && stderr) text += `\n${stderr.slice(0, 2000)}`;
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + "\n[output truncated]";
  const isError = timedOut || !status.success || /^Error: /m.test(text);
  return { text: text || "(no output: use console.log)", isError };
}
