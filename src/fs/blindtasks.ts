// Held-out ("blind") filesystem tasks: a new workspace and new tasks, written without
// looking at any glossary. Every expected answer is computed from the seed below.
import type { DiskTask } from "./tasks.ts";

// ---------- deterministic seed ----------

// Small LCG so the generated logs and CSV are identical on every run.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const LOG_MESSAGES: Record<string, string[]> = {
  INFO: ["request served", "cache hit", "retrying after error", "job queued", "health check ok", "connection pool resized"],
  WARN: ["slow query", "cache miss storm", "retry budget low", "deprecated header used"],
  ERROR: ["upstream timeout", "db connection refused", "unhandled exception", "payload too large"],
};

function makeLog(seed: number, day: string, lines: number, weights: [number, number]): string {
  const r = rng(seed);
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    const x = r();
    const level = x < weights[0] ? "ERROR" : x < weights[0] + weights[1] ? "WARN" : "INFO";
    const msgs = LOG_MESSAGES[level];
    const msg = msgs[Math.floor(r() * msgs.length)];
    const sec = i * 37;
    const hh = String(8 + Math.floor(sec / 3600)).padStart(2, "0");
    const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
    const ss = String(sec % 60).padStart(2, "0");
    out.push(`${day}T${hh}:${mm}:${ss}Z ${level} ${msg}`);
  }
  return out.join("\n") + "\n";
}

const REGIONS = ["norte", "sur", "centro", "oriente"];
const PRODUCTS = ["widget", "gadget", "sprocket", "gizmo"];
function makeSales(): string {
  const r = rng(4242);
  const rows = ["id,region,product,units,price"];
  for (let i = 1; i <= 64; i++) {
    const region = REGIONS[Math.floor(r() * REGIONS.length)];
    const product = PRODUCTS[Math.floor(r() * PRODUCTS.length)];
    const units = 5 + Math.floor(r() * 120);
    const price = (10 + Math.floor(r() * 9000) / 100).toFixed(2);
    rows.push(`${i},${region},${product},${units},${price}`);
  }
  return rows.join("\n") + "\n";
}

const APP_JSON = {
  name: "tienda-api", port: 8080, logLevel: "info", maxUploadMb: 10, corsOrigin: "https://tienda.example.com",
  workers: 4, featureCheckout: true, sessionSecretRef: "vault:tienda/session",
};
const APP_STAGING_JSON = {
  ...APP_JSON, port: 8081, logLevel: "debug", corsOrigin: "https://staging.tienda.example.com", workers: 2,
};

const CACHE_INI = `; cache settings
[default]
backend = redis
ttl_seconds = 300
max_entries = 10000

[sessions]
ttl_seconds = 1800
max_entries = 20000

[products]
ttl_seconds = 600
max_entries = 5000
compress = true
`;

const DB_YAML = `primary:
  host: db-primary.internal
  port: 5433
  database: tienda
  pool_size: 20
replica:
  host: db-replica.internal
  port: 5434
  database: tienda
  pool_size: 10
`;

