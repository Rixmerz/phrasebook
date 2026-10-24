// Progressive glossary arm ("glossary-help"). The tool description keeps the
// glossary header, the list of nouns and the examples; `help <noun>` returns the
// command lines for that noun. Commands go to the same parser as the full
// glossary. The split is generic over glossary text: header lines, then noun
// blocks (a line indented by two spaces, plus deeper-indented continuation lines).
import type Anthropic from "@anthropic-ai/sdk";
import type { CallLog, ExtraArm } from "../arms_extra.ts";
import type { Session, Suite } from "../suites.ts";
import { githubGlossaryTool } from "../github/glossary.ts";

type Split = { head: string[]; nouns: Map<string, string[]>; tail: string[] };

export function splitGlossary(text: string): Split {
  const lines = text.split("\n");
  const head: string[] = [];
  const tail: string[] = [];
  const nouns = new Map<string, string[]>();
  let current: string | null = null;
  let seenNoun = false;
  // A noun line: two spaces, a lowercase noun phrase (optionally "(note)"), then ":" or two spaces.
  const NOUN_AT = /(?:^ {2}|\s{3,})([a-z][a-z ,-]*?)(?: \([^)]*\))?(?::\s|\s{2,}(?=\S))/g;
  for (const line of lines) {
    const first = /^ {2}[a-z]/.test(line) ? [...line.matchAll(NOUN_AT)].map((m) => m[1].trim()) : [];
    if (first.length) {
      current = first[0];
      // A line may define several nouns ("branch: ...   commit: ..."); index it under each.
      for (const n of first) nouns.set(n, [...(nouns.get(n) ?? []), line]);
      seenNoun = true;
    } else if (current && /^ {3,}\S/.test(line)) {
      nouns.get(current)!.push(line);
    } else {
      current = null;
      (seenNoun ? tail : head).push(line);
    }
  }
  return { head, nouns, tail };
}

function describe(text: string): string {
  const { head, nouns, tail } = splitGlossary(text);
  return [
    ...head.filter((l) => l.trim()),
    `Nouns: ${[...nouns.keys()].join(", ")}.`,
    'Send "help <noun>" (e.g. "help issue") to get that noun\'s commands and keys before using it. "help" lists the nouns.',
    ...tail.filter((l) => l.trim()),
  ].join("\n");
}

function help(text: string, query: string): string {
  const { nouns } = splitGlossary(text);
  const q = query.trim().toLowerCase().replace(/s$/, "");
  if (!q) return `Nouns: ${[...nouns.keys()].join(", ")}. Send "help <noun>".`;
  // A noun key may hold several names ("issue field, issue type"); match any word of it.
  const hits = [...nouns.entries()].filter(([k]) =>
    k.toLowerCase().split(/[,\s]+/).some((w) => w.replace(/s$/, "") === q) || k.toLowerCase().startsWith(q)
  );
  if (!hits.length) return `No noun "${query.trim()}". Nouns: ${[...nouns.keys()].join(", ")}.`;
  return hits.flatMap(([, ls]) => ls).join("\n");
}

// Use the hand-written v2 only where the suite's own glossary is the hand-written v1;
// suites with a generated glossary (github-auto, github91, ...) use their own.
const handV2 = (suite: Suite) => suite.glossaryTool === githubGlossaryTool && !!suite.glossaryTool2;
const glossaryOf = (suite: Suite) => handV2(suite) ? suite.glossaryTool2! : suite.glossaryTool;
const parseOf = (suite: Suite) => handV2(suite) ? suite.parse2! : suite.parse;

let currentSuite: Suite | null = null;

export const glossaryHelpArm: ExtraArm = {
  tools(_mcp, suite) {
    currentSuite = suite;
    const g = glossaryOf(suite);
    return [{ name: g.name, description: describe(g.description), input_schema: g.input_schema }];
  },
  async dispatch(u: Anthropic.ToolUseBlock, session: Session, calls: CallLog[]) {
    const suite = currentSuite!;
    const input = u.input as Record<string, unknown>;
    if (typeof input.command !== "string") {
      calls.push({ tool: u.name, input, outcome: "schema_violation", detail: "command must be a string" });
      return { text: 'Send {"command": "..."}', isError: true };
    }
    const out: string[] = [];
    let anyError = false;
    // Help lines are answered here; the rest goes to the glossary parser as one batch.
    const lines = input.command.split("\n");
    const helpLines = lines.filter((l) => /^\s*help\b/i.test(l));
    const rest = lines.filter((l) => !/^\s*help\b/i.test(l)).join("\n");
    for (const h of helpLines) {
      calls.push({ tool: "help", input: h.trim(), outcome: "ok" });
      out.push(help(glossaryOf(suite).description, h.trim().replace(/^help\b/i, "")));
    }
    if (rest.trim()) {
      let parsed;
      try {
        parsed = parseOf(suite)(rest, session.tools);
      } catch (e) {
        if (!suite.isCommandError(e)) throw e;
        calls.push({ tool: u.name, input, outcome: "parse_error", detail: e.message });
        return { text: [...out, e.message].join("\n---\n"), isError: true };
      }
      for (const p of parsed) {
        const r = await session.call(p.tool, p.args);
        calls.push({ tool: p.tool, input: p.args, outcome: r.isError ? "backend_error" : "ok", detail: r.isError ? r.text : undefined });
        anyError ||= r.isError;
        out.push(r.text);
      }
    }
    return { text: out.join("\n---\n"), isError: anyError };
  },
};
