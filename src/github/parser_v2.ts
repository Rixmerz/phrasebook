// Glossary parser v2. Built only from failures seen with v1 on the original
// 12 tasks, before running the held-out set:
//  - word order is free ("pr files", "files pr", "pr octo/app#10 files");
//  - plurals fold through an explicit table, never by stripping "s";
//  - a generic leading verb is dropped when the rest names a command ("get pr files");
//  - errors list the three closest commands by word overlap;
//  - "add pr comment" exists (on GitHub a PR conversation comment is an issue comment).
import type { McpTool } from "../mcp.ts";
import { ALL_SPECS, type Call, CommandError, makeParser, splitCommands } from "./parser.ts";

const FOLD: Record<string, string> = {
  repos: "repo", repository: "repo", repositories: "repo", branches: "branch", commits: "commit",
  files: "file", tags: "tag", releases: "release", issues: "issue", labels: "label", prs: "pr",
  "pull-request": "pr", "pull-requests": "pr", pull: "pr", pulls: "pr", reviews: "review", users: "user",
  teams: "team", collaborators: "collaborator", comments: "comment", "sub-issues": "sub-issue",
  fields: "field", types: "type", checks: "check", diffs: "diff",
  show: "get", read: "get", view: "get", fetch: "get",
};
const GENERIC_VERBS = new Set(["get", "list"]);

const fold = (w: string) => FOLD[w.toLowerCase()] ?? w.toLowerCase();
const bagKey = (words: string[]) => words.map(fold).sort().join(" ");

// v1 spec keys whose verb is a PR sub-read ("files pr") fold the same way as their words.
const SPECS_V2: Record<string, string> = Object.fromEntries(Object.keys(ALL_SPECS).map((k) => [k, k]));
SPECS_V2["add pr comment"] = "add issue comment";

export function specBags() {
  return Object.keys(SPECS_V2).map((k) => [bagKey(k.split(" ")), k] as const);
}

const isKv = (t: string) => /^[a-z_]+=/i.test(t);
// Any word outside the glossary vocabulary is a target (owner/repo#n, or a bare owner).
const VOCAB = new Set([...Object.keys(SPECS_V2).flatMap((k) => k.split(" ").map(fold)), ...GENERIC_VERBS]);
const isWord = (t: string) => VOCAB.has(fold(t));

export function makeParserV2(tools: McpTool[]) {
  const v1 = makeParser(tools);
  const bags = new Map(specBags());

  function resolve(words: string[]): string | null {
    const exact = bags.get(bagKey(words));
    if (exact) return exact;
    const folded = words.map(fold);
    if (folded.length > 1 && GENERIC_VERBS.has(folded[0])) return bags.get(bagKey(words.slice(1))) ?? null;
    if (folded.length > 1) {
      // Generic verb anywhere, e.g. "pr files get".
      const i = folded.findIndex((w) => GENERIC_VERBS.has(w));
      if (i >= 0) return bags.get(bagKey(words.filter((_, j) => j !== i))) ?? null;
    }
    return null;
  }

  function closest(words: string[]) {
    const mine = new Set(words.map(fold));
    return Object.keys(SPECS_V2)
      .map((k) => {
        const theirs = new Set(k.split(" ").map(fold));
        const inter = [...mine].filter((w) => theirs.has(w)).length;
        return { k, score: inter / (mine.size + theirs.size - inter) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ k }) => ALL_SPECS[SPECS_V2[k]].usage.replace(SPECS_V2[k], k));
  }

  return (text: string): Call[] => {
    const lines = splitCommands(text);
    return lines.map((tokens) => {
      const clean = tokens.filter((t) => t !== "|");
      const words = clean.filter((t) => !isKv(t) && isWord(t));
      const rest = clean.filter((t) => isKv(t) || !isWord(t));
      const key = resolve(words);
      if (!key) {
        throw new CommandError(
          `Unknown command "${words.join(" ")}". Closest commands:\n  ${closest(words).join("\n  ")}`,
        );
      }
      // Re-emit in canonical v1 order and let v1 do targets, keys and validation.
      const canonical = [...SPECS_V2[key].split(" "), ...rest]
        .map((t) => (/[\s"'\n\\]/.test(t) ? JSON.stringify(t) : t))
        .join(" ");
      return v1(canonical)[0];
    });
  };
}
