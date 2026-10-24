// Mechanically ports the hand-written GitHub glossary (src/github/parser.ts specs
// plus the v2 additions) into an engine table: glossaries/github-hand.json.
import { ALL_SPECS } from "../github/parser.ts";
import { EXAMPLES } from "../github/examples.ts";
import { GITHUB_GLOSSARY_V2 } from "../github/glossary.ts";
import type { Command, Table } from "./engine.ts";

const tools = JSON.parse(Deno.readTextFileSync("vendor/github-mcp/tools-default.json")) as { name: string; inputSchema: { properties?: Record<string, unknown> } }[];
const props = (tool: string) => tools.find((t) => t.name === tool)?.inputSchema.properties ?? {};

// Same folds as src/github/parser_v2.ts (v1 noun aliases are a subset).
const FOLD: Record<string, string> = {
  repos: "repo", repository: "repo", repositories: "repo", branches: "branch", commits: "commit",
  files: "file", tags: "tag", releases: "release", issues: "issue", labels: "label", prs: "pr",
  "pull-request": "pr", "pull-requests": "pr", pull: "pr", pulls: "pr", reviews: "review", users: "user",
  teams: "team", collaborators: "collaborator", comments: "comment", "sub-issues": "sub-issue",
  fields: "field", types: "type", checks: "check", diffs: "diff",
  show: "get", read: "get", view: "get", fetch: "get",
};

const commands: Command[] = Object.entries(ALL_SPECS).map(([key, s]) => {
  const p = props(s.tool);
  const target: Command["target"] = {};
  if (s.needs || s.numberAs) {
    if ("owner" in p) target.owner = "owner";
    if ("repo" in p) target.repo = "repo";
    if (s.numberAs) target.number = s.numberAs;
  }
  return {
    words: key.split(" "), tool: s.tool,
    ...(s.fixed ? { fixed: s.fixed } : {}), ...(s.rename ? { rename: s.rename } : {}),
    ...(Object.keys(target).length ? { target } : {}), ...(s.needs ? { needs: s.needs } : {}),
    usage: s.usage, example: EXAMPLES[key],
  };
});
commands.push({
  words: ["add", "pr", "comment"], tool: "add_issue_comment", target: { owner: "owner", repo: "repo", number: "issue_number" },
  needs: "number", usage: "add pr comment <owner>/<repo>#<n> body=", example: 'add pr comment octo/app#11 body="LGTM"',
});

const table: Table = { server: "github", glossary: GITHUB_GLOSSARY_V2, targetStyle: "github", fold: FOLD, genericVerbs: ["get", "list"], commands };
Deno.writeTextFileSync("glossaries/github-hand.json", JSON.stringify(table, null, 1));
console.log("glossaries/github-hand.json", commands.length, "commands");
