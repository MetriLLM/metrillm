-- Restore integrated GPU label for historical Ryzen AI MAX+ 395 rows.
-- These rows were previously reported as "... w/ Radeon 8060S" and should not remain unknown.

UPDATE public.benchmarks
SET
  gpu = 'AMD Radeon 8060S',
  result = jsonb_set(result, '{hardware,gpu}', to_jsonb('AMD Radeon 8060S'::text), true)
WHERE cpu = 'AMD RYZEN AI MAX+ 395'
  AND os ILIKE 'Ubuntu%'
  AND gpu = 'Integrated / Unknown';
