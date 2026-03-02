import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadConfigMock,
  saveConfigMock,
  posthogCtorMock,
  captureMock,
  shutdownMock,
} = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  saveConfigMock: vi.fn(),
  posthogCtorMock: vi.fn(),
  captureMock: vi.fn(),
  shutdownMock: vi.fn(),
}));

vi.mock("../src/core/store.js", () => ({
  loadConfig: loadConfigMock,
  saveConfig: saveConfigMock,
}));

vi.mock("posthog-node", () => ({
  PostHog: posthogCtorMock,
}));

describe("telemetry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.METRILLM_POSTHOG_KEY = "phc_test_key";
    posthogCtorMock.mockImplementation(function MockPostHog(this: Record<string, unknown>) {
      this.capture = captureMock;
      this.shutdown = shutdownMock;
    });
  });

  it("does not capture events when telemetry is disabled", async () => {
    loadConfigMock.mockResolvedValueOnce({ telemetry: false });
    const telemetry = await import("../src/core/telemetry.js");

    await telemetry.trackEvent("bench_started", { model: "qwen" });
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("captures events when telemetry is enabled", async () => {
    loadConfigMock.mockResolvedValueOnce({ telemetry: true });
    const telemetry = await import("../src/core/telemetry.js");

    await telemetry.trackBenchStarted({
      model: "qwen2.5:7b",
      os: "macOS",
      arch: "arm64",
      cpuCores: 8,
      ramGb: 32,
    });

    expect(posthogCtorMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledTimes(1);
    const payload = captureMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.event).toBe("bench_started");
    expect((payload.properties as Record<string, unknown>).source).toBe("metrillm-cli");
  });

  it("saves consent and reuses it for subsequent calls", async () => {
    loadConfigMock.mockResolvedValueOnce({});
    const telemetry = await import("../src/core/telemetry.js");

    await telemetry.saveTelemetryConsent(true);
    expect(saveConfigMock).toHaveBeenCalledWith({ telemetry: true });

    await telemetry.trackBenchShared({ model: "qwen", verdict: "GOOD" });
    expect(captureMock).toHaveBeenCalledTimes(1);
  });

  it("flushTelemetry is safe with no client and with shutdown errors", async () => {
    loadConfigMock.mockResolvedValue({ telemetry: true });
    const telemetry = await import("../src/core/telemetry.js");

    await telemetry.flushTelemetry();
    expect(shutdownMock).not.toHaveBeenCalled();

    await telemetry.trackBenchExported({ format: "json" });
    shutdownMock.mockRejectedValueOnce(new Error("flush failed"));
    await telemetry.flushTelemetry();
    expect(shutdownMock).toHaveBeenCalledTimes(1);
  });

  it("shows notice only when telemetry consent is not set", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    loadConfigMock.mockResolvedValueOnce({});
    const telemetryA = await import("../src/core/telemetry.js");
    await telemetryA.showTelemetryNotice();
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    vi.resetModules();
    vi.clearAllMocks();
    posthogCtorMock.mockImplementation(function MockPostHog(this: Record<string, unknown>) {
      this.capture = captureMock;
      this.shutdown = shutdownMock;
    });
    const consoleSpy2 = vi.spyOn(console, "log").mockImplementation(() => {});

    loadConfigMock.mockResolvedValueOnce({ telemetry: false });
    const telemetryB = await import("../src/core/telemetry.js");
    await telemetryB.showTelemetryNotice();
    expect(consoleSpy2).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
    consoleSpy2.mockRestore();
  });
});
