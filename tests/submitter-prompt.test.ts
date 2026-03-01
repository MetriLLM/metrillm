/**
 * Test intent:
 * - Validate nickname/email collection flow used before benchmark sharing.
 *
 * Why it matters:
 * - Profile capture should be optional, robust, and persistable.
 */
import { describe, expect, it, vi } from "vitest";
import type { LLMeterConfig } from "../src/core/store.js";
import { resolveSubmitterForShare } from "../src/ui/submitter-prompt.js";

describe("resolveSubmitterForShare", () => {
  it("returns stored submitter profile without prompting", async () => {
    const askLine = vi.fn(async () => "");
    const loadUserConfig = vi.fn(async () => ({
      autoShare: "ask" as const,
      submitterNickname: "Cyril",
      submitterEmail: "cyril@example.com",
    }));
    const saveUserConfig = vi.fn(async (_config: LLMeterConfig) => {});

    const submitter = await resolveSubmitterForShare({
      askLine,
      loadUserConfig,
      saveUserConfig,
    });

    expect(submitter).toEqual({
      nickname: "Cyril",
      email: "cyril@example.com",
      emailHash: "58dec56b272b89273d472ad4f5a2af983bc6010aa23ab2dcbd27ab7042ee042e",
    });
    expect(askLine).not.toHaveBeenCalled();
    expect(saveUserConfig).not.toHaveBeenCalled();
  });

  it("returns null when user declines profile capture", async () => {
    const askLine = vi.fn(async () => "n");
    const loadUserConfig = vi.fn(async () => ({ autoShare: "ask" as const }));
    const saveUserConfig = vi.fn(async (_config: LLMeterConfig) => {});

    const submitter = await resolveSubmitterForShare({
      askLine,
      loadUserConfig,
      saveUserConfig,
    });

    expect(submitter).toBeNull();
    expect(saveUserConfig).not.toHaveBeenCalled();
  });

  it("prompts, validates, and saves profile", async () => {
    const answers = [
      "y",
      "x",
      "Cyril",
      "invalid",
      "cyril@example.com",
    ];
    const askLine = vi.fn(async () => answers.shift() ?? null);
    const loadUserConfig = vi.fn(async () => ({ autoShare: "ask" as const }));
    const saveUserConfig = vi.fn(async (_config: LLMeterConfig) => {});

    const submitter = await resolveSubmitterForShare({
      askLine,
      loadUserConfig,
      saveUserConfig,
    });

    expect(submitter).toEqual({
      nickname: "Cyril",
      email: "cyril@example.com",
      emailHash: "58dec56b272b89273d472ad4f5a2af983bc6010aa23ab2dcbd27ab7042ee042e",
    });
    expect(saveUserConfig).toHaveBeenCalledWith({
      autoShare: "ask",
      submitterNickname: "Cyril",
      submitterEmail: "cyril@example.com",
    });
  });
});
