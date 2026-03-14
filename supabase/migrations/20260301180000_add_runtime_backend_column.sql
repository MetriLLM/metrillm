alter table public.benchmarks
  add column runtime_backend text not null default 'ollama',
  add column model_format text not null default 'gguf';

create index idx_benchmarks_runtime_backend on public.benchmarks (runtime_backend);
create index idx_benchmarks_model_format on public.benchmarks (model_format);
