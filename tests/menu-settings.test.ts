/**
 * Test intent:
 * - Validate settings menu behavior for persisted preferences.
 *
 * Why it matters:
 * - Settings must reliably reflect and update user preferences across runs.
 */
import { describe, expect, it, vi } from "vitest";
import { runSettingsMenu } from "../src/ui/menu.js";
import type { MetriLLMConfig } from "../src/core/store.js";

describe("runSettingsMenu", () => {
  it("toggles auto-share and persists to config", async () => {
    let config: MetriLLMConfig = { autoShare: "ask", autoSharePreferenceSet: true, telemetry: false };
    const sequence = ["toggle-auto-share", "back"] as const;
    let idx = 0;

    const loadUserConfig = vi.fn(async () => config);
    const saveUserConfig = vi.fn(async (next: MetriLLMConfig) => {
      config = next;
    });
    const saveTelemetryPref = vi.fn(async (_value: boolean) => {});
    const selectSettingsAction = vi.fn(async () => sequence[idx++] ?? null);
    const waitForAcknowledge = vi.fn(async () => {});

    await runSettingsMenu({
      loadUserConfig,
      saveUserConfig,
      saveTelemetryPref,
      selectSettingsAction,
      waitForAcknowledge,
    });

    expect(saveUserConfig).toHaveBeenCalledWith({
      autoShare: true,
      autoSharePreferenceSet: true,
      telemetry: false,
    });
    expect(saveTelemetryPref).not.toHaveBeenCalled();
    expect(waitForAcknowledge).toHaveBeenCalledTimes(1);
  });

  it("toggles telemetry via telemetry consent helper", async () => {
    const config: MetriLLMConfig = { autoShare: true, telemetry: false };
    const sequence = ["toggle-telemetry", "back"] as const;
    let idx = 0;

    const loadUserConfig = vi.fn(async () => config);
    const saveUserConfig = vi.fn(async (_next: MetriLLMConfig) => {});
    const saveTelemetryPref = vi.fn(async (_value: boolean) => {});
    const selectSettingsAction = vi.fn(async () => sequence[idx++] ?? null);
    const waitForAcknowledge = vi.fn(async () => {});

    await runSettingsMenu({
      loadUserConfig,
      saveUserConfig,
      saveTelemetryPref,
      selectSettingsAction,
      waitForAcknowledge,
    });

    expect(saveTelemetryPref).toHaveBeenCalledWith(true);
    expect(saveUserConfig).not.toHaveBeenCalled();
    expect(waitForAcknowledge).toHaveBeenCalledTimes(1);
  });

  it("returns immediately when user exits settings", async () => {
    const loadUserConfig = vi.fn(async () => ({
      autoShare: "ask" as const,
      autoSharePreferenceSet: true,
    }));
    const saveUserConfig = vi.fn(async (_next: MetriLLMConfig) => {});
    const saveTelemetryPref = vi.fn(async (_value: boolean) => {});
    const selectSettingsAction = vi.fn(async () => null);
    const promptSubmitterProfile = vi.fn(async () => null);
    const waitForAcknowledge = vi.fn(async () => {});

    await runSettingsMenu({
      loadUserConfig,
      saveUserConfig,
      saveTelemetryPref,
      selectSettingsAction,
      promptSubmitterProfile,
      waitForAcknowledge,
    });

    expect(saveUserConfig).not.toHaveBeenCalled();
    expect(saveTelemetryPref).not.toHaveBeenCalled();
    expect(promptSubmitterProfile).not.toHaveBeenCalled();
    expect(waitForAcknowledge).not.toHaveBeenCalled();
  });

  it("edits benchmark profile from settings", async () => {
    const config: MetriLLMConfig = { autoShare: true, telemetry: false };
    const sequence = ["edit-submitter-profile", "back"] as const;
    let idx = 0;

    const loadUserConfig = vi.fn(async () => config);
    const saveUserConfig = vi.fn(async (_next: MetriLLMConfig) => {});
    const saveTelemetryPref = vi.fn(async (_value: boolean) => {});
    const selectSettingsAction = vi.fn(async () => sequence[idx++] ?? null);
    const promptSubmitterProfile = vi.fn(async () => ({
      nickname: "Cyril",
      email: "cyril@example.com",
    }));
    const waitForAcknowledge = vi.fn(async () => {});

    await runSettingsMenu({
      loadUserConfig,
      saveUserConfig,
      saveTelemetryPref,
      selectSettingsAction,
      promptSubmitterProfile,
      waitForAcknowledge,
    });

    expect(promptSubmitterProfile).toHaveBeenCalledTimes(1);
    expect(saveUserConfig).not.toHaveBeenCalled();
    expect(saveTelemetryPref).not.toHaveBeenCalled();
    expect(waitForAcknowledge).toHaveBeenCalledTimes(1);
  });

  it("clears benchmark profile from settings", async () => {
    let config: MetriLLMConfig = {
      autoShare: "ask",
      autoSharePreferenceSet: true,
      telemetry: false,
      submitterNickname: "Cyril",
      submitterEmail: "cyril@example.com",
    };
    const sequence = ["clear-submitter-profile", "back"] as const;
    let idx = 0;

    const loadUserConfig = vi.fn(async () => config);
    const saveUserConfig = vi.fn(async (next: MetriLLMConfig) => {
      config = next;
    });
    const saveTelemetryPref = vi.fn(async (_value: boolean) => {});
    const selectSettingsAction = vi.fn(async () => sequence[idx++] ?? null);
    const promptSubmitterProfile = vi.fn(async () => null);
    const waitForAcknowledge = vi.fn(async () => {});

    await runSettingsMenu({
      loadUserConfig,
      saveUserConfig,
      saveTelemetryPref,
      selectSettingsAction,
      promptSubmitterProfile,
      waitForAcknowledge,
    });

    expect(saveUserConfig).toHaveBeenCalledWith({
      autoShare: "ask",
      autoSharePreferenceSet: true,
      telemetry: false,
      submitterNickname: undefined,
      submitterEmail: undefined,
    });
    expect(promptSubmitterProfile).not.toHaveBeenCalled();
    expect(saveTelemetryPref).not.toHaveBeenCalled();
    expect(waitForAcknowledge).toHaveBeenCalledTimes(1);
  });

  it("updates runtime backend from settings", async () => {
    let config: MetriLLMConfig = {
      autoShare: "ask",
      autoSharePreferenceSet: true,
      telemetry: false,
      runtimeBackend: "ollama",
    };
    const sequence = ["set-runtime-backend", "back"] as const;
    let idx = 0;

    const loadUserConfig = vi.fn(async () => config);
    const saveUserConfig = vi.fn(async (next: MetriLLMConfig) => {
      config = next;
    });
    const saveTelemetryPref = vi.fn(async (_value: boolean) => {});
    const selectSettingsAction = vi.fn(async () => sequence[idx++] ?? null);
    const selectRuntimeBackend = vi.fn(async () => "lm-studio" as const);
    const waitForAcknowledge = vi.fn(async () => {});

    await runSettingsMenu({
      loadUserConfig,
      saveUserConfig,
      saveTelemetryPref,
      selectSettingsAction,
      selectRuntimeBackend,
      waitForAcknowledge,
    });

    expect(selectRuntimeBackend).toHaveBeenCalledWith("ollama");
    expect(saveUserConfig).toHaveBeenCalledWith({
      autoShare: "ask",
      autoSharePreferenceSet: true,
      telemetry: false,
      runtimeBackend: "lm-studio",
    });
    expect(saveTelemetryPref).not.toHaveBeenCalled();
    expect(waitForAcknowledge).toHaveBeenCalledTimes(1);
  });
});
