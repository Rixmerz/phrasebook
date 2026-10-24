// Extra arms registered by add-on modules (code mode with search, native + tool search).
// Owned by the code-mode/tool-search work.
import type Anthropic from "@anthropic-ai/sdk";
import type { McpTool } from "./mcp.ts";
import type { Session, Suite } from "./suites.ts";

export type CallLog = { tool: string; input: unknown; outcome: string; detail?: string };

export type ExtraArm = {
  // Tools to send. Server tools (e.g. tool search) and deferred tools are allowed.
  tools: (mcpTools: McpTool[], suite: Suite) => unknown[];
  // Appended to the suite's system prompt, only for this arm. Optional.
  systemSuffix?: string;
  // Extra request fields, e.g. { betas: [...] }. Optional.
  request?: Record<string, unknown>;
  // Handles one client tool_use. When absent, the bench treats it as a native MCP call.
  // Reuse the code execution container across turns (programmatic tool calling needs it).
  keepContainer?: boolean;
  dispatch?: (u: Anthropic.ToolUseBlock, session: Session, calls: CallLog[]) => Promise<{ text: string; isError: boolean }>;
};

import { toolsearchArm } from "./arms/toolsearch.ts";
import { codesearchArm } from "./arms/codesearch.ts";
import { ptcArm } from "./arms/ptc.ts";
import { glossaryHelpArm } from "./arms/glossary_help.ts";
import { glossary3FeedbackArm, glossary3LegendArm, glossary4Arm } from "./v3/arms.ts";

export const extraArms: Record<string, ExtraArm> = {
  toolsearch: toolsearchArm,
  codesearch: codesearchArm,
  "glossary-help": glossaryHelpArm,
  ptc: ptcArm,
  "glossary3-legend": glossary3LegendArm,
  "glossary3-feedback": glossary3FeedbackArm,
  glossary4: glossary4Arm,
};
