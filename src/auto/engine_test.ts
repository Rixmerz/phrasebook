import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { compile, CommandError, loadTable } from "./engine.ts";
import { makeParser } from "../github/parser.ts";
import { makeParserV2 } from "../github/parser_v2.ts";
import { EXAMPLES } from "../github/examples.ts";

const tools = JSON.parse(Deno.readTextFileSync(new URL("../../vendor/github-mcp/tools-default.json", import.meta.url)));
const engine = compile(loadTable(new URL("../../glossaries/github-hand.json", import.meta.url).pathname), tools);

Deno.test("engine + ported table reproduces v1 on all 67 examples", () => {
  const v1 = makeParser(tools);
  assertEquals(Object.keys(EXAMPLES).length, 67);
  for (const [key, ex] of Object.entries(EXAMPLES)) assertEquals(engine.parse(ex), v1(ex), key);
});

Deno.test("engine matches v2 on its extra forms", () => {
  const v2 = makeParserV2(tools);
  for (const c of ["pr files octo/app#10", "pr octo/app#10 files", "get pr files octo/app#10", "pr commits octo/app#10",
    "file get octo/app path=package.json", 'add pr comment octo/app#11 body="LGTM"', "list issue type octo", "pr octo/app#10 | files"]) {
    assertEquals(engine.parse(c), v2(c), c);
  }
});

Deno.test("quoted values are never command words", () => {
  const c = engine.parse('add issue comment octo/app#3 body="pr files"')[0];
  assertEquals([c.tool, c.args.body], ["add_issue_comment", "pr files"]);
});

Deno.test("errors list closest commands", () => {
  assertThrows(() => engine.parse("pr frobnicate octo/app#10"), CommandError, "Closest commands");
});
