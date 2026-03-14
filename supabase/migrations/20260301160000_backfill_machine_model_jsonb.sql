-- Backfill machineModel inside the JSONB result.hardware for existing rows.
-- Column machine_model was already backfilled via REST API.

UPDATE public.benchmarks
SET result = jsonb_set(result, '{hardware,machineModel}', '"MacBook Air"')
WHERE cpu = 'Apple M4'
  AND (result->'hardware'->>'machineModel') IS NULL;

UPDATE public.benchmarks
SET result = jsonb_set(result, '{hardware,machineModel}', '"Mac Mini"')
WHERE cpu = 'Apple M4 Pro'
  AND (result->'hardware'->>'machineModel') IS NULL;
