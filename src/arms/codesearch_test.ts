import { assert, assertEquals } from "jsr:@std/assert@1";
import { codesearchTools, renderTool, searchTools } from "./codesearch.ts";

const gh = JSON.parse(Deno.readTextFileSync(new URL("../../vendor/github-mcp/tools-default.json", import.meta.url)));

Deno.test("search ranks the obvious tool first", () => {
  assertEquals(searchTools(gh, "merge pull request")[0].name, "merge_pull_request");
  assertEquals(searchTools(gh, "file contents")[0].name, "get_file_contents");
  assertEquals(searchTools(gh, "list branches")[0].name, "list_branches");
  assert(searchTools(gh, "issue comment").slice(0, 3).some((t: { name: string }) => t.name === "add_issue_comment"));
});

Deno.test("detail levels grow in size", () => {
  const t = gh.find((x: { name: string }) => x.name === "issue_read");
  const [n, s, f] = (["name", "signature", "full"] as const).map((d) => renderTool(t, d).length);
  assert(n < s && s < f);
  assert(renderTool(t, "signature").includes('"get" | "get_comments"'));
});

Deno.test("initial description lists names only and stays small", () => {
  const desc = codesearchTools(gh).map((t) => t.description).join("\n");
  assert(desc.includes("merge_pull_request"));
  assert(!desc.includes("pullNumber"));
  assert(desc.length < 2500, `description is ${desc.length} chars`);
});
