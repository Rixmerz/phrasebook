// A small declarative pipeline over the records of a result, run by the engine:
//   | where <field> <op> <value>   ops: = != > >= < <= has contains starts empty notempty
//   | select a,b   | sort <field> [asc|desc]   | top <n>   | group <field>   | count
//   | sum <field>  | avg <field>  | min <field>  | max <field>  | distinct <field>
//   | where <field> in @n[*].<field>   | where <field> notin @n[*].<field>
import { getPath, type Json } from "./format.ts";

export class PipelineError extends Error {}

const lc = (v: Json) => String(v ?? "").toLowerCase();

function compare(a: Json, b: string): number {
  const na = Number(a), nb = Number(b);
  if (a !== null && a !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return lc(a) < b.toLowerCase() ? -1 : lc(a) > b.toLowerCase() ? 1 : 0;
}

export type Resolve = (expr: string) => Json;

function matches(row: Json, field: string, op: string, value: string, resolve?: Resolve): boolean {
  const v = getPath(row, field);
  const list = Array.isArray(v) ? v : null;
  switch (op) {
    case "=": case "==": return list ? list.some((x) => lc(x) === value.toLowerCase()) : lc(v) === value.toLowerCase();
    case "!=": return list ? !list.some((x) => lc(x) === value.toLowerCase()) : lc(v) !== value.toLowerCase();
    case "has": return (list ?? [v]).some((x) => lc(x) === value.toLowerCase());
    // Smart case, as in ripgrep: a value with capitals matches case-sensitively.
    case "contains": {
      const hay = list ? list.join(" ") : String(v ?? "");
      return /[A-Z]/.test(value) ? hay.includes(value) : hay.toLowerCase().includes(value.toLowerCase());
    }
    case "starts": return lc(v).startsWith(value.toLowerCase());
    case "empty": return list ? list.length === 0 : v === null || v === "";
    case "notempty": return list ? list.length > 0 : !(v === null || v === "");
    case "in": case "notin": {
      if (!resolve || !value.startsWith("@")) throw new PipelineError(`"${op}" needs another result, e.g. where author in @2[*].user`);
      const other = resolve(value);
      const set = new Set((Array.isArray(other) ? other : [other]).flat().map((x) => lc(x as Json)));
      const hit = (list ?? [v]).some((x) => set.has(lc(x)));
      return op === "in" ? hit : !hit;
    }
    case ">": return compare(v, value) > 0;
    case ">=": return compare(v, value) >= 0;
    case "<": return compare(v, value) < 0;
    case "<=": return compare(v, value) <= 0;
    default: throw new PipelineError(`Unknown operator "${op}". Use = != > >= < <= has contains starts empty notempty.`);
  }
}

export type Stage = string[];

const nums = (rows: Json[], field: string) =>
  rows.map((r) => Number(getPath(r, field) ?? 0)).filter((n) => !Number.isNaN(n));

// A field no row has is a typo, not an empty match: say so instead of answering 0.
function hasField(row: Json, path: string): boolean {
  let cur: Json = row;
  for (const part of path.split(".").filter(Boolean)) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur) || !(part in cur)) return false;
    cur = (cur as Record<string, Json>)[part];
  }
  return true;
}
function checkField(rows: Json[], field: string | undefined, seen: Json[]) {
  if (!field || !rows.length || rows.some((r) => hasField(r, field)) || seen.some((r) => hasField(r, field))) return;
  const first = rows[0];
  const keys = first && typeof first === "object" && !Array.isArray(first) ? Object.keys(first) : [];
  throw new PipelineError(`No row has a field "${field}". Fields: ${keys.join(", ")}`);
}
const FIELD_STEPS = new Set(["where", "sort", "group", "sum", "avg", "min", "max", "distinct"]);

export function runPipeline(rows: Json[], stages: Stage[], resolve?: Resolve): Json {
  let cur: Json = rows;
  for (const st of stages) {
    const [op, ...args] = st;
    if (!Array.isArray(cur)) throw new PipelineError(`"${op}" needs a list, but the previous step gave a single value.`);
    if (FIELD_STEPS.has((op ?? "").toLowerCase())) checkField(cur, args[0], rows);
    switch ((op ?? "").toLowerCase()) {
      case "where": {
        const [field, o, ...rest] = args;
        if (!field || !o) throw new PipelineError("Usage: where <field> <op> <value>, e.g. where labels has bug");
        cur = cur.filter((r) => matches(r, field, o.toLowerCase(), rest.join(" "), resolve));
        break;
      }
      case "select": {
        const fields = args.join(",").split(",").map((f) => f.trim()).filter(Boolean);
        cur = cur.map((r) => Object.fromEntries(fields.map((f) => [f, getPath(r, f)])));
        break;
      }
      case "sort": {
        const [field, dir] = args;
        const sign = (dir ?? "asc").toLowerCase() === "desc" ? -1 : 1;
        cur = [...cur].sort((a, b) => sign * compare(getPath(a, field), String(getPath(b, field) ?? "")));
        break;
      }
      case "top": case "first": case "limit":
        cur = cur.slice(0, Number(args[0] ?? 10));
        break;
      case "group": {
        const field = args[0];
        const counts = new Map<string, number>();
        for (const r of cur) {
          const v = getPath(r, field);
          for (const k of Array.isArray(v) ? (v.length ? v : [null]) : [v]) counts.set(String(k ?? "(none)"), (counts.get(String(k ?? "(none)")) ?? 0) + 1);
        }
        cur = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ [field]: k, count: n }));
        break;
      }
      case "count":
        return cur.length;
      case "sum":
        return nums(cur, args[0]).reduce((a, b) => a + b, 0);
      case "avg": {
        const xs = nums(cur, args[0]);
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
      }
      case "min":
        return Math.min(...nums(cur, args[0]));
      case "max":
        return Math.max(...nums(cur, args[0]));
      case "distinct": {
        const field = args[0];
        const seen = new Set<string>();
        for (const r of cur) {
          const v = getPath(r, field);
          for (const x of Array.isArray(v) ? v : [v]) if (x !== null && x !== "") seen.add(String(x));
        }
        cur = [...seen].sort().map((x) => ({ [field]: x }));
        break;
      }
      default:
        throw new PipelineError(`Unknown step "${op}". Steps: where, select, sort, top, group, count, sum, avg, min, max, distinct.`);
    }
  }
  return cur;
}
