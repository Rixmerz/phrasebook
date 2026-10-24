// Generic glossary engine. A declarative command table (one JSON file per
// server, hand-ported or generated) drives parsing; no per-server code.
//
// A command line is a bag of words plus values:
//  - words from the table's vocabulary pick the command, in any order;
//  - key=value pairs fill parameters (renamed per command, coerced by schema);
//  - a target like owner/repo#n fills the command's target parameters;
//  - other bare or quoted tokens fill the command's positional parameters, in order.
import type { McpTool } from "../mcp.ts";

export type Command = {
  words: string[];
  tool: string;
  fixed?: Record<string, unknown>;
  rename?: Record<string, string>;
  positional?: string[];
  target?: { owner?: string; repo?: string; number?: string };
  needs?: "owner" | "repo" | "number";
  // Keys the server's schema leaves out but its API takes, sent through as given (JSON parsed).
  passthrough?: string[];
  usage: string;
  example: string;
};

export type Table = {
  server: string;
  glossary: string;
  // Server instructions: Claude Code shows them even while the tool itself is deferred.
  instructions?: string;
  // "owner/repo#n" style targets (GitHub-like). Without it, only positional values.
  targetStyle: "github" | "none";
  fold: Record<string, string>;
  genericVerbs: string[];
  commands: Command[];
};

export type Call = { tool: string; args: Record<string, unknown> };
export class CommandError extends Error {}

type Token = { text: string; quoted: boolean };
type Prop = { type?: string | string[]; enum?: unknown[]; items?: { type?: string }; anyOf?: Prop[] };

// Splits on newlines outside quotes. Double quotes take \n, \t and \" escapes; single quotes are literal.
export function tokenize(text: string): Token[][] {
  const lines: Token[][] = [];
  let tokens: Token[] = [];
  let cur = "";
  let quoted = false;
  let inQuote: string | null = null;
  let hasTok = false;
  const push = () => {
    if (hasTok) tokens.push({ text: cur, quoted });
    cur = "";
    hasTok = false;
    quoted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      // Single quotes are literal, as in a shell, so JSON with \" inside survives.
      if (ch === "\\" && inQuote === '"' && i + 1 < text.length) {
        const nx = text[++i];
        cur += nx === "n" ? "\n" : nx === "t" ? "\t" : nx;
      } else if (ch === inQuote) inQuote = null;
      else cur += ch;
      continue;
    }
    // key={...} or key=[...]: take the balanced JSON verbatim, so its quotes and spaces survive.
    if ((ch === "{" || ch === "[") && /^[a-z_]\w*=$/i.test(cur)) {
      let depth = 0, str = false, j = i;
      for (; j < text.length; j++) {
        const c = text[j];
        if (str) {
          if (c === "\\") j++;
          else if (c === '"') str = false;
        } else if (c === '"') str = true;
        else if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") {
          if (--depth === 0) break;
        }
      }
      if (depth === 0 && j < text.length) {
        cur += text.slice(i, j + 1);
        hasTok = true;
        i = j;
        continue;
      }
    }
    if (ch === '"' || ch === "'") {
      // Only a token that starts with a quote is a quoted value; key="v" stays a key=value.
      if (!hasTok) quoted = true;
      inQuote = ch;
      hasTok = true;
    } else if (ch === "\n") {
      push();
      if (tokens.length) lines.push(tokens);
      tokens = [];
    } else if (ch === " " || ch === "\t") push();
    else {
      cur += ch;
      hasTok = true;
    }
  }
  if (inQuote) throw new CommandError('Unclosed quote. Close every " you open.');
  push();
  if (tokens.length) lines.push(tokens);
  return lines.filter((l) => !(l[0].text.startsWith("#") && !l[0].quoted));
}

function propType(p: Prop | undefined): string | undefined {
  if (!p) return undefined;
  if (Array.isArray(p.type)) return p.type.find((t) => t !== "null");
  if (p.type) return p.type;
  return p.anyOf?.map(propType).find((t) => t && t !== "null");
}

