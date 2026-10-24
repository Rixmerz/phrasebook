// Fifth filesystem set, NOT blind: written by the glossary's author after reading the
// filesystem-blind logs, before v4.3 was built, and frozen first (results/set5-freeze.sha256).
// It leans on large text files (logs, a CSV), the case v4.3 targets, so it can favor v4.3.
import type { DiskTask } from "./tasks.ts";

function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}
const rand = rng(5150);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

const SERVICES = ["gateway", "billing", "search"];
const DAYS = ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"];
const MSG = {
  INFO: ["request ok", "cache warm", "job queued", "health check passed", "retry scheduled after error"],
  WARN: ["slow query", "queue depth high", "deprecated header"],
  ERROR: ["timeout talking to db", "payment declined upstream", "index shard missing"],
};
type Level = keyof typeof MSG;

export const SET5_SEED: Record<string, string> = {};
for (const svc of SERVICES) {
  for (const d of DAYS) {
    const n = 120 + Math.floor(rand() * 120);
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = rand();
      const level: Level = r < 0.08 ? "ERROR" : r < 0.2 ? "WARN" : "INFO";
      const hh = String(Math.floor(i / 12)).padStart(2, "0"), mm = String((i * 5) % 60).padStart(2, "0");
      lines.push(`${d}T${hh}:${mm}:00Z ${level} ${pick(MSG[level])}`);
    }
    SET5_SEED[`var/log/${svc}/${d}.log`] = lines.join("\n") + "\n";
  }
}
const CUSTOMERS = ["acme", "globex", "initech", "umbrella", "hooli", "stark"];
const csv = ["date,customer,amount,status"];
for (let i = 0; i < 150; i++) {
  csv.push(`${DAYS[i % 4]},${pick(CUSTOMERS)},${(10 + Math.floor(rand() * 990))},${rand() < 0.85 ? "paid" : "refunded"}`);
}
SET5_SEED["data/payments.csv"] = csv.join("\n") + "\n";
SET5_SEED["README.md"] = "# ops\n\nLogs live in var/log/<service>/<day>.log.\n";
SET5_SEED["SUMMARY.md"] = "# Summary\n\n";
SET5_SEED["etc/service.conf"] = "[gateway]\nworkers = 8\ntimeout = 30\n\n[billing]\nworkers = 4\ntimeout = 60\n";

export function seedSet5(dir: string) {
  for (const [path, content] of Object.entries(SET5_SEED)) {
    const full = `${dir}/${path}`;
    Deno.mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
    Deno.writeTextFileSync(full, content);
  }
}

// ---- Truth ----
const logs = Object.entries(SET5_SEED).filter(([p]) => p.endsWith(".log"));
const level = (l: string) => l.split(" ")[1];
const count = (p: string, lv: string) => SET5_SEED[p].split("\n").filter((l) => level(l) === lv).length;
const errorsBilling = logs.filter(([p]) => p.includes("/billing/")).reduce((a, [p]) => a + count(p, "ERROR"), 0);
const errorsAll = logs.reduce((a, [p]) => a + count(p, "ERROR"), 0);
const byDay = DAYS.map((d) => [d, logs.filter(([p]) => p.includes(d)).reduce((a, [p]) => a + count(p, "ERROR"), 0)] as const)
  .sort((a, b) => b[1] - a[1]);
if (byDay[0][1] === byDay[1][1]) throw new Error("set5: day tie");
const timeouts = logs.reduce((a, [p]) => a + SET5_SEED[p].split("\n").filter((l) => l.endsWith("timeout talking to db")).length, 0);
const rows = csv.slice(1).map((r) => r.split(","));
const paidByCustomer = new Map<string, number>();
for (const [, c, a, s] of rows) if (s === "paid") paidByCustomer.set(c, (paidByCustomer.get(c) ?? 0) + Number(a));
const topCustomer = [...paidByCustomer.entries()].sort((a, b) => b[1] - a[1]);
if (topCustomer[0][1] === topCustomer[1][1]) throw new Error("set5: customer tie");
const refunded = rows.filter((r) => r[3] === "refunded").length;
const firstWarnGateway = SET5_SEED["var/log/gateway/2026-10-12.log"].split("\n").find((l) => level(l) === "WARN")!;

