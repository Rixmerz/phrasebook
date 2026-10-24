// Glossary v4 list output: a few default columns per record type instead of every field.
// Hidden fields stay in the stored result, so `| select` and `| where` still reach them.
import { type Json, table } from "./format.ts";

type Row = Record<string, Json>;

const SHA = /^[0-9a-f]{40}$/;
const ISSUE_COLS = ["number", "title", "state", "labels", "assignees", "comments"];
const PR_COLS = ["number", "title", "state", "merged", "user", "head", "base"];

// Nested branch objects ({ref, sha, repo, ...}) become their ref, with the sha kept as <key>_sha.
export function flatten(v: Json): Json {
  if (Array.isArray(v)) return v.map(flatten);
  if (!v || typeof v !== "object") return v;
  const out: Row = {};
  for (const [k, x] of Object.entries(v)) {
    if (x && typeof x === "object" && !Array.isArray(x) && typeof (x as Row).ref === "string") {
      out[k] = (x as Row).ref;
      if (typeof (x as Row).sha === "string") out[`${k}_sha`] = (x as Row).sha;
    } else out[k] = flatten(x);
  }
  return out;
}

function defaultsFor(fields: string[]): string[] {
  const isPr = fields.includes("head") && fields.includes("base");
  const want = isPr ? PR_COLS : fields.includes("number") && fields.includes("title") ? ISSUE_COLS : null;
  if (want) return want.filter((f) => fields.includes(f));
  return fields;
}

const isSha = (v: Json) => typeof v === "string" && SHA.test(v);

// Records as a table of default columns; columns equal on every row go to one header line.
export function compactTable(name: string, rows: Json[]): string {
  const recs = rows.filter((r): r is Row => !!r && typeof r === "object" && !Array.isArray(r));
  if (recs.length !== rows.length || !recs.length) return table(name, rows);
  const fields: string[] = [];
  for (const r of recs) for (const k of Object.keys(r)) if (!fields.includes(k)) fields.push(k);
  let shown = defaultsFor(fields).filter((f) => !recs.every((r) => isSha(r[f] ?? null)));
  const same: string[] = [];
  if (recs.length > 1) {
    for (const f of shown) {
      const first = JSON.stringify(recs[0][f] ?? null);
      if (f !== "number" && recs.every((r) => JSON.stringify(r[f] ?? null) === first)) same.push(f);
    }
    shown = shown.filter((f) => !same.includes(f));
  }
  const lines: string[] = [];
  if (same.length) lines.push(`all rows: ${same.map((f) => `${f}=${cellOf(recs[0][f] ?? null)}`).join(" ")}`);
  lines.push(table(name, recs.map((r) => Object.fromEntries(shown.map((f) => [f, r[f] ?? null])))));
  const hidden = fields.filter((f) => !shown.includes(f) && !same.includes(f));
  if (hidden.length) lines.push(`more fields: ${hidden.join(", ")} (add | select number,<field>)`);
  return lines.join("\n");
}

function cellOf(v: Json): string {
  if (Array.isArray(v)) return v.join("|") || "(none)";
  return v === null || v === "" ? "(none)" : String(v);
}
