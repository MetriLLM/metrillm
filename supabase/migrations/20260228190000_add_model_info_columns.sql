-- Add model info columns: parameter_size, quantization, family
-- These are uploaded by the CLI since the modelInfo feature was added
-- but were missing from the table schema.

alter table public.benchmarks
  add column parameter_size text,
  add column quantization text,
  add column family text;

-- Indexes for filtering by model family and parameter size
create index idx_benchmarks_family on public.benchmarks (family);
create index idx_benchmarks_parameter_size on public.benchmarks (parameter_size);

-- Backfill from the JSONB result column for any existing rows
update public.benchmarks
set
  parameter_size = result->'modelInfo'->>'parameterSize',
  quantization = result->'modelInfo'->>'quantization',
  family = result->'modelInfo'->>'family'
where parameter_size is null
  and result->'modelInfo' is not null;
