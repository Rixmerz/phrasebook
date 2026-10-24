// Extra suites registered by add-on modules (auto-generated glossaries, new servers).
// Owned by the auto-glossary work; each entry is a Suite from ./suites.ts.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpTool } from "./mcp.ts";
import type { Call, Session, Suite, ToolResult } from "./suites.ts";
import { makeGithubSuite, mockFetch, startGithubServer } from "./suites.ts";
import { compile, CommandError, glossaryToolOf, loadTable, type Table } from "./auto/engine.ts";
import { stripDialect } from "./auto/validate.ts";
import { type DiskTask, fsTasks } from "./fs/tasks.ts";
import { seedFs } from "./fs/seed.ts";
import { gitTasks } from "./git/tasks.ts";
import { AGENT_GIT_ENV, seedGit } from "./git/seed.ts";
import { fsBlindTasks, seedFsBlind } from "./fs/blindtasks.ts";
import { gitBlindTasks, seedGitBlind } from "./git/blindtasks.ts";
import { seedSet5, set5Tasks } from "./fs/set5tasks.ts";
import { ghTasks, seed as githubSeed } from "./github/tasks.ts";
import { heldoutSeed, heldoutTasks } from "./github/heldout.ts";
import { bulkSeed, bulkTasks } from "./github/bulk.ts";
import { makeRealSuite } from "./github/real/suite.ts";

const root = new URL("../", import.meta.url).pathname;
const tableAt = (name: string): Table | null => {
  try {
    return loadTable(`${root}glossaries/${name}.json`);
  } catch {
    return null; // not generated yet
  }
};

// Glossary arm driven by a generated table and the generic engine.
function autoGlossary(table: Table) {
  let engine: ReturnType<typeof compile> | null = null;
  return {
    glossaryTool: glossaryToolOf(table),
    parse: (command: string, tools: McpTool[]): Call[] => {
      engine ??= compile(table, tools);
      return engine.parse(command);
    },
    isCommandError: (e: unknown): e is Error => e instanceof CommandError,
  };
}

async function startStdio(command: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  const transport = new StdioClientTransport({
    command, args, cwd, stderr: "ignore",
    env: { PATH: Deno.env.get("PATH") ?? "", HOME: Deno.env.get("HOME") ?? "", ...env },
  });
  const client = new Client({ name: "phrasebook", version: "0.1.0" });
  await client.connect(transport);
  // The bench compiles schemas with ajv (draft-07); drop the "$schema" dialect marker for every arm.
  const tools = stripDialect((await client.listTools()).tools as McpTool[]);
  async function call(name: string, a: Record<string, unknown>): Promise<ToolResult> {
    const res = await client.callTool({ name, arguments: a });
    const text = (res.content as { type: string; text?: string }[]).map((c) => c.text ?? `[${c.type}]`).join("\n");
    return { text, isError: Boolean(res.isError) };
  }
  return { tools, call, close: () => client.close() };
}

type DiskServer = { command: string; args: string[]; env?: Record<string, string> };

function makeDiskSuite(o: {
  name: string; system: string; tasks: DiskTask[]; seed: (dir: string) => void; server: DiskServer; table: string;
}): Suite | null {
  const table = tableAt(o.table);
  if (!table) return null;
  return {
    name: o.name,
    system: o.system,
    taskIds: o.tasks.map((t) => t.id),
    promptOf: (id) => o.tasks.find((t) => t.id === id)!.prompt,
    ...autoGlossary(table),
    async start(taskId): Promise<Session> {
      const task = o.tasks.find((t) => t.id === taskId)!;
      const dir = Deno.makeTempDirSync({ prefix: `phrasebook-${o.name}-` });
      o.seed(dir);
      const server = await startStdio(o.server.command, o.server.args, dir, o.server.env);
      return {
        tools: server.tools,
        call: server.call,
        async finish(finalText) {
          await server.close();
          const success = task.check(dir, finalText);
          Deno.removeSync(dir, { recursive: true });
          return { success, harnessGaps: [] };
        },
      };
    },
    async listTools() {
      const dir = Deno.makeTempDirSync({ prefix: `phrasebook-${o.name}-` });
      o.seed(dir);
      const s = await startStdio(o.server.command, o.server.args, dir, o.server.env);
      await s.close();
      Deno.removeSync(dir, { recursive: true });
      return s.tools;
    },
  };
}

