// Parses the GitHub glossary language into calls to the real MCP tools.
// Every command the glossary advertises is supported here, not only the ones
// the tasks use, so arm B is not handicapped by parser gaps.
import type { McpTool } from "../mcp.ts";

export type Call = { tool: string; args: Record<string, unknown> };
export class CommandError extends Error {}

type Target = { owner?: string; repo?: string; number?: number };
type Spec = {
  tool: string;
  // Fixed arguments, such as a `method` that selects a sub-operation.
  fixed?: Record<string, unknown>;
  // Glossary key -> tool parameter, when the names differ.
  rename?: Record<string, string>;
  // Where the #n of the target goes, if the command takes one.
  numberAs?: string;
  needs?: "repo" | "number" | "owner";
  usage: string;
};

const PAGING = { per_page: "perPage" };
const MERGE = { method: "merge_method", title: "commit_title", message: "commit_message" };

// Keyed by "<verb> <noun>". Nouns can be two words; the longest match wins.
const SPECS: Record<string, Spec> = {
  "get me": { tool: "get_me", usage: "get me" },

  "create repo": { tool: "create_repository", rename: { auto_init: "autoInit" }, usage: "create repo name= [organization=] [private=true] [description=] [auto_init=true]" },
  "fork repo": { tool: "fork_repository", needs: "repo", usage: "fork repo <owner>/<repo> [organization=]" },
  "search repo": { tool: "search_repositories", rename: PAGING, usage: "search repo query= [sort=stars|forks|updated]" },

  "list branch": { tool: "list_branches", needs: "repo", rename: PAGING, usage: "list branch <owner>/<repo>" },
  "create branch": { tool: "create_branch", needs: "repo", rename: { from: "from_branch" }, usage: "create branch <owner>/<repo> branch= [from=]" },

  "get commit": { tool: "get_commit", needs: "repo", rename: PAGING, usage: "get commit <owner>/<repo> sha= [detail=none|stats|full_patch]" },
  "list commit": { tool: "list_commits", needs: "repo", rename: PAGING, usage: "list commit <owner>/<repo> [sha=] [path=] [author=] [since=] [until=]" },
  "search commit": { tool: "search_commits", rename: PAGING, usage: "search commit query= [sort=author-date|committer-date]" },

  "get file": { tool: "get_file_contents", needs: "repo", usage: "get file <owner>/<repo> path= [ref=]" },
  "write file": { tool: "create_or_update_file", needs: "repo", usage: "write file <owner>/<repo> path= content= message= branch= [sha=]" },
  "delete file": { tool: "delete_file", needs: "repo", usage: "delete file <owner>/<repo> path= message= branch=" },
  "push file": { tool: "push_files", needs: "repo", usage: "push file <owner>/<repo> branch= message= files=[{\"path\":...,\"content\":...}]" },

  "search code": { tool: "search_code", rename: PAGING, usage: "search code query=" },

  "list tag": { tool: "list_tags", needs: "repo", rename: PAGING, usage: "list tag <owner>/<repo>" },
  "get tag": { tool: "get_tag", needs: "repo", usage: "get tag <owner>/<repo> tag=" },

  "list release": { tool: "list_releases", needs: "repo", rename: PAGING, usage: "list release <owner>/<repo>" },
  "latest release": { tool: "get_latest_release", needs: "repo", usage: "latest release <owner>/<repo>" },
  "get release": { tool: "get_release_by_tag", needs: "repo", usage: "get release <owner>/<repo> tag=" },

  "get issue": { tool: "issue_read", fixed: { method: "get" }, needs: "number", numberAs: "issue_number", usage: "get issue <owner>/<repo>#<n>" },
  "list issue": { tool: "list_issues", needs: "repo", rename: { ...PAGING, order_by: "orderBy" }, usage: "list issue <owner>/<repo> [state=open|closed] [labels=] [order_by=created_at|updated_at|comments] [since=]" },
  "create issue": { tool: "issue_write", fixed: { method: "create" }, needs: "repo", usage: "create issue <owner>/<repo> title= [body=] [labels=] [assignees=] [milestone=] [type=]" },
  "update issue": { tool: "issue_write", fixed: { method: "update" }, needs: "number", numberAs: "issue_number", usage: "update issue <owner>/<repo>#<n> [title=] [body=] [state=open|closed] [state_reason=completed|not_planned|duplicate] [duplicate_of=] [labels=] [assignees=] [milestone=] [type=]" },
  "search issue": { tool: "search_issues", rename: PAGING, usage: "search issue query= [sort=comments|reactions|created|updated]" },
  "assign-copilot issue": { tool: "assign_copilot_to_issue", needs: "number", numberAs: "issue_number", rename: { instructions: "custom_instructions" }, usage: "assign-copilot issue <owner>/<repo>#<n> [base_ref=] [instructions=]" },

  "list issue comment": { tool: "issue_read", fixed: { method: "get_comments" }, needs: "number", numberAs: "issue_number", rename: PAGING, usage: "list issue comment <owner>/<repo>#<n>" },
  "add issue comment": { tool: "add_issue_comment", needs: "number", numberAs: "issue_number", usage: "add issue comment <owner>/<repo>#<n> body=" },
  "update issue comment": { tool: "update_issue_comment", needs: "repo", usage: "update issue comment <owner>/<repo> comment_id= body=" },
  "react issue comment": { tool: "add_issue_comment", needs: "number", numberAs: "issue_number", usage: "react issue comment <owner>/<repo>#<n> comment_id= reaction=+1|-1|laugh|confused|heart|hooray|rocket|eyes" },

  "list sub-issue": { tool: "issue_read", fixed: { method: "get_sub_issues" }, needs: "number", numberAs: "issue_number", rename: PAGING, usage: "list sub-issue <owner>/<repo>#<n>" },
  "parent sub-issue": { tool: "issue_read", fixed: { method: "get_parent" }, needs: "number", numberAs: "issue_number", usage: "parent sub-issue <owner>/<repo>#<n>" },
  "add sub-issue": { tool: "sub_issue_write", fixed: { method: "add" }, needs: "number", numberAs: "issue_number", usage: "add sub-issue <owner>/<repo>#<n> sub_issue_id=" },
  "remove sub-issue": { tool: "sub_issue_write", fixed: { method: "remove" }, needs: "number", numberAs: "issue_number", usage: "remove sub-issue <owner>/<repo>#<n> sub_issue_id=" },
  "reprioritize sub-issue": { tool: "sub_issue_write", fixed: { method: "reprioritize" }, needs: "number", numberAs: "issue_number", usage: "reprioritize sub-issue <owner>/<repo>#<n> sub_issue_id= [after_id=|before_id=]" },

  "get label": { tool: "get_label", needs: "repo", usage: "get label <owner>/<repo> name=" },
  "list label": { tool: "issue_read", fixed: { method: "get_labels" }, needs: "number", numberAs: "issue_number", usage: "list label <owner>/<repo>#<n>" },

  "get pr": { tool: "pull_request_read", fixed: { method: "get" }, needs: "number", numberAs: "pullNumber", usage: "get pr <owner>/<repo>#<n>" },
  "list pr": { tool: "list_pull_requests", needs: "repo", rename: PAGING, usage: "list pr <owner>/<repo> [state=open|closed|all] [base=] [head=] [sort=created|updated|popularity] [direction=asc|desc]" },
  "create pr": { tool: "create_pull_request", needs: "repo", usage: "create pr <owner>/<repo> title= head= base= [body=] [draft=true] [reviewers=]" },
  "update pr": { tool: "update_pull_request", needs: "number", numberAs: "pullNumber", usage: "update pr <owner>/<repo>#<n> [title=] [body=] [state=open|closed] [base=] [draft=] [reviewers=]" },
  "merge pr": { tool: "merge_pull_request", needs: "number", numberAs: "pullNumber", rename: MERGE, usage: "merge pr <owner>/<repo>#<n> [method=merge|squash|rebase] [title=] [message=]" },
  "update-branch pr": { tool: "update_pull_request_branch", needs: "number", numberAs: "pullNumber", usage: "update-branch pr <owner>/<repo>#<n>" },
  "diff pr": { tool: "pull_request_read", fixed: { method: "get_diff" }, needs: "number", numberAs: "pullNumber", usage: "diff pr <owner>/<repo>#<n>" },
  "status pr": { tool: "pull_request_read", fixed: { method: "get_status" }, needs: "number", numberAs: "pullNumber", usage: "status pr <owner>/<repo>#<n>" },
  "files pr": { tool: "pull_request_read", fixed: { method: "get_files" }, needs: "number", numberAs: "pullNumber", rename: PAGING, usage: "files pr <owner>/<repo>#<n>" },
  "commits pr": { tool: "pull_request_read", fixed: { method: "get_commits" }, needs: "number", numberAs: "pullNumber", rename: PAGING, usage: "commits pr <owner>/<repo>#<n>" },
  "checks pr": { tool: "pull_request_read", fixed: { method: "get_check_runs" }, needs: "number", numberAs: "pullNumber", rename: PAGING, usage: "checks pr <owner>/<repo>#<n>" },
  "search pr": { tool: "search_pull_requests", rename: PAGING, usage: "search pr query= [sort=comments|reactions|created|updated]" },
  "request-copilot-review pr": { tool: "request_copilot_review", needs: "number", numberAs: "pullNumber", usage: "request-copilot-review pr <owner>/<repo>#<n>" },

  "list pr comment": { tool: "pull_request_read", fixed: { method: "get_comments" }, needs: "number", numberAs: "pullNumber", rename: PAGING, usage: "list pr comment <owner>/<repo>#<n>" },
  "reply pr comment": { tool: "add_reply_to_pull_request_comment", needs: "repo", numberAs: "pullNumber", rename: { comment_id: "commentId" }, usage: "reply pr comment <owner>/<repo>[#<n>] comment_id= body=" },
  "react pr comment": { tool: "add_reply_to_pull_request_comment", needs: "repo", numberAs: "pullNumber", rename: { comment_id: "commentId" }, usage: "react pr comment <owner>/<repo>[#<n>] comment_id= reaction=" },

  "list review": { tool: "pull_request_read", fixed: { method: "get_reviews" }, needs: "number", numberAs: "pullNumber", rename: PAGING, usage: "list review <owner>/<repo>#<n>" },
  "create review": { tool: "pull_request_review_write", fixed: { method: "create" }, needs: "number", numberAs: "pullNumber", usage: "create review <owner>/<repo>#<n> [event=APPROVE|REQUEST_CHANGES|COMMENT] [body=]" },
  "submit review": { tool: "pull_request_review_write", fixed: { method: "submit_pending" }, needs: "number", numberAs: "pullNumber", usage: "submit review <owner>/<repo>#<n> [event=] [body=]" },
  "discard review": { tool: "pull_request_review_write", fixed: { method: "delete_pending" }, needs: "number", numberAs: "pullNumber", usage: "discard review <owner>/<repo>#<n>" },
  "comment review": { tool: "add_comment_to_pending_review", needs: "number", numberAs: "pullNumber", rename: { subject: "subjectType", start_line: "startLine", start_side: "startSide" }, usage: "comment review <owner>/<repo>#<n> path= body= subject=line|file [line=] [side=LEFT|RIGHT] [start_line=]" },
  "resolve review": { tool: "pull_request_review_write", fixed: { method: "resolve_thread" }, needs: "number", numberAs: "pullNumber", rename: { thread: "threadId" }, usage: "resolve review <owner>/<repo>#<n> thread=" },
  "unresolve review": { tool: "pull_request_review_write", fixed: { method: "unresolve_thread" }, needs: "number", numberAs: "pullNumber", rename: { thread: "threadId" }, usage: "unresolve review <owner>/<repo>#<n> thread=" },
  "list review comment": { tool: "pull_request_read", fixed: { method: "get_review_comments" }, needs: "number", numberAs: "pullNumber", rename: PAGING, usage: "list review comment <owner>/<repo>#<n>" },

  "search user": { tool: "search_users", rename: PAGING, usage: "search user query= [sort=followers|repositories|joined]" },
  "list team": { tool: "get_teams", usage: "list team [user=]" },
  "members team": { tool: "get_team_members", rename: { team: "team_slug" }, usage: "members team org= team=" },
  "list collaborator": { tool: "list_repository_collaborators", needs: "repo", rename: PAGING, usage: "list collaborator <owner>/<repo> [affiliation=outside|direct|all]" },
  "list issue field": { tool: "list_issue_fields", needs: "owner", usage: "list issue field <owner>[/<repo>]" },
  "list issue type": { tool: "list_issue_types", needs: "owner", usage: "list issue type <owner>[/<repo>]" },
  "list options": { tool: "ui_get", needs: "owner", rename: { kind: "method" }, usage: "list options <owner>[/<repo>] kind=labels|assignees|milestones|issue_types|branches|issue_fields|reviewers" },
};

