// In-process mock of the Notion REST API (version 2025-09-03 data sources, plus the 2026
// markdown endpoints), behind the real @notionhq/notion-mcp-server via BASE_URL.
// Each run's bearer token selects its own state. Shapes follow the API reference: rich text
// objects, property values, list envelopes with next_cursor/has_more, and error objects.
// Requests the mock cannot serve faithfully are recorded as harness gaps.
import type { Block, BlockType, DataSource, Page, PropSchema, State, User, Value } from "./seed.ts";
import { seed, uuid } from "./seed.ts";

type Json = Record<string, unknown>;
type Run = { state: State; gaps: string[]; clock: number };
const runs = new Map<string, Run>();

export function newRun(token: string) {
  runs.set(token, { state: seed(), gaps: [], clock: 0 });
}
export function endRun(token: string) {
  const r = runs.get(token)!;
  runs.delete(token);
  return r;
}

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
const invalid = (m: string) => new ApiError(400, "validation_error", m);
const notFound = (id: string) =>
  new ApiError(404, "object_not_found", `Could not find object with ID: ${id}. Make sure the relevant pages and databases are shared with your integration.`);

// Notion accepts IDs with or without dashes.
const norm = (id: string) => id.replace(/-/g, "").toLowerCase();
const now = (r: Run) => new Date(Date.UTC(2026, 9, 24, 12, 0, r.clock++)).toISOString();

const rich = (text: string) =>
  text === "" ? [] : [{
    type: "text", text: { content: text, link: null },
    annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
    plain_text: text, href: null,
  }];
// deno-lint-ignore no-explicit-any
const plain = (rt: any): string => Array.isArray(rt) ? rt.map((t) => t?.plain_text ?? t?.text?.content ?? "").join("") : "";

function userObj(u: User, full = true): Json {
  if (!full) return { object: "user", id: u.id };
  if (u.type === "bot") {
    return { object: "user", id: u.id, name: u.name, avatar_url: null, type: "bot", bot: { owner: { type: "workspace", workspace: true }, workspace_name: "Acme" } };
  }
  return { object: "user", id: u.id, name: u.name, avatar_url: null, type: "person", person: { email: u.email } };
}

const dsOf = (s: State, id: string) => s.dataSources.find((d) => norm(d.id) === norm(id));
const pageOf = (s: State, id: string) => s.pages.find((p) => norm(p.id) === norm(id));
const blockOf = (s: State, id: string) => s.blocks.find((b) => norm(b.id) === norm(id));
const userOf = (s: State, id: string) => s.users.find((u) => norm(u.id) === norm(id));
const titleOf = (s: State, p: Page) => String(p.parent.kind === "data_source" ? p.props[titleProp(dsOf(s, p.parent.id)!).name] ?? "" : p.props.title ?? "");
const titleProp = (d: DataSource) => d.properties.find((x) => x.type === "title")!;
const schemaOf = (s: State, p: Page): PropSchema[] =>
  p.parent.kind === "data_source" ? dsOf(s, p.parent.id)!.properties : [{ id: "title", name: "title", type: "title" }];
const url = (title: string, id: string) => `https://www.notion.so/${title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")}-${norm(id)}`;

function valueObj(s: State, sc: PropSchema, v: Value): Json {
  const base = { id: sc.id, type: sc.type };
  const opt = (name: string) => {
    const o = sc.options?.find((x) => x.name === name);
    return o ? { id: o.id, name: o.name, color: o.color } : { id: "", name, color: "default" };
  };
  switch (sc.type) {
    case "title":
    case "rich_text":
      return { ...base, [sc.type]: rich(String(v ?? "")) };
    case "status":
    case "select":
      return { ...base, [sc.type]: v == null ? null : opt(String(v)) };
    case "multi_select":
      return { ...base, multi_select: ((v ?? []) as string[]).map(opt) };
    case "people":
      return { ...base, people: ((v ?? []) as string[]).map((id) => userObj(userOf(s, id)!)) };
    case "number":
      return { ...base, number: v ?? null };
    case "date":
      return { ...base, date: v == null ? null : { start: v, end: null, time_zone: null } };
    case "checkbox":
      return { ...base, checkbox: !!v };
    case "relation":
      return { ...base, relation: ((v ?? []) as string[]).map((id) => ({ id })), has_more: false };
  }
}

function parentObj(s: State, p: Page): Json {
  if (p.parent.kind === "data_source") {
    return { type: "data_source_id", data_source_id: p.parent.id, database_id: dsOf(s, p.parent.id)!.database_id };
  }
  if (p.parent.kind === "page") return { type: "page_id", page_id: p.parent.id };
  return { type: "workspace", workspace: true };
}

