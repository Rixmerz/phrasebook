// Output shaping for glossary v3: simplify GitHub-style JSON and print it compactly.
// Lists of records become TOON-style tables: name[count]{field,...}: then one row per record.

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const NOISE = /(^|_)url$|^node_id$|^html_url$|^avatar|gravatar|^_links$|^permissions$/;

// Collapse what an agent rarely needs: link fields, {login} users, {name} labels.
export function simplify(v: Json): Json {
  if (Array.isArray(v)) return v.map(simplify);
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    if (typeof v.login === "string" && keys.every((k) => ["login", "id", "type", "html_url", "url", "site_admin", "profile_url", "avatar_url"].includes(k))) {
      return v.login;
    }
    if (typeof v.name === "string" && keys.every((k) => ["name", "id", "color", "description", "default", "node_id", "url"].includes(k))) {
      return v.name;
    }
    if (keys.length === 1 && keys[0] === "totalCount") return v.totalCount;
    const out: Record<string, Json> = {};
    for (const k of keys) if (!NOISE.test(k)) out[k] = simplify(v[k]);
    return out;
  }
  return v;
}

// The main list inside a result: the result itself, or its first array of records.
export function rowsOf(v: Json): { key: string; rows: Json[] } | null {
  if (Array.isArray(v)) return { key: "items", rows: v };
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (Array.isArray(x) && (x.length === 0 || (typeof x[0] === "object" && x[0] !== null))) return { key: k, rows: x };
    }
  }
  return null;
}

function cell(v: Json): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(cell).join("|");
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return /[,"\n]|^\s|\s$/.test(s) ? JSON.stringify(s) : s;
}

export function table(name: string, rows: Json[]): string {
  const fields: string[] = [];
  for (const r of rows) if (r && typeof r === "object" && !Array.isArray(r)) for (const k of Object.keys(r)) if (!fields.includes(k)) fields.push(k);
  if (!fields.length) return `${name}[${rows.length}]: ${rows.map(cell).join(", ")}`;
  const lines = rows.map((r) => "  " + fields.map((f) => cell((r as Record<string, Json>)[f] ?? null)).join(","));
  return `${name}[${rows.length}]{${fields.join(",")}}:\n${lines.join("\n")}`;
}

// A single object as indented "key: value" lines; nested lists of records as tables.
export function render(v: Json, indent = ""): string {
  if (Array.isArray(v)) return table("items", v);
  if (!v || typeof v !== "object") return indent + cell(v);
  const lines: string[] = [];
  for (const [k, x] of Object.entries(v)) {
    if (Array.isArray(x) && x.some((e) => e && typeof e === "object" && !Array.isArray(e))) {
      lines.push(indent + table(k, x).replace(/\n/g, "\n" + indent));
    } else if (x && typeof x === "object" && !Array.isArray(x)) {
      lines.push(`${indent}${k}:`, render(x, indent + "  "));
    } else {
      lines.push(`${indent}${k}: ${cell(x)}`);
    }
  }
  return lines.join("\n");
}

export function getPath(v: Json, path: string): Json {
  let cur: Json = v;
  for (const part of path.split(".").filter(Boolean)) {
    if (cur && typeof cur === "object" && !Array.isArray(cur)) cur = (cur as Record<string, Json>)[part] ?? null;
    else return null;
  }
  return cur;
}

export type { Json };
