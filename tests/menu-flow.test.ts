/**
 * Test intent:
 * - Lock the post-benchmark interactive flow behavior.
 * - Ensure export action does not implicitly trigger a benchmark rerun.
 *
 * Why it matters:
 * - Users may export after long runs; accidental reruns are costly and unexpected.
 * - This protects the "Next Action" menu contract over future refactors.
 */
import { describe, it, expect, vi } from "vitest";
import { choosePostBenchmarkAction } from "../src/ui/menu.js";

describe("choosePostBenchmarkAction", () => {
  it("stays in action menu after export, then can return to main menu", async () => {
    const sequence = ["export", "menu"] as const;
    let index = 0;

    const selectAction = vi.fn(async () => sequence[index++] ?? null);
    const exportResults = vi.fn(async () => {});

    const action = await choosePostBenchmarkAction([], {
      selectAction,
      exportResults,
    });

    expect(action).toBe("menu");
    expect(exportResults).toHaveBeenCalledTimes(1);
    expect(selectAction).toHaveBeenCalledTimes(2);
  });

  it("allows export then rerun explicitly", async () => {
    const sequence = ["export", "rerun"] as const;
    let index = 0;

    const selectAction = vi.fn(async () => sequence[index++] ?? null);
    const exportResults = vi.fn(async () => {});

    const action = await choosePostBenchmarkAction([], {
      selectAction,
      exportResults,
    });

    expect(action).toBe("rerun");
    expect(exportResults).toHaveBeenCalledTimes(1);
    expect(selectAction).toHaveBeenCalledTimes(2);
  });

  it("returns quit directly without exporting", async () => {
    const selectAction = vi.fn(async () => "quit" as const);
    const exportResults = vi.fn(async () => {});

    const action = await choosePostBenchmarkAction([], {
      selectAction,
      exportResults,
    });

    expect(action).toBe("quit");
    expect(exportResults).not.toHaveBeenCalled();
    expect(selectAction).toHaveBeenCalledTimes(1);
  });
});
