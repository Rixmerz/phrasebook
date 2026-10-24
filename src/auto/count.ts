// Definition tokens per suite: native tool list vs the suite's glossary tool (count_tokens only).
// Usage: deno run -A src/auto/count.ts suite1,suite2 [model1,model2]
import Anthropic from "@anthropic-ai/sdk";
import { loadEnv } from "../env.ts";
import { suites } from "../suites.ts";

await loadEnv();
const client = new Anthropic();
const names = (Deno.args[0] ?? "").split(",").filter(Boolean);
const models = (Deno.args[1] ?? "claude-haiku-5-5,claude-haiku-4-5-20251001").split(",");
for (const name of names) {
  const suite = suites[name];
  if (!suite) {
    console.log(`${name}: not registered (glossary not generated yet?)`);
    continue;
  }
  const tools = await suite.listTools();
  const native = tools.map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema })) as Anthropic.Tool[];
  for (const model of models) {
    const base = { model, system: suite.system, messages: [{ role: "user" as const, content: "hi" }] };
    const none = (await client.messages.countTokens(base)).input_tokens;
    const n = (await client.messages.countTokens({ ...base, tools: native })).input_tokens - none;
    const g = (await client.messages.countTokens({ ...base, tools: [suite.glossaryTool as Anthropic.Tool] })).input_tokens - none;
    console.log(`${name.padEnd(20)} ${model.padEnd(27)} tools=${tools.length} native=${n} glossary=${g} ratio=${(n / g).toFixed(1)}x`);
  }
}
Deno.exit(0);
