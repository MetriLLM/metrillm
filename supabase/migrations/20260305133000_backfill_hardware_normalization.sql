-- Backfill historical hardware fields with the same normalization rules now used by CLI ingestion.
-- Idempotent: safe to run multiple times.

-- 1) Split CPU labels that embed an inferred GPU suffix (e.g. "AMD ... w/ Radeon 780M").
WITH parsed AS (
  SELECT
    id,
    cpu AS cpu_original,
    trim(regexp_replace(cpu, '\\s+(?:w/\\s*|with\\s+).+$', '', 'i')) AS cpu_clean,
    nullif(trim(substring(cpu from '\\s+(?:w/\\s*|with\\s+)(.+)$')), '') AS inferred_gpu
  FROM public.benchmarks
),
valid_inferred AS (
  SELECT
    id,
    cpu_original,
    cpu_clean,
    inferred_gpu
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

-- 2) Fix non-macOS rows that were incorrectly tagged as Apple Silicon fallback GPU.
WITH parsed AS (
  SELECT
    id,
    nullif(trim(substring(cpu from '\\s+(?:w/\\s*|with\\s+)(.+)$')), '') AS inferred_gpu
  FROM public.benchmarks
),
fix_targets AS (
  SELECT
    b.id,
    CASE
      WHEN p.inferred_gpu IS NOT NULL
        AND p.inferred_gpu ~* '(radeon|graphics|geforce|rtx|gtx|arc|iris|uhd|quadro|tesla|adreno|mali|powervr)'
      THEN p.inferred_gpu
      ELSE 'Integrated / Unknown'
    END AS gpu_fixed
  FROM public.benchmarks b
  LEFT JOIN parsed p ON p.id = b.id
  WHERE b.gpu = 'Integrated / Apple Silicon'
    AND b.os NOT ILIKE 'mac%'
)
UPDATE public.benchmarks b
SET
  gpu = t.gpu_fixed,
  result = jsonb_set(b.result, '{hardware,gpu}', to_jsonb(t.gpu_fixed), true)
FROM fix_targets t
WHERE b.id = t.id;

-- 3) Backfill machine model when missing, and keep JSON + indexed column in sync.
WITH desired AS (
  SELECT
    id,
    coalesce(
      nullif(result->'hardware'->>'machineModel', ''),
      CASE
        WHEN cpu = 'Apple M4' THEN 'MacBook Air'
        WHEN cpu = 'Apple M4 Pro' THEN 'Mac Mini'
        ELSE NULL
      END
    ) AS machine_model_fixed
  FROM public.benchmarks
)
UPDATE public.benchmarks b
SET
  machine_model = coalesce(b.machine_model, d.machine_model_fixed),
  result = CASE
    WHEN d.machine_model_fixed IS NULL THEN b.result
    ELSE jsonb_set(b.result, '{hardware,machineModel}', to_jsonb(d.machine_model_fixed), true)
  END
FROM desired d
WHERE b.id = d.id
  AND d.machine_model_fixed IS NOT NULL
  AND (
    b.machine_model IS NULL
    OR coalesce(b.result->'hardware'->>'machineModel', '') = ''
  );