function coerce(raw: string, prop: Prop | undefined, key: string): unknown {
  const t = propType(prop);
  let v: unknown = raw;
  if (t === "number" || t === "integer") {
    const n = Number(raw.replace(/^#/, ""));
    if (Number.isNaN(n)) throw new CommandError(`${key} must be a number, got "${raw}"`);
    v = n;
  } else if (t === "boolean") v = /^(true|yes|1)$/i.test(raw);
  else if (t === "array") {
    const items = prop?.items ?? prop?.anyOf?.find((a) => a.items)?.items;
    if (items?.type === "object" || raw.trim().startsWith("[")) {
      try {
        v = JSON.parse(raw);
      } catch {
        throw new CommandError(`${key} must be a JSON array, e.g. ${key}='[{"a":"b"}]'`);
      }
    } else v = raw.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (t === "object" || (!t && raw.trim().startsWith("{"))) {
    try {
      v = JSON.parse(raw);
    } catch {
      throw new CommandError(`${key} must be a JSON object, e.g. ${key}={"a":"b"}`);
    }
  }
  // Enum values: accept any case, send the schema's spelling.
  if (typeof v === "string" && prop?.enum) {
    const hit = prop.enum.find((e) => typeof e === "string" && e.toLowerCase() === (v as string).toLowerCase());
    if (hit !== undefined) v = hit;
  }
  return v;
}

export function compile(table: Table, tools: McpTool[]) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const fold = (w: string) => table.fold[w.toLowerCase()] ?? w.toLowerCase();
  const bagKey = (words: string[]) => words.map(fold).sort().join(" ");
  const bags = new Map(table.commands.map((c) => [bagKey(c.words), c]));
  const vocab = new Set([...table.commands.flatMap((c) => c.words.map(fold)), ...table.genericVerbs.map(fold)]);
  const generic = new Set(table.genericVerbs.map(fold));
  const isKv = (t: Token) => !t.quoted && /^[a-z_][\w]*=/i.test(t.text);
  const isWord = (t: Token) => !t.quoted && vocab.has(fold(t.text));
  const targetRe = /^([\w.-]+)\/([\w.-]+)(?:#(\d+))?$/;

  function resolve(words: string[]): Command | null {
    const exact = bags.get(bagKey(words));
    if (exact) return exact;
    // Drop one generic verb ("get pr files" -> "pr files").
    const i = words.findIndex((w) => generic.has(fold(w)));
    if (i >= 0 && words.length > 1) {
      const hit = bags.get(bagKey(words.filter((_, j) => j !== i)));
      if (hit) return hit;
    }
    // One word short ("read <id>" for "read page <id>"): take it only when a single command fits.
    const mine = new Set(words.map(fold));
    const fits = mine.size ? table.commands.filter((c) => c.words.length === mine.size + 1 && [...mine].every((w) => c.words.map(fold).includes(w))) : [];
    return new Set(fits.map((c) => c.tool)).size === 1 ? fits[0] : null;
  }

  function closest(words: string[]) {
    const mine = new Set(words.map(fold));
    return table.commands
      .map((c) => {
        const theirs = new Set(c.words.map(fold));
        const inter = [...mine].filter((w) => theirs.has(w)).length;
        return { c, score: inter / (mine.size + theirs.size - inter || 1) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ c }) => c.usage);
  }

  function parseLine(tokens: Token[]): Call {
    const clean = tokens.filter((t) => t.quoted || t.text !== "|");
    const words = clean.filter(isWord).map((t) => t.text);
    const cmd = resolve(words);
    if (!cmd) throw new CommandError(`Unknown command "${words.join(" ")}". Closest commands:\n  ${closest(words).join("\n  ")}`);
    const tool = byName.get(cmd.tool);
    if (!tool) throw new CommandError(`"${cmd.tool}" is not enabled on this server.`);
    const props = ((tool.inputSchema as { properties?: Record<string, Prop> }).properties ?? {});
    const required = ((tool.inputSchema as { required?: string[] }).required ?? []);
    const args: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cmd.fixed ?? {})) args[k] = typeof v === "string" ? coerce(v, props[k], k) : v;

    const positional = [...(cmd.positional ?? [])];
    const internal = new Set([...Object.keys(cmd.fixed ?? {}), ...Object.values(cmd.target ?? {})]);
    let targetSeen = false;
    for (const t of clean) {
      if (isWord(t)) continue;
      if (isKv(t)) {
        const eq = t.text.indexOf("=");
        const key = t.text.slice(0, eq);
        const param = cmd.rename?.[key] ?? key;
        if (cmd.passthrough?.includes(key) && !(param in props)) {
          args[key] = coerce(t.text.slice(eq + 1), undefined, key);
          continue;
        }
        if (!(param in props) || internal.has(param)) {
          const allowed = [...Object.keys(props).filter((p) => !internal.has(p))
            .map((p) => Object.entries(cmd.rename ?? {}).find(([, v]) => v === p)?.[0] ?? p), ...(cmd.passthrough ?? [])];
          throw new CommandError(`Unknown key "${key}". Valid keys: ${allowed.join(", ")}. Usage: ${cmd.usage}`);
        }
        args[param] = coerce(t.text.slice(eq + 1), props[param], key);
        continue;
      }
      const m = table.targetStyle === "github" && !t.quoted ? t.text.match(targetRe) : null;
      if (m && !targetSeen && cmd.target) {
        targetSeen = true;
        if (cmd.target.owner) args[cmd.target.owner] = m[1];
        if (cmd.target.repo) args[cmd.target.repo] = m[2];
        if (m[3] !== undefined && cmd.target.number) args[cmd.target.number] = Number(m[3]);
        else if (m[3] !== undefined) throw new CommandError(`This command takes no #number. Usage: ${cmd.usage}`);
        continue;
      }
      // A bare owner, for commands that need only an owner.
      if (!targetSeen && cmd.needs === "owner" && cmd.target?.owner && /^[\w.-]+$/.test(t.text) && !t.quoted) {
        targetSeen = true;
        args[cmd.target.owner] = t.text;
        continue;
      }
      const slot = positional.shift();
      if (!slot) throw new CommandError(`Unexpected "${t.text}". Values go as key=value; quote values with spaces. Usage: ${cmd.usage}`);
      args[slot] = coerce(t.text, props[slot], slot);
    }

    if (cmd.needs && cmd.target?.owner && args[cmd.target.owner] === undefined) throw new CommandError(`Missing target. Usage: ${cmd.usage}`);
    if ((cmd.needs === "repo" || cmd.needs === "number") && cmd.target?.repo && args[cmd.target.repo] === undefined) {
      throw new CommandError(`Missing <owner>/<repo>. Usage: ${cmd.usage}`);
    }
    if (cmd.needs === "number" && cmd.target?.number && args[cmd.target.number] === undefined) {
      throw new CommandError(`Missing #<number>. Usage: ${cmd.usage}`);
    }
    const missing = required.filter((r) => args[r] === undefined);
    if (missing.length) {
      const names = missing.map((p) => Object.entries(cmd.rename ?? {}).find(([, v]) => v === p)?.[0] ?? p);
      throw new CommandError(`Missing ${names.join(", ")}. Usage: ${cmd.usage}`);
    }
    return { tool: cmd.tool, args };
  }

  const parse = (text: string): Call[] => tokenize(text).map(parseLine);
  return { parse, fold, bagKey };
}

export function glossaryToolOf(table: Table) {
  return {
    name: table.server.replace(/[^a-zA-Z0-9_-]/g, "_"),
    description: table.glossary,
    input_schema: {
      type: "object" as const,
      properties: { command: { type: "string", description: "One or more commands, one per line." } },
      required: ["command"],
    },
  };
}

export const loadTable = (path: string): Table => JSON.parse(Deno.readTextFileSync(path));
