import type {
  HardwareInfo,
  PerformanceMetrics,
  QualityMetrics,
  FitnessResult,
  FitnessVerdict,
  CategoryLabel,
  CategoryLevel,
} from "../types.js";
import {
  computePerformanceScore,
  deriveHardwareFitTuning,
} from "./performance-scorer.js";
import { computeQualityScore, effectiveScore, RESPONSE_TIME_LIMITS_MS } from "./quality-scorer.js";
import { clamp } from "../utils.js";

function getCategoryLevel(rawScore: number): CategoryLevel {
  if (rawScore >= 75) return "Strong";
  if (rawScore >= 50) return "Adequate";
  if (rawScore >= 25) return "Weak";
  return "Poor";
}

function normalizeRawScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 100);
}

function sanitizeNonNegative(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

export function computeFitness(
  perf: PerformanceMetrics,
  quality: QualityMetrics | null,
  hardware?: HardwareInfo
): FitnessResult {
  const tuning = deriveHardwareFitTuning(hardware);
  const performanceScore = computePerformanceScore(perf, hardware);
  const qualityScore = quality ? computeQualityScore(quality) : null;

  const hardwareFitScore = Math.round(performanceScore.total);

  // Global score: 40% HW + 60% Quality (null if quality absent)
  const globalScore = qualityScore
    ? clamp(Math.round(0.4 * hardwareFitScore + 0.6 * qualityScore.total), 0, 100)
    : null;

  // Category labels from effective scores (with time penalties applied)
  const categoryLabels: CategoryLabel[] | null = quality
    ? ([
        { category: "Reasoning", key: "reasoning", result: quality.reasoning },
        { category: "Coding", key: "coding", result: quality.coding },
        { category: "Instruction Following", key: "instructionFollowing", result: quality.instructionFollowing },
        { category: "Structured Output", key: "structuredOutput", result: quality.structuredOutput },
        { category: "Math", key: "math", result: quality.math },
        { category: "Multilingual", key: "multilingual", result: quality.multilingual },
      ] as const).map(({ category, key, result }) => {
        const score = normalizeRawScore(effectiveScore(result, RESPONSE_TIME_LIMITS_MS[key]));
        return { category, rawScore: score, level: getCategoryLevel(score) };
      })
    : null;

  const safeTokensPerSecond = sanitizeNonNegative(perf.tokensPerSecond, 0);
  const safeTtft = sanitizeNonNegative(perf.ttft, tuning.ttft.hardMaxMs * 10);
  const safeLoadTime = sanitizeNonNegative(perf.loadTime, tuning.loadTimeHardMaxMs * 10);
  const hostMemoryPercent = sanitizeNonNegative(
    perf.memoryHostPercent ?? perf.memoryPercent,
    100
  );
  const modelMemoryDeltaPercent = sanitizeNonNegative(perf.memoryPercent, 100);

  // Disqualifiers
  const disqualifiers: string[] = [];
  if (safeTokensPerSecond < tuning.speed.hardMin) {
    disqualifiers.push(
      `Token speed too low: ${safeTokensPerSecond.toFixed(1)} tok/s (minimum: ${tuning.speed.hardMin} tok/s for ${tuning.profile} profile)`
    );
  }
  if (safeTtft > tuning.ttft.hardMaxMs) {
    disqualifiers.push(
      `Time to first token too high: ${Math.round(safeTtft)}ms (maximum: ${tuning.ttft.hardMaxMs}ms for ${tuning.profile} profile)`
    );
  }
  if (safeLoadTime > tuning.loadTimeHardMaxMs) {
    disqualifiers.push(
      `Model load time too high: ${Math.round(safeLoadTime)}ms (maximum: ${tuning.loadTimeHardMaxMs}ms for ${tuning.profile} profile)`
    );
  }
  const hostCritical = hostMemoryPercent > 95;
  const modelDeltaCritical = modelMemoryDeltaPercent > 90;
  const modelDeltaSignificant = modelMemoryDeltaPercent >= 10;
  if (modelDeltaCritical || (hostCritical && modelDeltaSignificant)) {
    disqualifiers.push(
      `Memory usage critical: host ${hostMemoryPercent.toFixed(0)}%, model delta +${modelMemoryDeltaPercent.toFixed(0)}%`
    );
  }

  // Determine verdict based on globalScore (or hardwareFitScore if null)
  const verdictScore = globalScore ?? hardwareFitScore;
  let verdict: FitnessVerdict;
  if (disqualifiers.length > 0) {
    verdict = "NOT RECOMMENDED";
  } else if (verdictScore >= 80) {
    verdict = "EXCELLENT";
  } else if (verdictScore >= 60) {
    verdict = "GOOD";
  } else if (verdictScore >= 40) {
    verdict = "MARGINAL";
  } else {
    verdict = "NOT RECOMMENDED";
  }

  // Interpretation
  let interpretation: string;
  if (categoryLabels) {
    const labelParts = categoryLabels.map((l) => `${l.category}: ${l.level}`).join(", ");
    interpretation = `Hardware fit: ${hardwareFitScore}/100. Overall suitability: ${verdict}${globalScore !== null ? ` (Global ${globalScore}/100)` : ""}. Category profile: ${labelParts}.`;
  } else {
    interpretation = `Hardware fit: ${hardwareFitScore}/100. Overall suitability: ${verdict}. Run full benchmarks for quality assessment.`;
  }

  // Warnings
  const warnings: string[] = [];

  if (qualityScore !== null && qualityScore.total < 15) {
    interpretation +=
      " Warning: model produced very low accuracy on quality tasks — results may be unusable despite good hardware performance.";
    warnings.push(
      "Model produced very low accuracy on quality tasks — results may be unusable despite good hardware performance."
    );
  }

  if (
    perf.tpsStdDev !== undefined &&
    Number.isFinite(perf.tpsStdDev) &&
    safeTokensPerSecond > 0 &&
    perf.tpsStdDev / safeTokensPerSecond > 0.3
  ) {
    warnings.push(
      `Token speed is unstable (stddev ${perf.tpsStdDev.toFixed(1)} tok/s, mean ${safeTokensPerSecond.toFixed(1)} tok/s) — may indicate thermal throttling or memory pressure.`
    );
  }

  if (hostCritical && !modelDeltaSignificant) {
    warnings.push(
      `Host memory is already high (${hostMemoryPercent.toFixed(0)}%) but model delta is limited (+${modelMemoryDeltaPercent.toFixed(0)}%). Verdict may be influenced by other running workloads.`
    );
  }

  if (hardware?.powerMode === "low-power") {
    warnings.push(
      "System was in low-power mode during this benchmark."
    );
  }

  if (
    hardware?.cpuCurrentSpeedGHz != null &&
    hardware?.cpuFreqGHz != null &&
    hardware.cpuFreqGHz > 0 &&
    hardware.cpuCurrentSpeedGHz / hardware.cpuFreqGHz < 0.8
  ) {
    const ratio = ((hardware.cpuCurrentSpeedGHz / hardware.cpuFreqGHz) * 100).toFixed(0);
    warnings.push(
      `CPU appears throttled (${hardware.cpuCurrentSpeedGHz.toFixed(1)} GHz current vs ${hardware.cpuFreqGHz.toFixed(1)} GHz nominal, ${ratio}%).`
    );
  }

  return {
    verdict,
    globalScore,
    hardwareFitScore,
    performanceScore,
    qualityScore,
    categoryLabels,
    disqualifiers,
    warnings,
    interpretation,
    tuning,
  };
}
