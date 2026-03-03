import type {
  HardwareFitTuning,
  HardwareInfo,
  PerformanceMetrics,
  PerformanceScore,
} from "../types.js";
import { clamp, lerp, sanitizeNonNegative } from "../utils.js";

// Anchor points for continuous interpolation.
// Low end: ~4 cores, ~8 GB.  High end: ~24+ cores, ~96+ GB.
const TUNING_LOW = {
  speed:   { excellent: 15, good: 8,  marginal: 3,  hardMin: 2 },
  ttft:    { excellentMs: 2000, goodMs: 4000, marginalMs: 8000, hardMaxMs: 25000 },
  loadTimeHardMaxMs: 300000,
};

const TUNING_HIGH = {
  speed:   { excellent: 55, good: 30, marginal: 14, hardMin: 8 },
  ttft:    { excellentMs: 500,  goodMs: 1200, marginalMs: 2800, hardMaxMs: 10000 },
  loadTimeHardMaxMs: 90000,
};

function lerpNum(t: number, low: number, high: number): number {
  return low + t * (high - low);
}

function computeHardwareCapacity(hardware: HardwareInfo): number {
  // Core score: 4 cores = 0, 24+ cores = 1
  const coreScore = clamp((hardware.cpuCores - 4) / (24 - 4), 0, 1);
  // RAM score: 8 GB = 0, 96+ GB = 1
  const ramScore = clamp((hardware.totalMemoryGB - 8) / (96 - 8), 0, 1);
  // Weighted average — cores and RAM contribute equally
  return (coreScore + ramScore) / 2;
}

function deriveProfile(capacity: number): "ENTRY" | "BALANCED" | "HIGH-END" {
  if (capacity >= 0.55) return "HIGH-END";
  if (capacity >= 0.25) return "BALANCED";
  return "ENTRY";
}

export function deriveHardwareFitTuning(hardware?: HardwareInfo): HardwareFitTuning {
  if (!hardware) {
    // Default to mid-range when hardware is unknown
    const t = 0.35;
    return {
      profile: "BALANCED",
      speed: {
        excellent: Math.round(lerpNum(t, TUNING_LOW.speed.excellent, TUNING_HIGH.speed.excellent)),
        good:      Math.round(lerpNum(t, TUNING_LOW.speed.good,      TUNING_HIGH.speed.good)),
        marginal:  Math.round(lerpNum(t, TUNING_LOW.speed.marginal,  TUNING_HIGH.speed.marginal)),
        hardMin:   Math.round(lerpNum(t, TUNING_LOW.speed.hardMin,   TUNING_HIGH.speed.hardMin)),
      },
      ttft: {
        excellentMs: Math.round(lerpNum(t, TUNING_LOW.ttft.excellentMs, TUNING_HIGH.ttft.excellentMs)),
        goodMs:      Math.round(lerpNum(t, TUNING_LOW.ttft.goodMs,      TUNING_HIGH.ttft.goodMs)),
        marginalMs:  Math.round(lerpNum(t, TUNING_LOW.ttft.marginalMs,  TUNING_HIGH.ttft.marginalMs)),
        hardMaxMs:   Math.round(lerpNum(t, TUNING_LOW.ttft.hardMaxMs,   TUNING_HIGH.ttft.hardMaxMs)),
      },
      loadTimeHardMaxMs: Math.round(lerpNum(t, TUNING_LOW.loadTimeHardMaxMs, TUNING_HIGH.loadTimeHardMaxMs)),
    };
  }

  const t = computeHardwareCapacity(hardware);
  const profile = deriveProfile(t);

  return {
    profile,
    speed: {
      excellent: Math.round(lerpNum(t, TUNING_LOW.speed.excellent, TUNING_HIGH.speed.excellent)),
      good:      Math.round(lerpNum(t, TUNING_LOW.speed.good,      TUNING_HIGH.speed.good)),
      marginal:  Math.round(lerpNum(t, TUNING_LOW.speed.marginal,  TUNING_HIGH.speed.marginal)),
      hardMin:   Math.round(lerpNum(t, TUNING_LOW.speed.hardMin,   TUNING_HIGH.speed.hardMin)),
    },
    ttft: {
      excellentMs: Math.round(lerpNum(t, TUNING_LOW.ttft.excellentMs, TUNING_HIGH.ttft.excellentMs)),
      goodMs:      Math.round(lerpNum(t, TUNING_LOW.ttft.goodMs,      TUNING_HIGH.ttft.goodMs)),
      marginalMs:  Math.round(lerpNum(t, TUNING_LOW.ttft.marginalMs,  TUNING_HIGH.ttft.marginalMs)),
      hardMaxMs:   Math.round(lerpNum(t, TUNING_LOW.ttft.hardMaxMs,   TUNING_HIGH.ttft.hardMaxMs)),
    },
    loadTimeHardMaxMs: Math.round(lerpNum(t, TUNING_LOW.loadTimeHardMaxMs, TUNING_HIGH.loadTimeHardMaxMs)),
  };
}

function scoreSpeed(tps: number, tuning: HardwareFitTuning): number {
  if (tps >= tuning.speed.excellent) return 50;
  if (tps >= tuning.speed.good) {
    return lerp(tps, tuning.speed.good, tuning.speed.excellent, 30, 50);
  }
  if (tps >= tuning.speed.marginal) {
    return lerp(tps, tuning.speed.marginal, tuning.speed.good, 12, 30);
  }
  return lerp(tps, 0, tuning.speed.marginal, 0, 12);
}

// For TTFT: lower is better, so score decreases as TTFT increases
function scoreTTFT(ttft: number, tuning: HardwareFitTuning): number {
  if (ttft <= tuning.ttft.excellentMs) return 20;
  if (ttft <= tuning.ttft.goodMs) {
    return lerp(ttft, tuning.ttft.excellentMs, tuning.ttft.goodMs, 20, 13);
  }
  if (ttft <= tuning.ttft.marginalMs) {
    return lerp(ttft, tuning.ttft.goodMs, tuning.ttft.marginalMs, 13, 6);
  }
  return lerp(ttft, tuning.ttft.marginalMs, tuning.ttft.hardMaxMs, 6, 0);
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
  const safeTokensPerSecond = sanitizeNonNegative(perf.tokensPerSecond, 0);
  const safeTtft = sanitizeNonNegative(perf.ttft, tuning.ttft.hardMaxMs * 2);
  // Use host absolute memory usage when available (more representative of
  // the actual impact on the user's system) — fall back to model delta.
  const effectiveMemPercent = sanitizeNonNegative(
    perf.memoryHostPercent ?? perf.memoryPercent,
    100
  );
  const speed = Math.round(scoreSpeed(safeTokensPerSecond, tuning));
  const ttft = Math.round(scoreTTFT(safeTtft, tuning));
  const memory = Math.round(scoreMemory(effectiveMemPercent));

  return {
    total: clamp(speed + ttft + memory, 0, 100),
    speed,
    ttft,
    memory,
  };
}
