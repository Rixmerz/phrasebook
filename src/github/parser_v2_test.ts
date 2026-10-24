import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { CommandError, makeParser } from "./parser.ts";
import { EXAMPLES } from "./examples.ts";
import { makeParserV2, specBags } from "./parser_v2.ts";

const tools = JSON.parse(Deno.readTextFileSync(new URL("../../vendor/github-mcp/tools-default.json", import.meta.url)));
const parse = makeParserV2(tools);

Deno.test("no two commands share a word set", () => {
  const seen = new Map<string, string>();
  for (const [bag, key] of specBags()) {
    assert(!seen.has(bag), `"${key}" and "${seen.get(bag)}" both fold to "${bag}"`);
    seen.set(bag, key);
  }
});

Deno.test("v2 reads every v1 example exactly like v1", () => {
  const v1 = makeParser(tools);
  for (const [key, example] of Object.entries(EXAMPLES)) assertEquals(parse(example), v1(example), key);
});

Deno.test("free word order and generic verbs", () => {
  for (const c of ["pr files octo/app#10", "pr octo/app#10 files", "get pr files octo/app#10", "list pr files octo/app#10", "pr octo/app#10 | files"]) {
    const call = parse(c)[0];
    assertEquals([call.tool, call.args.method, call.args.pullNumber], ["pull_request_read", "get_files", 10], c);
  }
  assertEquals(parse("pr commits octo/app#10")[0].args.method, "get_commits");
  assertEquals(parse("file get octo/app path=package.json")[0].tool, "get_file_contents");
  assertEquals(parse("commit octo/app get sha=abc")[0].tool, "get_commit");
  assertEquals(parse("list issue type octo")[0].args.owner, "octo");
});

Deno.test("add pr comment posts a conversation comment", () => {
  const c = parse('add pr comment octo/app#11 body="LGTM"')[0];
  assertEquals([c.tool, c.args.issue_number, c.args.body], ["add_issue_comment", 11, "LGTM"]);
});

Deno.test("values with spaces and newlines survive", () => {
  assertEquals(parse('issue create octo/app title="A b" body="l1\\nl2"')[0].args.body, "l1\nl2");
});

Deno.test("errors suggest the closest commands", () => {
  assertThrows(() => parse("pr frobnicate octo/app#10"), CommandError, "Closest commands");
});