// GitHub suites whose glossary arm uses a generated table instead of the hand-written one.
function githubWithTable(name: string, tableName: string, toolsets: string, tasks = ghTasks, seedFn = githubSeed): Suite | null {
  const table = tableAt(tableName);
  if (!table) return null;
  const base = makeGithubSuite(name, tasks, seedFn);
  const suite: Suite = { ...base, ...autoGlossary(table), glossaryTool2: undefined, parse2: undefined };
  if (toolsets === "default") return suite;
  // Same tasks and fake backend, but the server exposes more toolsets (extra tools are distractors).
  return {
    ...suite,
    async start(taskId) {
      const task = tasks.find((t) => t.id === taskId)!;
      const token = `run-${crypto.randomUUID()}`;
      const server = await startGithubServer(token, toolsets);
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
      const s = await startGithubServer("list-only", toolsets);
      await s.close();
      return s.tools;
    },
  };
}

const candidates: Record<string, Suite | null> = {
  filesystem: makeDiskSuite({
    name: "filesystem",
    system:
      "You work on the files of a project through the provided tool(s). The project is the current directory: " +
      "use relative paths such as notes/todo.md. Complete the user's request, then reply briefly. " +
      "When asked for a specific answer, give only that answer.",
    tasks: fsTasks, seed: seedFs, table: "filesystem-auto",
    server: { command: "deno", args: ["run", "-A", "npm:@modelcontextprotocol/server-filesystem@2.0.0", "."] },
  }),
  git: makeDiskSuite({
    name: "git",
    system:
      'You work on a git repository through the provided tool(s). The repository is the current directory; its path is ".". ' +
      "Complete the user's request, then reply briefly. When asked for a specific answer, give only that answer.",
    tasks: gitTasks, seed: seedGit, table: "git-auto",
    server: { command: "uvx", args: ["mcp-server-git==2026.10.19", "--repository", "."], env: AGENT_GIT_ENV },
  }),
  "filesystem-blind": makeDiskSuite({
    name: "filesystem-blind",
    system:
      "You work on the files of a project through the provided tool(s). The project is the current directory: " +
      "use relative paths such as notes/todo.md. Complete the user's request, then reply briefly. " +
      "When asked for a specific answer, give only that answer.",
    tasks: fsBlindTasks, seed: seedFsBlind, table: "filesystem-auto",
    server: { command: "deno", args: ["run", "-A", "npm:@modelcontextprotocol/server-filesystem@2.0.0", "."] },
  }),
  "filesystem-set5": makeDiskSuite({
    name: "filesystem-set5",
    system:
      "You work on the files of a project through the provided tool(s). The project is the current directory: " +
      "use relative paths such as notes/todo.md. Complete the user's request, then reply briefly. " +
      "When asked for a specific answer, give only that answer.",
    tasks: set5Tasks, seed: seedSet5, table: "filesystem-auto",
    server: { command: "deno", args: ["run", "-A", "npm:@modelcontextprotocol/server-filesystem@2.0.0", "."] },
  }),
  "git-blind": makeDiskSuite({
    name: "git-blind",
    system:
      'You work on a git repository through the provided tool(s). The repository is the current directory; its path is ".". ' +
      "Complete the user's request, then reply briefly. When asked for a specific answer, give only that answer.",
    tasks: gitBlindTasks, seed: seedGitBlind, table: "git-auto",
    server: { command: "uvx", args: ["mcp-server-git==2026.10.19", "--repository", "."], env: AGENT_GIT_ENV },
  }),
  "github-auto": githubWithTable("github-auto", "github-auto", "default"),
  "github-auto-heldout": githubWithTable("github-auto-heldout", "github-auto", "default", heldoutTasks, heldoutSeed),
  // Data-heavy tasks with the generated glossary, to separate the hand glossary's omissions from the format.
  "github-auto-bulk": githubWithTable("github-auto-bulk", "github-auto", "default", bulkTasks, bulkSeed),
  // Real api.github.com, sandbox repo only; needs the token in ~/.config/glosa/env.
  "github-real": Deno.env.get("PHRASEBOOK_REAL") ? makeRealSuite() : null,
  github91: githubWithTable("github91", "github91-auto", "all"),
  "github91-heldout": githubWithTable("github91-heldout", "github91-auto", "all", heldoutTasks, heldoutSeed),
};

export const extraSuites: Record<string, Suite> = Object.fromEntries(
  Object.entries(candidates).filter((e): e is [string, Suite] => e[1] !== null),
);
