-- Reweight global score from 40/60 (HW/Quality) to 30/70.
--
-- This migration recalculates:
--   1. global_score column (used by leaderboard queries)
--   2. verdict column (derived from new global_score)
--   3. result JSONB → fitness.globalScore, fitness.verdict, fitness.interpretation
--
-- Only rows with quality_score NOT NULL are affected (perf-only rows have no global score).

BEGIN;

-- Step 1: Recalculate global_score column
UPDATE public.benchmarks
SET global_score = LEAST(GREATEST(ROUND(0.3 * hardware_fit_score + 0.7 * quality_score), 0), 100)
WHERE quality_score IS NOT NULL;

-- Step 2: Recalculate verdict column based on new global_score
-- Rows with disqualifiers keep NOT RECOMMENDED regardless of score.
-- We detect disqualifiers from the result JSONB.
UPDATE public.benchmarks
SET verdict = CASE
  WHEN jsonb_array_length(result->'fitness'->'disqualifiers') > 0 THEN 'NOT RECOMMENDED'
  WHEN global_score >= 80 THEN 'EXCELLENT'
  WHEN global_score >= 60 THEN 'GOOD'
  WHEN global_score >= 40 THEN 'MARGINAL'
  ELSE 'NOT RECOMMENDED'
END
WHERE quality_score IS NOT NULL;

-- Step 3: Update JSONB result field to match columns
UPDATE public.benchmarks
SET result = jsonb_set(
  jsonb_set(
    result,
    '{fitness,globalScore}',
    to_jsonb(global_score::integer)
  ),
  '{fitness,verdict}',
  to_jsonb(verdict::text)
)
WHERE quality_score IS NOT NULL;

COMMIT;
