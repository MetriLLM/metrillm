// This file MUST be imported before any CLI module to ensure console.log
// is redirected to stderr before any module-level code runs.
//
// MCP uses stdout exclusively for JSON-RPC. The CLI uses console.log for
// UI output (ora spinners, chalk colors, tables). We redirect console.log
// to stderr so it doesn't corrupt the JSON-RPC stream.

console.log = (...args: unknown[]) => {
  console.error(...args);
};

// Force disable colors and interactive UI elements
process.env.NO_COLOR = "1";
process.env.FORCE_COLOR = "0";
