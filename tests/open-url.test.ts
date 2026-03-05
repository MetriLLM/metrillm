import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock, spawnMock } = vi.hoisted(() => {
  const execFileMock = vi.fn(() => {
    const child = {
      on: vi.fn(),
    };
    return child;
  });

  const spawnMock = vi.fn(() => {
    const child = {
      on: vi.fn(),
      unref: vi.fn(),
    };
    return child;
  });

  return { execFileMock, spawnMock };
});

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}));

import { openUrl } from "../src/utils.js";

const originalPlatform = process.platform;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

describe("openUrl", () => {
  beforeEach(() => {
    execFileMock.mockClear();
    spawnMock.mockClear();
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it("uses cmd start on Windows", () => {
    setPlatform("win32");

    openUrl("https://metrillm.dev");

    expect(spawnMock).toHaveBeenCalledWith(
      "cmd",
      ["/c", "start", "", "https://metrillm.dev"],
      expect.objectContaining({
        windowsHide: true,
        stdio: "ignore",
      })
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("uses open on macOS", () => {
    setPlatform("darwin");

    openUrl("https://metrillm.dev");

    expect(execFileMock).toHaveBeenCalledWith("open", ["https://metrillm.dev"]);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
