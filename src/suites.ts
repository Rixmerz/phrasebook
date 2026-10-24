// A suite is one MCP server plus its glossary, parser and tasks.
// The bench is generic over suites, so every arm talks to the same backend.
import { type McpTool, startMemoryServer } from "./mcp.ts";
import { CommandError as MemoryCommandError, glossaryTool as memoryGlossaryTool, parseCommand as parseMemory } from "./glossary.ts";
import { type Graph, tasks as memoryTasks } from "./tasks.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMock } from "./github/mock.ts";
import { ghTasks, seed as githubSeed } from "./github/tasks.ts";
import { githubGlossaryTool, githubGlossaryToolV2 } from "./github/glossary.ts";
import { makeParserV2 } from "./github/parser_v2.ts";
import { heldoutSeed, heldoutTasks } from "./github/heldout.ts";
import { hardSeed, hardTasks } from "./github/hard.ts";
import { bulkSeed, bulkTasks } from "./github/bulk.ts";
import { bulk2Seed, bulk2Tasks, exactSeed, exactTasks } from "./github/v3tasks.ts";
import { calcSeed, calcTasks } from "./github/calctasks.ts";
import { blindSeed, blindTasks } from "./github/blindtasks.ts";
import { safetySeed, safetyTasks } from "./github/safetytasks.ts";
import type { GhTask } from "./github/tasks.ts";
import type { State } from "./github/mock.ts";
import { CommandError as GithubCommandError, makeParser } from "./github/parser.ts";

import { extraSuites } from "./suites_extra.ts";

export type ToolResult = { text: string; isError: boolean };
export type Call = { tool: string; args: Record<string, unknown> };

export type Session = {
  tools: McpTool[];
  call: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  // Closes the server and returns whether the task succeeded.
  finish: (finalText: string) => Promise<{ success: boolean; harnessGaps: string[] }>;
};

type GlossaryTool = { name: string; description: string; input_schema: { type: "object"; properties: Record<string, unknown>; required: string[] } };

export type Suite = {
  name: string;
  system: string;
  taskIds: string[];
  promptOf: (taskId: string) => string;
  glossaryTool: GlossaryTool;
  parse: (command: string, tools: McpTool[]) => Call[];
  // Optional second glossary version, run as arm "glossary2".
  glossaryTool2?: GlossaryTool;
  parse2?: (command: string, tools: McpTool[]) => Call[];
  isCommandError: (e: unknown) => e is Error;
  start: (taskId: string) => Promise<Session>;
  // Tool list without a task, for counting definition tokens.
  listTools: () => Promise<McpTool[]>;
};

function writeSeed(path: string, g: Graph) {
  const lines = [
    ...g.entities.map((e) => JSON.stringify({ type: "entity", ...e })),
    ...g.relations.map((r) => JSON.stringify({ type: "relation", ...r })),
  ];
  Deno.writeTextFileSync(path, lines.join("\n"));
}

function readGraph(path: string): Graph {
  const g: Graph = { entities: [], relations: [] };
  let text = "";
  try {
    text = Deno.readTextFileSync(path);
  } catch {
    return g;
  }
  for (const line of text.split("\n").filter(Boolean)) {
    const { type, ...rest } = JSON.parse(line);
    if (type === "entity") g.entities.push(rest);
    else if (type === "relation") g.relations.push(rest);
  }
  return g;
}

export const memorySuite: Suite = {
  name: "memory",
  system:
    "You manage a knowledge graph through the provided tool(s). Complete the user's request, " +
    "then reply briefly. When asked for a specific answer, give only that answer.",
  taskIds: memoryTasks.map((t) => t.id),
  promptOf: (id) => memoryTasks.find((t) => t.id === id)!.prompt,
  glossaryTool: memoryGlossaryTool,
  parse: (command) => parseMemory(command),
  isCommandError: (e): e is Error => e instanceof MemoryCommandError,
  async start(taskId) {
    const task = memoryTasks.find((t) => t.id === taskId)!;
    const dir = Deno.makeTempDirSync({ prefix: "glosa-" });
    const memFile = `${dir}/memory.jsonl`;
    writeSeed(memFile, task.seed);
    const server = await startMemoryServer(memFile);
    return {
      tools: server.tools,
      call: server.call,
      async finish(finalText) {
        await server.close();
        const success = task.check(readGraph(memFile), finalText);
        Deno.removeSync(dir, { recursive: true });
        return { success, harnessGaps: [] };
      },
    };
  },
  async listTools() {
    const dir = Deno.makeTempDirSync({ prefix: "glosa-" });
    const s = await startMemoryServer(`${dir}/m.jsonl`);
    await s.close();
    Deno.removeSync(dir, { recursive: true });
    return s.tools;
  },
};

