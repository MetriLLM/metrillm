/**
 * Test intent:
 * - Verify power mode detection across macOS, Linux, and Windows.
 * - Ensure silent failure → "unknown" when detection fails.
 *
 * Why it matters:
 * - Power mode affects benchmark comparability warnings.
 * - Detection must never crash the benchmark flow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { readFile } from "node:fs/promises";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

// We need to test the internal detectPowerMode functions.
// Since they are not exported, we test via getHardwareInfo which calls detectPowerMode.
// However, getHardwareInfo also calls systeminformation which is heavy.
// Instead, let's test the power mode logic by re-implementing the test
// against the module internals through a dynamic import after mocking.

// For a clean approach, we'll test the exported getHardwareInfo with full SI mock.
vi.mock("systeminformation", () => ({
  default: {
    cpu: vi.fn(async () => ({
      manufacturer: "Test",
      brand: "CPU",
      cores: 8,
      performanceCores: 6,
      efficiencyCores: 2,
      speed: 3.2,
    })),
    mem: vi.fn(async () => ({
      total: 32 * 1024 ** 3,
      available: 16 * 1024 ** 3,
      swaptotal: 4 * 1024 ** 3,
      swapused: 0,
    })),
    graphics: vi.fn(async () => ({
      controllers: [{ model: "Test GPU", cores: 16, vram: null }],
    })),
    osInfo: vi.fn(async () => ({
      distro: "TestOS",
      release: "1.0",
    })),
    memLayout: vi.fn(async () => [{ type: "DDR5" }]),
    cpuCurrentSpeed: vi.fn(async () => ({ avg: 3.0 })),
    battery: vi.fn(async () => ({
      hasBattery: true,
      acConnected: true,
      isCharging: true,
      percent: 100,
    })),
  },
}));

const mockedExecFile = vi.mocked(execFileCb);
const mockedReadFile = vi.mocked(readFile);

describe("power mode detection", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects macOS low-power mode", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockedExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, stdout: string) => void)(null, "Currently drawing from 'AC Power'\n lowpowermode 1\n");
      return {} as ReturnType<typeof execFileCb>;
    });

    const { getHardwareInfo } = await import("../src/core/hardware.js");
    const hw = await getHardwareInfo();
    expect(hw.powerMode).toBe("low-power");
  });

  it("detects macOS balanced mode", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockedExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, stdout: string) => void)(null, "Currently drawing from 'AC Power'\n lowpowermode 0\n");
      return {} as ReturnType<typeof execFileCb>;
    });

    const { getHardwareInfo } = await import("../src/core/hardware.js");
    const hw = await getHardwareInfo();
    expect(hw.powerMode).toBe("balanced");
  });

  it("detects Linux powersave governor", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockedReadFile.mockResolvedValue("powersave\n");

    const { getHardwareInfo } = await import("../src/core/hardware.js");
    const hw = await getHardwareInfo();
    expect(hw.powerMode).toBe("low-power");
  });

  it("detects Linux performance governor", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockedReadFile.mockResolvedValue("performance\n");

    const { getHardwareInfo } = await import("../src/core/hardware.js");
    const hw = await getHardwareInfo();
    expect(hw.powerMode).toBe("performance");
  });

  it("detects Linux schedutil governor as balanced", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockedReadFile.mockResolvedValue("schedutil\n");

    const { getHardwareInfo } = await import("../src/core/hardware.js");
    const hw = await getHardwareInfo();
    expect(hw.powerMode).toBe("balanced");
  });

  it("detects Windows Power Saver", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    mockedExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, stdout: string) => void)(
        null,
        "Power Scheme GUID: 123  (Power saver)"
      );
      return {} as ReturnType<typeof execFileCb>;
    });

    const { getHardwareInfo } = await import("../src/core/hardware.js");
    const hw = await getHardwareInfo();
    expect(hw.powerMode).toBe("low-power");
  });

  it("detects Windows High performance", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    mockedExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, stdout: string) => void)(
        null,
        "Power Scheme GUID: 456  (High performance)"
      );
      return {} as ReturnType<typeof execFileCb>;
    });

    const { getHardwareInfo } = await import("../src/core/hardware.js");
    const hw = await getHardwareInfo();
    expect(hw.powerMode).toBe("performance");
  });

  it("detects Windows Balanced mode", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    mockedExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, stdout: string) => void)(
        null,
        "Power Scheme GUID: 789  (Balanced)"
      );
      return {} as ReturnType<typeof execFileCb>;
    });

    const { getHardwareInfo } = await import("../src/core/hardware.js");
    const hw = await getHardwareInfo();
    expect(hw.powerMode).toBe("balanced");
  });

  it("returns unknown when exec fails", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockedExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: Error, stdout: string) => void)(new Error("command not found"), "");
      return {} as ReturnType<typeof execFileCb>;
    });

    const { getHardwareInfo } = await import("../src/core/hardware.js");
    const hw = await getHardwareInfo();
    expect(hw.powerMode).toBe("unknown");
  });

  it("includes cpuCurrentSpeedGHz in hardware info", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockedExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, stdout: string) => void)(null, "lowpowermode 0\n");
      return {} as ReturnType<typeof execFileCb>;
    });

    const { getHardwareInfo } = await import("../src/core/hardware.js");
    const hw = await getHardwareInfo();
    expect(hw.cpuCurrentSpeedGHz).toBe(3.0);
  });
});

describe("detectThermalPressure", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns nominal when CPU_Speed_Limit = 100 on macOS", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockedExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, stdout: string) => void)(null, "CPU_Speed_Limit = 100\n");
      return {} as ReturnType<typeof execFileCb>;
    });

    const { detectThermalPressure } = await import("../src/core/hardware.js");
    expect(await detectThermalPressure()).toBe("nominal");
  });

  it("returns moderate when CPU_Speed_Limit = 85 on macOS", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockedExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, stdout: string) => void)(null, "CPU_Speed_Limit = 85\n");
      return {} as ReturnType<typeof execFileCb>;
    });

    const { detectThermalPressure } = await import("../src/core/hardware.js");
    expect(await detectThermalPressure()).toBe("moderate");
  });

  it("returns heavy when CPU_Speed_Limit = 60 on macOS", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockedExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, stdout: string) => void)(null, "CPU_Speed_Limit = 60\n");
      return {} as ReturnType<typeof execFileCb>;
    });

    const { detectThermalPressure } = await import("../src/core/hardware.js");
    expect(await detectThermalPressure()).toBe("heavy");
  });

  it("returns critical when CPU_Speed_Limit = 30 on macOS", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockedExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, stdout: string) => void)(null, "CPU_Speed_Limit = 30\n");
      return {} as ReturnType<typeof execFileCb>;
    });

    const { detectThermalPressure } = await import("../src/core/hardware.js");
    expect(await detectThermalPressure()).toBe("critical");
  });

  it("returns unknown when pmset output is empty on macOS", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockedExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: Error, stdout: string) => void)(new Error("fail"), "");
      return {} as ReturnType<typeof execFileCb>;
    });

    const { detectThermalPressure } = await import("../src/core/hardware.js");
    expect(await detectThermalPressure()).toBe("unknown");
  });
});

describe("detectBatteryPowered", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when on Battery Power on macOS", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockedExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, stdout: string) => void)(null, "Currently drawing from 'Battery Power'\n");
      return {} as ReturnType<typeof execFileCb>;
    });

    const { detectBatteryPowered } = await import("../src/core/hardware.js");
    expect(await detectBatteryPowered()).toBe(true);
  });

  it("returns false when on AC Power on macOS", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockedExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, stdout: string) => void)(null, "Currently drawing from 'AC Power'\n");
      return {} as ReturnType<typeof execFileCb>;
    });

    const { detectBatteryPowered } = await import("../src/core/hardware.js");
    expect(await detectBatteryPowered()).toBe(false);
  });

  it("returns undefined when detection fails on macOS", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockedExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: Error, stdout: string) => void)(new Error("fail"), "");
      return {} as ReturnType<typeof execFileCb>;
    });

    const { detectBatteryPowered } = await import("../src/core/hardware.js");
    expect(await detectBatteryPowered()).toBeUndefined();
  });

  it("uses AC connection on non-macOS to detect battery-powered state", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    const siModule = await import("systeminformation");
    const batteryMock = vi.mocked(siModule.default.battery);
    batteryMock.mockResolvedValueOnce({
      hasBattery: true,
      acConnected: false,
      isCharging: false,
      percent: 100,
    } as Awaited<ReturnType<typeof siModule.default.battery>>);

    const { detectBatteryPowered } = await import("../src/core/hardware.js");
    expect(await detectBatteryPowered()).toBe(true);
  });

  it("falls back to charging state on non-macOS when AC status is unavailable", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const siModule = await import("systeminformation");
    const batteryMock = vi.mocked(siModule.default.battery);
    batteryMock.mockResolvedValueOnce({
      hasBattery: true,
      acConnected: undefined,
      isCharging: true,
      percent: 80,
    } as Awaited<ReturnType<typeof siModule.default.battery>>);

    const { detectBatteryPowered } = await import("../src/core/hardware.js");
    expect(await detectBatteryPowered()).toBe(false);
  });
});