function pageObj(s: State, p: Page): Json {
  const properties: Json = {};
  for (const sc of schemaOf(s, p)) properties[sc.name] = valueObj(s, sc, p.props[sc.name] ?? null);
  return {
    object: "page", id: p.id, created_time: p.created_time, last_edited_time: p.last_edited_time,
    created_by: userObj(userOf(s, p.created_by)!, false), last_edited_by: userObj(userOf(s, p.last_edited_by)!, false),
    cover: null, icon: null, parent: parentObj(s, p), archived: p.in_trash, in_trash: p.in_trash, is_locked: false,
    properties, url: url(titleOf(s, p), p.id), public_url: null,
  };
}

function schemaObj(sc: PropSchema): Json {
  const o: Json = { id: sc.id, name: sc.name, type: sc.type, description: null };
  if (sc.type === "select" || sc.type === "multi_select") o[sc.type] = { options: sc.options!.map((x) => ({ ...x, description: null })) };
  else if (sc.type === "status") {
    o.status = {
      options: sc.options!.map((x) => ({ ...x, description: null })),
      groups: [
        { id: "g1", name: "To-do", color: "gray", option_ids: [sc.options![0].id] },
        { id: "g2", name: "In progress", color: "blue", option_ids: [sc.options![1].id, sc.options![2].id] },
        { id: "g3", name: "Complete", color: "green", option_ids: [sc.options![3].id] },
      ],
    };
  } else if (sc.type === "number") o.number = { format: "number" };
  else if (sc.type === "relation") o.relation = { data_source_id: sc.relation, type: "single_property", single_property: {} };
  else o[sc.type] = {};
  return o;
}

function dsObj(s: State, d: DataSource): Json {
  const properties: Json = {};
  for (const sc of d.properties) properties[sc.name] = schemaObj(sc);
  return {
    object: "data_source", id: d.id, created_time: "2026-09-02T10:00:00.000Z", last_edited_time: "2026-09-02T10:00:00.000Z",
    created_by: userObj(s.users[0], false), last_edited_by: userObj(s.users[0], false),
    title: rich(d.title), description: [], icon: null, cover: null, properties,
    parent: { type: "database_id", database_id: d.database_id },
    database_parent: { type: "page_id", page_id: d.parent }, archived: false, in_trash: false, is_inline: false,
    url: url(d.title, d.database_id), public_url: null,
  };
}

const blockText: Record<string, boolean> = {
  paragraph: true, heading_1: true, heading_2: true, heading_3: true, bulleted_list_item: true,
  numbered_list_item: true, to_do: true, quote: true,
};

function blockObj(s: State, b: Block): Json {
  const parent = pageOf(s, b.parent) ? { type: "page_id", page_id: b.parent } : { type: "block_id", block_id: b.parent };
  const body: Json = b.type === "divider" ? {} : { rich_text: rich(b.text), color: "default" };
  if (b.type === "to_do") body.checked = !!b.checked;
  if (b.type.startsWith("heading")) body.is_toggleable = false;
  return {
    object: "block", id: b.id, parent, created_time: b.created_time, last_edited_time: b.last_edited_time,
    created_by: userObj(userOf(s, b.created_by)!, false), last_edited_by: userObj(userOf(s, b.created_by)!, false),
    has_children: (s.children[b.id] ?? []).some((c) => !blockOf(s, c)!.in_trash) || s.pages.some((p) => p.parent.kind === "page" && p.parent.id === b.id),
    archived: b.in_trash, in_trash: b.in_trash, type: b.type, [b.type]: body,
  };
}

// Child pages appear among a page's children as child_page blocks, as in Notion.
function childrenOf(s: State, id: string): Json[] {
  const out: Json[] = (s.children[id] ?? []).map((c) => blockOf(s, c)!).filter((b) => !b.in_trash).map((b) => blockObj(s, b));
  for (const p of s.pages.filter((p) => p.parent.kind === "page" && p.parent.id === id && !p.in_trash)) {
    out.push({
      object: "block", id: p.id, parent: { type: "page_id", page_id: id }, created_time: p.created_time, last_edited_time: p.last_edited_time,
      created_by: userObj(userOf(s, p.created_by)!, false), last_edited_by: userObj(userOf(s, p.last_edited_by)!, false),
      has_children: true, archived: false, in_trash: false, type: "child_page", child_page: { title: titleOf(s, p) },
    });
  }
  for (const d of s.dataSources.filter((d) => d.parent === id)) {
    out.push({
      object: "block", id: d.database_id, parent: { type: "page_id", page_id: id }, created_time: "2026-09-02T10:00:00.000Z",
      last_edited_time: "2026-09-02T10:00:00.000Z", created_by: userObj(s.users[0], false), last_edited_by: userObj(s.users[0], false),
      has_children: false, archived: false, in_trash: false, type: "child_database", child_database: { title: d.title },
    });
  }
  return out;
}