const GH_BINARY = new URL("../vendor/github-mcp/github-mcp-server", import.meta.url).pathname;
// Port 0: the OS picks a free port, so several bench processes can run at once.
let mockPort = 0;
let githubParser: ReturnType<typeof makeParser> | null = null;

export async function startGithubServer(token: string, toolsets = "default") {
  if (!mockPort) mockPort = (startMock(0).addr as Deno.NetAddr).port;
  const transport = new StdioClientTransport({
    command: GH_BINARY,
    // Exactly the default toolsets: the 46 tools the glossary covers.
    args: ["stdio", `--toolsets=${toolsets}`, `--gh-host=http://127.0.0.1:${mockPort}`],
    env: { PATH: Deno.env.get("PATH") ?? "", GITHUB_PERSONAL_ACCESS_TOKEN: token },
    stderr: "ignore",
  });
  const client = new Client({ name: "glosa", version: "0.1.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { type: string; text?: string; resource?: { text?: string } }[])
      .map((c) => c.text ?? c.resource?.text ?? "")
      .join("\n");
    return { text, isError: Boolean(res.isError) };
  }
  return { tools: tools as McpTool[], call, close: () => client.close() };
}

export const mockFetch = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${mockPort}${path}`, { ...init, headers: { authorization: `token ${token}` } }).then((r) => r.json());

export function makeGithubSuite(name: string, tasks: GhTask[], seedFn: () => State): Suite {
  let v2: ReturnType<typeof makeParserV2> | null = null;
  return {
  name,
  system:
    "You work on GitHub through the provided tool(s). Complete the user's request, " +
    "then reply briefly. When asked for a specific answer, give only that answer.",
  taskIds: tasks.map((t) => t.id),
  promptOf: (id) => tasks.find((t) => t.id === id)!.prompt,
  glossaryTool: githubGlossaryTool,
  parse(command, tools) {
    githubParser ??= makeParser(tools);
    return githubParser(command);
  },
  glossaryTool2: githubGlossaryToolV2,
  parse2(command, tools) {
    v2 ??= makeParserV2(tools);
    return v2(command);
  },
  isCommandError: (e): e is Error => e instanceof GithubCommandError,
  async start(taskId) {
    const task = tasks.find((t) => t.id === taskId)!;
    const token = `run-${crypto.randomUUID()}`;
    const server = await startGithubServer(token);
    await mockFetch("/__seed", token, { method: "POST", body: JSON.stringify(seedFn()) });
    return {
      tools: server.tools,
      call: server.call,
      async finish(finalText) {
        await server.close();
        const state = await mockFetch("/__state", token);
        const gaps = (await mockFetch("/__unhandled", token)) as string[];
        await mockFetch("/__drop", token);
        return { success: task.check(state, finalText), harnessGaps: gaps };
      },
    };
  },
  async listTools() {
    const s = await startGithubServer("list-only");
    await s.close();
    return s.tools;
  },
};
}

export const githubSuite = makeGithubSuite("github", ghTasks, githubSeed);
export const githubHeldoutSuite = makeGithubSuite("github-heldout", heldoutTasks, heldoutSeed);
export const githubHardSuite = makeGithubSuite("github-hard", hardTasks, hardSeed);
export const githubBulkSuite = makeGithubSuite("github-bulk", bulkTasks, bulkSeed);
export const githubBulk2Suite = makeGithubSuite("github-bulk2", bulk2Tasks, bulk2Seed);
export const githubExactSuite = makeGithubSuite("github-exact", exactTasks, exactSeed);
export const githubCalcSuite = makeGithubSuite("github-calc", calcTasks, calcSeed);
export const githubBlindSuite = makeGithubSuite("github-blind", blindTasks, blindSeed);
export const githubSafetySuite = makeGithubSuite("github-safety", safetyTasks, safetySeed);

export const suites: Record<string, Suite> = {
  memory: memorySuite, github: githubSuite, "github-heldout": githubHeldoutSuite,
  "github-hard": githubHardSuite, "github-bulk": githubBulkSuite,
  "github-bulk2": githubBulk2Suite, "github-exact": githubExactSuite, "github-calc": githubCalcSuite, "github-blind": githubBlindSuite, "github-safety": githubSafetySuite,
  ...extraSuites,
};
