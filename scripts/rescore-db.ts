#!/usr/bin/env tsx
/**
 * Rescore all benchmark rows in Supabase after a scoring weight change.
 *
 * Reads each row's `result` JSON, recalculates performanceScore / hardwareFitScore /
 * globalScore / verdict using the current scoring logic, and updates the row.
 *
 * Usage:
 *   METRILLM_SUPABASE_URL=... METRILLM_SUPABASE_ANON_KEY=... \
 *   METRILLM_SUPABASE_SERVICE_KEY=... npx tsx scripts/rescore-db.ts [--dry-run]
 *
 * Requires the service role key for UPDATE access (anon key is insert-only via RLS).
 */

import { createClient } from "@supabase/supabase-js";
import { computeFitness } from "../src/scoring/fitness.js";
import type { BenchResult } from "../src/types.js";

const SUPABASE_URL = process.env.METRILLM_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.METRILLM_SUPABASE_SERVICE_KEY ?? process.env.METRILLM_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing env: METRILLM_SUPABASE_URL and METRILLM_SUPABASE_SERVICE_KEY are required."
  );
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const PAGE_SIZE = 500;

async function main() {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);

  let offset = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: rows, error } = await supabase
      .from("benchmarks")
      .select("id, result, hardware_fit_score, global_score, verdict")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("Fetch error:", error.message);
      process.exit(1);
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const bench = row.result as BenchResult | null;
      if (!bench?.performance) {
        totalSkipped++;
        continue;
      }

      const newFitness = computeFitness(
        bench.performance,
        bench.quality ?? null,
        bench.hardware
      );

      const newHwScore = newFitness.hardwareFitScore;
      const newGlobalScore = newFitness.globalScore;
      const newVerdict = newFitness.verdict;

      const changed =
        newHwScore !== row.hardware_fit_score ||
        newGlobalScore !== row.global_score ||
        newVerdict !== row.verdict;

      if (!changed) {
        totalSkipped++;
        continue;
      }

      if (dryRun) {
        console.log(
          `[DRY-RUN] ${row.id}: hw ${row.hardware_fit_score}→${newHwScore}, ` +
            `global ${row.global_score}→${newGlobalScore}, verdict ${row.verdict}→${newVerdict}`
        );
        totalUpdated++;
        continue;
      }

      // Update the denormalized columns AND the nested result JSON
      const updatedResult: BenchResult = {
        ...bench,
        fitness: newFitness,
      };

      const { error: updateError } = await supabase
        .from("benchmarks")
        .update({
          hardware_fit_score: newHwScore,
          global_score: newGlobalScore,
          verdict: newVerdict,
          result: updatedResult,
        })
        .eq("id", row.id);

      if (updateError) {
        console.error(`Error updating ${row.id}: ${updateError.message}`);
        totalErrors++;
      } else {
        console.log(
          `Updated ${row.id}: hw ${row.hardware_fit_score}→${newHwScore}, ` +
            `global ${row.global_score}→${newGlobalScore}, verdict ${row.verdict}→${newVerdict}`
        );
        totalUpdated++;
      }
    }

    offset += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }

  console.log(
    `\nDone${dryRun ? " (dry-run)" : ""}. Updated: ${totalUpdated}, Skipped: ${totalSkipped}, Errors: ${totalErrors}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