export const SET5_TRUTH = { errorsBilling, errorsAll, worstDay: byDay[0], timeouts, topCustomer: topCustomer[0], refunded, firstWarnGateway };

// ---- Checks ----
const read = (dir: string, p: string) => {
  try {
    return Deno.readTextFileSync(`${dir}/${p}`);
  } catch {
    return null;
  }
};
const firstNumber = (t: string) => Number((t.replace(/(\d)[.,](\d{3})\b/g, "$1$2").match(/\d+/) ?? ["NaN"])[0]);
function sameTree(dir: string, except: string[]): boolean {
  const walk = (d: string, pre = ""): string[] =>
    [...Deno.readDirSync(d)].flatMap((e) => e.isDirectory ? walk(`${d}/${e.name}`, `${pre}${e.name}/`) : [`${pre}${e.name}`]);
  const files = walk(dir).sort();
  const want = Object.keys(SET5_SEED).sort();
  return files.join() === want.join() && want.every((p) => except.includes(p) || read(dir, p) === SET5_SEED[p]);
}

export const set5Tasks: DiskTask[] = [
  {
    id: "s5-errors-billing",
    prompt: "¿Cuántas líneas con nivel ERROR hay en total en los logs de billing (var/log/billing/)? Responde solo con el número.",
    check: (_d, t) => firstNumber(t) === errorsBilling,
  },
  {
    id: "s5-worst-day",
    prompt: "Sumando los tres servicios en var/log, ¿qué día tuvo más líneas ERROR? Responde en el formato: AAAA-MM-DD, cantidad.",
    check: (_d, t) => t.includes(byDay[0][0]) && (t.match(/\d+/g) ?? []).map(Number).includes(byDay[0][1]) && DAYS.filter((d) => t.includes(d)).length === 1,
  },
  {
    id: "s5-timeouts",
    prompt: "¿Cuántas veces aparece el mensaje \"timeout talking to db\" en todos los logs de var/log? Responde solo con el número.",
    check: (_d, t) => firstNumber(t) === timeouts,
  },
  {
    id: "s5-first-warn",
    prompt: "¿Cuál es la primera línea WARN de var/log/gateway/2026-10-12.log? Responde solo con la línea completa.",
    check: (_d, t) => t.includes(firstWarnGateway),
  },
  {
    id: "s5-top-customer",
    prompt: "En data/payments.csv, sumando amount solo de las filas con status paid, ¿qué cliente suma más? Responde en el formato: cliente, total.",
    check: (_d, t) => t.toLowerCase().includes(topCustomer[0][0]) && (t.replace(/[.,](\d{3})\b/g, "$1").match(/\d+/g) ?? []).map(Number).includes(topCustomer[0][1]),
  },
  {
    id: "s5-refunded",
    prompt: "¿Cuántas filas de data/payments.csv tienen status refunded? Responde solo con el número.",
    check: (_d, t) => firstNumber(t) === refunded,
  },
  {
    id: "s5-summary-errors",
    prompt: "Agrega al final de SUMMARY.md la línea \"Total ERROR: N\" (con N el total de líneas ERROR de todos los logs en var/log), terminada en salto de línea. No cambies nada más.",
    check: (d) => read(d, "SUMMARY.md") === SET5_SEED["SUMMARY.md"] + `Total ERROR: ${errorsAll}\n` && sameTree(d, ["SUMMARY.md"]),
  },
  {
    id: "s5-edit-timeout",
    prompt: "En etc/service.conf, cambia el timeout de la sección [billing] de 60 a 90, sin tocar nada más del archivo.",
    check: (d) => read(d, "etc/service.conf") === SET5_SEED["etc/service.conf"].replace("timeout = 60", "timeout = 90") && sameTree(d, ["etc/service.conf"]),
  },
];
