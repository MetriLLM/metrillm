#!/usr/bin/env tsx
import { createClient } from "@supabase/supabase-js";

const url = process.env.METRILLM_SUPABASE_URL;
const key = process.env.METRILLM_SUPABASE_SERVICE_KEY ?? process.env.METRILLM_SUPABASE_ANON_KEY;
if (!url || !key) { console.error("Missing env"); process.exit(1); }

const supabase = createClient(url, key);
const { data, error } = await supabase
  .from("benchmarks")
  .select("id, model, runtime_backend, model_format, tokens_per_second, ttft_ms, global_score, verdict, created_at")
  .eq("runtime_backend", "lm-studio")
  .order("created_at", { ascending: true });

if (error) { console.error(error); process.exit(1); }
for (const r of data ?? []) {
  console.log(`${r.id} | ${r.model} | ${r.model_format} | ${r.tokens_per_second} tok/s | ${r.ttft_ms}ms | global=${r.global_score} | ${r.verdict}`);
}
console.log(`\nTotal: ${(data ?? []).length}`);
