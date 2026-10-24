// Arm B: one tool that takes a controlled-language command string.
// The parser is deterministic and dispatches to the real MCP tools,
// so both arms hit exactly the same backend.

type Call = { tool: string; args: Record<string, unknown> };

export const GLOSSARY_TOOL_NAME = "memory";

export const GLOSSARY_DESCRIPTION = `Knowledge graph. Send one command per line.

Glossary:
- entity: a named node with a type (person, company, project...) and observations.
- observation: a short fact stored on an entity, as a quoted string.
- relation: a directed, active-voice link: <from> <relation_type> <to>.
- graph: everything stored.

Commands:
  create entity <name> type=<type> ["observation" ...]
  add observation <entity> "text" ["text" ...]
  relate <from> <relation_type> <to>
  delete entity <name> [<name> ...]          (also removes its relations)
  delete observation <entity> "text" ["text" ...]
  delete relation <from> <relation_type> <to>
  search <words>                             (matches names, types, observations)
  open <name> [<name> ...]
  read graph

Quote names or values that contain spaces: create entity "Ana Diaz" type=person "works at Mecha"
Example: relate Ana works_at Mecha`;

export const glossaryTool = {
  name: GLOSSARY_TOOL_NAME,
  description: GLOSSARY_DESCRIPTION,
  input_schema: {
    type: "object" as const,
    properties: {
      command: { type: "string", description: "One or more commands, one per line." },
    },
    required: ["command"],
  },
};

// Shell-like split that keeps quoted strings together.
function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export class CommandError extends Error {}

const USAGE: Record<string, string> = {
  "create entity": 'create entity <name> type=<type> ["observation" ...]',
  "add observation": 'add observation <entity> "text" ["text" ...]',
  relate: "relate <from> <relation_type> <to>",
  "delete entity": "delete entity <name> [<name> ...]",
  "delete observation": 'delete observation <entity> "text" ["text" ...]',
  "delete relation": "delete relation <from> <relation_type> <to>",
  search: "search <words>",
  open: "open <name> [<name> ...]",
  "read graph": "read graph",
};

function usageError(key: string, problem: string): never {
  throw new CommandError(`${problem}. Usage: ${USAGE[key]}`);
}

export function parseLine(line: string): Call {
  const t = tokenize(line.trim());
  const verb = (t[0] ?? "").toLowerCase();
  const noun = (t[1] ?? "").toLowerCase().replace(/s$/, "");

  if (verb === "create" && noun === "entity") {
    const name = t[2];
    if (!name) usageError("create entity", "Missing entity name");
    const typeTok = t.slice(3).find((x) => x.startsWith("type="));
    if (!typeTok) usageError("create entity", `Missing type= for "${name}"`);
    const observations = t.slice(3).filter((x) => x !== typeTok);
    return {
      tool: "create_entities",
      args: { entities: [{ name, entityType: typeTok.slice(5), observations }] },
    };
  }
  if (verb === "add" && noun === "observation") {
    const [entityName, ...contents] = t.slice(2);
    if (!entityName || contents.length === 0) usageError("add observation", "Missing entity or text");
    return { tool: "add_observations", args: { observations: [{ entityName, contents }] } };
  }
  if (verb === "relate") {
    const [from, relationType, to, ...rest] = t.slice(1);
    if (!to || rest.length) usageError("relate", "Expected exactly three words");
    return { tool: "create_relations", args: { relations: [{ from, relationType, to }] } };
  }
  if (verb === "delete" && noun === "entity") {
    const entityNames = t.slice(2);
    if (!entityNames.length) usageError("delete entity", "Missing entity name");
    return { tool: "delete_entities", args: { entityNames } };
  }
  if (verb === "delete" && noun === "observation") {
    const [entityName, ...observations] = t.slice(2);
    if (!entityName || !observations.length) usageError("delete observation", "Missing entity or text");
    return { tool: "delete_observations", args: { deletions: [{ entityName, observations }] } };
  }
  if (verb === "delete" && noun === "relation") {
    const [from, relationType, to, ...rest] = t.slice(2);
    if (!to || rest.length) usageError("delete relation", "Expected exactly three words");
    return { tool: "delete_relations", args: { relations: [{ from, relationType, to }] } };
  }
  if (verb === "search") {
    const query = t.slice(1).join(" ");
    if (!query) usageError("search", "Missing words");
    return { tool: "search_nodes", args: { query } };
  }
  if (verb === "open") {
    const names = t.slice(1);
    if (!names.length) usageError("open", "Missing name");
    return { tool: "open_nodes", args: { names } };
  }
  if (verb === "read" && noun === "graph") return { tool: "read_graph", args: {} };

  throw new CommandError(
    `Unknown command "${t.slice(0, 2).join(" ")}". Valid commands:\n` +
      Object.values(USAGE).map((u) => "  " + u).join("\n"),
  );
}

export function parseCommand(command: string): Call[] {
  return command
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map(parseLine);
}
