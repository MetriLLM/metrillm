import type { CategoryResult, QualityMetrics, QualityScore } from "../types.js";
import { clamp } from "../utils.js";

export const RESPONSE_TIME_LIMITS_MS: Record<string, number> = {
  reasoning: 30_000,
  math: 30_000,
  coding: 90_000,
  instructionFollowing: 30_000,
  structuredOutput: 30_000,
  multilingual: 30_000,
};

function safePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 100);
}

function weightedScore(raw: number, max: number): number {
  return clamp(Math.round((safePercent(raw) / 100) * max), 0, max);
}

export function effectiveScore(result: CategoryResult, limitMs: number): number {
  if (result.total === 0) return 0;
  // When details are unavailable (legacy data/tests), derive from correct/total.
  if (result.details.length === 0) {
    const boundedCorrect = clamp(result.correct, 0, result.total);
    return (boundedCorrect / result.total) * 100;
  }
  const effectiveCorrect = result.details.filter(
    (d) => d.correct && d.timeMs <= limitMs
  ).length;
  return (effectiveCorrect / result.total) * 100;
}

function countPenalties(result: CategoryResult, limitMs: number): number {
  return result.details.filter((d) => d.correct && d.timeMs > limitMs).length;
}

export function computeQualityScore(quality: QualityMetrics): QualityScore {
  const categories = [
    { key: "reasoning", result: quality.reasoning, weight: 20 },
    { key: "coding", result: quality.coding, weight: 20 },
    { key: "instructionFollowing", result: quality.instructionFollowing, weight: 20 },
    { key: "structuredOutput", result: quality.structuredOutput, weight: 15 },
    { key: "math", result: quality.math, weight: 15 },
    { key: "multilingual", result: quality.multilingual, weight: 10 },
  ] as const;

  const scores: Record<string, number> = {};
  const timePenalties: Record<string, number> = {};
  let hasPenalties = false;

  for (const cat of categories) {
    const limitMs = RESPONSE_TIME_LIMITS_MS[cat.key];
    const raw = effectiveScore(cat.result, limitMs);
    scores[cat.key] = weightedScore(raw, cat.weight);

    const penalties = countPenalties(cat.result, limitMs);
    if (penalties > 0) {
      timePenalties[cat.key] = penalties;
      hasPenalties = true;
    }
  }

  const total = clamp(
    scores.reasoning + scores.coding + scores.instructionFollowing +
    scores.structuredOutput + scores.math + scores.multilingual,
    0,
    100
  );

  return {
    total,
    reasoning: scores.reasoning,
    coding: scores.coding,
    instructionFollowing: scores.instructionFollowing,
    structuredOutput: scores.structuredOutput,
    math: scores.math,
    multilingual: scores.multilingual,
    ...(hasPenalties ? { timePenalties } : {}),
  };
}
