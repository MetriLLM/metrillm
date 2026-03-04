// IMPORTANT: setup.ts must be imported FIRST — it redirects console.log
// to stderr before any CLI module can write to stdout at module level.
import "./setup.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  toolDefinitions,
  listModelsSchema,
  runBenchmarkSchema,
  getResultsSchema,
  shareResultSchema,
  handleListModels,
  handleRunBenchmark,
  handleGetResults,
  handleShareResult,
} from "./tools.js";

// ── MCP Server ──

const server = new McpServer({
  name: "metrillm",
  version: "0.2.0",
});

// Register tools
for (const def of toolDefinitions) {
  switch (def.name) {
    case "list_models":
      server.tool(
        def.name,
        def.description,
        def.inputSchema.shape,
        async (args) => {
          try {
            const parsed = listModelsSchema.parse(args);
            const result = await handleListModels(parsed);
            return { content: [{ type: "text" as const, text: result }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }], isError: true };
          }
        }
      );
      break;

    case "run_benchmark":
      server.tool(
        def.name,
        def.description,
        def.inputSchema.shape,
        async (args) => {
          try {
            const parsed = runBenchmarkSchema.parse(args);
            const result = await handleRunBenchmark(parsed);
            return { content: [{ type: "text" as const, text: result }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }], isError: true };
          }
        }
      );
      break;

    case "get_results":
      server.tool(
        def.name,
        def.description,
        def.inputSchema.shape,
        async (args) => {
          try {
            const parsed = getResultsSchema.parse(args);
            const result = await handleGetResults(parsed);
            return { content: [{ type: "text" as const, text: result }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }], isError: true };
          }
        }
      );
      break;

    case "share_result":
      server.tool(
        def.name,
        def.description,
        def.inputSchema.shape,
        async (args) => {
          try {
            const parsed = shareResultSchema.parse(args);
            const result = await handleShareResult(parsed);
            return { content: [{ type: "text" as const, text: result }] };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }], isError: true };
          }
        }
      );
      break;
  }
}

// ── Start ──

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MetriLLM MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting MetriLLM MCP server:", err);
  process.exit(1);
});