function paginate(items: Json[], cursor: unknown, size: unknown, type: string): Json {
  const n = size == null ? 100 : Number(size);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw invalid("body.page_size should be a number between 1 and 100.");
  let start = 0;
  if (cursor != null && cursor !== "") {
    start = Number(String(cursor).replace(/^c/, ""));
    if (!Number.isInteger(start) || start < 0) throw invalid("start_cursor provided is invalid.");
  }
  const results = items.slice(start, start + n);
  const more = start + n < items.length;
  return { object: "list", results, next_cursor: more ? `c${start + n}` : null, has_more: more, type, [type]: {} };
}

// ---------- filters and sorts on data source queries ----------

function propFilter(r: Run, d: DataSource, f: Json): (p: Page) => boolean {
  if (Array.isArray(f.and)) {
    const fs = f.and.map((x: Json) => propFilter(r, d, x));
    return (p) => fs.every((g) => g(p));
  }
  if (Array.isArray(f.or)) {
    const fs = f.or.map((x: Json) => propFilter(r, d, x));
    return (p) => fs.some((g) => g(p));
  }
  if (typeof f.timestamp === "string") {
    const ts = f.timestamp as "created_time" | "last_edited_time";
    const cond = f[ts] as Json;
    if (!cond) throw invalid(`body.filter.${ts} should be defined.`);
    return (p) => dateCond(r, p[ts].slice(0, 10), cond, true);
  }
  const name = String(f.property ?? "");
  const sc = d.properties.find((x) => x.name === name || x.id === name);
  if (!sc) throw invalid(`Could not find property with name or id: ${name}`);
  const key = Object.keys(f).find((k) => k !== "property" && k !== "type");
  if (!key) throw invalid("body.filter should define a condition.");
  const cond = f[key] as Json;
  const kindOk: Record<string, string[]> = {
    title: ["title", "rich_text"], rich_text: ["rich_text", "title"], status: ["status"], select: ["select"],
    multi_select: ["multi_select"], people: ["people"], number: ["number"], date: ["date"], checkbox: ["checkbox"], relation: ["relation"],
  };
  if (!kindOk[sc.type].includes(key)) {
    throw invalid(`body.filter.${key} is not a valid filter for property "${sc.name}" of type ${sc.type}.`);
  }
  const op = Object.keys(cond ?? {})[0];
  const arg = op ? cond[op] : undefined;
  const get = (p: Page) => p.props[sc.name] ?? null;
  const gap = () => {
    r.gaps.push(`filter ${sc.type}.${op}`);
    return (_p: Page) => false;
  };
  const lower = (x: unknown) => String(x ?? "").toLowerCase();
  switch (sc.type) {
    case "title":
    case "rich_text": {
      const t = (p: Page) => lower(get(p));
      const a = lower(arg);
      const ops: Record<string, (p: Page) => boolean> = {
        equals: (p) => t(p) === a, does_not_equal: (p) => t(p) !== a, contains: (p) => t(p).includes(a),
        does_not_contain: (p) => !t(p).includes(a), starts_with: (p) => t(p).startsWith(a), ends_with: (p) => t(p).endsWith(a),
        is_empty: (p) => t(p) === "", is_not_empty: (p) => t(p) !== "",
      };
      return ops[op] ?? gap();
    }
    case "status":
    case "select": {
      if (["equals", "does_not_equal"].includes(op) && !sc.options!.some((o) => o.name === arg)) {
        if (sc.type === "status") throw invalid(`Invalid status option "${arg}" for property "${sc.name}".`);
      }
      const ops: Record<string, (p: Page) => boolean> = {
        equals: (p) => get(p) === arg, does_not_equal: (p) => get(p) !== arg,
        is_empty: (p) => get(p) == null, is_not_empty: (p) => get(p) != null,
      };
      return ops[op] ?? gap();
    }
    case "multi_select":
    case "people":
    case "relation": {
      const xs = (p: Page) => ((get(p) ?? []) as string[]).map((x) => sc.type === "multi_select" ? x : norm(x));
      const a = sc.type === "multi_select" ? arg : norm(String(arg ?? ""));
      const ops: Record<string, (p: Page) => boolean> = {
        contains: (p) => xs(p).includes(a as string), does_not_contain: (p) => !xs(p).includes(a as string),
        is_empty: (p) => xs(p).length === 0, is_not_empty: (p) => xs(p).length > 0,
      };
      return ops[op] ?? gap();
    }
    case "number": {
      const n = (p: Page) => get(p) as number | null;
      const a = Number(arg);
      const ops: Record<string, (p: Page) => boolean> = {
        equals: (p) => n(p) === a, does_not_equal: (p) => n(p) !== a, greater_than: (p) => n(p) != null && n(p)! > a,
        less_than: (p) => n(p) != null && n(p)! < a, greater_than_or_equal_to: (p) => n(p) != null && n(p)! >= a,
        less_than_or_equal_to: (p) => n(p) != null && n(p)! <= a, is_empty: (p) => n(p) == null, is_not_empty: (p) => n(p) != null,
      };
      return ops[op] ?? gap();
    }
    case "checkbox":
      if (op === "equals") return (p) => !!get(p) === !!arg;
      if (op === "does_not_equal") return (p) => !!get(p) !== !!arg;
      return gap();
    case "date":
      return (p) => {
        const v = get(p) as string | null;
        if (op === "is_empty") return v == null;
        if (op === "is_not_empty") return v != null;
        return v != null && dateCond(r, v, cond, false);
      };
  }
}

