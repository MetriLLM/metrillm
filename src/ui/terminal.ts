export const supportsUnicode: boolean =
  process.platform !== "win32" ||
  Boolean(process.env.WT_SESSION) ||
  Boolean(process.env.TERM_PROGRAM);
