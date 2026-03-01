/**
 * Test intent:
 * - Validate list command success/empty/error paths without requiring a real Ollama daemon.
 *
 * Why it matters:
 * - Listing models is the entry-point of the interactive flow.
 * - Regressions here block users before any benchmark can start.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listModelsMock,
  listRunningModelsMock,
  spinner,
  errorMsgMock,
  warnMsgMock,
} = vi.hoisted(() => ({
  listModelsMock: vi.fn(),
  listRunningModelsMock: vi.fn(),
  spinner: {
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  },
  errorMsgMock: vi.fn(),
  warnMsgMock: vi.fn(),
}));

vi.mock("../src/core/ollama-client.js", () => ({
  listModels: listModelsMock,
  listRunningModels: listRunningModelsMock,
}));

vi.mock("../src/ui/progress.js", () => ({
  createSpinner: () => spinner,
  errorMsg: errorMsgMock,
  warnMsg: warnMsgMock,
}));

import { listCommand } from "../src/commands/list.js";

describe("listCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listModelsMock.mockResolvedValue([]);
    listRunningModelsMock.mockResolvedValue([]);
  });

  it("returns models and running set on success", async () => {
    listModelsMock.mockResolvedValueOnce([
      {
        name: "qwen2.5:7b",
        size: 12_000_000_000,
        parameterSize: "7B",
        quantization: "Q4_K_M",
        family: "qwen",
      },
    ]);
    listRunningModelsMock.mockResolvedValueOnce([
      { name: "qwen2.5:7b", size: 12_000_000_000, size_vram: 5_000_000_000 },
    ]);

    const out = await listCommand({ setExitCode: false });
    expect(out.models).toHaveLength(1);
    expect(out.running).toHaveLength(1);
    expect(out.reachable).toBe(true);
    expect(spinner.start).toHaveBeenCalledTimes(1);
    expect(spinner.succeed).toHaveBeenCalledTimes(1);
    expect(spinner.fail).not.toHaveBeenCalled();
  });

  it("handles empty model list gracefully", async () => {
    const out = await listCommand({ setExitCode: false });
    expect(out.models).toEqual([]);
    expect(out.running).toEqual([]);
    expect(out.reachable).toBe(true);
    expect(spinner.succeed).toHaveBeenCalledWith("Found 0 model(s)");
  });

  it("keeps model listing when running status lookup fails", async () => {
    listModelsMock.mockResolvedValueOnce([
      {
        name: "llama3.1:8b",
        size: 13_000_000_000,
        parameterSize: "8B",
        quantization: "Q4_0",
        family: "llama",
      },
    ]);
    listRunningModelsMock.mockRejectedValueOnce(new Error("ps failed"));

    const out = await listCommand({ setExitCode: false });
    expect(out.models).toHaveLength(1);
    expect(out.running).toEqual([]);
    expect(out.reachable).toBe(true);
    expect(spinner.fail).not.toHaveBeenCalled();
  });

  it("returns empty output on connection failure and sets exitCode", async () => {
    const prevExitCode = process.exitCode;
    process.exitCode = 0;
    listModelsMock.mockRejectedValueOnce(new Error("daemon down"));

    const out = await listCommand();
    expect(out.models).toEqual([]);
    expect(out.running).toEqual([]);
    expect(out.reachable).toBe(false);
    expect(spinner.fail).toHaveBeenCalledWith("Cannot connect to Ollama");
    expect(errorMsgMock).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);

    process.exitCode = prevExitCode;
  });
});
