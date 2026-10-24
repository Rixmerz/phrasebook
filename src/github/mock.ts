// A small fake of the GitHub REST v3 and GraphQL API, enough for the benchmark
// tasks. The real github-mcp-server talks to it through --gh-host.
// Each run uses its own token, and the token selects an isolated state bucket.
// Control routes: POST /__seed, GET /__state, GET /__unhandled (all by token).

export type User = { login: string; id: number };
export type Label = { id: number; name: string; color: string; description: string };
export type Comment = { id: number; body: string; user: User; created_at: string };
export type Issue = {
  number: number; title: string; body: string; state: "open" | "closed";
  state_reason: string | null; labels: string[]; assignees: string[]; author: string;
  comments: Comment[]; created_at: string; updated_at: string;
};
export type PrFile = { filename: string; status: string; additions: number; deletions: number; patch: string };
export type Pull = {
  number: number; title: string; body: string; state: "open" | "closed"; merged: boolean;
  merge_method: string | null; head: string; base: string; author: string; draft: boolean;
  files: PrFile[]; comments: Comment[]; created_at: string; updated_at: string;
};
export type Commit = { sha: string; message: string; author: string; date: string; branch: string };
export type Repo = {
  owner: string; name: string; default_branch: string;
  branches: Record<string, string>; // name -> head sha
  files: Record<string, Record<string, string>>; // branch -> path -> content
  issues: Issue[]; pulls: Pull[]; commits: Commit[]; labels: string[];
};
export type State = { repos: Repo[]; users: string[]; me: string; nextId: number };

import { createHash } from "node:crypto";

const states = new Map<string, State>();
// Content-addressed, so sharing it across runs is safe.
const globalBlobs = new Map<string, string>();
const unhandled = new Map<string, string[]>();
const BASE = "http://localhost";

const uid = (login: string) => 1000 + [...login].reduce((s, c) => s + c.charCodeAt(0), 0);
const user = (login: string): User => ({ login, id: uid(login), type: "User", html_url: `https://github.com/${login}` } as User);
const sha = (seed: string) => {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h.toString(16).padStart(8, "0").repeat(5)).slice(0, 40);
};
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
const now = () => new Date().toISOString();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const notFound = (msg = "Not Found") => json({ message: msg, documentation_url: "https://docs.github.com/rest" }, 404);

function labelObj(name: string, i: number): Label {
  return { id: 5000 + i, name, color: "ededed", description: "" , node_id: `LA_${i}`, default: false } as Label;
}

function issueJson(r: Repo, i: Issue) {
  return {
    id: 100000 + i.number, node_id: `I_${i.number}`, number: i.number, title: i.title, body: i.body,
    state: i.state, state_reason: i.state_reason, locked: false,
    labels: i.labels.map((l) => labelObj(l, r.labels.indexOf(l))),
    assignees: i.assignees.map(user), assignee: i.assignees[0] ? user(i.assignees[0]) : null,
    user: user(i.author), comments: i.comments.length,
    html_url: `https://github.com/${r.owner}/${r.name}/issues/${i.number}`,
    url: `${BASE}/api/v3/repos/${r.owner}/${r.name}/issues/${i.number}`,
    repository_url: `${BASE}/api/v3/repos/${r.owner}/${r.name}`,
    created_at: i.created_at, updated_at: i.updated_at, closed_at: i.state === "closed" ? i.updated_at : null,
    author_association: "MEMBER", milestone: null,
  };
}

function pullJson(r: Repo, p: Pull) {
  return {
    id: 200000 + p.number, node_id: `PR_${p.number}`, number: p.number, title: p.title, body: p.body,
    state: p.state, merged: p.merged, draft: p.draft, locked: false, mergeable: !p.merged, mergeable_state: "clean",
    user: user(p.author), labels: [], assignees: [], requested_reviewers: [],
    head: { ref: p.head, sha: r.branches[p.head] ?? sha(p.head), label: `${r.owner}:${p.head}`, repo: repoJson(r) },
    base: { ref: p.base, sha: r.branches[p.base] ?? sha(p.base), label: `${r.owner}:${p.base}`, repo: repoJson(r) },
    html_url: `https://github.com/${r.owner}/${r.name}/pull/${p.number}`,
    url: `${BASE}/api/v3/repos/${r.owner}/${r.name}/pulls/${p.number}`,
    created_at: p.created_at, updated_at: p.updated_at, merged_at: p.merged ? p.updated_at : null,
    comments: p.comments.length, review_comments: 0,
    // Must agree with /pulls/:n/commits, or models that trust the summary get a false answer.
    commits: Math.max(1, r.commits.filter((c) => c.branch === p.head).length),
    additions: p.files.reduce((s, f) => s + f.additions, 0), deletions: p.files.reduce((s, f) => s + f.deletions, 0),
    changed_files: p.files.length, maintainer_can_modify: false,
  };
}

