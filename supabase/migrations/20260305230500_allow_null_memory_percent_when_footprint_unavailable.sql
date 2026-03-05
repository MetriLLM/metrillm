alter table public.benchmarks
  alter column memory_percent drop not null;

update public.benchmarks
set memory_percent = null
where coalesce((result->'performance'->>'memoryFootprintAvailable')::boolean, true) = false;
