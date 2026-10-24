// Glossary v3 engine for GitHub. It sits in front of the v2 parser and adds:
//  - literal blocks (key<<EOF ... EOF, exact bytes, trailing newline kept);
//  - verb macros (close, reopen, comment);
//  - references to earlier results (@n, @n.path, @n[*].path) and fan-out over #@n[*].number;
//  - list arithmetic (labels+=x, labels-=x, assignees+=x) on issues;
//  - `all` to fetch every page, and a pipeline (| where | select | sort | top | group | count);
//  - `form <command>` with enum values and the repository's real labels, assignees and branches;
//  - compact output (tables), and in "feedback" mode, footers with what was applied and next commands,
//    and errors with ready-to-send corrections.
import type { McpTool } from "../mcp.ts";
import type { Call, Session } from "../suites.ts";
import { ALL_SPECS, CommandError, splitCommands } from "../github/parser.ts";
import { specBags } from "../github/parser_v2.ts";
import { compactTable, flatten } from "./compact.ts";
import { type Json, render, rowsOf, simplify, table } from "./format.ts";
import { PipelineError, runPipeline } from "./pipeline.ts";

export type Mode = "legend" | "feedback" | "v4";
type Ref = { line: string; data: Json; content?: string };
// seen: hints already given in this run (v4 gives each one once).
export type V3State = { refs: Ref[]; seen?: Set<string> };
type Log = (entry: { tool: string; input: unknown; outcome: string; detail?: string }) => void;

const MAX_PAGES = 30;

// Quote a token for the v2 tokenizer: only backslash, quote, newline and tab need escapes.
function quote(s: string): string {
  if (s !== "" && !/[\s"'\\|]/.test(s)) return s;
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t") + '"';
}
// key=value tokens quote only the value (key="a b"): both the GitHub and the generic tokenizers read that form.
const join = (tokens: string[]) =>
  tokens.map((t) => {
    const m = t.match(/^([a-z_][\w.]*)=([\s\S]*)$/i);
    return m ? `${m[1]}=${quote(m[2])}` : quote(t);
  }).join(" ");

// key<<TAG on a line, then lines up to a line that is exactly TAG: the value keeps every byte plus a final newline.
export function expandLiterals(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    // key<<EOF keeps a final newline; key<<EOF! leaves it out.
    const m = lines[i].match(/^(.*?)(\b[a-z_]+)<<([A-Za-z_]+)(!?)\s*$/);
    if (!m) {
      out.push(lines[i]);
      continue;
    }
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && lines[j] !== m[3]; j++) body.push(lines[j]);
    if (j >= lines.length) throw new CommandError(`Literal block ${m[2]}<<${m[3]} is not closed: end it with a line containing only ${m[3]}.`);
    out.push(`${m[1]}${m[2]}=${quote(body.join("\n") + (m[4] ? "" : "\n"))}`);
    i = j;
  }
  return out.join("\n");
}

const FOLD: Record<string, string> = { issues: "issue", prs: "pr", "pull-request": "pr", pull: "pr", comments: "comment" };
const fold = (w: string) => FOLD[w.toLowerCase()] ?? w.toLowerCase();

// close / reopen / comment, written the way people say them.
function macro(tokens: string[]): string[] {
  // "add comment T body=..." is the same as "comment T body=...".
  if (tokens[0]?.toLowerCase() === "add" && fold(tokens[1] ?? "") === "comment") tokens = ["comment", ...tokens.slice(2)];
  const [verb, maybeNoun, ...rest] = tokens;
  const v = verb?.toLowerCase();
  if (!["close", "reopen", "comment"].includes(v)) return tokens;
  const nounGiven = ["issue", "pr"].includes(fold(maybeNoun ?? ""));
  const noun = nounGiven ? fold(maybeNoun) : "issue";
  const args = nounGiven ? rest : [maybeNoun, ...rest].filter((x) => x !== undefined);
  if (v === "comment") return ["add", "issue", "comment", ...args];
  const reason = args.find((a) => /^reason=/.test(a));
  const others = args.filter((a) => a !== reason);
  if (v === "reopen") return ["update", noun, ...others, "state=open"];
  if (noun === "pr") return ["update", "pr", ...others, "state=closed"];
  return ["update", "issue", ...others, "state=closed", `state_reason=${reason ? reason.slice(7) : "completed"}`];
}

function refValue(st: V3State, expr: string): Json | string {
  const m = expr.match(/^@(\d+)(\[\*\])?(?:\.?([\w.]+))?$/);
  if (!m) throw new CommandError(`Bad reference "${expr}". Use @n, @n.field or @n[*].field.`);
  const ref = st.refs[Number(m[1]) - 1];
  if (!ref) throw new CommandError(`No result @${m[1]} yet. Results so far: ${st.refs.length ? `@1 to @${st.refs.length}` : "none"}.`);
  if (!m[2] && !m[3]) return ref.content ?? ref.data;
  if (m[2]) {
    const rows = rowsOf(ref.data)?.rows ?? [];
    return rows.map((r) => (m[3] ? pick(r, m[3]) : r)) as Json;
  }
  return pick(ref.content !== undefined ? { ...(ref.data as Record<string, Json>), content: ref.content } : ref.data, m[3]!);
}
function pick(v: Json, path: string): Json {
  let cur: Json = v;
  for (const p of path.split(".")) cur = cur && typeof cur === "object" && !Array.isArray(cur) ? (cur as Record<string, Json>)[p] ?? null : null;
  return cur;
}