function repoJson(r: Repo) {
  return {
    id: uid(r.owner + "/" + r.name), node_id: `R_${r.name}`, name: r.name, full_name: `${r.owner}/${r.name}`,
    private: false, owner: user(r.owner), html_url: `https://github.com/${r.owner}/${r.name}`,
    description: "", fork: false, default_branch: r.default_branch, visibility: "public",
    open_issues_count: r.issues.filter((i) => i.state === "open").length,
    created_at: "2024-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", pushed_at: "2026-01-01T00:00:00Z",
    permissions: { admin: true, push: true, pull: true },
  };
}

function commitJson(r: Repo, c: Commit) {
  return {
    sha: c.sha, node_id: `C_${c.sha.slice(0, 7)}`,
    commit: { message: c.message, author: { name: c.author, email: `${c.author}@example.com`, date: c.date },
      committer: { name: c.author, email: `${c.author}@example.com`, date: c.date }, tree: { sha: sha("tree" + c.sha) } },
    author: user(c.author), committer: user(c.author), parents: [],
    html_url: `https://github.com/${r.owner}/${r.name}/commit/${c.sha}`,
    url: `${BASE}/api/v3/repos/${r.owner}/${r.name}/commits/${c.sha}`,
  };
}

// The server checks blob ids, so they must be real git object ids.
function gitBlobSha(content: string) {
  const bytes = new TextEncoder().encode(content);
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function contentJson(r: Repo, path: string, content: string, ref: string) {
  const blobSha = gitBlobSha(content);
  globalBlobs.set(blobSha, content);
  return {
    type: "file", encoding: "base64", size: content.length, name: path.split("/").pop(), path,
    content: b64(content), sha: blobSha,
    url: `${BASE}/api/v3/repos/${r.owner}/${r.name}/contents/${path}?ref=${ref}`,
    html_url: `https://github.com/${r.owner}/${r.name}/blob/${ref}/${path}`,
    download_url: `${BASE}/raw/${r.owner}/${r.name}/${ref}/${path}`,
  };
}

// Real GitHub caps per_page at 100 and announces other pages in a Link header.
function pageParams(url: URL) {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const per = Math.min(100, Math.max(1, Number(url.searchParams.get("per_page") ?? 30)));
  return { page, per };
}
function paginate<T>(items: T[], url: URL): T[] {
  const { page, per } = pageParams(url);
  return items.slice((page - 1) * per, page * per);
}
function linkHeader(total: number, url: URL) {
  const { page, per } = pageParams(url);
  const last = Math.max(1, Math.ceil(total / per));
  const at = (n: number) => {
    const u = new URL(url);
    u.searchParams.set("page", String(n));
    u.searchParams.set("per_page", String(per));
    return `<${u}>`;
  };
  const rels = [];
  if (page < last) rels.push(`${at(page + 1)}; rel="next"`, `${at(last)}; rel="last"`);
  if (page > 1) rels.push(`${at(1)}; rel="first"`, `${at(page - 1)}; rel="prev"`);
  return rels.join(", ");
}
function pageJson<T>(items: T[], url: URL, wrap?: (page: T[]) => unknown) {
  const res = json(wrap ? wrap(paginate(items, url)) : paginate(items, url));
  const link = linkHeader(items.length, url);
  if (link) res.headers.set("link", link);
  return res;
}

// GitHub search syntax: is:open|closed, is:issue|pr, label:, assignee:, author:, repo:, plus free words.
function matchQuery(q: string, i: Issue, r: Repo, isPr: boolean) {
  for (const tok of q.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
    const [k, ...rest] = tok.split(":");
    const v = rest.join(":").replace(/"/g, "").toLowerCase();
    if (!rest.length) {
      const w = tok.replace(/"/g, "").toLowerCase();
      if (!(i.title + " " + i.body).toLowerCase().includes(w)) return false;
      continue;
    }
    switch (k.toLowerCase()) {
      case "is":
        if ((v === "issue" && isPr) || ((v === "pr" || v === "pull-request") && !isPr)) return false;
        if ((v === "open" || v === "closed") && i.state !== v) return false;
        if (v === "merged" && !(isPr && (i as unknown as Pull).merged)) return false;
        break;
      case "state": if (i.state !== v) return false; break;
      case "label": if (!i.labels?.some((l) => l.toLowerCase() === v)) return false; break;
      case "assignee": if (!i.assignees?.some((a) => a.toLowerCase() === v)) return false; break;
      case "author": if (i.author.toLowerCase() !== v) return false; break;
      case "repo": if (`${r.owner}/${r.name}`.toLowerCase() !== v) return false; break;
      case "user": case "org": if (r.owner.toLowerCase() !== v) return false; break;
      case "in": break;
      default: return false;
    }
  }
  return true;
}

function findIssueByNode(st: State, id: string) {
  const n = Number(String(id).replace(/^I_/, ""));
  for (const r of st.repos) {
    const i = r.issues.find((x) => x.number === n);
    if (i) return { r, i };
  }
  return null;
}

function graphql(st: State, body: { query: string; variables: Record<string, unknown> }) {
  const v = body.variables ?? {};
  const q = body.query ?? "";
  const repo = () => st.repos.find((x) => x.owner === v.owner && x.name === v.repo);

  // Extra issue details fetched by id; this fake has no fields, parents or sub-issues.
  if (/^query\(\$ids:\[ID!\]!\)\{nodes\(ids: \$ids\)/.test(q)) {
    return json({
      data: {
        // Only return the fields the query asked for; the client rejects extras.
        nodes: (v.ids as string[]).map((id) => ({
          id, issueFieldValues: { nodes: [] },
          ...(/parent\{/.test(q) ? { parent: null } : {}),
          ...(/closedByPullRequestsReferences/.test(q) ? { closedByPullRequestsReferences: { totalCount: 0, nodes: [] } } : {}),
          ...(/subIssuesSummary/.test(q) ? { subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 } } : {}),
        })),
      },
    });
  }
  if (/^\{viewer\{id\}\}$/.test(q.trim())) return json({ data: { viewer: { id: `U_${st.me}` } } });
  // Creating a pull request review: stored as a review, not as a conversation comment.
  if (/^mutation\(\$input:AddPullRequestReviewInput!\)/.test(q)) {
    const input = (v.input ?? {}) as Record<string, unknown>;
    const n = Number(String(input.pullRequestId ?? "").replace(/^PR_/, ""));
    const pr = st.repos.flatMap((r) => r.pulls).find((x) => x.number === n);
    if (!pr) return json({ errors: [{ message: "Could not resolve to a node" }] });
    const reviews = ((pr as unknown as { reviews?: unknown[] }).reviews ??= []);
    const review = { id: `PRR_${n}_${reviews.length + 1}`, body: String(input.body ?? ""), state: input.event ? String(input.event) : "PENDING" };
    reviews.push(review);
    return json({ data: { addPullRequestReview: { pullRequestReview: { id: review.id, state: review.state, url: `https://github.com/pull/${n}#review` } } } });
  }
  // A pull request's node id, by number.
  if (/pullRequest\(number: \$prNum\)\{id\}/.test(q)) {
    const pr = repo()?.pulls.find((x) => x.number === v.prNum);
    return json({ data: { repository: { pullRequest: pr ? { id: `PR_${pr.number}` } : null } } });
  }
  // Custom issue fields: this fake defines none.
  if (/issueFields\(first:/.test(q)) {
    const r = st.repos.find((x) => x.owner === v.owner && x.name === (v.name ?? v.repo));
    return json({ data: { repository: r ? { issueFields: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } : null } });
  }
  // Repository labels: the full list, or one by name.
  if (/repository\(owner: \$owner, name: \$repo\)\{labels\(/.test(q)) {
    const r = repo();
    const nodes = (r?.labels ?? []).map((l, i) => ({ id: `LA_${i}`, name: l, color: "ededed", description: "" }));
    return json({ data: { repository: r ? { labels: { nodes, totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null } } } : null } });
  }
  if (/repository\(owner: \$owner, name: \$repo\)\{label\(name: \$name\)/.test(q)) {
    const r = repo();
    const i = r?.labels.indexOf(String(v.name)) ?? -1;
    return json({ data: { repository: r ? { label: i >= 0 ? { id: `LA_${i}`, name: r!.labels[i], color: "ededed", description: "" } : null } : null } });
  }
  // Assignee suggestions, used when assigning: this fake has no bots to suggest.
  if (/suggestedActors\(/.test(q)) {
    return json({ data: { repository: { suggestedActors: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } });
  }
  if (/issue\(number: \$issueNumber\)\{id\}/.test(q)) {
    const i = repo()?.issues.find((x) => x.number === v.issueNumber);
    return json({ data: { repository: { issue: i ? { id: `I_${i.number}` } : null } } });
  }
  if (/issue\(number: \$issueNumber\)\{labels\(/.test(q)) {
    const r = repo();
    const i = r?.issues.find((x) => x.number === v.issueNumber);
    return json({
      data: {
        repository: {
          issue: i
            ? { labels: { totalCount: i.labels.length, nodes: i.labels.map((l) => ({ id: `LA_${r!.labels.indexOf(l)}`, name: l, color: "ededed", description: "" })) } }
            : null,
        },
      },
    });
  }
  // Closing or reopening by node id, with an optional state reason.
  if (/^mutation/.test(q) && /(closeIssue|reopenIssue|updateIssue)\(/.test(q)) {
    const input = (v.input ?? {}) as Record<string, unknown>;
    const hit = findIssueByNode(st, String(input.issueId ?? input.id ?? ""));
    if (!hit) return json({ errors: [{ message: "Could not resolve to a node" }] });
    if (/closeIssue\(/.test(q)) {
      hit.i.state = "closed";
      hit.i.state_reason = String(input.stateReason ?? "COMPLETED").toLowerCase();
    } else if (/reopenIssue\(/.test(q)) {
      hit.i.state = "open";
      hit.i.state_reason = null;
    }
    hit.i.updated_at = now();
    const payload = { issue: { id: `I_${hit.i.number}`, number: hit.i.number, url: `https://github.com/${hit.r.owner}/${hit.r.name}/issues/${hit.i.number}`, state: hit.i.state.toUpperCase() } };
    const key = q.match(/(closeIssue|reopenIssue|updateIssue)\(/)![1];
    return json({ data: { [key]: payload } });
  }

  if (!/repository\(owner: \$owner, name: \$repo\)\{issues\(/.test(q)) return null;
  const r = st.repos.find((x) => x.owner === v.owner && x.name === v.repo);
  if (!r) return json({ data: { repository: null }, errors: [{ message: "Could not resolve to a Repository" }] });
  const statesWanted = ((v.states as string[]) ?? ["OPEN", "CLOSED"]).map((s) => s.toLowerCase());
  const labels = (v.labels as string[] | undefined)?.map((l) => l.toLowerCase());
  let items = r.issues.filter((i) => statesWanted.includes(i.state));
  if (labels?.length) items = items.filter((i) => labels.every((l) => i.labels.some((x) => x.toLowerCase() === l)));
  if (v.since) items = items.filter((i) => i.updated_at >= String(v.since));
  const field = v.orderBy === "UPDATED_AT" ? "updated_at" : "created_at";
  items.sort((a, b) => (a[field] < b[field] ? -1 : 1));
  if (v.direction !== "ASC") items.reverse();
  const first = Math.min(100, Number(v.first ?? 30));
  const start = v.after ? Number(atob(String(v.after))) : 0;
  const page = items.slice(start, start + first);
  const end = start + page.length;
  return json({
    data: {
      repository: {
        isPrivate: false,
        issues: {
          totalCount: items.length,
          pageInfo: { hasNextPage: end < items.length, hasPreviousPage: start > 0, startCursor: btoa(String(start)), endCursor: btoa(String(end)) },
          nodes: page.map((i) => ({
            number: i.number, title: i.title, body: i.body, state: i.state.toUpperCase(), databaseId: 100000 + i.number,
            author: { login: i.author }, createdAt: i.created_at, updatedAt: i.updated_at,
            labels: { nodes: i.labels.map((l, n) => ({ name: l, id: `LA_${n}`, description: "" })) },
            assignees: { nodes: i.assignees.map((login) => ({ login })) },
            comments: { totalCount: i.comments.length }, issueFieldValues: { nodes: [] },
          })),
        },
      },
    },
  });
}

async function handle(req: Request, st: State, token: string): Promise<Response | null> {
  const url = new URL(req.url);
  const p = url.pathname.replace(/^\/api\/v3/, "");
  const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
  let m: RegExpMatchArray | null;

  if (url.pathname === "/api/graphql") return graphql(st, body);
  if (p === "/user" && req.method === "GET") return json({ ...user(st.me), name: st.me, public_repos: st.repos.length });

  if (p.startsWith("/search/")) {
    const q = url.searchParams.get("q") ?? "";
    const kind = p.split("/")[2];
    if (kind === "issues") {
      const hits: unknown[] = [];
      for (const r of st.repos) {
        for (const i of r.issues) if (matchQuery(q, i, r, false)) hits.push(issueJson(r, i));
        for (const pr of r.pulls) {
          const asIssue = { ...pr, labels: [], assignees: [], state_reason: null } as unknown as Issue;
          if (matchQuery(q, asIssue, r, true)) hits.push({ ...issueJson(r, asIssue), pull_request: { url: pullJson(r, pr).url, merged_at: pr.merged ? pr.updated_at : null } });
        }
      }
      return pageJson(hits, url, (items) => ({ total_count: hits.length, incomplete_results: false, items }));
    }
    if (kind === "users") {
      const w = q.toLowerCase();
      const items = st.users.filter((u) => u.includes(w.split(" ")[0])).map(user);
      return json({ total_count: items.length, incomplete_results: false, items });
    }
    if (kind === "code") {
      const items: unknown[] = [];
      const words = q.split(/\s+/).filter((t) => !t.includes(":")).map((t) => t.toLowerCase());
      for (const r of st.repos) for (const [path, content] of Object.entries(r.files[r.default_branch] ?? {})) {
        if (words.every((w) => content.toLowerCase().includes(w))) {
          items.push({ name: path.split("/").pop(), path, sha: sha(path), repository: repoJson(r), html_url: `https://github.com/${r.owner}/${r.name}/blob/${r.default_branch}/${path}` });
        }
      }
      return json({ total_count: items.length, incomplete_results: false, items });
    }
    if (kind === "repositories") {
      const items = st.repos.map(repoJson);
      return json({ total_count: items.length, incomplete_results: false, items });
    }
    if (kind === "commits") {
      const items = st.repos.flatMap((r) => r.commits.filter((c) => q.split(/\s+/).every((t) => t.includes(":") ? (t.startsWith("author:") ? c.author === t.slice(7) : true) : c.message.toLowerCase().includes(t.toLowerCase()))).map((c) => ({ ...commitJson(r, c), repository: repoJson(r) })));
      return json({ total_count: items.length, incomplete_results: false, items });
    }
  }

  if (!(m = p.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/))) return null;
  const r = st.repos.find((x) => x.owner === m![1] && x.name === m![2]);
  if (!r) return notFound();
  const rest = m[3] ?? "";
  const ref = url.searchParams.get("ref") || r.default_branch;

  if (rest === "" && req.method === "GET") return json(repoJson(r));

  // Users that issues can be assigned to.
  if (rest === "/assignees" && req.method === "GET") return pageJson(st.users.map(user), url);
  // Collaborators: every known user, with push access.
  if (rest === "/collaborators" && req.method === "GET") {
    return pageJson(st.users.map((u) => ({ ...user(u), permissions: { admin: u === r.owner, push: true, pull: true }, role_name: u === r.owner ? "admin" : "write" })), url);
  }

  // Branches and refs
  if (rest === "/branches" && req.method === "GET") {
    return pageJson(Object.entries(r.branches).map(([name, s]) => ({ name, commit: { sha: s, url: "" }, protected: false })), url);
  }
  if ((m = rest.match(/^\/git\/ref\/heads\/(.+)$/)) && req.method === "GET") {
    const s = r.branches[m[1]];
    return s ? json({ ref: `refs/heads/${m[1]}`, node_id: "REF", url: "", object: { sha: s, type: "commit", url: "" } }) : notFound();
  }
  if (rest === "/git/refs" && req.method === "POST") {
    const name = String(body.ref).replace(/^refs\/heads\//, "");
    if (r.branches[name]) return json({ message: "Reference already exists" }, 422);
    const from = Object.entries(r.branches).find(([, s]) => s === body.sha)?.[0] ?? r.default_branch;
    r.branches[name] = body.sha;
    r.files[name] = { ...(r.files[from] ?? {}) };
    return json({ ref: `refs/heads/${name}`, node_id: "REF", url: "", object: { sha: body.sha, type: "commit", url: "" } }, 201);
  }

  // Low-level git objects, used by get_file_contents (blobs) and push_files (trees, commits, refs).
  const git = st as State & { _blobs?: Record<string, string>; _trees?: Record<string, Record<string, string>>; _commits?: Record<string, { tree: string; message: string }> };
  git._blobs ??= {};
  git._trees ??= {};
  git._commits ??= {};
  if ((m = rest.match(/^\/git\/blobs\/([0-9a-f]+)$/)) && req.method === "GET") {
    const content = git._blobs[m[1]] ?? globalBlobs.get(m[1]);
    return content === undefined ? notFound() : json({ sha: m[1], encoding: "base64", content: b64(content), size: content.length, url: "" });
  }
  if ((m = rest.match(/^\/git\/commits\/([0-9a-f]+)$/)) && req.method === "GET") {
    const branch = Object.entries(r.branches).find(([, s]) => s === m![1])?.[0];
    const known = git._commits[m[1]];
    if (!branch && !known) return notFound();
    const tree = known?.tree ?? `tree-${branch}`;
    if (branch && !git._trees[tree]) git._trees[tree] = { ...(r.files[branch] ?? {}) };
    return json({ sha: m[1], tree: { sha: tree, url: "" }, message: known?.message ?? "", parents: [], author: { name: st.me, email: "", date: now() }, url: "" });
  }
  if ((m = rest.match(/^\/git\/trees\/(.+)$/)) && req.method === "GET") {
    const ref = decodeURIComponent(m[1]);
    const branch = r.branches[ref] ? ref : Object.entries(r.branches).find(([, s]) => s === ref)?.[0];
    const files = branch ? r.files[branch] : git._trees[ref];
    if (!files) return notFound();
    const recursive = url.searchParams.has("recursive");
    const entries = new Map<string, unknown>();
    for (const [path, content] of Object.entries(files)) {
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join("/");
        // Subtrees get their own sha, and are served by it, like GitHub does (the MCP server walks them).
        const sub = sha("tree" + ref + "/" + dir);
        if (!git._trees[sub]) {
          git._trees[sub] = Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith(dir + "/")).map(([p, c]) => [p.slice(dir.length + 1), c]));
        }
        if (recursive || i === 1) entries.set(dir, { path: dir, mode: "040000", type: "tree", sha: sub });
      }
      if (recursive || parts.length === 1) entries.set(path, { path, mode: "100644", type: "blob", sha: gitBlobSha(content), size: content.length });
    }
    return json({ sha: sha("tree" + ref), url: "", truncated: false, tree: [...entries.values()] });
  }
  if (rest === "/git/trees" && req.method === "POST") {
    const files = { ...(git._trees[String(body.base_tree)] ?? {}) };
    for (const e of (body.tree ?? []) as { path: string; content?: string; sha?: string | null }[]) {
      if (e.content !== undefined) files[e.path] = e.content;
      else if (e.sha === null) {
        // GitHub refuses to delete a path the base tree does not have.
        if (!(e.path in files)) return json({ message: `GitRPC::BadObjectState: path ${e.path} does not exist` }, 422);
        delete files[e.path];
      }
      else if (e.sha && git._blobs[e.sha] !== undefined) files[e.path] = git._blobs[e.sha];
    }
    const tsha = sha("tree" + JSON.stringify(files));
    git._trees[tsha] = files;
    return json({ sha: tsha, url: "", tree: Object.keys(files).map((path) => ({ path, mode: "100644", type: "blob", sha: sha(path) })) }, 201);
  }
  if (rest === "/git/blobs" && req.method === "POST") {
    const content = body.encoding === "base64" ? unb64(String(body.content)) : String(body.content ?? "");
    const bsha = sha("blob" + content);
    git._blobs[bsha] = content;
    return json({ sha: bsha, url: "" }, 201);
  }
  if (rest === "/git/commits" && req.method === "POST") {
    const csha = sha("commit" + body.tree + body.message + now());
    git._commits[csha] = { tree: String(body.tree), message: String(body.message ?? "") };
    return json({ sha: csha, tree: { sha: body.tree }, message: body.message, parents: [], url: "" }, 201);
  }
  if ((m = rest.match(/^\/git\/refs\/heads\/(.+)$/)) && req.method === "PATCH") {
    const branch = m[1];
    const c = git._commits[String(body.sha)];
    if (!r.branches[branch] || !c) return notFound();
    r.branches[branch] = String(body.sha);
    r.files[branch] = { ...git._trees[c.tree] };
    r.commits.unshift({ sha: String(body.sha), message: c.message, author: st.me, date: now(), branch });
    return json({ ref: `refs/heads/${branch}`, node_id: "REF", url: "", object: { sha: body.sha, type: "commit", url: "" } });
  }

  // Files
  if ((m = rest.match(/^\/contents\/?(.*)$/))) {
    const path = decodeURIComponent(m[1]);
    const branchName = String(body.branch ?? ref).replace(/^refs\/heads\//, "");
    const files = r.files[branchName] ?? r.files[Object.entries(r.branches).find(([, s]) => s === branchName)?.[0] ?? ""];
    if (req.method === "GET") {
      if (!files) return notFound("No commit found for the ref " + branchName);
      if (path in files) return json(contentJson(r, path, files[path], branchName));
      const prefix = path ? path.replace(/\/$/, "") + "/" : "";
      const entries = new Map<string, unknown>();
      for (const f of Object.keys(files)) {
        if (!f.startsWith(prefix)) continue;
        const [head, ...tail] = f.slice(prefix.length).split("/");
        entries.set(head, { type: tail.length ? "dir" : "file", name: head, path: prefix + head, sha: sha(prefix + head), size: tail.length ? 0 : files[f].length });
      }
      return entries.size ? json([...entries.values()]) : notFound();
    }
    if (req.method === "PUT") {
      if (!r.files[branchName]) return notFound("Branch not found");
      const existed = path in r.files[branchName];
      r.files[branchName][path] = unb64(String(body.content ?? ""));
      const c: Commit = { sha: sha(now() + path + Math.random()), message: String(body.message ?? ""), author: st.me, date: now(), branch: branchName };
      r.commits.unshift(c);
      r.branches[branchName] = c.sha;
      return json({ content: contentJson(r, path, r.files[branchName][path], branchName), commit: { sha: c.sha, message: c.message, html_url: "" } }, existed ? 200 : 201);
    }
    if (req.method === "DELETE") {
      if (!r.files[branchName] || !(path in r.files[branchName])) return notFound();
      delete r.files[branchName][path];
      return json({ content: null, commit: { sha: sha(now() + path), message: String(body.message ?? "") } });
    }
  }

  // CI state for a commit: this fake has no CI, so every commit is green with no checks.
  if ((m = rest.match(/^\/commits\/([^/]+)\/check-runs$/)) && req.method === "GET") return json({ total_count: 0, check_runs: [] });
  if ((m = rest.match(/^\/commits\/([^/]+)\/status$/)) && req.method === "GET") {
    return json({ state: "success", sha: m[1], total_count: 0, statuses: [], repository: repoJson(r) });
  }

  // Commits
  if (rest === "/commits" && req.method === "GET") {
    const author = url.searchParams.get("author");
    const branch = url.searchParams.get("sha");
    let cs = r.commits;
    if (author) cs = cs.filter((c) => c.author === author);
    if (branch && r.branches[branch]) cs = cs.filter((c) => c.branch === branch || c.branch === r.default_branch);
    return pageJson(cs.map((c) => commitJson(r, c)), url);
  }
  if ((m = rest.match(/^\/commits\/([^/]+)$/)) && req.method === "GET") {
    const c = r.commits.find((x) => x.sha.startsWith(m![1]) || x.branch === m![1]);
    return c ? json({ ...commitJson(r, c), stats: { additions: 1, deletions: 0, total: 1 }, files: [] }) : notFound();
  }

  // Issues (GitHub serves PRs through /issues too, for comments)
  if (rest === "/issues" && req.method === "POST") {
    const number = Math.max(0, ...r.issues.map((i) => i.number), ...r.pulls.map((x) => x.number)) + 1;
    const i: Issue = {
      number, title: String(body.title ?? ""), body: String(body.body ?? ""), state: "open", state_reason: null,
      labels: (body.labels ?? []) as string[], assignees: (body.assignees ?? []) as string[], author: st.me,
      comments: [], created_at: now(), updated_at: now(),
    };
    for (const l of i.labels) if (!r.labels.includes(l)) r.labels.push(l);
    r.issues.push(i);
    return json(issueJson(r, i), 201);
  }
  if ((m = rest.match(/^\/issues\/(\d+)(\/.*)?$/))) {
    const n = Number(m[1]);
    const sub = m[2] ?? "";
    const issue = r.issues.find((i) => i.number === n);
    const pr = r.pulls.find((x) => x.number === n);
    const target = issue ?? pr;
    if (!target) return notFound();
    if (sub === "" && req.method === "GET") {
      return json(issue ? issueJson(r, issue) : { ...issueJson(r, { ...pr!, labels: [], assignees: [], state_reason: null } as unknown as Issue), pull_request: { url: "" } });
    }
    if (sub === "" && req.method === "PATCH" && issue) {
      if (body.title !== undefined) issue.title = body.title;
      if (body.body !== undefined) issue.body = body.body;
      if (body.state !== undefined) issue.state = body.state;
      if (body.state_reason !== undefined) issue.state_reason = body.state_reason;
      if (body.labels !== undefined) issue.labels = body.labels;
      if (body.assignees !== undefined) issue.assignees = body.assignees;
      if (issue.state === "closed" && !issue.state_reason) issue.state_reason = "completed";
      if (issue.state === "open") issue.state_reason = null;
      issue.updated_at = now();
      return json(issueJson(r, issue));
    }
    if (sub === "/comments" && req.method === "GET") {
      return pageJson(target.comments.map((c) => ({ ...c, html_url: "", author_association: "MEMBER", updated_at: c.created_at })), url);
    }
    if (sub === "/comments" && req.method === "POST") {
      const c: Comment = { id: st.nextId++, body: String(body.body ?? ""), user: user(st.me), created_at: now() };
      target.comments.push(c);
      return json({ ...c, html_url: `https://github.com/${r.owner}/${r.name}/issues/${n}#issuecomment-${c.id}`, author_association: "MEMBER", updated_at: c.created_at }, 201);
    }
    if (sub === "/labels" && req.method === "GET" && issue) return json(issue.labels.map((l) => labelObj(l, r.labels.indexOf(l))));
  }
  if (rest === "/issues" && req.method === "GET") {
    const state = url.searchParams.get("state") ?? "open";
    return pageJson(r.issues.filter((i) => state === "all" || i.state === state).map((i) => issueJson(r, i)), url);
  }
  if ((m = rest.match(/^\/labels\/(.+)$/)) && req.method === "GET") {
    const name = decodeURIComponent(m[1]);
    const i = r.labels.indexOf(name);
    return i >= 0 ? json(labelObj(name, i)) : notFound();
  }

  // Pull requests
  if (rest === "/pulls" && req.method === "GET") {
    const state = url.searchParams.get("state") ?? "open";
    let ps = r.pulls.filter((x) => state === "all" || x.state === state);
    const head = url.searchParams.get("head");
    const base = url.searchParams.get("base");
    if (head) ps = ps.filter((x) => head.endsWith(":" + x.head) || head === x.head);
    if (base) ps = ps.filter((x) => x.base === base);
    ps = [...ps].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    if (url.searchParams.get("direction") === "asc") ps.reverse();
    return pageJson(ps.map((x) => pullJson(r, x)), url);
  }
  if (rest === "/pulls" && req.method === "POST") {
    if (!r.branches[body.head]) return json({ message: "Validation Failed", errors: [{ field: "head", code: "invalid" }] }, 422);
    if (!r.branches[body.base]) return json({ message: "Validation Failed", errors: [{ field: "base", code: "invalid" }] }, 422);
    const number = Math.max(0, ...r.issues.map((i) => i.number), ...r.pulls.map((x) => x.number)) + 1;
    const changed = Object.entries(r.files[body.head] ?? {}).filter(([path, c]) => r.files[body.base]?.[path] !== c);
    const pr: Pull = {
      number, title: String(body.title ?? ""), body: String(body.body ?? ""), state: "open", merged: false, merge_method: null,
      head: body.head, base: body.base, author: st.me, draft: Boolean(body.draft),
      files: changed.map(([filename, c]) => ({ filename, status: r.files[body.base]?.[filename] === undefined ? "added" : "modified", additions: c.split("\n").length, deletions: 0, patch: "" })),
      comments: [], created_at: now(), updated_at: now(),
    };
    r.pulls.push(pr);
    return json(pullJson(r, pr), 201);
  }
  if ((m = rest.match(/^\/pulls\/(\d+)(\/.*)?$/))) {
    const pr = r.pulls.find((x) => x.number === Number(m![1]));
    if (!pr) return notFound();
    const sub = m[2] ?? "";
    if (sub === "" && req.method === "GET") return json(pullJson(r, pr));
    if (sub === "" && req.method === "PATCH") {
      for (const k of ["title", "body", "state", "base", "draft"] as const) if (body[k] !== undefined) (pr as Record<string, unknown>)[k] = body[k];
      pr.updated_at = now();
      return json(pullJson(r, pr));
    }
    if (sub === "/files" && req.method === "GET") {
      return pageJson(pr.files.map((f) => ({ sha: sha(f.filename), changes: f.additions + f.deletions, ...f })), url);
    }
    if (sub === "/commits" && req.method === "GET") return json(r.commits.filter((c) => c.branch === pr.head).map((c) => commitJson(r, c)));
    if (sub === "/merge" && req.method === "PUT") {
      if (pr.merged || pr.state === "closed") return json({ message: "Pull Request is not mergeable" }, 405);
      pr.merged = true;
      pr.state = "closed";
      pr.merge_method = String(body.merge_method ?? "merge");
      pr.updated_at = now();
      for (const f of Object.keys(r.files[pr.head] ?? {})) (r.files[pr.base] ??= {})[f] = r.files[pr.head][f];
      return json({ sha: sha("merge" + pr.number), merged: true, message: "Pull Request successfully merged" });
    }
    if (sub === "/reviews" && req.method === "GET") return json([]);
    if (sub === "/comments" && req.method === "GET") return json([]);
    // Review comments (on diff lines), as real GitHub: a reply needs an existing comment,
    // a new one needs commit_id, path and a line. This fake has no review comments yet.
    if (sub === "/comments" && req.method === "POST") {
      if (body.in_reply_to !== undefined) return notFound();
      if (!body.commit_id || !body.path || (body.line === undefined && body.position === undefined && body.subject_type !== "file")) {
        return json({ message: "Validation Failed", errors: [{ resource: "PullRequestReviewComment", code: "missing_field" }] }, 422);
      }
      return json({ message: "Validation Failed", errors: [{ resource: "PullRequestReviewComment", code: "invalid", field: "path" }] }, 422);
    }
    if ((m = sub.match(/^\/comments\/(\d+)\/replies$/)) && req.method === "POST") return notFound();
  }
  void token;
  return null;
}

export function startMock(port = 8787) {
  return Deno.serve({ port, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
    const url = new URL(req.url);
    const token = (req.headers.get("authorization") ?? "").replace(/^(token|Bearer)\s+/i, "") ||
      url.searchParams.get("token") || "";
    if (url.pathname === "/__seed") {
      states.set(token, await req.json());
      unhandled.set(token, []);
      return json({ ok: true });
    }
    if (url.pathname === "/__state") return json(states.get(token) ?? null);
    if (url.pathname === "/__unhandled") return json(unhandled.get(token) ?? []);
    if (url.pathname === "/__drop") {
      states.delete(token);
      unhandled.delete(token);
      return json({ ok: true });
    }
    const st = states.get(token);
    if (!st) return json({ message: "Bad credentials" }, 401);
    const res = await handle(req.clone(), st, token);
    if (res) return res;
    // A route the fake does not know is a harness gap, not a model error: record it.
    const detail = url.pathname === "/api/graphql" ? " " + (await req.clone().text().catch(() => "")).slice(0, 1500) : "";
    unhandled.get(token)?.push(`${req.method} ${url.pathname}${url.search}${detail}`);
    return json({ message: `phrasebook mock: unhandled route ${req.method} ${url.pathname}` }, 501);
  });
}

if (import.meta.main) {
  startMock(Number(Deno.args[0] ?? 8787));
  console.log("mock GitHub on http://127.0.0.1:" + (Deno.args[0] ?? 8787));
}