function dateCond(r: Run, v: string, cond: Json, isTs: boolean): boolean {
  const op = Object.keys(cond)[0];
  const a = String(cond[op] ?? "").slice(0, 10);
  const ops: Record<string, () => boolean> = {
    equals: () => v === a, before: () => v < a, after: () => v > a, on_or_before: () => v <= a, on_or_after: () => v >= a,
  };
  if (!ops[op]) {
    r.gaps.push(`date filter ${op}${isTs ? " (timestamp)" : ""}`);
    return false;
  }
  return ops[op]();
}

function sorter(d: DataSource, sorts: Json[]): (a: Page, b: Page) => number {
  const keys = sorts.map((s) => {
    const dir = s.direction === "descending" ? -1 : 1;
    if (typeof s.timestamp === "string") {
      const ts = s.timestamp as "created_time" | "last_edited_time";
      return (a: Page, b: Page) => dir * a[ts].localeCompare(b[ts]);
    }
    const sc = d.properties.find((x) => x.name === s.property || x.id === s.property);
    if (!sc) throw invalid(`Could not find sort property with name or id: ${s.property}`);
    const rank = (p: Page): string | number | null => {
      const v = p.props[sc.name] ?? null;
      if (v == null || (Array.isArray(v) && !v.length)) return null;
      if (sc.type === "select" || sc.type === "status") return sc.options!.findIndex((o) => o.name === v);
      if (Array.isArray(v)) return v.join(",");
      if (typeof v === "boolean") return v ? 1 : 0;
      return v as string | number;
    };
    return (a: Page, b: Page) => {
      const x = rank(a), y = rank(b);
      if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1; // empty last
      return dir * (x < y ? -1 : x > y ? 1 : 0);
    };
  });
  return (a, b) => {
    for (const k of keys) {
      const c = k(a, b);
      if (c) return c;
    }
    return 0;
  };
}

// ---------- writes ----------

// deno-lint-ignore no-explicit-any
function readValue(s: State, sc: PropSchema, raw: any): Value {
  const v = raw?.[sc.type] !== undefined ? raw[sc.type] : raw;
  const bad = () => invalid(`${sc.name} is expected to be ${sc.type}.`);
  switch (sc.type) {
    case "title":
    case "rich_text":
      if (!Array.isArray(v)) throw bad();
      return v.map((t) => t?.text?.content ?? t?.plain_text ?? "").join("");
    case "status":
    case "select": {
      if (v === null) return null;
      const name = v?.name ?? sc.options!.find((o) => o.id === v?.id)?.name;
      if (typeof name !== "string") throw bad();
      if (!sc.options!.some((o) => o.name === name)) {
        if (sc.type === "status") throw invalid(`Invalid status option. Status option "${name}" does not exist".`);
        sc.options!.push({ id: `n${sc.options!.length}`, name, color: "default" });
      }
      return name;
    }
    case "multi_select": {
      if (!Array.isArray(v)) throw bad();
      return v.map((o) => {
        const name = o?.name ?? sc.options!.find((x) => x.id === o?.id)?.name;
        if (typeof name !== "string") throw bad();
        if (name.includes(",")) throw invalid("Multi-select option names cannot contain commas.");
        if (!sc.options!.some((x) => x.name === name)) sc.options!.push({ id: `n${sc.options!.length}`, name, color: "default" });
        return name;
      });
    }
    case "people":
    case "relation":
      if (!Array.isArray(v)) throw bad();
      return v.map((o) => {
        const id = String(o?.id ?? "");
        const found = sc.type === "people" ? userOf(s, id)?.id : pageOf(s, id)?.id;
        if (!found) throw invalid(`${sc.type === "people" ? "User" : "Page"} ${id} not found.`);
        return found;
      });
    case "number":
      if (v !== null && typeof v !== "number") throw bad();
      return v;
    case "date":
      if (v === null) return null;
      if (typeof v?.start !== "string") throw bad();
      return v.start.slice(0, 10);
    case "checkbox":
      if (typeof v !== "boolean") throw bad();
      return v;
  }
}

function applyProps(s: State, p: Page, props: Json) {
  const schema = schemaOf(s, p);
  for (const [k, raw] of Object.entries(props ?? {})) {
    const sc = schema.find((x) => x.name === k || x.id === k);
    if (!sc) throw invalid(`${k} is not a property that exists.`);
    p.props[sc.name] = readValue(s, sc, raw);
  }
}

