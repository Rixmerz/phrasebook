// The two glossary v3 arms. Same engine and vocabulary; "legend" states conventions
// up front, "feedback" puts them in every answer and in error corrections.
import type Anthropic from "@anthropic-ai/sdk";
import type { CallLog, ExtraArm } from "../arms_extra.ts";
import type { Session, Suite } from "../suites.ts";
import { githubGlossaryToolV2 } from "../github/glossary.ts";
import { type Mode, runV3, type V3State } from "./engine.ts";
import { GITHUB_GLOSSARY_V3_FEEDBACK, GITHUB_GLOSSARY_V3_LEGEND, GITHUB_GLOSSARY_V4 } from "./glossary.ts";

function v3Arm(mode: Mode): ExtraArm {
  let suite: Suite | null = null;
  // One reference store per run: a run owns one session.
  const states = new WeakMap<Session, V3State>();
  return {
    tools(_mcp, s) {
      if (!s.parse2) throw new Error(`glossary v3 needs a GitHub suite with the v2 parser; ${s.name} has none`);
      suite = s;
      const description = mode === "legend" ? GITHUB_GLOSSARY_V3_LEGEND : mode === "v4" ? GITHUB_GLOSSARY_V4 : GITHUB_GLOSSARY_V3_FEEDBACK;
      return [{ ...githubGlossaryToolV2, description }];
    },
    async dispatch(u: Anthropic.ToolUseBlock, session: Session, calls: CallLog[]) {
      const input = u.input as Record<string, unknown>;
      if (typeof input.command !== "string") {
        calls.push({ tool: u.name, input, outcome: "schema_violation", detail: "command must be a string" });
        return { text: 'Send {"command": "..."}', isError: true };
      }
      let st = states.get(session);
      if (!st) states.set(session, st = { refs: [] });
      return await runV3(mode, input.command, session, st, (c) => suite!.parse2!(c, session.tools), (e) => calls.push(e));
    },
  };
}

export const glossary3LegendArm = v3Arm("legend");
export const glossary3FeedbackArm = v3Arm("feedback");
export const glossary4Arm = v3Arm("v4");
