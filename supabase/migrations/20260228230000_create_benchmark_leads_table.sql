-- Optional lead capture for CLI share flow.
-- Stores private contact details separately from public benchmark rows.
create table if not exists public.benchmark_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  email text not null,
  email_hash text not null unique,
  nickname text,
  source text not null default 'cli',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_benchmark_leads_created_at on public.benchmark_leads (created_at desc);

alter table public.benchmark_leads enable row level security;

-- Public insert from CLI anon key.
create policy "Public lead insert access"
  on public.benchmark_leads for insert
  with check (true);

-- No public read/update/delete policy on this table.
