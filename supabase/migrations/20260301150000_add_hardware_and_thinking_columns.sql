-- Add columns for machine model, power mode, and thinking model detection.
-- These fields are already present in the JSONB `result` column; explicit
-- columns enable efficient leaderboard filtering and grouping.

alter table public.benchmarks
  add column machine_model text,
  add column power_mode text,
  add column thinking_detected boolean,
  add column thinking_tokens_estimate integer;

-- Indexes for leaderboard filtering
create index idx_benchmarks_machine_model on public.benchmarks (machine_model);
create index idx_benchmarks_power_mode on public.benchmarks (power_mode);
create index idx_benchmarks_thinking_detected on public.benchmarks (thinking_detected);

-- Backfill from the JSONB result column for existing rows
update public.benchmarks
set
  machine_model = result->'hardware'->>'machineModel',
  power_mode = result->'hardware'->>'powerMode',
  thinking_detected = (result->'modelInfo'->>'thinkingDetected')::boolean,
  thinking_tokens_estimate = (result->'performance'->>'thinkingTokensEstimate')::integer
where machine_model is null
  and result->'hardware' is not null;
