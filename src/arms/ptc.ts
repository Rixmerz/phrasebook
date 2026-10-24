// Arm "ptc": Anthropic's programmatic tool calling, the official code-mode
// feature. Claude writes Python in Anthropic's code execution container; every
// MCP tool is callable only from that code. Each call pauses the container and
// comes back as an ordinary tool_use, which the bench runs as a native MCP call.
import type { ExtraArm } from "../arms_extra.ts";
import type { McpTool } from "../mcp.ts";

const CODE_EXECUTION = "code_execution_20260120";

export function ptcTools(mcpTools: McpTool[]) {
  return [
    { type: CODE_EXECUTION, name: "code_execution" },
    ...mcpTools.map((t) => ({
      name: t.name,
      // The docs ask for the output format in the description; MCP tools return JSON text.
      description: `${t.description ?? ""}\nReturns the MCP result text (usually JSON).`,
      input_schema: t.inputSchema,
      allowed_callers: [CODE_EXECUTION],
    })),
  ];
}

export const ptcArm: ExtraArm = { tools: ptcTools, keepContainer: true };
