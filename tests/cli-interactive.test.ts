import { describe, expect, it } from "vitest";
import { canUseInteractiveMenu } from "../src/cli-interactive.js";

describe("canUseInteractiveMenu", () => {
  it("returns true only when both stdin and stdout are TTY", () => {
    expect(canUseInteractiveMenu(true, true)).toBe(true);
    expect(canUseInteractiveMenu(true, false)).toBe(false);
    expect(canUseInteractiveMenu(false, true)).toBe(false);
    expect(canUseInteractiveMenu(false, false)).toBe(false);
  });

  it("treats undefined TTY flags as non-interactive", () => {
    expect(canUseInteractiveMenu(undefined, true)).toBe(false);
    expect(canUseInteractiveMenu(true, undefined)).toBe(false);
    expect(canUseInteractiveMenu(undefined, undefined)).toBe(false);
  });
});

