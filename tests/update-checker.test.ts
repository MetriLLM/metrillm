/**
 * Test intent:
 * - Verify version discovery and update checks stay aligned with the installed package metadata.
 * - Ensure the update warning logic remains reliable with both fresh network checks and cached results.
 *
 * Why it matters:
 * - The banner and update prompt both depend on the current CLI version.
 * - A broken update check leaves users stuck on stale releases without any warning.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn());
const mkdirMock = vi.hoisted(() => vi.fn());
const execSyncMock = vi.hoisted(() => vi.fn());
const realpathSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
  readFileSync: readFileMock,
  realpathSync: realpathSyncMock,
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: writeFileMock,
  mkdir: mkdirMock,
}));

vi.mock("node:child_process", () => ({
  execSync: execSyncMock,
}));

describe("app metadata", () => {
  beforeEach(() => {
    vi.resetModules();
    readFileMock.mockReset();
    realpathSyncMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the CLI version from package.json once and caches it", async () => {
    readFileMock.mockReturnValue(JSON.stringify({ version: "9.9.9" }));

    const { getCliVersion } = await import("../src/core/app-meta.js");

    expect(getCliVersion()).toBe("9.9.9");
    expect(getCliVersion()).toBe("9.9.9");
    expect(readFileMock).toHaveBeenCalledTimes(1);
  });

  it("finds package.json when running from the bundled dist entrypoint", async () => {
    process.argv[1] = "/tmp/metrillm/dist/index.mjs";
    realpathSyncMock.mockImplementation((value: string) => value);
    readFileMock.mockImplementation((path: string) => {
      if (path === "/tmp/metrillm/package.json") {
        return JSON.stringify({ version: "0.2.2" });
      }
      throw new Error(`ENOENT: ${path}`);
    });

    const { getCliVersion } = await import("../src/core/app-meta.js");

    expect(getCliVersion()).toBe("0.2.2");
    expect(readFileMock).toHaveBeenCalledWith("/tmp/metrillm/package.json", "utf8");
  });

  it("detects a Homebrew install from the resolved executable path", async () => {
    realpathSyncMock.mockReturnValue("/opt/homebrew/Cellar/metrillm/0.2.2/libexec/lib/node_modules/metrillm/dist/index.mjs");
    process.argv[1] = "/opt/homebrew/bin/metrillm";

    const { getInstallChannel } = await import("../src/core/app-meta.js");

    expect(getInstallChannel()).toBe("homebrew");
  });
});

describe("checkForUpdate", () => {
  beforeEach(() => {
    vi.resetModules();
    readFileMock.mockReset();
    realpathSyncMock.mockReset();
    writeFileMock.mockReset();
    mkdirMock.mockReset();
    execSyncMock.mockReset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an available update after a successful npm registry fetch and refreshes the cache", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: "0.3.0" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { checkForUpdate } = await import("../src/core/update-checker.js");
    const info = await checkForUpdate("0.2.2");

    expect(info).toEqual({
      current: "0.2.2",
      latest: "0.3.0",
      updateAvailable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mkdirMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).toHaveBeenCalledTimes(1);
  });

  it("uses a fresh cache entry without hitting the network", async () => {
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    vi.doMock("node:fs/promises", () => ({
      readFile: vi.fn(async () => JSON.stringify({
        latest: "0.2.3",
        checkedAt: now,
        channel: "local",
      })),
      writeFile: writeFileMock,
      mkdir: mkdirMock,
    }));

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { checkForUpdate } = await import("../src/core/update-checker.js");
    const info = await checkForUpdate("0.2.2");

    expect(info).toEqual({
      current: "0.2.2",
      latest: "0.2.3",
      updateAvailable: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("uses Homebrew formula version instead of npm for Homebrew installs", async () => {
    realpathSyncMock.mockReturnValue("/opt/homebrew/Cellar/metrillm/0.2.2/libexec/lib/node_modules/metrillm/dist/index.mjs");
    process.argv[1] = "/opt/homebrew/bin/metrillm";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    execSyncMock.mockImplementation((command: string) => {
      if (command === "brew info --json=v2 metrillm") {
        return JSON.stringify({
          formulae: [{ versions: { stable: "0.2.3" } }],
        });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const { checkForUpdate } = await import("../src/core/update-checker.js");
    const info = await checkForUpdate("0.2.2");

    expect(info).toEqual({
      current: "0.2.2",
      latest: "0.2.3",
      updateAvailable: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(execSyncMock).toHaveBeenCalledWith("brew info --json=v2 metrillm", {
      encoding: "utf8",
      timeout: 3000,
    });
  });

  it("ignores cache entries from a different install channel", async () => {
    const now = 2_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    realpathSyncMock.mockReturnValue("/opt/homebrew/Cellar/metrillm/0.2.2/libexec/lib/node_modules/metrillm/dist/index.mjs");
    process.argv[1] = "/opt/homebrew/bin/metrillm";

    vi.doMock("node:fs/promises", () => ({
      readFile: vi.fn(async () => JSON.stringify({
        latest: "9.9.9",
        checkedAt: now,
        channel: "npm",
      })),
      writeFile: writeFileMock,
      mkdir: mkdirMock,
    }));

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    execSyncMock.mockImplementation((command: string) => {
      if (command === "brew info --json=v2 metrillm") {
        return JSON.stringify({
          formulae: [{ versions: { stable: "0.2.2" } }],
        });
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const { checkForUpdate } = await import("../src/core/update-checker.js");
    const info = await checkForUpdate("0.2.2");

    expect(info).toEqual({
      current: "0.2.2",
      latest: "0.2.2",
      updateAvailable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(execSyncMock).toHaveBeenCalledWith("brew info --json=v2 metrillm", {
      encoding: "utf8",
      timeout: 3000,
    });
  });

  it("uses the Homebrew update command when the executable comes from Homebrew", async () => {
    realpathSyncMock.mockReturnValue("/opt/homebrew/Cellar/metrillm/0.2.2/libexec/lib/node_modules/metrillm/dist/index.mjs");
    process.argv[1] = "/opt/homebrew/bin/metrillm";

    const { getInstallChannelLabel, getUpdateCommand, runUpdate } = await import("../src/core/update-checker.js");

    expect(getInstallChannelLabel()).toBe("Homebrew");
    expect(getUpdateCommand()).toBe("brew upgrade metrillm");
    expect(runUpdate()).toBe(true);
    expect(execSyncMock).toHaveBeenCalledWith("brew upgrade metrillm", {
      stdio: "inherit",
      timeout: 60_000,
    });
  });
});
