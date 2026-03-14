-- Allow UPDATE path for benchmark_leads upsert conflict resolution.
-- Needed because CLI uses upsert(onConflict: email_hash), which performs UPDATE
-- when a lead already exists.

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'benchmark_leads'
      and policyname = 'Public lead update access'
  ) then
    create policy "Public lead update access"
      on public.benchmark_leads
      for update
      using (true)
      with check (true);
  end if;
end
$$;