// A JSON value whose strings were unescaped by the tokenizer (real newlines inside strings)
// is turned back into valid JSON before it reaches the v2 parser.
export function repairJson(s: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr && c === "\\") {
      out += c + (s[++i] ?? "");
      continue;
    }
    if (c === '"') inStr = !inStr;
    out += inStr && c === "\n" ? "\\n" : inStr && c === "\t" ? "\\t" : inStr && c === "\r" ? "\\r" : c;
  }
  return out;
}

// Turn a resolved reference into one command token.
function asToken(key: string, v: Json | string): string {
  if (typeof v === "string") return `${key}=${v}`;
  if (Array.isArray(v) && v.every((x) => typeof x !== "object" || x === null)) return `${key}=${v.join(",")}`;
  if (v === null || typeof v !== "object") return `${key}=${String(v)}`;
  return `${key}=${JSON.stringify(v)}`;
}

function parseResult(tool: string, text: string): { data: Json; content?: string } {
  // get_file_contents answers with a status line, then the file bytes.
  if (tool === "get_file_contents") {
    const m = text.match(/^successfully downloaded [^\n]*\n([\s\S]*)$/);
    const sha = text.match(/^successfully downloaded [^\n]*\(SHA: ([0-9a-f]+)\)/)?.[1] ?? null;
    // Keep the SHA: updating an existing file needs it (sha=@n.sha).
    if (m) return { data: { sha }, content: m[1] };
  }
  try {
    return { data: simplify(JSON.parse(text)) };
  } catch {
    return { data: text };
  }
}

type Paging = { kind: "cursor" | "page"; perKey: string };
function pagingOf(tool: McpTool | undefined): Paging | null {
  const p = (tool?.inputSchema?.properties ?? {}) as Record<string, unknown>;
  if (!("perPage" in p)) return null;
  if ("after" in p && tool!.name === "list_issues") return { kind: "cursor", perKey: "perPage" };
  if ("page" in p) return { kind: "page", perKey: "perPage" };
  return null;
}

// Fetch every page, merging the records into one result of the same shape.
async function fetchAll(session: Session, call: Call, paging: Paging, log: Log): Promise<{ text: string; isError: boolean; pages: number }> {
  const merged: Json[] = [];
  let first: Record<string, unknown> | Json[] | null = null;
  let key = "items";
  let after: string | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const args = { ...call.args, [paging.perKey]: 100, ...(paging.kind === "page" ? { page } : after ? { after } : {}) };
    const r = await session.call(call.tool, args);
    log({ tool: call.tool, input: args, outcome: r.isError ? "backend_error" : "ok", detail: r.isError ? r.text : undefined });
    if (r.isError) return { ...r, pages: page };
    let data: Json;
    try {
      data = JSON.parse(r.text);
    } catch {
      return { text: r.text, isError: false, pages: page };
    }
    first ??= data as Record<string, unknown>;
    const found = rowsOf(data);
    if (!found) return { text: r.text, isError: false, pages: page };
    key = found.key;
    merged.push(...found.rows);
    const info = (data as Record<string, Record<string, unknown>>)?.pageInfo;
    if (paging.kind === "cursor") {
      if (!info?.hasNextPage) return done(page);
      after = String(info.endCursor);
    } else if (found.rows.length < 100) return done(page);
  }
  return done(MAX_PAGES);

  function done(pages: number) {
    const out = Array.isArray(first) ? merged : { ...(first as Record<string, unknown>), [key]: merged, pageInfo: { hasNextPage: false } };
    return { text: JSON.stringify(out), isError: false, pages };
  }
}

// Defaults the tool applies silently: shown to the model in feedback mode.
function appliedDefaults(call: Call): string[] {
  const a = call.args;
  const out: string[] = [];
  if (call.tool === "list_issues") {
    if (!a.state) out.push("state: OPEN only (default); add state=closed for closed ones");
    if (!a.direction) out.push("order: newest first (default); add direction=asc for oldest first");
  }
  if (call.tool === "list_pull_requests") {
    if (!a.state) out.push("state: open only (default); add state=closed or state=all");
    if (!a.direction) out.push("order: newest first (default); add direction=asc for oldest first");
  }
  if (call.tool === "list_commits") out.push("order: newest first");
  if (/^search_/.test(call.tool) && !/is:(open|closed)/.test(String(a.query ?? ""))) out.push("search covers open and closed items unless the query says is:open or is:closed");
  return out;
}

