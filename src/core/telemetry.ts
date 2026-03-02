import { createHash } from "node:crypto";
import { arch, cpus, platform, totalmem } from "node:os";
import { PostHog } from "posthog-node";
import { loadConfig, saveConfig } from "./store.js";

const POSTHOG_API_KEY = "phc_qapPj4PqTJCY4Og6OVCH1nfwsjWJ7fLpFeTyUakdJk3";
const POSTHOG_HOST = "https://eu.i.posthog.com";

let client: PostHog | null = null;
let consent: boolean | undefined;
let distinctId: string | null = null;

function getDistinctId(): string {
  if (distinctId) return distinctId;
  const cpu = cpus()[0]?.model ?? "unknown";
  const raw = `${cpu}|${platform()}|${arch()}`;
  distinctId = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return distinctId;
}

async function isEnabled(): Promise<boolean> {
  if (consent !== undefined) return consent;
  const config = await loadConfig();
  consent = config.telemetry !== false;
  return consent;
}

function getClient(): PostHog {
  if (!client) {
    client = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      flushAt: 5,
      flushInterval: 10_000,
    });
  }
  return client;
}

export async function saveTelemetryConsent(value: boolean): Promise<void> {
  const config = await loadConfig();
  config.telemetry = value;
  await saveConfig(config);
  consent = value;
}

export async function trackEvent(
  event: string,
  properties: Record<string, unknown> = {}
): Promise<void> {
  if (!(await isEnabled())) return;
  try {
    getClient().capture({
      distinctId: getDistinctId(),
      event,
      properties: {
        source: "metrillm-cli",
        ...properties,
      },
    });
  } catch {
    // Non-fatal: telemetry should never break the CLI
  }
}

export async function trackBenchStarted(props: {
  model: string;
  os: string;
  arch: string;
  cpuCores: number;
  ramGb: number;
}): Promise<void> {
  await trackEvent("bench_started", props);
}

export async function trackBenchCompleted(props: {
  model: string;
  verdict: string;
  globalScore: number | null;
  tps: number;
  durationMs: number;
}): Promise<void> {
  await trackEvent("bench_completed", props);
}

export async function trackBenchShared(props: {
  model: string;
  verdict: string;
}): Promise<void> {
  await trackEvent("bench_shared", props);
}

export async function trackBenchExported(props: {
  format: string;
}): Promise<void> {
  await trackEvent("bench_exported", props);
}

export async function flushTelemetry(): Promise<void> {
  if (!client) return;
  try {
    await client.shutdown();
  } catch {
    // Non-fatal
  }
  client = null;
}

export async function showTelemetryNotice(): Promise<void> {
  const config = await loadConfig();
  if (config.telemetry !== undefined) return;
  console.log(
    "Anonymous usage stats are enabled by default to help improve MetriLLM. Opt-out anytime: metrillm bench --no-telemetry"
  );
}
