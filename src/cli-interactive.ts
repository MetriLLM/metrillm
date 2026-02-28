export function canUseInteractiveMenu(
  stdinIsTTY: boolean | undefined,
  stdoutIsTTY: boolean | undefined
): boolean {
  return Boolean(stdinIsTTY && stdoutIsTTY);
}