function footer(call: Call, line: string, raw: Json, n: number, didAll: boolean, piped: boolean): string[] {
  const out: string[] = [];
  const found = rowsOf(raw);
  if (found && !piped) {
    const r = raw as Record<string, Record<string, unknown> | number>;
    const total = typeof r.totalCount === "number" ? r.totalCount : typeof r.total_count === "number" ? r.total_count : null;
    const more = !didAll && ((r.pageInfo as Record<string, unknown>)?.hasNextPage === true ||
      (total !== null && total > found.rows.length) || (total === null && found.rows.length >= Number(call.args.perPage ?? 30)));
    out.push(`shown: ${found.rows.length}${total !== null ? ` of ${total}` : ""}${more ? " (more exist)" : ""}`);
    if (more) out.push(`every page at once: ${line} all`);
  }
  out.push(...appliedDefaults(call));
  if (found && found.rows.length && typeof (found.rows[0] as Record<string, Json>)?.number === "number") {
    const target = `${call.args.owner}/${call.args.repo}`;
    const noun = /pull/.test(call.tool) ? "pr" : "issue";
    out.push(`act on every row: update ${noun} ${target}#@${n}[*].number <key=value ...>`);
    if (!piped) out.push(`filter or count here: ${line}${didAll ? "" : " all"} | where <field> <op> <value> | count`);
  }
  return out.map((l) => "-> " + l);
}

// v4: conventions once per run; paging hints only when rows are missing; next steps once.
function footerV4(st: V3State, call: Call, line: string, raw: Json, n: number, didAll: boolean, piped: boolean, notes: string[]): string[] {
  const seen = st.seen ??= new Set();
  const once = (key: string, text: string) => {
    if (seen.has(key)) return [];
    seen.add(key);
    return [text];
  };
  const out: string[] = [...notes];
  const found = rowsOf(raw);
  if (found && !piped) {
    const r = raw as Record<string, Record<string, unknown> | number>;
    const total = typeof r.totalCount === "number" ? r.totalCount : typeof r.total_count === "number" ? r.total_count : null;
    const more = !didAll && ((r.pageInfo as Record<string, unknown>)?.hasNextPage === true ||
      (total !== null && total > found.rows.length) || (total === null && found.rows.length >= Number(call.args.perPage ?? 30)));
    if (more) out.push(`only ${found.rows.length}${total !== null ? ` of ${total}` : ""} shown; every page at once: ${line} all`);
    if (!found.rows.length) out.push(...appliedDefaults(call));
    else for (const d of appliedDefaults(call)) out.push(...once(d, d));
  }
  if (found && found.rows.length && typeof (found.rows[0] as Record<string, Json>)?.number === "number") {
    const target = `${call.args.owner}/${call.args.repo}`;
    const noun = /pull/.test(call.tool) ? "pr" : "issue";
    out.push(...once("act", `act on every row: update ${noun} ${target}#@${n}[*].number <key=value ...>`));
    if (!piped) out.push(...once("pipe", `filter or count here: ${line}${didAll ? "" : " all"} | where <field> <op> <value> | count`));
  }
  return out.map((l) => "-> " + l);
}

// v4: an issue or PR (top-level number) is one record even when it holds an empty list like assignees: [].
const isRecord = (v: Json) => !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as Record<string, Json>).number === "number";
const listOf = (mode: Mode, v: Json) => (mode === "v4" && isRecord(v) ? null : rowsOf(v));
// v4: plain text (file contents, logs, command output) pipes as one row per line: | where line contains ERROR
const textRows = (v: Json | string | undefined): Json[] | null =>
  typeof v === "string" ? v.replace(/\n$/, "").split("\n").map((line) => ({ line })) : null;
// Stages that keep whole records (filters, sorts) still print compactly; select and the like print what was asked.
const keepsRecords = (stages: string[][]) => stages.every((s) => ["where", "sort", "top", "first", "limit"].includes((s[0] ?? "").toLowerCase()));

