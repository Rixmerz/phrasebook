// Notion suite: the real @notionhq/notion-mcp-server, pointed at the in-process mock with
// BASE_URL. Each run gets its own token, so its own seeded workspace.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpTool } from "../mcp.ts";
import type { Suite, ToolResult } from "../suites.ts";
import { compile, CommandError, glossaryToolOf, type Table } from "../auto/engine.ts";
import { stripDialect } from "../auto/validate.ts";
import { endRun, mockUrl, newRun } from "./mock.ts";
import type { State } from "./seed.ts";

export type NotionTask = { id: string; prompt: string; check: (s: State, finalText: string) => boolean; writes?: boolean };

export const NOTION_SERVER = ["-y", "@notionhq/notion-mcp-server@2.5.2"];
export const NOTION_SYSTEM =
  "You work in the Acme product team's Notion workspace through the provided tool(s). " +
  "Complete the user's request, then reply briefly. When asked for a specific answer, give only that answer.";

export async function startNotion(token: string) {
  const transport = new StdioClientTransport({
    command: "npx", args: NOTION_SERVER, stderr: "ignore",
    env: { PATH: Deno.env.get("PATH") ?? "", HOME: Deno.env.get("HOME") ?? "", NOTION_TOKEN: token, BASE_URL: mockUrl() },
  });
  const client = new Client({ name: "phrasebook", version: "0.1.0" });
  await client.connect(transport);
  const tools = stripDialect((await client.listTools()).tools as McpTool[]);
  async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { type: string; text?: string }[]).map((c) => c.text ?? `[${c.type}]`).join("\n");
    return { text, isError: Boolean(res.isError) };
  }
  return { tools, call, close: () => client.close() };
}

export function makeNotionSuite(name: string, tasks: NotionTask[], table: Table | null): Suite | null {
  if (!table) return null;
  let engine: ReturnType<typeof compile> | null = null;
  return {
    name,
    system: NOTION_SYSTEM,
    taskIds: tasks.map((t) => t.id),
    promptOf: (id) => tasks.find((t) => t.id === id)!.prompt,
    glossaryTool: glossaryToolOf(table),
    parse: (command, tools) => (engine ??= compile(table, tools)).parse(command),
    isCommandError: (e: unknown): e is Error => e instanceof CommandError,
    async start(taskId) {
      const task = tasks.find((t) => t.id === taskId)!;
      const token = `ntn_run_${crypto.randomUUID()}`;
      newRun(token);
      const server = await startNotion(token);
      return {
        tools: server.tools,
        call: server.call,
        async finish(finalText) {
          await server.close();
          const run = endRun(token);
          return { success: task.check(run.state, finalText), harnessGaps: run.gaps };
        },
      };
    },
    async listTools() {
      const token = "ntn_list_only";
      newRun(token);
      const s = await startNotion(token);
      await s.close();
      endRun(token);
      return s.tools;
    },
  };
}
