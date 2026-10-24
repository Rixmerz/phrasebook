// Definition tokens of the toolsearch and codesearch arms (count_tokens only, free).
// Usage: deno run -A src/arms/count_defs.ts
import Anthropic from "@anthropic-ai/sdk";
import { loadEnv } from "../env.ts";
import { suites } from "../suites.ts";
import { toolsearchTools } from "./toolsearch.ts";
import { codesearchTools } from "./codesearch.ts";

await loadEnv();
const client = new Anthropic();
const models = ["claude-haiku-4-5-20251001", "claude-haiku-5-5", "claude-sonnet-5-5"];
for (const name of ["memory", "github"]) {
  const suite = suites[name];
  const mcp = await suite.listTools();
  for (const model of models) {
    const base = { model, system: suite.system, messages: [{ role: "user" as const, content: "hi" }] };
    const none = (await client.messages.countTokens(base)).input_tokens;
    const count = async (tools: unknown[]) => (await client.messages.countTokens({ ...base, tools } as never)).input_tokens - none;
    console.log(`${name.padEnd(7)} ${model.padEnd(27)} toolsearch=${await count(toolsearchTools(mcp))} codesearch=${await count(codesearchTools(mcp))}`);
  }
}
Deno.exit(0);
