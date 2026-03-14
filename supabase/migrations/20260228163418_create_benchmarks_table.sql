-- Benchmarks table: stores uploaded benchmark results
-- Indexed columns for leaderboard queries + full JSONB for complete data
create table public.benchmarks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Indexed columns for fast leaderboard/filter queries
  model text not null,
  tokens_per_second double precision not null,
  ttft_ms double precision not null,
  memory_percent double precision not null,
  verdict text not null,
  global_score integer,
  hardware_fit_score integer not null,
  quality_score integer,

  -- Hardware identifiers (for filtering/grouping)
  cpu text not null,
  cpu_cores integer not null,
  total_memory_gb double precision not null,
  gpu text,
  os text not null,
  arch text not null,

  -- Metadata
  benchmark_spec_version text not null,
  runtime_version text not null,
  raw_log_hash text not null unique,  -- prevents duplicate uploads

  -- Full result as JSONB (source of truth)
  result jsonb not null
);

-- Indexes for leaderboard queries
create index idx_benchmarks_model on public.benchmarks (model);
create index idx_benchmarks_tokens_per_second on public.benchmarks (tokens_per_second desc);
create index idx_benchmarks_global_score on public.benchmarks (global_score desc nulls last);
create index idx_benchmarks_cpu on public.benchmarks (cpu);
create index idx_benchmarks_total_memory_gb on public.benchmarks (total_memory_gb);
create index idx_benchmarks_created_at on public.benchmarks (created_at desc);

-- RLS: enable row level security
alter table public.benchmarks enable row level security;

-- Policy: anyone can read (public leaderboard)
create policy "Public read access"
  on public.benchmarks for select
  using (true);

-- Policy: anyone can insert (anonymous uploads from CLI)
create policy "Public insert access"
  on public.benchmarks for insert
  with check (true);

-- No update/delete for anonymous users (results are immutable once uploaded)