// v4: owner=o repo=r, or repo=o/r, become the o/r target the commands expect.
function targetFromKeys(cmd: string[]): string[] {
  if (cmd.some((t) => /^[\w.-]+\/[\w.-]+(#.*)?$/.test(t))) return cmd;
  const repo = cmd.find((t) => /^repo=/.test(t))?.slice(5);
  const owner = cmd.find((t) => /^owner=/.test(t))?.slice(6);
  const full = repo?.includes("/") ? repo : owner && repo ? `${owner}/${repo}` : null;
  if (!full) return cmd;
  const num = cmd.find((t) => /^(number|issue_number|pullNumber)=\d+$/.test(t))?.split("=")[1];
  const rest = cmd.filter((t) => !/^(repo|owner|number|issue_number|pullNumber)=/.test(t));
  const at = rest.findIndex((t) => t.includes("="));
  const target = num ? `${full}#${num}` : full;
  return at < 0 ? [...rest, target] : [...rest.slice(0, at), target, ...rest.slice(at)];
}

// v4: list_issues has no ALL state; fetch open and closed and merge them.
async function bothStates(session: Session, call: Call, paging: Paging | null, log: Log): Promise<{ text: string; isError: boolean }> {
  const rows: Json[] = [];
  let shape: Record<string, Json> | null = null;
  let key = "issues";
  for (const state of ["OPEN", "CLOSED"]) {
    const c = { ...call, args: { ...call.args, state } };
    const r = paging ? await fetchAll(session, c, paging, log) : await session.call(c.tool, c.args);
    if (!paging) log({ tool: c.tool, input: c.args, outcome: r.isError ? "backend_error" : "ok" });
    if (r.isError) return r;
    const data = JSON.parse(r.text);
    const found = rowsOf(data);
    if (!found) return r;
    key = found.key;
    shape ??= data;
    rows.push(...found.rows);
  }
  return { text: JSON.stringify(Array.isArray(shape) ? rows : { ...shape, [key]: rows }), isError: false };
}

// v4.2: fields a list leaves out (state_reason on issue lists) are filled in by fetching each
// record, when a pipeline step names them. Capped so a typo cannot fan out without end.
const MAX_HYDRATE = 300;
async function hydrate(session: Session, call: Call, rows: Json[], stages: string[][], log: Log): Promise<string | null> {
  const recs = rows.filter((r): r is Record<string, Json> => !!r && typeof r === "object" && !Array.isArray(r));
  if (!recs.length || typeof recs[0].number !== "number") return null;
  const getter = call.tool === "list_issues" ? "issue_read" : call.tool === "list_pull_requests" ? "pull_request_read" : null;
  if (!getter) return null;
  const named = new Set<string>();
  for (const [op, ...args] of stages) {
    const o = (op ?? "").toLowerCase();
    if (o === "select") args.join(",").split(",").forEach((f) => f.trim() && named.add(f.trim().split(".")[0]));
    else if (["where", "sort", "group", "sum", "avg", "min", "max", "distinct"].includes(o) && args[0]) named.add(args[0].split(".")[0]);
  }
  const missing = [...named].filter((f) => recs.every((r) => !(f in r)));
  if (!missing.length || recs.length > MAX_HYDRATE) return null;
  for (const r of recs) {
    const args = getter === "issue_read"
      ? { method: "get", owner: call.args.owner, repo: call.args.repo, issue_number: r.number }
      : { method: "get", owner: call.args.owner, repo: call.args.repo, pullNumber: r.number };
    const got = await session.call(getter, args);
    log({ tool: getter, input: args, outcome: got.isError ? "backend_error" : "ok" });
    if (got.isError) continue;
    const full = flatten(simplify(JSON.parse(got.text))) as Record<string, Json>;
    for (const f of missing) r[f] = full[f] ?? null;
  }
  return `${missing.join(", ")} is not in list results: read from each of the ${recs.length} records`;
}

// v4.2: edit file o/r path=P [branch=B] old="..." new="..." [message=M]: exact replacement of one occurrence.
async function editFile(session: Session, tokens: string[], parse: (c: string) => Call[], log: Log): Promise<string> {
  const kv = new Map<string, string>();
  for (const t of tokens.slice(2)) {
    const i = t.indexOf("=");
    if (i > 0) kv.set(t.slice(0, i), t.slice(i + 1));
  }
  const target = tokens.slice(2).find((t) => !t.includes("=") && t.includes("/"));
  const path = kv.get("path"), oldText = kv.get("old"), newText = kv.get("new");
  if (!target || !path || oldText === undefined || newText === undefined) {
    throw new CommandError('Usage: edit file <owner>/<repo> path=<file> [branch=<b>] old="<exact text>" new="<text>" [message=<m>]');
  }
  const branch = kv.get("branch");
  const [read] = parse(join(["get", "file", target, `path=${path}`, ...(branch ? [`ref=${branch}`] : [])]));
  const r = await session.call(read.tool, read.args);
  log({ tool: read.tool, input: read.args, outcome: r.isError ? "backend_error" : "ok" });
  if (r.isError) throw new CommandError(r.text);
  const { data, content } = parseResult(read.tool, r.text);
  if (content === undefined) throw new CommandError(`${path} is not a file.`);
  const hits = content.split(oldText).length - 1;
  if (hits !== 1) throw new CommandError(`old= text found ${hits} times in ${path}; it must match exactly once. Include more of the line to make it unique.`);
  const sha = (data as Record<string, Json>)?.sha;
  const write = ["write", "file", target, `path=${path}`, ...(branch ? [`branch=${branch}`] : []),
    `message=${kv.get("message") ?? `Edit ${path}`}`, `content=${content.replace(oldText, newText)}`, ...(sha ? [`sha=${sha}`] : [])];
  const [w] = parse(join(write));
  const wr = await session.call(w.tool, w.args);
  log({ tool: w.tool, input: { ...w.args, content: "(edited)" }, outcome: wr.isError ? "backend_error" : "ok" });
  if (wr.isError) throw new CommandError(wr.text);
  return `edited ${path}${branch ? ` on ${branch}` : ""}: 1 replacement, rest of the file unchanged`;
}

// v4.3: long text shows its head only; the whole text stays in @n for pipes and content=@n.
const TEXT_MAX_LINES = 40;
const TEXT_HEAD = 15;
function clip(text: string, n: number, full: boolean): string {
  const lines = text.replace(/\n$/, "").split("\n");
  if (full || lines.length <= TEXT_MAX_LINES) return text;
  return `${lines.slice(0, TEXT_HEAD).join("\n")}\n... ${lines.length - TEXT_HEAD} more lines (${lines.length} in all) kept in @${n}: ` +
    `@${n} | where line contains <text> | count, or add full to the command to print everything`;
}

const isRead = (tool: string) => /^(get_|list_|search_)|_read$/.test(tool);

// v4: list filters the tool does not take become client-side where steps over every page.
function lowerFilters(tokens: string[], parse: (c: string) => Call[]): { tokens: string[]; stages: string[][]; notes: string[] } {
  const stages: string[][] = [];
  const notes: string[] = [];
  let cur = tokens;
  for (let tries = 0; tries < 4; tries++) {
    try {
      parse(join(cur));
      return { tokens: cur, stages, notes };
    } catch (e) {
      const m = e instanceof CommandError && e.message.match(/^Unknown key "([\w.]+)" for "(list|search)/);
      const tok = m && cur.find((t) => t.startsWith(`${m[1]}=`));
      if (!m || !tok) throw e;
      const value = tok.slice(m[1].length + 1);
      cur = cur.filter((t) => t !== tok);
      stages.push(["where", m[1], value === "" ? "empty" : "=", ...(value === "" ? [] : [value])]);
      notes.push(`${m[1]} is not a server filter: applied as | where ${m[1]} = ${value} over every page`);
    }
  }
  return { tokens: cur, stages, notes };
}

async function liveOptions(session: Session, owner: string, repo: string, kind: string): Promise<string> {
  const r = await session.call("ui_get", { method: kind, owner, repo });
  if (r.isError) return "(unavailable)";
  try {
    const d = simplify(JSON.parse(r.text));
    const rows = Array.isArray(d) ? d : (Object.values(d as Record<string, Json>).find(Array.isArray) as Json[] | undefined) ?? [];
    return rows.map((x) => (typeof x === "object" && x ? String((x as Record<string, Json>).name ?? (x as Record<string, Json>).login ?? JSON.stringify(x)) : String(x))).join(", ");
  } catch {
    return r.text.slice(0, 300);
  }
}

// form <command words> [owner/repo[#n]]: the command's keys, enum values and live options.
async function form(session: Session, tools: McpTool[], tokens: string[]): Promise<string> {
  const words = tokens.filter((t) => !t.includes("/") && !t.includes("="));
  const target = tokens.find((t) => t.includes("/"));
  const bag = words.map(fold).sort().join(" ");
  const key = specBags().find(([b]) => b === bag)?.[1];
  if (!key || !ALL_SPECS[key === "add pr comment" ? "add issue comment" : key]) {
    throw new CommandError(`form: no command "${words.join(" ")}". Example: form update issue octo/app#4`);
  }
  const spec = ALL_SPECS[key === "add pr comment" ? "add issue comment" : key];
  const tool = tools.find((t) => t.name === spec.tool);
  const props = (tool?.inputSchema.properties ?? {}) as Record<string, { enum?: string[]; type?: string; description?: string }>;
  const lines = [`${key}: ${spec.usage}`];
  const [owner, repo] = (target ?? "").split("#")[0].split("/");
  for (const [p, s] of Object.entries(props)) {
    if (["owner", "repo", "method", spec.numberAs].includes(p) || p in (spec.fixed ?? {})) continue;
    const name = Object.entries(spec.rename ?? {}).find(([, v]) => v === p)?.[0] ?? p;
    let options = s.enum ? s.enum.join(" | ") : s.type ?? "";
    if (owner && repo && ["labels", "assignees"].includes(p)) options = `${await liveOptions(session, owner, repo, p)} (list; += adds, -= removes)`;
    if (owner && repo && ["head", "base", "branch", "from_branch"].includes(p)) options = `branch: ${await liveOptions(session, owner, repo, "branches")}`;
    lines.push(`  ${name} = ${options}`);
  }
  return lines.join("\n");
}

// The v3 interpreter for one tool call (possibly several lines).
export async function runV3(
  mode: Mode, text: string, session: Session, st: V3State,
  parse: (command: string) => Call[], log: Log,
): Promise<{ text: string; isError: boolean }> {
  const outputs: string[] = [];
  let anyError = false;
  let lines: string[][];
  try {
    lines = splitCommands(expandLiterals(text));
  } catch (e) {
    if (e instanceof CommandError) return { text: e.message, isError: true };
    throw e;
  }

  // v4.2: lines run in order and stop at the first error, so a failed step is not built on.
  let skipped = 0;
  for (const rawTokens of lines) {
    if (mode === "v4" && anyError) {
      skipped++;
      continue;
    }
    const pipeAt = rawTokens.indexOf("|");
    let cmd = pipeAt >= 0 ? rawTokens.slice(0, pipeAt) : rawTokens;
    const stages: string[][] = [];
    if (pipeAt >= 0) {
      let curStage: string[] = [];
      for (const t of rawTokens.slice(pipeAt + 1)) {
        if (t === "|") {
          stages.push(curStage);
          curStage = [];
        } else curStage.push(t);
      }
      stages.push(curStage);
    }
    try {
      if (cmd[0]?.toLowerCase() === "form") {
        outputs.push(await form(session, session.tools, cmd.slice(1)));
        log({ tool: "form", input: join(cmd), outcome: "ok" });
        continue;
      }
      if (mode === "v4" && cmd[0]?.toLowerCase() === "edit" && fold(cmd[1] ?? "") === "file" && session.tools.some((t) => t.name === "get_file_contents")) {
        const msg = await editFile(session, targetFromKeys(cmd), parse, log);
        st.refs.push({ line: join(cmd), data: msg });
        outputs.push(`@${st.refs.length}\n${msg}`);
        continue;
      }
      // calc <expression over numbers and results>, e.g. calc @1 / @2 * 100
      if (cmd[0]?.toLowerCase() === "calc") {
        const value = calc(cmd.slice(1).join(" "), st);
        st.refs.push({ line: join(cmd), data: value });
        outputs.push(`@${st.refs.length}\n${value}`);
        log({ tool: "calc", input: join(cmd), outcome: "ok" });
        continue;
      }
      // A pipeline over an earlier result: @3 | where ... | count
      if (/^@\d+$/.test(cmd[0] ?? "") && cmd.length === 1) {
        const src = st.refs[Number(cmd[0].slice(1)) - 1];
        if (!src) throw new CommandError(`No result ${cmd[0]} yet.`);
        const rows = listOf(mode, src.data)?.rows ?? (Array.isArray(src.data) ? src.data
          : mode === "v4" && src.data && typeof src.data === "object" ? [src.data] : mode === "v4" ? textRows(src.content ?? src.data) : null);
        if (!rows) throw new PipelineError(`${cmd[0]} has no list to pipe into.`);
        const out = runPipeline(rows, stages, (x) => refValue(st, x) as Json);
        st.refs.push({ line: join(rawTokens), data: Array.isArray(out) ? { items: out } : out });
        outputs.push(`@${st.refs.length}\n${typeof out === "number" ? out : table("items", out as Json[])}`);
        log({ tool: "pipeline", input: join(rawTokens), outcome: "ok" });
        continue;
      }
      cmd = macro(cmd);
      if (mode === "v4") cmd = targetFromKeys(cmd);
      const wantAll = cmd.some((t) => t.toLowerCase() === "all");
      const wantFull = mode === "v4" && cmd.some((t) => t.toLowerCase() === "full");
      if (wantFull) cmd = cmd.filter((t) => t.toLowerCase() !== "full");
      cmd = cmd.filter((t) => t.toLowerCase() !== "all");
      let notes: string[] = [];
      let forceAll = false;
      if (mode === "v4" && /^(list|search)$/i.test(cmd[0] ?? "")) {
        const lowered = lowerFilters(cmd, parse);
        if (lowered.stages.length) {
          cmd = lowered.tokens;
          stages.unshift(...lowered.stages);
          notes = lowered.notes;
          forceAll = true;
        }
      }
      // v4 batched get: owner/repo#1,5,9 runs the command once per number.
      const batchIdx = mode === "v4" ? cmd.findIndex((t) => /^[\w.-]+\/[\w.-]+#\d+(,\d+)+$/.test(t)) : -1;

      // Fan-out: owner/repo#@n[*].number becomes one command per value.
      const fanIdx = cmd.findIndex((t) => /#@\d+/.test(t));
      const variants: string[][] = [];
      if (batchIdx >= 0) {
        const [base, nums] = cmd[batchIdx].split("#");
        for (const v of nums.split(",")) variants.push(cmd.map((t, i) => (i === batchIdx ? `${base}#${v}` : t)));
      } else if (fanIdx >= 0) {
        const [base, expr] = cmd[fanIdx].split("#");
        const vals = refValue(st, expr);
        const numOf = (v: Json | string) => (v && typeof v === "object" && !Array.isArray(v) && "number" in v ? (v as Record<string, Json>).number : v);
        for (const v of (Array.isArray(vals) ? vals : [vals]).map(numOf)) variants.push(cmd.map((t, i) => (i === fanIdx ? `${base}#${v}` : t)));
      } else variants.push(cmd);

      const results: { data: Json; content?: string; raw: Json; call: Call }[] = [];
      for (let variant of variants) {
        // Value references: key=@n...
        variant = variant.map((t) => {
          const m = t.match(/^([a-z_]+)=(@\d+.*)$/i);
          return m ? asToken(m[1], refValue(st, m[2])) : t;
        });
        // List arithmetic on an issue: labels+=x, assignees-=y.
        const arith = variant.filter((t) => /^(labels|assignees)[+-]=/.test(t));
        if (arith.length) {
          const target = variant.find((t) => /^[\w.-]+\/[\w.-]+#\d+$/.test(t));
          if (!target) throw new CommandError("labels+= and assignees+= need an issue target like owner/repo#12.");
          const [owner, rest] = target.split("/");
          const [repo, num] = rest.split("#");
          const cur = await session.call("issue_read", { owner, repo, issue_number: Number(num), method: "get" });
          log({ tool: "issue_read", input: { owner, repo, issue_number: Number(num) }, outcome: cur.isError ? "backend_error" : "ok" });
          // The issue must exist before its lists change; pass GitHub's error back instead of crashing.
          if (cur.isError) throw new CommandError(`${target}: ${cur.text}`);
          const now = simplify(JSON.parse(cur.text)) as Record<string, Json>;
          variant = variant.filter((t) => !arith.includes(t));
          for (const key of ["labels", "assignees"]) {
            const ops = arith.filter((t) => t.startsWith(key));
            if (!ops.length) continue;
            let list = ((now[key] as Json[]) ?? []).map(String);
            for (const op of ops) {
              const vals = op.slice(key.length + 2).split(",").map((s) => s.trim()).filter(Boolean);
              list = op[key.length] === "+" ? [...new Set([...list, ...vals])] : list.filter((x) => !vals.includes(x));
            }
            variant.push(`${key}=${list.join(",")}`);
          }
        }
        variant = variant.map((t) => {
          const m = t.match(/^([a-z_]+)=([[{][\s\S]*)$/i);
          return m ? `${m[1]}=${repairJson(m[2])}` : t;
        });
        const calls = parse(join(variant));
        for (const call of calls) {
          const paging = wantAll || forceAll ? pagingOf(session.tools.find((t) => t.name === call.tool)) : null;
          const r = mode === "v4" && call.tool === "list_issues" && /^all$/i.test(String(call.args.state ?? ""))
            ? await bothStates(session, call, paging, log)
            : paging ? await fetchAll(session, call, paging, log) : await session.call(call.tool, call.args);
          if (!paging) log({ tool: call.tool, input: call.args, outcome: r.isError ? "backend_error" : "ok", detail: r.isError ? r.text : undefined });
          if (r.isError) {
            anyError = true;
            outputs.push(r.text);
            continue;
          }
          let raw: Json;
          try {
            raw = JSON.parse(r.text);
          } catch {
            raw = r.text;
          }
          results.push({ ...parseResult(call.tool, r.text), raw, call });
        }
      }

      if (variants.length > 1 && mode === "v4" && results.length && results.every((r) => isRead(r.call.tool))) {
        let rows = results.map((r) => flatten(r.content !== undefined ? { ...(r.data as Record<string, Json>), content: r.content } : r.data));
        if (stages.length) {
          const out = runPipeline(rows, stages, (x) => refValue(st, x) as Json);
          rows = Array.isArray(out) ? out : [out];
          st.refs.push({ line: join(cmd), data: Array.isArray(out) ? { items: out } : out });
          outputs.push(`@${st.refs.length}\n${typeof out === "number" ? out : keepsRecords(stages) ? compactTable("items", rows) : table("items", rows)}`);
        } else {
          st.refs.push({ line: join(cmd), data: { items: rows } });
          outputs.push(`@${st.refs.length}\n${compactTable("items", rows)}`);
        }
        continue;
      }
      if (variants.length > 1) {
        const done = results.map((r) => String(r.call.args.issue_number ?? r.call.args.pullNumber ?? "?"));
        st.refs.push({ line: join(cmd), data: { items: done.map((n) => ({ number: Number(n), ok: true })) } });
        outputs.push(`@${st.refs.length}\ndone on ${results.length} of ${variants.length}: #${done.join(" #")}`);
        continue;
      }
      for (const res of results) {
        if (mode === "v4") res.data = flatten(res.data);
        st.refs.push({ line: join(cmd), data: res.data, content: res.content });
        const n = st.refs.length;
        let body: string;
        if (stages.length) {
          // v4: a single object pipes as a one-row list (get issue ... | select title,user).
          const rows = listOf(mode, res.data)?.rows ?? (mode === "v4" && res.data && typeof res.data === "object" ? [res.data] : null) ??
            (mode === "v4" ? textRows(res.content ?? res.data) : null);
          if (!rows) throw new PipelineError("This result has no list to pipe into.");
          if (mode === "v4") {
            const note = await hydrate(session, res.call, rows, stages, log);
            if (note) notes.push(note);
          }
          const out = runPipeline(rows, stages, (x) => refValue(st, x) as Json);
          st.refs[n - 1].data = Array.isArray(out) ? { items: out } : out;
          body = typeof out === "number" ? `${stages.at(-1)?.[0] ?? "value"}: ${out}`
            : mode === "v4" && keepsRecords(stages) ? compactTable("items", out as Json[]) : table("items", out as Json[]);
        } else if (mode === "v4" && res.content === undefined && listOf(mode, res.data)) {
          body = renderV4(res.data);
        } else if (mode === "v4" && typeof res.data === "string") {
          body = clip(res.data, n, wantFull); // plain text as is, not JSON-escaped
        } else body = res.content !== undefined ? (mode === "v4" ? clip(res.content, n, wantFull) : res.content) : render(res.data);
        const sha = res.content !== undefined ? (res.data as Record<string, Json>)?.sha : null;
        const head = res.content !== undefined
          ? `@${n} = file bytes${sha ? `, sha ${sha} (to overwrite this file add sha=@${n}.sha)` : ""}; pass them on exactly with content=@${n}`
          : `@${n}`;
        // After a pipeline that ends in a single number there are no rows to act on.
        const scalar = stages.length > 0 && typeof st.refs[n - 1].data === "number";
        const foot = scalar ? notes.map((l) => "-> " + l)
          : mode === "v4" ? footerV4(st, res.call, join(cmd), res.raw, n, wantAll || forceAll, stages.length > 0, notes)
          : mode === "feedback" ? footer(res.call, join(cmd), res.raw, n, wantAll, stages.length > 0) : [];
        if (mode !== "legend" && res.content !== undefined && !res.content.endsWith("\n")) {
          foot.push(`-> this file does not end with a newline: copy it with content=@${n}, or end a literal block with EOF! to leave the newline out`);
        }
        outputs.push([head, body, ...foot].join("\n"));
      }
    } catch (e) {
      if (!(e instanceof CommandError || e instanceof PipelineError)) throw e;
      anyError = true;
      log({ tool: "glossary", input: join(rawTokens), outcome: "parse_error", detail: e.message });
      outputs.push(mode !== "legend" ? withCorrections(e.message, rawTokens, parse) : e.message);
    }
  }
  if (skipped) outputs.push(`stopped after the error: ${skipped} later line(s) not run; fix it and send them again`);
  return { text: outputs.join("\n---\n"), isError: anyError };
}

// Arithmetic over numbers and scalar results: + - * / ( ), e.g. calc @1 / @2 * 100
export function calc(expr: string, st: V3State): number {
  const src = expr.replace(/@\d+(?:\.[\w.]+)?/g, (r) => {
    const v = refValue(st, r);
    const n = typeof v === "number" ? v : Number(Array.isArray(v) ? v.length : v);
    if (Number.isNaN(n)) throw new CommandError(`calc: ${r} is not a number.`);
    return String(n);
  });
  if (!/^[\d\s.+\-*/()]+$/.test(src)) throw new CommandError("calc takes numbers, results (@n) and + - * / ( ) only.");
  const toks = src.match(/\d+(?:\.\d+)?|[-+*/()]/g) ?? [];
  let i = 0;
  const num = (): number => {
    const t = toks[i++];
    if (t === "(") {
      const v = add();
      i++;
      return v;
    }
    if (t === "-") return -num();
    const n = Number(t);
    if (Number.isNaN(n)) throw new CommandError(`calc: unexpected "${t}".`);
    return n;
  };
  const mul = (): number => {
    let v = num();
    while (toks[i] === "*" || toks[i] === "/") v = toks[i++] === "*" ? v * num() : v / num();
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (toks[i] === "+" || toks[i] === "-") v = toks[i++] === "+" ? v + mul() : v - mul();
    return v;
  };
  const v = add();
  return Math.round(v * 10000) / 10000;
}

// Feedback mode: offer up to two corrected commands that actually parse.
function withCorrections(message: string, tokens: string[], parse: (c: string) => Call[]): string {
  const words = tokens.filter((t) => !t.includes("=") && !t.includes("/") && t !== "|" && !t.startsWith("@"));
  const rest = tokens.filter((t) => t.includes("=") || t.includes("/"));
  const mine = new Set(words.map(fold));
  const ranked = specBags().map(([, k]) => {
    const theirs = new Set(k.split(" ").map(fold));
    const inter = [...mine].filter((w) => theirs.has(w)).length;
    return { k, score: inter / (mine.size + theirs.size - inter || 1) };
  }).sort((a, b) => b.score - a.score).slice(0, 12);
  const ok: string[] = [];
  const hasNumber = rest.some((t) => /#\d+$/.test(t));
  for (const { k } of ranked) {
    const spec = ALL_SPECS[k === "add pr comment" ? "add issue comment" : k];
    // A #n target only fits commands that act on one issue or PR, and the other way round.
    if (spec && (spec.needs === "number") !== hasNumber) continue;
    const candidate = join([...k.split(" "), ...rest]);
    try {
      parse(candidate);
      ok.push(candidate);
    } catch { /* not a valid correction */ }
    if (ok.length === 2) break;
  }
  return ok.length ? `${message}\nReady to send:\n  ${ok.join("\n  ")}` : message;
}

// v4: an object holding a list prints its scalar fields, then the list as a compact table.
function renderV4(v: Json): string {
  const found = rowsOf(v)!;
  if (Array.isArray(v)) return compactTable("items", found.rows);
  const lines: string[] = [];
  for (const [k, x] of Object.entries(v as Record<string, Json>)) {
    if (k === found.key) lines.push(compactTable(k, found.rows));
    else if (k !== "pageInfo" && (x === null || typeof x !== "object")) lines.push(`${k}: ${x}`);
  }
  return lines.join("\n");
}
