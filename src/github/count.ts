// Static cost of tool definitions for the GitHub MCP server: native schemas
// (default and all toolsets) against the glossary tool. Uses count_tokens only.
import Anthropic from "@anthropic-ai/sdk";
import { loadEnv } from "../env.ts";
import { githubGlossaryTool } from "./glossary.ts";

await loadEnv();
const client = new Anthropic();
const models = (Deno.args[0] ?? "claude-haiku-4-5-20251001,claude-haiku-5-5,claude-sonnet-5-5").split(",");

type McpTool = { name: string; description?: string; inputSchema: Anthropic.Tool.InputSchema };
const load = (set: string): Anthropic.Tool[] =>
  (JSON.parse(Deno.readTextFileSync(`vendor/github-mcp/tools-${set}.json`)) as McpTool[]).map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema,
  }));

const sets = { default46: load("default"), all91: load("all") };
const base = { system: "You help with GitHub.", messages: [{ role: "user" as const, content: "hi" }] };

for (const model of models) {
  const none = (await client.messages.countTokens({ model, ...base })).input_tokens;
  const count = async (tools: Anthropic.Tool[]) =>
    (await client.messages.countTokens({ model, ...base, tools })).input_tokens - none;
  const d = await count(sets.default46);
  const a = await count(sets.all91);
  const g = await count([githubGlossaryTool]);
  console.log(
    `${model.padEnd(28)} native(46)=${d}  native(91)=${a}  glossary(46)=${g}  ` +
      `ratio 46: ${(d / g).toFixed(1)}x`,
  );
}