// Plural forms the model may naturally write.
const NOUN_ALIASES: Record<string, string> = {
  repos: "repo", repository: "repo", repositories: "repo", branches: "branch", commits: "commit", files: "file",
  tags: "tag", releases: "release", issues: "issue", labels: "label", prs: "pr", "pull-request": "pr",
  "pull-requests": "pr", reviews: "review", users: "user", teams: "team", collaborators: "collaborator",
  comments: "comment", "sub-issues": "sub-issue", fields: "field", types: "type",
};
// Values that the tools spell in upper case.
const UPPER = new Set(["state:list_issues", "orderBy:list_issues", "direction:list_issues", "subjectType", "side", "startSide", "event"]);

// Splits on newlines outside quotes; quotes may contain \n, \" and real newlines.
export function splitCommands(text: string): string[][] {
  const lines: string[][] = [];
  let tokens: string[] = [];
  let cur = "";
  let inQuote: string | null = null;
  let hasTok = false;
  const pushTok = () => {
    if (hasTok) tokens.push(cur);
    cur = "";
    hasTok = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === "\\" && i + 1 < text.length) {
        const nx = text[++i];
        cur += nx === "n" ? "\n" : nx === "t" ? "\t" : nx;
      } else if (ch === inQuote) inQuote = null;
      else cur += ch;
      continue;
    }
    // key={...} or key=[...]: keep the balanced JSON verbatim, or its quotes are stripped and
    // the documented form filter={"a":"b"} reaches the table engine as invalid JSON.
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
      inQuote = ch;
      hasTok = true;
    } else if (ch === "\n") {
      pushTok();
      if (tokens.length) lines.push(tokens);
      tokens = [];
    } else if (ch === " " || ch === "\t") pushTok();
    else {
      cur += ch;
      hasTok = true;
    }
  }
  if (inQuote) throw new CommandError("Unclosed quote. Close every \" you open.");
  pushTok();
  if (tokens.length) lines.push(tokens);
  return lines.filter((l) => !l[0].startsWith("#"));
}

