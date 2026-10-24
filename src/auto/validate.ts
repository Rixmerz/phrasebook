// Static checks for a glossary table, run before any API spend.
// Usage: deno run -A src/auto/validate.ts <table.json> <tools.json>
import { Ajv } from "ajv";
import type { McpTool } from "../mcp.ts";
import { compile, type Table } from "./engine.ts";

// ajv speaks draft-07 by default; a "$schema" naming another draft only selects the dialect.
export function stripDialect(tools: McpTool[]): McpTool[] {
  return tools.map((t) => {
    const { $schema: _, ...schema } = t.inputSchema as Record<string, unknown>;
    return { ...t, inputSchema: schema };
  });
}

export function validateTable(table: Table, rawTools: McpTool[]): string[] {
  const tools = stripDialect(rawTools);
  const errors: string[] = [];
  const byName = new Map(tools.map((t) => [t.name, t]));
  const ajv = new Ajv({ strict: false });

  // 1. Every command maps to a real tool, using only real parameters.
  for (const c of table.commands) {
    const tool = byName.get(c.tool);
    const label = `"${c.words.join(" ")}"`;
    if (!tool) {
      errors.push(`${label}: unknown tool "${c.tool}"`);
      continue;
    }
    const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    const used = [
      ...Object.keys(c.fixed ?? {}), ...Object.values(c.rename ?? {}), ...(c.positional ?? []),
      ...Object.values(c.target ?? {}).filter(Boolean) as string[],
    ];
    for (const p of used) if (!(p in props)) errors.push(`${label}: "${c.tool}" has no parameter "${p}"`);
    if (!c.words.length) errors.push(`${label}: no words`);
    if (!c.usage) errors.push(`${label}: no usage`);
    if (c.needs && !c.target) errors.push(`${label}: needs a ${c.needs} but has no target mapping`);
  }

  // 2. Every tool is reachable through at least one command.
  const covered = new Set(table.commands.map((c) => c.tool));
  for (const t of tools) if (!covered.has(t.name)) errors.push(`tool "${t.name}" has no command`);

  // 3. No two commands fold to the same word set (that would make one unreachable).
  let engine: ReturnType<typeof compile> | null = null;
  try {
    engine = compile(table, tools);
  } catch (e) {
    errors.push(`table does not compile: ${(e as Error).message}`);
    return errors;
  }
  const seen = new Map<string, string>();
  for (const c of table.commands) {
    const bag = engine.bagKey(c.words);
    if (seen.has(bag)) errors.push(`"${c.words.join(" ")}" and "${seen.get(bag)}" fold to the same words "${bag}"`);
    else seen.set(bag, c.words.join(" "));
  }
  // 4. Every example parses to its own command's tool and validates against the schema.
  for (const c of table.commands) {
    const label = `"${c.words.join(" ")}"`;
    if (!c.example) {
      errors.push(`${label}: no example`);
      continue;
    }
    try {
      const calls = engine.parse(c.example);
      if (calls.length !== 1) errors.push(`${label}: example yields ${calls.length} calls`);
      const call = calls[0];
      if (call.tool !== c.tool) errors.push(`${label}: example parses to "${call.tool}", expected "${c.tool}"`);
      const tool = byName.get(call.tool);
      if (tool) {
        const v = ajv.compile(tool.inputSchema);
        if (!v(call.args)) errors.push(`${label}: example args invalid: ${ajv.errorsText(v.errors)} ${JSON.stringify(call.args)}`);
      }
    } catch (e) {
      errors.push(`${label}: example "${c.example}" fails: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  return errors;
}

if (import.meta.main) {
  const [tablePath, toolsPath] = Deno.args;
  const errors = validateTable(JSON.parse(Deno.readTextFileSync(tablePath)), JSON.parse(Deno.readTextFileSync(toolsPath)));
  if (errors.length) {
    console.log(`${tablePath}: ${errors.length} problem(s)\n  ${errors.join("\n  ")}`);
    Deno.exit(1);
  }
  console.log(`${tablePath}: OK`);
}
