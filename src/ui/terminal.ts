export const supportsUnicode: boolean =
  process.platform !== "win32" ||
  Boolean(process.env.WT_SESSION) ||
  Boolean(process.env.TERM_PROGRAM);

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}
