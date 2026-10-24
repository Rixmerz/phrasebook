// phrasebook proxy: an MCP server that wraps another MCP server and exposes a single
// tool driven by a glossary, instead of the upstream's full tool list.
// Usage (GitHub, hand-written v2 glossary):
//   deno run -A src/proxy.ts --name=github -- <upstream command> [args...]
// The upstream inherits this process's environment.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { parseArgs } from "@std/cli/parse-args";
import type { McpTool } from "./mcp.ts";
import { githubGlossaryToolV2 } from "./github/glossary.ts";
import { makeParserV2 } from "./github/parser_v2.ts";
import { CommandError } from "./github/parser.ts";
import { runV3, type V3State } from "./v3/engine.ts";
import { GITHUB_GLOSSARY_V4 } from "./v3/glossary.ts";
import type { Session } from "./suites.ts";

// --runtime=v4 runs commands through the glossary v4 engine (references, pipelines, compact output).
const flags = parseArgs(Deno.args, { string: ["name", "runtime"], default: { name: "github", runtime: "v2" }, "--": true });
const upstreamCmd = flags["--"] ?? [];
if (!upstreamCmd.length) {
  console.error("Usage: deno run -A src/proxy.ts --name=github -- <upstream command> [args...]");
  Deno.exit(1);
}

const upstream = new Client({ name: "phrasebook-proxy", version: "0.1.0" });
await upstream.connect(new StdioClientTransport({
  command: upstreamCmd[0],
  args: upstreamCmd.slice(1),
  env: Deno.env.toObject(),
  stderr: "ignore",
}));
const { tools } = await upstream.listTools();
const parse = makeParserV2(tools as McpTool[]);

const server = new Server({ name: `phrasebook-${flags.name}`, version: "0.1.0" }, { capabilities: { tools: {} } });

// Claude Code shows the model only the first paragraph of an MCP tool description,
// so the glossary is sent without blank lines.
const v4 = flags.runtime === "v4";
const description = (v4 ? GITHUB_GLOSSARY_V4 : githubGlossaryToolV2.description).replace(/\n\s*\n/g, "\n");
// One proxy process serves one client session, so one reference store.
const v4State: V3State = { refs: [] };
const session: Session = {
  tools: tools as McpTool[],
  async call(name, args) {
    const res = await upstream.callTool({ name, arguments: args });
    const text = (res.content as { text?: string; resource?: { text?: string } }[]).map((x) => x.text ?? x.resource?.text ?? "").join("\n");
    return { text, isError: Boolean(res.isError) };
  },
  finish: () => Promise.resolve({ success: false, harnessGaps: [] }),
};

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [{ name: flags.name, description, inputSchema: githubGlossaryToolV2.input_schema }],
}));

server.setRequestHandler(CallToolRequestSchema, async (req: { params: { arguments?: Record<string, unknown> } }) => {
  const command = (req.params.arguments ?? {}).command;
  if (typeof command !== "string") {
    return { content: [{ type: "text", text: 'Send {"command": "..."}' }], isError: true };
  }
  if (v4) {
    const r = await runV3("v4", command, session, v4State, parse, () => {});
    return { content: [{ type: "text", text: r.text }], isError: r.isError };
  }
  let calls;
  try {
    calls = parse(command);
  } catch (e) {
    if (e instanceof CommandError) return { content: [{ type: "text", text: e.message }], isError: true };
    throw e;
  }
  const out: string[] = [];
  let isError = false;
  for (const c of calls) {
    const res = await upstream.callTool({ name: c.tool, arguments: c.args });
    isError ||= Boolean(res.isError);
    out.push((res.content as { text?: string; resource?: { text?: string } }[]).map((x) => x.text ?? x.resource?.text ?? "").join("\n"));
  }
  return { content: [{ type: "text", text: out.join("\n---\n") }], isError };
});

await server.connect(new StdioServerTransport());
