// Minimal client for the real GitHub REST API, locked to the sandbox repo.
// The token never appears in errors or logs.
export const OWNER = "Rixmerz";
export const NAME = "phrasebook-sandbox";
export const REPO = `${OWNER}/${NAME}`;

export function tokenFromEnv(): string {
  const path = `${Deno.env.get("HOME")}/.config/glosa/env`;
  const line = Deno.readTextFileSync(path).split("\n").find((l) => l.startsWith("GITHUB_PERSONAL_ACCESS_TOKEN="));
  if (!line) throw new Error(`GITHUB_PERSONAL_ACCESS_TOKEN missing in ${path}`);
  return line.slice(line.indexOf("=") + 1).trim();
}

// deno-lint-ignore no-explicit-any
export async function api(token: string, method: string, path: string, body?: unknown): Promise<any> {
  if (!path.startsWith(`/repos/${REPO}/`) && !path.startsWith(`/repos/${REPO}?`)) {
    throw new Error(`refusing a request outside ${REPO}: ${method} ${path}`);
  }
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// Every page of a list endpoint.
// deno-lint-ignore no-explicit-any
export async function all(token: string, path: string): Promise<any[]> {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const rows = await api(token, "GET", `${path}${sep}per_page=100&page=${page}`);
    out.push(...rows);
    if (rows.length < 100) return out;
  }
}
