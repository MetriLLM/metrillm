-- Fix previous backfill regex escaping and finalize CPU/GPU normalization.
-- Idempotent: safe to run multiple times.

-- 1) Normalize CPU labels by removing trailing inferred GPU descriptors.
WITH parsed AS (
  SELECT
    id,
    cpu AS cpu_original,
    trim(regexp_replace(cpu, '\s+(?:w/\s*|with\s+).+$', '', 'i')) AS cpu_clean,
    nullif(trim(substring(cpu from '\s+(?:w/\s*|with\s+)(.+)$')), '') AS inferred_gpu
  FROM public.benchmarks
),
valid_inferred AS (
  SELECT id, cpu_original, cpu_clean
  FROM parsed
  WHERE inferred_gpu IS NOT NULL
    AND inferred_gpu ~* '(radeon|graphics|geforce|rtx|gtx|arc|iris|uhd|quadro|tesla|adreno|mali|powervr)'
    AND cpu_clean <> cpu_original
)
UPDATE public.benchmarks b
SET
  cpu = v.cpu_clean,
  result = jsonb_set(b.result, '{hardware,cpu}', to_jsonb(v.cpu_clean), true)
FROM valid_inferred v
WHERE b.id = v.id;

-- 2) If non-macOS GPU fallback is unknown/apple-silicon and CPU contains a valid inferred GPU,
-- use that inferred GPU label.
WITH parsed AS (
  SELECT
    id,
    nullif(trim(substring(cpu from '\s+(?:w/\s*|with\s+)(.+)$')), '') AS inferred_gpu
  FROM public.benchmarks
),
fix_targets AS (
  SELECT
    b.id,
    p.inferred_gpu AS gpu_fixed
  FROM public.benchmarks b
  JOIN parsed p ON p.id = b.id
  WHERE b.os NOT ILIKE 'mac%'
    AND b.gpu IN ('Integrated / Apple Silicon', 'Integrated / Unknown')
    AND p.inferred_gpu IS NOT NULL
    AND p.inferred_gpu ~* '(radeon|graphics|geforce|rtx|gtx|arc|iris|uhd|quadro|tesla|adreno|mali|powervr)'
)
UPDATE public.benchmarks b
SET
  gpu = t.gpu_fixed,
  result = jsonb_set(b.result, '{hardware,gpu}', to_jsonb(t.gpu_fixed), true)
FROM fix_targets t
WHERE b.id = t.id;