export const FS_BLIND_SEED: Record<string, string> = {
  "README.md": "# tienda-api\n\nBackend of the online shop.\n\nSee docs/intro.md to get started.\n",
  "CHANGELOG.md": "# Changelog\n\n## 1.4.0\n- checkout v2\n\n## 1.3.2\n- fix cart totals\n",
  "REPORT.md": "# Weekly report\n\nWeek 40 summary.\n",
  "config/app.json": JSON.stringify(APP_JSON, null, 2) + "\n",
  "config/app.staging.json": JSON.stringify(APP_STAGING_JSON, null, 2) + "\n",
  "config/db.yaml": DB_YAML,
  "config/cache.ini": CACHE_INI,
  "config/features.yaml": "checkout_v2: true\nwishlist: false\nreviews: true\n",
  "docs/intro.md": "# Intro\n\nThe API serves the shop frontend.\n",
  "docs/api/endpoints.md": "# Endpoints\n\n- GET /users\n- GET /orders\n- POST /orders\n",
  "docs/api/auth.md": "# Auth\n\nTokens expire after 30 minutes.\n",
  "docs/guides/deploy.md": "# Deploy\n\nRun scripts/deploy.sh from the repo root.\n",
  "docs/guides/onboarding/first-week.md":
    "# First week\n\n- Day 1: laptop and accounts\n- Day 2: read docs/api\n- Buddy: Marta Riquelme\n- Team lead: Tomas Vidal\n",
  "logs/api/2026-10-01.log": makeLog(11, "2026-10-01", 140, [0.08, 0.12]),
  "logs/api/2026-10-02.log": makeLog(12, "2026-10-02", 180, [0.10, 0.10]),
  "logs/api/2026-10-03.log": makeLog(13, "2026-10-03", 120, [0.05, 0.15]),
  "logs/worker/2026-10-01.log": makeLog(21, "2026-10-01", 90, [0.12, 0.08]),
  "logs/worker/2026-10-02.log": makeLog(22, "2026-10-02", 160, [0.06, 0.25]),
  "logs/archive/2026-09-30.log": makeLog(31, "2026-09-30", 70, [0.15, 0.10]),
  "data/sales.csv": makeSales(),
  "data/regions.csv": "region,manager\nnorte,Ana\nsur,Bruno\ncentro,Carla\noriente,Diego\n",
  "src/server.ts": 'import { route } from "./routes/users.ts";\nexport const PORT = 8080;\nexport function start() {\n  return route;\n}\n',
  "src/routes/users.ts": 'export const route = "/users";\n',
  "src/routes/orders.ts": 'export const route = "/orders";\n',
  "src/lib/db.ts": 'export const DB_HOST = "db-primary.internal";\n',
  "src/lib/cache.ts": "export const TTL = 300;\n",
  "src/lib/util.ts": "export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n",
  "src/worker/queue.ts": 'export const QUEUE = "orders";\n',
  "scripts/deploy.sh": "#!/bin/sh\necho deploy\n",
  "scripts/backup.sh": "#!/bin/sh\necho backup\n",
  "tests/users.test.ts": 'import { route } from "../src/routes/users.ts";\nconsole.assert(route === "/users");\n',
  "tests/orders.test.ts": 'import { route } from "../src/routes/orders.ts";\nconsole.assert(route === "/orders");\n',
};

export function seedFsBlind(dir: string) {
  for (const [path, content] of Object.entries(FS_BLIND_SEED)) {
    const full = `${dir}/${path}`;
    Deno.mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
    Deno.writeTextFileSync(full, content);
  }
}

// ---------- expected answers, computed from the seed ----------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`fs blind task invariant failed: ${msg}`);
}

const LOG_PATHS = Object.keys(FS_BLIND_SEED).filter((p) => p.startsWith("logs/"));
const levelCount = (p: string, level: string) =>
  FS_BLIND_SEED[p].split("\n").filter((l) => l.split(" ")[1] === level).length;

const TOTAL_ERRORS = LOG_PATHS.reduce((n, p) => n + levelCount(p, "ERROR"), 0);
const API_ERRORS = LOG_PATHS.filter((p) => p.startsWith("logs/api/")).reduce((n, p) => n + levelCount(p, "ERROR"), 0);
// The trap: INFO lines that mention "error" in lower case must not be counted.
assert(LOG_PATHS.some((p) => FS_BLIND_SEED[p].includes("INFO retrying after error")), "error-word trap present");
assert(TOTAL_ERRORS > 20, "enough ERROR lines");

const warnRanking = LOG_PATHS.map((p) => ({ p, n: levelCount(p, "WARN") })).sort((a, b) => b.n - a.n);
assert(warnRanking[0].n > warnRanking[1].n, "unique log with most WARN lines");
const MOST_WARN = warnRanking[0].p;

const salesRows = FS_BLIND_SEED["data/sales.csv"].trim().split("\n").slice(1).map((l) => l.split(","));
const NORTE_UNITS = salesRows.filter((r) => r[1] === "norte").reduce((n, r) => n + Number(r[3]), 0);
assert(salesRows.length >= 40 && salesRows.length <= 80, "csv row count");
assert(salesRows.filter((r) => r[1] === "norte").length >= 5, "enough norte rows");

