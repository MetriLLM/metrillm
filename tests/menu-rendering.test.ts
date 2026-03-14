/**
 * Test intent:
 * - Protect the interactive arrow-menu renderer against duplicated titles
 *   after returning to the main menu from an unreachable runtime error.
 *
 * Why it matters:
 * - The published CLI runs inside real terminals where repaint logic must
 *   survive both wrapped text and long menus that may scroll the viewport.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  listCommandMock,
  loadConfigMock,
  printBannerMock,
  printGuruMeditationMock,
} = vi.hoisted(() => ({
  listCommandMock: vi.fn(),
  loadConfigMock: vi.fn(),
  printBannerMock: vi.fn(),
  printGuruMeditationMock: vi.fn(),
}));

vi.mock("../src/commands/list.js", () => ({
  listCommand: listCommandMock,
}));

vi.mock("../src/core/store.js", () => ({
  loadConfig: loadConfigMock,
  saveConfig: vi.fn(),
}));

vi.mock("../src/ui/banner.js", () => ({
  printBanner: printBannerMock,
}));

vi.mock("../src/ui/guru-meditation.js", () => ({
  printGuruMeditation: printGuruMeditationMock,
}));

import { runInteractiveMenu } from "../src/ui/menu.js";

describe("interactive menu renderer", () => {
  const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalStdoutIsTTY = process.stdout.isTTY;

  const setTTY = (value: boolean) => {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setTTY(true);
    loadConfigMock.mockResolvedValue({
      autoShare: "ask",
      telemetry: false,
      runtimeBackend: "ollama",
    });
    listCommandMock.mockResolvedValue({
      models: [],
      running: [],
      reachable: false,
    });
    printGuruMeditationMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (stdinTtyDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
    } else {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: originalStdinIsTTY,
      });
    }

    if (stdoutTtyDescriptor) {
      Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
    } else {
      Object.defineProperty(process.stdout, "isTTY", {
        configurable: true,
        value: originalStdoutIsTTY,
      });
    }
  });

  it("re-renders with relative cursor movement after returning from an unreachable runtime error", async () => {
    const stdinStream = process.stdin as NodeJS.ReadStream & {
      isRaw?: boolean;
      setRawMode?: (mode: boolean) => void;
    };
    const originalSetRawMode = stdinStream.setRawMode;
    const originalIsRaw = stdinStream.isRaw;
    const writes: string[] = [];

    stdinStream.setRawMode = (mode: boolean) => {
      stdinStream.isRaw = mode;
    };

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as typeof process.stdout.write);

    const tick = () => new Promise((resolve) => setImmediate(resolve));

    try {
      const pendingMenu = runInteractiveMenu({
        updateCheckPromise: Promise.resolve(null),
      });

      await tick();
      process.stdin.emit("keypress", "2", { name: "2" });

      await tick();
      await tick();
      process.stdin.emit("keypress", "\r", { name: "return" });

      await tick();
      await tick();
      process.stdin.emit("keypress", "", { name: "down" });

      await tick();
      process.stdin.emit("keypress", "8", { name: "8" });

      await pendingMenu;
    } finally {
      writeSpy.mockRestore();
      if (originalSetRawMode) {
        stdinStream.setRawMode = originalSetRawMode;
      } else {
        delete stdinStream.setRawMode;
      }
      stdinStream.isRaw = originalIsRaw;
    }

    const output = writes.join("");
    const relativeRewriteCount = output.split("\r\x1b[").length - 1;

    expect(relativeRewriteCount).toBeGreaterThanOrEqual(1);
    expect(output).not.toContain("\x1b7");
    expect(output).not.toContain("\x1b8\x1b[J");
  });
});