// deno-lint-ignore no-explicit-any
function newBlocks(r: Run, parent: string, list: any[]): Block[] {
  if (!Array.isArray(list)) throw invalid("body.children should be an array.");
  if (list.length > 100) throw invalid("body.children.length should be ≤ 100.");
  return list.map((c) => {
    const type = (c?.type ?? Object.keys(c ?? {}).find((k) => k in blockText || k === "divider")) as BlockType;
    if (!(type in blockText) && type !== "divider") {
      r.gaps.push(`append block type ${type}`);
      throw invalid(`body.children[0].type "${type}" is not supported.`);
    }
    const body = c[type] ?? {};
    const t = now(r);
    const b: Block = {
      id: uuid(r.state.nextId++, 0xa), parent, type, text: type === "divider" ? "" : plain(body.rich_text?.map((x: Json) => ({ plain_text: (x.text as Json)?.content ?? x.plain_text }))),
      created_time: t, last_edited_time: t, created_by: r.state.me, in_trash: false,
    };
    if (type === "to_do") b.checked = !!body.checked;
    return b;
  });
}

// ---------- markdown ----------

function toMarkdown(s: State, id: string): string {
  const lines: string[] = [];
  let num = 0;
  for (const c of childrenOf(s, id)) {
    const type = c.type as string;
    // deno-lint-ignore no-explicit-any
    const text = plain((c as any)[type]?.rich_text ?? []);
    if (type !== "numbered_list_item") num = 0;
    if (type === "paragraph") lines.push(text);
    else if (type === "heading_1") lines.push(`# ${text}`);
    else if (type === "heading_2") lines.push(`## ${text}`);
    else if (type === "heading_3") lines.push(`### ${text}`);
    else if (type === "bulleted_list_item") lines.push(`- ${text}`);
    else if (type === "numbered_list_item") lines.push(`${++num}. ${text}`);
    // deno-lint-ignore no-explicit-any
    else if (type === "to_do") lines.push(`- [${(c as any).to_do.checked ? "x" : " "}] ${text}`);
    else if (type === "quote") lines.push(`> ${text}`);
    else if (type === "divider") lines.push("---");
    // deno-lint-ignore no-explicit-any
    else if (type === "child_page") lines.push(`<page url="${url((c as any).child_page.title, c.id as string)}">${(c as any).child_page.title}</page>`);
    // deno-lint-ignore no-explicit-any
    else if (type === "child_database") lines.push(`<database url="${url((c as any).child_database.title, c.id as string)}">${(c as any).child_database.title}</database>`);
  }
  return lines.join("\n");
}