const MD_FILES = Object.keys(FS_BLIND_SEED).filter((p) => p.endsWith(".md")).sort();
assert(MD_FILES.length >= 6, "non-trivial md set");

const DIFF_KEYS = Object.keys(APP_JSON).filter((k) =>
  JSON.stringify((APP_JSON as Record<string, unknown>)[k]) !== JSON.stringify((APP_STAGING_JSON as Record<string, unknown>)[k])
);
const SAME_KEYS = Object.keys(APP_JSON).filter((k) => !DIFF_KEYS.includes(k));
assert(DIFF_KEYS.length >= 3 && SAME_KEYS.length >= 3, "config diff non-trivial");
// No key may be a substring of another, so word checks are unambiguous.
for (const a of Object.keys(APP_JSON)) for (const b of Object.keys(APP_JSON)) assert(a === b || !lcs(b).includes(lcs(a)), `key ${a} inside ${b}`);
function lcs(s: string) {
  return s.toLowerCase();
}

const ONCALL = "# Guardia\n\n- lunes: Ana\n- martes: Bruno\n- miércoles: Carla\n";

const CACHE_INI_EDITED = CACHE_INI.replace("[products]\nttl_seconds = 600\nmax_entries = 5000\n", "[products]\nttl_seconds = 600\nmax_entries = 8000\n");
assert(CACHE_INI_EDITED !== CACHE_INI && (CACHE_INI.match(/max_entries/g) ?? []).length === 3, "ini edit target");

// ---------- check helpers ----------

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const e of Deno.readDirSync(rel ? `${dir}/${rel}` : dir)) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory) walk(p);
      else out[p] = new TextDecoder().decode(Deno.readFileSync(`${dir}/${p}`));
    }
  };
  walk("");
  return out;
}

// The workspace must equal the seed with exactly these changes (null removes a file).
function diskIs(dir: string, changes: Record<string, string | null>): boolean {
  const expected: Record<string, string> = { ...FS_BLIND_SEED };
  for (const [p, c] of Object.entries(changes)) {
    if (c === null) delete expected[p];
    else expected[p] = c;
  }
  const actual = snapshot(dir);
  const ka = Object.keys(actual).sort(), ke = Object.keys(expected).sort();
  return ka.length === ke.length && ka.every((k, i) => k === ke[i] && actual[k] === expected[k]);
}

