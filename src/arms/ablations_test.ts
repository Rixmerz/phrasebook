import { assert, assertEquals } from "jsr:@std/assert@1";
import { compactResult, firstSentence, stripSchema, trimTools } from "./ablations.ts";

const gh = JSON.parse(Deno.readTextFileSync(new URL("../../vendor/github-mcp/tools-default.json", import.meta.url)));

Deno.test("first sentence stops at the first period followed by a space", () => {
  assertEquals(firstSentence("Get a file. Use it for v1.2 files.\n\nMore."), "Get a file.");
  assertEquals(firstSentence("No period here"), "No period here");
  assertEquals(firstSentence("Version v1.2 only."), "Version v1.2 only.");
});

Deno.test("trimmed schemas keep every parameter, type, enum and required key", () => {
  const s = { type: "object", description: "x", properties: { description: { type: "string", description: "y" }, state: { type: "string", enum: ["open", "closed"], description: "z" } }, required: ["state"] };
  assertEquals(stripSchema(s), { type: "object", properties: { description: { type: "string" }, state: { type: "string", enum: ["open", "closed"] } }, required: ["state"] });
});

Deno.test("trimming keeps every GitHub tool and parameter and shrinks the text", () => {
  const trimmed = trimTools(gh);
  assertEquals(trimmed.map((t) => t.name), gh.map((t: { name: string }) => t.name));
  for (const [i, t] of trimmed.entries()) {
    assertEquals(Object.keys((t.input_schema as { properties?: object }).properties ?? {}), Object.keys(gh[i].inputSchema.properties ?? {}));
  }
  const len = (x: unknown) => JSON.stringify(x).length;
  assert(len(trimmed) < 0.7 * len(gh.map((t: { name: string; description: string; inputSchema: unknown }) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))));
});

Deno.test("compact results keep every field and drop link noise", () => {
  const raw = JSON.stringify([
    { number: 1, title: "A", html_url: "https://x/1", user: { login: "ana", id: 1, avatar_url: "u" }, labels: [{ name: "bug", color: "f00" }], state_reason: null },
    { number: 2, title: "B", html_url: "https://x/2", user: { login: "leo", id: 2, avatar_url: "u" }, labels: [], state_reason: "completed" },
  ]);
  const out = compactResult(raw);
  assert(out.includes("number,title,user,labels,state_reason"), out);
  assert(out.includes("ana") && out.includes("bug") && out.includes("completed"));
  assert(!out.includes("https://"));
  assert(out.length < raw.length);
  assertEquals(compactResult("plain text\n"), "plain text\n");
});
