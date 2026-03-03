/**
 * Test intent:
 * - Ensure listCommand does not override the active runtime when backend is omitted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  setRuntimeByNameMock,
  getRuntimeNameMock,
  getRuntimeDisplayNameMock,
  getRuntimeModelInstallHintMock,
  getRuntimeSetupHintsMock,
  listModelsMock,
  listRunningModelsMock,
} = vi.hoisted(() => ({
  setRuntimeByNameMock: vi.fn(),
  getRuntimeNameMock: vi.fn(),
  getRuntimeDisplayNameMock: vi.fn(),
  getRuntimeModelInstallHintMock: vi.fn(),
  getRuntimeSetupHintsMock: vi.fn(),
  listModelsMock: vi.fn(),
  listRunningModelsMock: vi.fn(),
}));

vi.mock("../src/core/runtime.js", () => ({
  setRuntimeByName: setRuntimeByNameMock,
  getRuntimeName: getRuntimeNameMock,
  getRuntimeDisplayName: getRuntimeDisplayNameMock,
  getRuntimeModelInstallHint: getRuntimeModelInstallHintMock,
  getRuntimeSetupHints: getRuntimeSetupHintsMock,
  listModels: listModelsMock,
  listRunningModels: listRunningModelsMock,
}));

vi.mock("../src/ui/progress.js", () => ({
  createSpinner: () => ({
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
  errorMsg: vi.fn(),
  warnMsg: vi.fn(),
}));

describe("listCommand runtime selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRuntimeNameMock.mockReturnValue("lm-studio");
    getRuntimeDisplayNameMock.mockReturnValue("LM Studio");
    getRuntimeModelInstallHintMock.mockReturnValue("hint");
    getRuntimeSetupHintsMock.mockReturnValue(["setup-hint"]);
    listModelsMock.mockResolvedValue([{ name: "qwen3-8b", size: 0 }]);
    listRunningModelsMock.mockResolvedValue([]);
  });

  it("preserves currently selected runtime when backend is omitted", async () => {
    const { listCommand } = await import("../src/commands/list.js");
    await listCommand({ setExitCode: false });
    expect(setRuntimeByNameMock).not.toHaveBeenCalled();
  });

  it("switches runtime when backend is explicitly provided", async () => {
    const { listCommand } = await import("../src/commands/list.js");
    await listCommand({ setExitCode: false, backend: "ollama" });
    expect(setRuntimeByNameMock).toHaveBeenCalledWith("ollama");
  });
});
