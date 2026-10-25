// Offline tests for glossary v3: no model calls.
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { expandLiterals } from "./engine.ts";
import { runPipeline } from "./pipeline.ts";
import { simplify, table } from "./format.ts";
import { splitCommands } from "../github/parser.ts";
import { ENV_FILE } from "../github/v3tasks.ts";

Deno.test("literal blocks keep every byte and add the final newline", () => {
  const text = "write file o/r path=a branch=main message=m content<<EOF\n" + ENV_FILE.slice(0, -1) + "\nEOF";
  const [tokens] = splitCommands(expandLiterals(text));
  assertEquals(tokens.find((t) => t.startsWith("content="))!.slice(8), ENV_FILE);
});

Deno.test("unclosed literal block is an error", () => {
  assertThrows(() => expandLiterals("x content<<EOF\nabc"), Error, "not closed");
});

Deno.test("pipeline where, group, count", () => {
  const rows = [
    { number: 1, labels: ["bug"], assignees: ["ana"], title: "Billing: a" },
    { number: 2, labels: ["bug", "ui"], assignees: [], title: "Login: b" },
    { number: 3, labels: ["chore"], assignees: ["ana"], title: "Billing: c" },
  ];
  assertEquals(runPipeline(rows, [["where", "labels", "has", "bug"], ["count"]]), 2);
  assertEquals(runPipeline(rows, [["where", "assignees", "empty"], ["select", "number"]]), [{ number: 2 }]);
  assertEquals(runPipeline(rows, [["where", "title", "starts", "billing"], ["count"]]), 2);
  assertEquals(runPipeline(rows, [["group", "labels"]]), [{ labels: "bug", count: 2 }, { labels: "ui", count: 1 }, { labels: "chore", count: 1 }]);
  assertThrows(() => runPipeline(rows, [["where", "label", "has", "bug"], ["count"]]), Error, 'No row has a field "label"');
});

Deno.test("tables are compact and simplify users and labels", () => {
  const data = simplify([{ number: 1, user: { login: "ana", id: 3 }, labels: [{ name: "bug", id: 1 }], html_url: "x" }]);
  assertEquals(table("issues", data as never[]), "issues[1]{number,user,labels}:\n  1,ana,bug");
});
