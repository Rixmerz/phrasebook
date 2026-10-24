// One example per glossary command, checked against the real tool schemas.
import { Ajv } from "ajv";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { ALL_SPECS, CommandError, makeParser } from "./parser.ts";
import { EXAMPLES } from "./examples.ts";

const tools = JSON.parse(Deno.readTextFileSync(new URL("../../vendor/github-mcp/tools-default.json", import.meta.url)));
const parse = makeParser(tools);
const ajv = new Ajv({ strict: false });
const validate = (c: { tool: string; args: Record<string, unknown> }) => {
  const v = ajv.compile(tools.find((t: { name: string }) => t.name === c.tool).inputSchema);
  if (!v(c.args)) throw new Error(`${c.tool}: ${ajv.errorsText(v.errors)} ${JSON.stringify(c.args)}`);
};



Deno.test("every glossary command has an example and validates", () => {
  for (const key of Object.keys(ALL_SPECS)) {
    assert(EXAMPLES[key], `no example for "${key}"`);
    const calls = parse(EXAMPLES[key]);
    assertEquals(calls.length, 1, key);
    validate(calls[0]);
  }
});

Deno.test("multi-line values and several commands", () => {
  const calls = parse('create issue octo/app title="T" body="line 1\nline 2"\nclose_me\n'.replace("close_me", "get issue octo/app#1"));
  assertEquals(calls.length, 2);
  assertEquals(calls[0].args.body, "line 1\nline 2");
  assertEquals(parse('write file octo/app path=a content="a\\nb" message=m branch=x')[0].args.content, "a\nb");
});

Deno.test("plural nouns and upper-cased enums", () => {
  assertEquals(parse("list issues octo/app state=open")[0].args.state, "OPEN");
  assertEquals(parse("list prs octo/app state=open")[0].args.state, "open");
  assertEquals(parse("files pr octo/app#10")[0].args.method, "get_files");
});

Deno.test("errors teach", () => {
  assertThrows(() => parse("merge pr octo/app#10 strategy=squash"), CommandError, "Valid keys");
  assertThrows(() => parse("merge pr octo/app"), CommandError, "#<number>");
  assertThrows(() => parse("frobnicate issue octo/app#1"), CommandError, 'Commands for "issue"');
  assertThrows(() => parse('add issue comment octo/app#1 body="open'), CommandError, "Unclosed quote");
});

Deno.test("noun-first order is accepted", () => {
  assertEquals(parse("file get octo/app path=package.json")[0].tool, "get_file_contents");
  assertEquals(parse("issue comment add octo/app#3 body=x")[0].tool, "add_issue_comment");
  assertEquals(parse("pr merge octo/app#10 method=squash")[0].args.merge_method, "squash");
});
