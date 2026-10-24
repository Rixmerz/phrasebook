// Arm "toolsearch": the native MCP tools, all deferred, plus Anthropic's
// server-side tool search (BM25). Only the search tool loads up front; the API
// expands the tools Claude finds into full definitions. No beta header needed.
// Every MCP tool is deferred (none kept loaded), so no task-specific choice of
// "frequent" tools favors this arm.
import type { ExtraArm } from "../arms_extra.ts";
import type { McpTool } from "../mcp.ts";

export const TOOL_SEARCH = { type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" };

export function toolsearchTools(mcpTools: McpTool[]) {
  return [
    TOOL_SEARCH,
    ...mcpTools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: t.inputSchema,
      defer_loading: true,
    })),
  ];
}

// No dispatch: discovered tools come back as ordinary tool_use blocks,
// which the bench runs as native MCP calls.
export const toolsearchArm: ExtraArm = {
  tools: toolsearchTools,
  // Recommended by the tool search docs: tell the model its tools are behind search.
  systemSuffix: "Your tools are not loaded yet: use the tool search tool to find and load the tools you need, then call them.",
};
