import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

// One fresh memory server per run, so no state leaks between runs.
export async function startMemoryServer(memoryFile: string) {
  const transport = new StdioClientTransport({
    command: "deno",
    args: ["run", "-A", "npm:@modelcontextprotocol/server-memory@^1.0.0"],
    env: { ...Deno.env.toObject(), MEMORY_FILE_PATH: memoryFile },
    stderr: "ignore",
  });
  const client = new Client({ name: "glosa", version: "0.1.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();

  async function call(name: string, args: Record<string, unknown>) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { type: string; text?: string }[])
      .map((c) => c.text ?? "")
      .join("\n");
    return { text, isError: Boolean(res.isError) };
  }

  return { tools: tools as McpTool[], call, close: () => client.close() };
}
