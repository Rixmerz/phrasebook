// Dumps a stdio MCP server's tool list to JSON: deno run -A src/auto/list_tools.ts <out.json> <cmd> [args...]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const [out, command, ...args] = Deno.args;
const t = new StdioClientTransport({ command, args, stderr: "ignore" });
const c = new Client({ name: "phrasebook", version: "0.1.0" });
await c.connect(t);
const { tools } = await c.listTools();
Deno.writeTextFileSync(out, JSON.stringify(tools, null, 1));
console.log(out, tools.length, "tools:", tools.map((x) => x.name).join(" "));
await c.close();