function parseTarget(tok: string): Target | null {
  const m = tok.match(/^([\w.-]+)(?:\/([\w.-]+))?(?:#(\d+))?$/);
  if (!m || (!m[2] && !tok.includes("/") && !m[3])) return null;
  return { owner: m[1], repo: m[2], number: m[3] ? Number(m[3]) : undefined };
}

type Prop = { type?: string; enum?: string[]; items?: { type?: string } };

function coerce(raw: string, prop: Prop | undefined, key: string): unknown {
  const t = prop?.type;
  if (t === "number" || t === "integer") {
    const n = Number(raw.replace(/^#/, ""));
    if (Number.isNaN(n)) throw new CommandError(`${key} must be a number, got "${raw}"`);
    return n;
  }
  if (t === "boolean") return /^(true|yes|1)$/i.test(raw);
  if (t === "array") {
    if (prop?.items?.type === "object" || raw.trim().startsWith("[")) {
      try {
        return JSON.parse(raw);
      } catch {
        throw new CommandError(`${key} must be a JSON array, e.g. ${key}='[{"path":"a.md","content":"hi"}]'`);
      }
    }
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return raw;
}

export function makeParser(tools: McpTool[]) {
  const byName = new Map(tools.map((t) => [t.name, t]));

  function parseLine(tokens: string[]): Call {
    const verb = tokens[0].toLowerCase();
    // Longest noun match: up to two words after the verb.
    const nounWords = tokens.slice(1, 3).map((w) => NOUN_ALIASES[w.toLowerCase()] ?? w.toLowerCase());
    let spec: Spec | undefined;
    let used = 0;
    for (const n of [2, 1]) {
      const key = `${verb} ${nounWords.slice(0, n).join(" ")}`;
      if (SPECS[key]) {
        spec = SPECS[key];
        used = 1 + n;
        break;
      }
    }
    // Also accept noun-first order ("file get ..."), since the glossary lists verbs under each noun.
    if (!spec) {
      const words = tokens.slice(0, 3).map((w) => NOUN_ALIASES[w.toLowerCase()] ?? w.toLowerCase());
      for (const n of [2, 1]) {
        const key = `${words[n]} ${words.slice(0, n).join(" ")}`;
        if (words[n] && SPECS[key]) {
          spec = SPECS[key];
          used = 1 + n;
          break;
        }
      }
    }
    if (!spec) {
      const noun = nounWords[0] ?? "";
      const forNoun = Object.entries(SPECS).filter(([k]) => k.split(" ").slice(1).join(" ").startsWith(noun)).map(([, s]) => s.usage);
      throw new CommandError(
        `Unknown command "${tokens.slice(0, 3).join(" ")}".` +
          (forNoun.length ? ` Commands for "${noun}":\n  ${forNoun.join("\n  ")}` : ` Nouns: me, repo, branch, commit, file, code, tag, release, issue, issue comment, sub-issue, label, pr, pr comment, review, review comment, user, team, collaborator, issue field, issue type, options.`),
      );
    }

    const tool = byName.get(spec.tool);
    if (!tool) throw new CommandError(`"${spec.tool}" is not enabled on this server.`);
    const props = (tool.inputSchema.properties ?? {}) as Record<string, Prop>;

    const args: Record<string, unknown> = { ...(spec.fixed ?? {}) };
    let target: Target | null = null;
    for (const tok of tokens.slice(used)) {
      const eq = tok.indexOf("=");
      if (eq > 0 && /^[a-z_]+$/i.test(tok.slice(0, eq))) {
        const key = tok.slice(0, eq);
        const param = spec.rename?.[key] ?? key;
        if (!(param in props) || param in (spec.fixed ?? {}) || param === "owner" || param === "repo") {
          const allowed = Object.keys(props).filter((p) => !["owner", "repo", "method", spec!.numberAs].includes(p))
            .map((p) => Object.entries(spec!.rename ?? {}).find(([, v]) => v === p)?.[0] ?? p);
          throw new CommandError(`Unknown key "${key}" for "${verb} ${nounWords.slice(0, used - 1).join(" ")}". Valid keys: ${allowed.join(", ")}. Usage: ${spec.usage}`);
        }
        let value = coerce(tok.slice(eq + 1), props[param], key);
        if (typeof value === "string" && (UPPER.has(param) || UPPER.has(`${param}:${spec.tool}`))) value = value.toUpperCase();
        args[param] = value;
      } else if (!target && (target = parseTarget(tok))) {
        continue;
      } else if (!target && spec.needs === "owner" && /^[\w.-]+$/.test(tok)) {
        target = { owner: tok };
      } else {
        throw new CommandError(`Unexpected "${tok}". Values go as key=value; quote values with spaces. Usage: ${spec.usage}`);
      }
    }

    if (spec.needs && !target?.owner) throw new CommandError(`Missing target. Usage: ${spec.usage}`);
    if ((spec.needs === "repo" || spec.needs === "number") && !target?.repo) throw new CommandError(`Missing <owner>/<repo>. Usage: ${spec.usage}`);
    if (spec.needs === "number" && target?.number === undefined) throw new CommandError(`Missing #<number>. Usage: ${spec.usage}`);
    if (target?.owner && "owner" in props) args.owner = target.owner;
    if (target?.repo && "repo" in props) args.repo = target.repo;
    if (target?.number !== undefined && spec.numberAs) args[spec.numberAs] = target.number;

    const missing = ((tool.inputSchema.required ?? []) as string[]).filter((r) => args[r] === undefined);
    if (missing.length) {
      const names = missing.map((p) => Object.entries(spec!.rename ?? {}).find(([, v]) => v === p)?.[0] ?? p);
      throw new CommandError(`Missing ${names.join(", ")}. Usage: ${spec.usage}`);
    }
    return { tool: spec.tool, args };
  }

  return (text: string): Call[] => splitCommands(text).map(parseLine);
}

export const ALL_SPECS = SPECS;
