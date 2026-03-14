-- 1. Function: get_rank — replaces 4 COUNT(*) queries with 1 single scan
create or replace function public.get_rank(p_global_score integer, p_cpu text)
returns json
language sql stable
as $$
  select json_build_object(
    'total_count', count(*),
    'better_count', count(*) filter (where global_score > p_global_score),
    'cpu_total', count(*) filter (where cpu = p_cpu),
    'cpu_better', count(*) filter (where cpu = p_cpu and global_score > p_global_score)
  )
  from public.benchmarks;
$$;

-- 2. Composite index for CPU + score filter queries
create index if not exists idx_benchmarks_cpu_global_score
  on public.benchmarks (cpu, global_score desc nulls last);

-- 3. Rate limiting trigger: max 500 inserts/hour globally
create or replace function public.rate_limit_insert()
returns trigger
language plpgsql
as $$
declare
  recent_count integer;
begin
  select count(*) into recent_count
  from public.benchmarks
  where created_at > now() - interval '1 hour';

  if recent_count > 500 then
    raise exception 'Rate limit exceeded: too many uploads. Please try again later.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_rate_limit_insert
  before insert on public.benchmarks
  for each row execute function public.rate_limit_insert();
