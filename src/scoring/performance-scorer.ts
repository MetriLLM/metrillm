import type {
  HardwareFitTuning,
  HardwareInfo,
  PerformanceMetrics,
  PerformanceScore,
} from "../types.js";
import { clamp, lerp } from "../utils.js";

const ENTRY_TUNING: HardwareFitTuning = {
  profile: "ENTRY",
  speed: {
    excellent: 20,
    good: 10,
    marginal: 4,
    hardMin: 3,
  },
  ttft: {
    excellentMs: 1500,
    goodMs: 3200,
    marginalMs: 7000,
    hardMaxMs: 20000,
  },
  loadTimeHardMaxMs: 240000,
};

const BALANCED_TUNING: HardwareFitTuning = {
  profile: "BALANCED",
  speed: {
    excellent: 30,
    good: 16,
    marginal: 7,
    hardMin: 5,
  },
  ttft: {
    excellentMs: 1000,
    goodMs: 2200,
    marginalMs: 5000,
    hardMaxMs: 15000,
  },
  loadTimeHardMaxMs: 180000,
};

const HIGH_END_TUNING: HardwareFitTuning = {
  profile: "HIGH-END",
  speed: {
    excellent: 45,
    good: 25,
    marginal: 12,
    hardMin: 6,
  },
  ttft: {
    excellentMs: 700,
    goodMs: 1600,
    marginalMs: 3500,
    hardMaxMs: 12000,
  },
  loadTimeHardMaxMs: 120000,
};

export function deriveHardwareFitTuning(hardware?: HardwareInfo): HardwareFitTuning {
  if (!hardware) return BALANCED_TUNING;

  if (hardware.cpuCores >= 12 && hardware.totalMemoryGB >= 48) {
    return HIGH_END_TUNING;
  }
  if (hardware.cpuCores >= 8 && hardware.totalMemoryGB >= 24) {
    return BALANCED_TUNING;
  }
  return ENTRY_TUNING;
}

function scoreSpeed(tps: number, tuning: HardwareFitTuning): number {
  if (tps >= tuning.speed.excellent) return 40;
  if (tps >= tuning.speed.good) {
    return lerp(tps, tuning.speed.good, tuning.speed.excellent, 25, 40);
  }
  if (tps >= tuning.speed.marginal) {
    return lerp(tps, tuning.speed.marginal, tuning.speed.good, 10, 25);
  }
  return lerp(tps, 0, tuning.speed.marginal, 0, 10);
}

// For TTFT: lower is better, so score decreases as TTFT increases
function scoreTTFT(ttft: number, tuning: HardwareFitTuning): number {
  if (ttft <= tuning.ttft.excellentMs) return 30;
  if (ttft <= tuning.ttft.goodMs) {
    return lerp(ttft, tuning.ttft.excellentMs, tuning.ttft.goodMs, 30, 20);
  }
  if (ttft <= tuning.ttft.marginalMs) {
    return lerp(ttft, tuning.ttft.goodMs, tuning.ttft.marginalMs, 20, 10);
  }
  return lerp(ttft, tuning.ttft.marginalMs, tuning.ttft.hardMaxMs, 10, 0);
}

// For memory: lower usage is better, so score decreases as usage increases
function scoreMemory(memPercent: number): number {
  if (memPercent <= 30) return 30;
  if (memPercent <= 50) return lerp(memPercent, 30, 50, 30, 25);
  if (memPercent <= 70) return lerp(memPercent, 50, 70, 25, 15);
  if (memPercent <= 90) return lerp(memPercent, 70, 90, 15, 5);
  return lerp(memPercent, 90, 100, 5, 0);
}

export function computePerformanceScore(
  perf: PerformanceMetrics,
  hardware?: HardwareInfo
): PerformanceScore {
  const tuning = deriveHardwareFitTuning(hardware);
  const speed = Math.round(scoreSpeed(perf.tokensPerSecond, tuning));
  const ttft = Math.round(scoreTTFT(perf.ttft, tuning));
  // Use host absolute memory usage when available (more representative of
  // the actual impact on the user's system) — fall back to model delta.
  const effectiveMemPercent = perf.memoryHostPercent ?? perf.memoryPercent;
  const memory = Math.round(scoreMemory(effectiveMemPercent));

  return {
    total: clamp(speed + ttft + memory, 0, 100),
    speed,
    ttft,
    memory,
  };
}
