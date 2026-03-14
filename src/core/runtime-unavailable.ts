import { getRuntimeDisplayName } from "./runtime.js";

export function getRuntimeUnavailableHelp(runtimeName: string, setupHints: string[]): string[] {
  const runtimeDisplayName = getRuntimeDisplayName(runtimeName);
  const lines = [
    `MetriLLM is currently set to use ${runtimeDisplayName}.`,
    `Either start ${runtimeDisplayName}, or switch to another backend in Settings.`,
  ];

  for (const hint of setupHints) {
    lines.push(`  • ${hint}`);
  }

  lines.push("  • To change backend: Main Menu -> Settings -> Runtime backend");
  return lines;
}