function fromMarkdown(r: Run, parent: string, md: string): Block[] {
  const out: Block[] = [];
  for (const line of md.split("\n")) {
    if (/^<(page|database) /.test(line.trim())) continue; // child pages are kept as they are
    let type: BlockType = "paragraph", text = line, checked: boolean | undefined;
    let m;
    if ((m = line.match(/^- \[( |x|X)\] (.*)$/))) [type, checked, text] = ["to_do", m[1] !== " ", m[2]];
    else if ((m = line.match(/^(#{1,3}) (.*)$/))) [type, text] = [(["heading_1", "heading_2", "heading_3"] as BlockType[])[m[1].length - 1], m[2]];
    else if ((m = line.match(/^[-*] (.*)$/))) [type, text] = ["bulleted_list_item", m[1]];
    else if ((m = line.match(/^\d+\. (.*)$/))) [type, text] = ["numbered_list_item", m[1]];
    else if ((m = line.match(/^> (.*)$/))) [type, text] = ["quote", m[1]];
    else if (line.trim() === "---") [type, text] = ["divider", ""];
    else if (line.trim() === "") continue;
    const t = now(r);
    const b: Block = { id: uuid(r.state.nextId++, 0xa), parent, type, text, created_time: t, last_edited_time: t, created_by: r.state.me, in_trash: false };
    if (type === "to_do") b.checked = checked;
    out.push(b);
  }
  return out;
}

function replaceContent(r: Run, id: string, md: string) {
  const s = r.state;
  for (const c of s.children[id] ?? []) blockOf(s, c)!.in_trash = true;
  const bs = fromMarkdown(r, id, md);
  s.blocks.push(...bs);
  s.children[id] = [...(s.children[id] ?? []), ...bs.map((b) => b.id)];
}

// ---------- routing ----------

function handle(r: Run, method: string, path: string, q: URLSearchParams, body: Json): Json {
  const s = r.state;
  const seg = path.replace(/^\/v1\//, "").split("/");
  const touch = (p: Page) => {
    p.last_edited_time = now(r);
    p.last_edited_by = s.me;
  };

  if (seg[0] === "users") {
    if (seg[1] === "me" && method === "GET") return userObj(userOf(s, s.me)!);
    if (!seg[1] && method === "GET") return paginate(s.users.map((u) => userObj(u)), q.get("start_cursor"), q.get("page_size"), "user");
    if (method === "GET") {
      const u = userOf(s, seg[1]);
      if (!u) throw notFound(seg[1]);
      return userObj(u);
    }
  }

  if (seg[0] === "search" && method === "POST") {
    const term = String(body.query ?? "").toLowerCase();
    const want = (body.filter as Json | undefined)?.value;
    const items: { t: string; o: Json }[] = [];
    if (want !== "data_source") {
      for (const p of s.pages.filter((p) => !p.in_trash && titleOf(s, p).toLowerCase().includes(term))) items.push({ t: p.last_edited_time, o: pageObj(s, p) });
    }
    if (want !== "page") {
      for (const d of s.dataSources.filter((d) => d.title.toLowerCase().includes(term))) items.push({ t: "2026-09-02T10:00:00.000Z", o: dsObj(s, d) });
    }
    const dir = (body.sort as Json | undefined)?.direction === "ascending" ? 1 : -1;
    items.sort((a, b) => dir * a.t.localeCompare(b.t));
    return paginate(items.map((x) => x.o), body.start_cursor, body.page_size, "page_or_data_source");
  }

  if (seg[0] === "data_sources") {
    if (!seg[1] && method === "POST") {
      r.gaps.push("create data source");
      throw invalid("Creating data sources is not supported in this workspace.");
    }
    const d = dsOf(s, seg[1]);
    if (!d) throw notFound(seg[1]);
    if (seg[2] === "query" && method === "POST") {
      let rows = s.pages.filter((p) => p.parent.kind === "data_source" && p.parent.id === d.id && p.in_trash === !!(body.in_trash ?? body.archived));
      if (body.filter) rows = rows.filter(propFilter(r, d, body.filter as Json));
      rows = [...rows].sort(body.sorts ? sorter(d, body.sorts as Json[]) : (a, b) => b.created_time.localeCompare(a.created_time));
      const out = paginate(rows.map((p) => pageObj(s, p)), body.start_cursor, body.page_size, "page_or_data_source");
      const only = q.getAll("filter_properties").flatMap((x) => x.split(","));
      if (only.length) {
        for (const p of out.results as Json[]) {
          const props = p.properties as Json;
          for (const k of Object.keys(props)) if (!only.includes((props[k] as Json).id as string) && !only.includes(k)) delete props[k];
        }
      }
      return out;
    }
    if (seg[2] === "templates" && method === "GET") return { templates: [], has_more: false, next_cursor: null };
    if (!seg[2] && method === "GET") return dsObj(s, d);
    if (!seg[2] && method === "PATCH") {
      if (body.title) d.title = plain((body.title as Json[]).map((t) => ({ plain_text: (t.text as Json)?.content ?? t.plain_text })));
      for (const [k, v] of Object.entries((body.properties ?? {}) as Json)) {
        const sc = d.properties.find((x) => x.name === k || x.id === k);
        if (v === null) {
          if (sc) d.properties = d.properties.filter((x) => x !== sc);
          continue;
        }
        const nv = v as Json;
        if (sc && typeof nv.name === "string") {
          for (const p of s.pages) if (p.parent.kind === "data_source" && p.parent.id === d.id && sc.name in p.props) {
            p.props[nv.name] = p.props[sc.name];
            delete p.props[sc.name];
          }
          sc.name = nv.name;
        }
        if (!sc) {
          const type = Object.keys(nv).find((x) => x !== "name") as PropSchema["type"];
          if (!type) throw invalid(`Property ${k} needs a type.`);
          // deno-lint-ignore no-explicit-any
          const options = (nv as any)[type]?.options?.map((o: Json, i: number) => ({ id: `o${i}`, name: o.name, color: o.color ?? "default" }));
          d.properties.push({ id: `x${d.properties.length}`, name: k, type, ...(options || type === "select" || type === "multi_select" ? { options: options ?? [] } : {}) });
        }
      }
      return dsObj(s, d);
    }
  }

  if (seg[0] === "databases" && method === "GET") {
    const d = s.dataSources.find((x) => norm(x.database_id) === norm(seg[1]));
    if (!d) throw notFound(seg[1]);
    return {
      object: "database", id: d.database_id, title: rich(d.title), description: [], parent: { type: "page_id", page_id: d.parent },
      is_inline: false, in_trash: false, is_locked: false, created_time: "2026-09-02T10:00:00.000Z", last_edited_time: "2026-09-02T10:00:00.000Z",
      data_sources: [{ id: d.id, name: d.title }], icon: null, cover: null, url: url(d.title, d.database_id), public_url: null,
    };
  }

  if (seg[0] === "pages") {
    if (!seg[1] && method === "POST") {
      const pr = (body.parent ?? {}) as Json;
      let parent: Page["parent"];
      if (pr.data_source_id || pr.database_id) {
        const d = pr.data_source_id ? dsOf(s, String(pr.data_source_id)) : s.dataSources.find((x) => norm(x.database_id) === norm(String(pr.database_id)));
        if (!d) throw notFound(String(pr.data_source_id ?? pr.database_id));
        parent = { kind: "data_source", id: d.id };
      } else if (pr.page_id) {
        const pp = pageOf(s, String(pr.page_id));
        if (!pp) throw notFound(String(pr.page_id));
        parent = { kind: "page", id: pp.id };
      } else throw invalid("body.parent should be defined with page_id, data_source_id or database_id.");
      const t = now(r);
      const p: Page = { id: uuid(s.nextId++, 0x3), parent, props: {}, created_time: t, last_edited_time: t, created_by: s.me, last_edited_by: s.me, in_trash: false };
      applyProps(s, p, body.properties as Json);
      if (parent.kind === "page" && typeof p.props.title !== "string") throw invalid("Title is required for pages whose parent is a page.");
      s.pages.push(p);
      if (body.children) {
        const bs = newBlocks(r, p.id, body.children as unknown[]);
        s.blocks.push(...bs);
        s.children[p.id] = bs.map((b) => b.id);
      }
      if (typeof body.markdown === "string") replaceContent(r, p.id, body.markdown);
      return pageObj(s, p);
    }
    const p = pageOf(s, seg[1]);
    if (!p) throw notFound(seg[1]);
    if (!seg[2] && method === "GET") return pageObj(s, p);
    if (!seg[2] && method === "PATCH") {
      if (body.properties) applyProps(s, p, body.properties as Json);
      const trash = body.in_trash ?? body.archived;
      if (typeof trash === "boolean") p.in_trash = trash;
      if (body.icon !== undefined || body.cover !== undefined) r.gaps.push("page icon/cover");
      touch(p);
      return pageObj(s, p);
    }
    if (seg[2] === "properties" && method === "GET") {
      const sc = schemaOf(s, p).find((x) => x.id === decodeURIComponent(seg[3]) || x.name === decodeURIComponent(seg[3]));
      if (!sc) throw notFound(seg[3]);
      const v = valueObj(s, sc, p.props[sc.name] ?? null);
      if (["title", "rich_text", "people", "relation"].includes(sc.type)) {
        // deno-lint-ignore no-explicit-any
        const items = ((v as any)[sc.type] as Json[]).map((x) => ({ object: "property_item", id: sc.id, type: sc.type, [sc.type]: x }));
        return { ...paginate(items, q.get("start_cursor"), q.get("page_size"), "property_item"), property_item: { id: sc.id, next_url: null, type: sc.type, [sc.type]: {} } };
      }
      return { object: "property_item", ...v };
    }
    if (seg[2] === "move" && method === "POST") {
      const pr = (body.parent ?? {}) as Json;
      if (pr.type === "page_id" || pr.page_id) {
        const to = pageOf(s, String(pr.page_id));
        if (!to) throw notFound(String(pr.page_id));
        p.parent = { kind: "page", id: to.id };
      } else if (pr.type === "workspace") p.parent = { kind: "workspace" };
      else {
        r.gaps.push("move page into a database");
        throw invalid("Moving pages into a database is not supported here.");
      }
      touch(p);
      return pageObj(s, p);
    }
    if (seg[2] === "markdown" && method === "GET") return { object: "page_markdown", id: p.id, markdown: toMarkdown(s, p.id), truncated: false, unknown_block_ids: [] };
    if (seg[2] === "markdown" && method === "PATCH") {
      if (body.type === "replace_content") replaceContent(r, p.id, String((body.replace_content as Json)?.new_str ?? ""));
      else if (body.type === "update_content") {
        let md = toMarkdown(s, p.id);
        for (const u of ((body.update_content as Json)?.content_updates ?? []) as Json[]) {
          const old = String(u.old_str);
          if (!md.includes(old)) throw invalid(`Could not find the text to replace: ${old}`);
          md = u.replace_all_matches ? md.split(old).join(String(u.new_str)) : md.replace(old, String(u.new_str));
        }
        replaceContent(r, p.id, md);
      } else {
        r.gaps.push(`markdown ${body.type}`);
        throw invalid(`${body.type} is deprecated; use replace_content or update_content.`);
      }
      touch(p);
      return { object: "page_markdown", id: p.id, markdown: toMarkdown(s, p.id), truncated: false, unknown_block_ids: [] };
    }
  }

  if (seg[0] === "blocks") {
    const id = seg[1];
    const isPage = pageOf(s, id);
    const b = blockOf(s, id);
    const target = isPage?.id ?? b?.id;
    if (!target) throw notFound(id);
    if (seg[2] === "children" && method === "GET") return paginate(childrenOf(s, target), q.get("start_cursor"), q.get("page_size"), "block");
    if (seg[2] === "children" && method === "PATCH") {
      const bs = newBlocks(r, target, body.children as unknown[]);
      s.blocks.push(...bs);
      const list = s.children[target] ??= [];
      const after = body.after ? list.findIndex((x) => norm(x) === norm(String(body.after))) : -1;
      if (body.after && after < 0) throw invalid(`Block ${body.after} is not a child of ${id}.`);
      list.splice(after < 0 ? list.length : after + 1, 0, ...bs.map((x) => x.id));
      if (isPage) touch(isPage);
      return paginate(bs.map((x) => blockObj(s, x)), null, 100, "block");
    }
    if (!b) {
      if (isPage && !seg[2] && method === "GET") {
        return { ...childrenOf(s, isPage.parent.kind === "page" ? isPage.parent.id : "").find((c) => c.id === isPage.id) ?? { object: "block", id: isPage.id, type: "child_page", child_page: { title: titleOf(s, isPage) } } };
      }
      if (isPage && !seg[2] && method === "DELETE") {
        isPage.in_trash = true;
        touch(isPage);
        return { object: "block", id: isPage.id, type: "child_page", in_trash: true, archived: true, child_page: { title: titleOf(s, isPage) } };
      }
      throw notFound(id);
    }
    if (!seg[2] && method === "GET") return blockObj(s, b);
    if (!seg[2] && method === "DELETE") {
      b.in_trash = true;
      b.last_edited_time = now(r);
      return blockObj(s, b);
    }
    if (!seg[2] && method === "PATCH") {
      const trash = body.in_trash ?? body.archived;
      if (typeof trash === "boolean") b.in_trash = trash;
      const content = body[b.type] as Json | undefined;
      const otherType = Object.keys(body).find((k) => k in blockText && k !== b.type);
      if (otherType) throw invalid(`Block type ${b.type} cannot be changed to ${otherType}.`);
      if (content) {
        if (Array.isArray(content.rich_text)) b.text = plain((content.rich_text as Json[]).map((x) => ({ plain_text: (x.text as Json)?.content ?? x.plain_text })));
        if (b.type === "to_do" && typeof content.checked === "boolean") b.checked = content.checked;
      }
      b.last_edited_time = now(r);
      return blockObj(s, b);
    }
  }

  if (seg[0] === "comments") {
    if (method === "GET") {
      const id = q.get("block_id") ?? "";
      const target = pageOf(s, id)?.id ?? blockOf(s, id)?.id;
      if (!target) throw notFound(id);
      const list = s.comments.filter((c) => c.page === target).map((c) => ({
        object: "comment", id: c.id, parent: { type: "page_id", page_id: c.page }, discussion_id: c.discussion,
        created_time: c.created_time, last_edited_time: c.created_time, created_by: { object: "user", id: c.created_by },
        rich_text: rich(c.text), display_name: { type: "user", resolved_name: userOf(s, c.created_by)!.name },
      }));
      return paginate(list, q.get("start_cursor"), q.get("page_size"), "comment");
    }
    if (method === "POST") {
      const pid = (body.parent as Json | undefined)?.page_id;
      const disc = body.discussion_id;
      let page: string | undefined;
      if (pid) page = pageOf(s, String(pid))?.id;
      else if (disc) page = s.comments.find((c) => norm(c.discussion) === norm(String(disc)))?.page;
      if (!page) throw notFound(String(pid ?? disc));
      const text = plain(((body.rich_text ?? []) as Json[]).map((x) => ({ plain_text: (x.text as Json)?.content ?? x.plain_text })));
      if (!text) throw invalid("body.rich_text should be a non-empty array.");
      const t = now(r);
      const c = { id: uuid(s.nextId++, 0xc), page, discussion: disc ? String(disc) : uuid(s.nextId++, 0xf), text, created_by: s.me, created_time: t };
      s.comments.push(c);
      return {
        object: "comment", id: c.id, parent: { type: "page_id", page_id: page }, discussion_id: c.discussion, created_time: t,
        last_edited_time: t, created_by: { object: "user", id: s.me }, rich_text: rich(text),
      };
    }
  }

  r.gaps.push(`${method} ${path}`);
  throw new ApiError(400, "invalid_request_url", "Invalid request URL.");
}

let server: Deno.HttpServer | null = null;

export function mockUrl(): string {
  if (!server) {
    server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, async (req) => {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      const r = runs.get(token);
      if (!r) return Response.json({ object: "error", status: 401, code: "unauthorized", message: "API token is invalid." }, { status: 401 });
      const u = new URL(req.url);
      let body: Json = {};
      if (req.method !== "GET" && req.method !== "DELETE") {
        const t = await req.text();
        try {
          body = t ? JSON.parse(t) : {};
        } catch {
          return Response.json({ object: "error", status: 400, code: "invalid_json", message: "Error parsing JSON body." }, { status: 400 });
        }
      }
      try {
        return Response.json(handle(r, req.method, u.pathname, u.searchParams, body));
      } catch (e) {
        if (e instanceof ApiError) return Response.json({ object: "error", status: e.status, code: e.code, message: e.message }, { status: e.status });
        r.gaps.push(`crash ${req.method} ${u.pathname}: ${(e as Error).message}`);
        return Response.json({ object: "error", status: 500, code: "internal_server_error", message: "Unexpected error." }, { status: 500 });
      }
    });
  }
  server.unref();
  return `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
}