const clean = (t: string) => t.replace(/[`*_]/g, "");
// First integer in the reply, accepting thousands separators ("1,234", "1.234", "1 234").
function firstInt(t: string): number | null {
  const m = clean(t).match(/\d{1,3}(?:[.,  ]\d{3})+(?!\d)|\d+/);
  return m ? Number(m[0].replace(/\D/g, "")) : null;
}
// All paths like "dir/file.ext" mentioned in the reply, without a leading "./".
const pathsIn = (t: string, ext: string) =>
  new Set((clean(t).match(new RegExp(`[\\w./-]*\\.${ext}\\b`, "g")) ?? []).map((p) => p.replace(/^\.\//, "")));

export const FS_BLIND_EXPECTED = { TOTAL_ERRORS, API_ERRORS, MOST_WARN, NORTE_UNITS, MD_FILES, DIFF_KEYS, SAME_KEYS, ONCALL, CACHE_INI_EDITED };

export const fsBlindTasks: DiskTask[] = [
  // ---- reads ----
  {
    id: "fsb-read-buddy",
    prompt: "Según docs/guides/onboarding/first-week.md, ¿quién es el buddy asignado? Responde solo con el nombre completo.",
    check: (_d, t) => /marta\s+riquelme/i.test(t) && !/tomas/i.test(t),
  },
  {
    id: "fsb-read-db-primary",
    prompt: "En config/db.yaml, ¿cuál es el host y el puerto de la base de datos primaria? Responde en el formato host:puerto.",
    check: (_d, t) => /db-primary\.internal/.test(t) && /\b5433\b/.test(t) && !/replica|5434/.test(t),
  },
  {
    id: "fsb-read-readme-link",
    prompt: "README.md menciona un archivo de documentación para empezar. ¿Cuál es la primera línea de ese archivo? Responde solo con esa línea.",
    check: (_d, t) => clean(t).includes("# Intro") || /^\s*#?\s*intro\.?\s*$/i.test(clean(t)),
  },
  // ---- aggregations ----
  {
    id: "fsb-count-errors",
    prompt:
      "¿Cuántas líneas con nivel ERROR hay en total entre todos los archivos .log dentro de logs/ (incluidas las subcarpetas)? " +
      'El nivel es la segunda palabra de cada línea; una línea INFO que dice "error" no cuenta. Responde solo con el número.',
    check: (_d, t) => firstInt(t) === TOTAL_ERRORS,
  },
  {
    id: "fsb-sum-norte",
    prompt: 'En data/sales.csv, ¿cuál es la suma de la columna units de las filas cuya región es "norte"? Responde solo con el número.',
    check: (_d, t) => firstInt(t) === NORTE_UNITS,
  },
  {
    id: "fsb-most-warn",
    prompt: "¿Qué archivo .log dentro de logs/ (incluidas las subcarpetas) tiene más líneas con nivel WARN? Responde solo con su ruta relativa.",
    check: (_d, t) => {
      const found = pathsIn(t, "log");
      const want = MOST_WARN.replace(/^logs\//, "");
      return [...found].some((p) => p === MOST_WARN || p === want) &&
        [...found].every((p) => p === MOST_WARN || p === want);
    },
  },
  {
    id: "fsb-list-md",
    prompt: "Lista todos los archivos .md del proyecto, en todas las carpetas. Responde solo con las rutas relativas, una por línea.",
    check: (_d, t) => {
      const found = pathsIn(t, "md");
      return found.size === MD_FILES.length && MD_FILES.every((p) => found.has(p));
    },
  },
  {
    id: "fsb-config-diff",
    prompt:
      "Compara config/app.json con config/app.staging.json. ¿Qué claves de primer nivel tienen valores distintos? Responde solo con los nombres de las claves, una por línea.",
    check: (_d, t) => {
      const l = t.toLowerCase();
      return DIFF_KEYS.every((k) => l.includes(k.toLowerCase())) && SAME_KEYS.every((k) => !l.includes(k.toLowerCase()));
    },
  },
  // ---- writes ----
  {
    id: "fsb-create-oncall",
    prompt:
      'Crea el archivo ops/oncall.md con exactamente estas cinco líneas, en este orden: "# Guardia", una línea vacía, "- lunes: Ana", "- martes: Bruno" y "- miércoles: Carla" ' +
      "(sin las comillas). El archivo debe terminar con un salto de línea final, sin espacios extra. No modifiques ningún otro archivo.",
    check: (d) => diskIs(d, { "ops/oncall.md": ONCALL }),
  },
  {
    id: "fsb-edit-ini",
    prompt:
      "En config/cache.ini cambia max_entries de la sección [products] de 5000 a 8000. Las demás secciones también tienen max_entries: no las toques. " +
      "El resto del archivo debe quedar idéntico byte a byte, y ningún otro archivo debe cambiar.",
    check: (d) => diskIs(d, { "config/cache.ini": CACHE_INI_EDITED }),
  },
  {
    id: "fsb-move-archive",
    prompt: "Mueve logs/archive/2026-09-30.log a archive/logs/2026-09-30.log, sin cambiar su contenido. No modifiques ningún otro archivo.",
    check: (d) =>
      diskIs(d, { "logs/archive/2026-09-30.log": null, "archive/logs/2026-09-30.log": FS_BLIND_SEED["logs/archive/2026-09-30.log"] }),
  },
  {
    id: "fsb-append-report",
    prompt:
      'Cuenta las líneas con nivel ERROR (segunda palabra de la línea) en los archivos de logs/api/ y agrega al final de REPORT.md la línea "Errores API: N", ' +
      "donde N es ese número escrito sin separadores. La línea debe terminar con un salto de línea final. No cambies nada más de REPORT.md ni de otros archivos.",
    check: (d) => diskIs(d, { "REPORT.md": FS_BLIND_SEED["REPORT.md"] + `Errores API: ${API_ERRORS}\n` }),
  },
];
