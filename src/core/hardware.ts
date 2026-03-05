import si from "systeminformation";
import type { HardwareInfo } from "../types.js";
import os from "node:os";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

type PowerMode = "low-power" | "balanced" | "performance" | "unknown";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeGpuDescriptor(value: string): boolean {
  return /\b(radeon|graphics|geforce|rtx|gtx|arc|iris|uhd|quadro|tesla|adreno|mali|powervr)\b/i.test(value);
}

function splitCpuAndInferredGpu(cpuLabel: string): { cpu: string; inferredGpu: string | null } {
  const normalized = normalizeWhitespace(cpuLabel);
  const withGpuMatch = normalized.match(/\s+(?:w\/\s*|with\s+)(.+)$/i);
  if (!withGpuMatch?.index) {
    return { cpu: normalized, inferredGpu: null };
  }

  const inferredGpu = normalizeWhitespace(withGpuMatch[1] ?? "");
  if (!looksLikeGpuDescriptor(inferredGpu)) {
    return { cpu: normalized, inferredGpu: null };
  }
  const cpu = normalizeWhitespace(normalized.slice(0, withGpuMatch.index));
  return {
    cpu: cpu || normalized,
    inferredGpu: inferredGpu || null,
  };
}

function execCommand(cmd: string, args: string[], timeoutMs = 3000): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout: timeoutMs }, (err, stdout) => {
      if (err) return resolve("");
      resolve(stdout.trim());
    });
    child.on("error", () => resolve(""));
  });
}

async function detectPowerModeMacOS(): Promise<PowerMode> {
  const output = await execCommand("pmset", ["-g"]);
  if (!output) return "unknown";
  const match = output.match(/lowpowermode\s+(\d)/i);
  if (match) return match[1] === "1" ? "low-power" : "balanced";
  return "balanced";
}

async function detectPowerModeLinux(): Promise<PowerMode> {
  try {
    const governor = await readFile(
      "/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor",
      "utf-8"
    );
    const g = governor.trim().toLowerCase();
    if (g === "powersave") return "low-power";
    if (g === "performance") return "performance";
    return "balanced";
  } catch {
    return "unknown";
  }
}

async function detectPowerModeWindows(): Promise<PowerMode> {
  const output = await execCommand("powercfg", ["/getactivescheme"]);
  if (!output) return "unknown";
  const match = output.match(/\(([^)]+)\)/);
  if (!match) return "unknown";
  const name = match[1].toLowerCase();
  if (name.includes("power saver") || name.includes("économie")) return "low-power";
  if (name.includes("high performance") || name.includes("performances")) return "performance";
  return "balanced";
}

async function detectMachineModel(): Promise<string | null> {
  try {
    if (process.platform === "darwin") {
      // system_profiler gives the marketing name (e.g. "MacBook Air", "Mac mini")
      const output = await execCommand("system_profiler", ["SPHardwareDataType"]);
      const match = output.match(/Model Name:\s*(.+)/i);
      if (match) return match[1].trim();
      return null;
    }
    // Linux / Windows: si.system() often returns useful model info
    // (e.g. "ThinkPad X1 Carbon", "Dell XPS 15", "ASUS ROG Strix")
    const sys = await si.system();
    const parts = [sys.manufacturer, sys.model].filter(
      (p) => p && p !== "Unknown" && p !== "To Be Filled By O.E.M." && p !== "System Product Name"
    );
    return parts.length > 0 ? parts.join(" ") : null;
  } catch {
    return null;
  }
}

async function detectPowerMode(): Promise<PowerMode> {
  try {
    switch (process.platform) {
      case "darwin":
        return await detectPowerModeMacOS();
      case "linux":
        return await detectPowerModeLinux();
      case "win32":
        return await detectPowerModeWindows();
      default:
        return "unknown";
    }
  } catch {
    return "unknown";
  }
}

export type ThermalPressure = "nominal" | "moderate" | "heavy" | "critical" | "unknown";

export async function detectThermalPressure(): Promise<ThermalPressure> {
  try {
    if (process.platform === "darwin") {
      const output = await execCommand("pmset", ["-g", "therm"]);
      if (!output) return "unknown";
      const match = output.match(/CPU_Speed_Limit\s*=\s*(\d+)/i);
      if (!match) return "unknown";
      const limit = parseInt(match[1], 10);
      if (limit >= 100) return "nominal";
      if (limit >= 80) return "moderate";
      if (limit >= 50) return "heavy";
      return "critical";
    }
    // Other OS: use CPU temperature as proxy
    const temp = await si.cpuTemperature();
    const main = temp.main;
    if (main == null || main <= 0) return "unknown";
    if (main < 80) return "nominal";
    if (main < 90) return "moderate";
    if (main < 100) return "heavy";
    return "critical";
  } catch {
    return "unknown";
  }
}

export async function detectBatteryPowered(): Promise<boolean | undefined> {
  try {
    if (process.platform === "darwin") {
      const output = await execCommand("pmset", ["-g", "ps"]);
      if (!output) return undefined;
      if (output.includes("Battery Power")) return true;
      if (output.includes("AC Power")) return false;
      return undefined;
    }
    const battery = await si.battery();
    if (!battery.hasBattery) return undefined;
    if (typeof battery.acConnected === "boolean") return !battery.acConnected;
    if (typeof battery.isCharging === "boolean") return !battery.isCharging;
    return undefined;
  } catch {
    return undefined;
  }
}

export async function getSwapUsedGB(): Promise<number> {
  try {
    const mem = await si.mem();
    return +(mem.swapused / 1024 / 1024 / 1024).toFixed(2);
  } catch {
    return 0;
  }
}

export async function getHardwareInfo(): Promise<HardwareInfo> {
  const [cpu, mem, graphics, osInfo, memLayout, powerMode, cpuSpeed, machineModel] = await Promise.all([
    si.cpu(),
    si.mem(),
    si.graphics(),
    si.osInfo(),
    si.memLayout(),
    detectPowerMode(),
    si.cpuCurrentSpeed().catch(() => null),
    detectMachineModel(),
  ]);

  const gpuController = graphics.controllers[0];
  const gpuNames = graphics.controllers
    .map((g) => g.model)
    .filter(Boolean)
    .join(", ");
  const cpuLabelRaw = normalizeWhitespace(`${cpu.manufacturer} ${cpu.brand}`);
  const { cpu: cpuLabel, inferredGpu } = splitCpuAndInferredGpu(cpuLabelRaw);
  const defaultIntegratedGpu =
    process.platform === "darwin" ? "Integrated / Apple Silicon" : "Integrated / Unknown";

  const gpuCoresRaw = gpuController?.cores;
  const gpuCores = gpuCoresRaw ? parseInt(String(gpuCoresRaw), 10) : null;

  const memType = memLayout.length > 0 ? memLayout[0].type : null;

  return {
    cpu: cpuLabel,
    cpuCores: cpu.cores,
    cpuPCores: cpu.performanceCores || null,
    cpuECores: cpu.efficiencyCores || null,
    cpuFreqGHz: cpu.speed || null,
    totalMemoryGB: +(mem.total / 1024 / 1024 / 1024).toFixed(1),
    freeMemoryGB: +(mem.available / 1024 / 1024 / 1024).toFixed(1),
    memoryType: memType || null,
    swapTotalGB: +(mem.swaptotal / 1024 / 1024 / 1024).toFixed(1),
    swapUsedGB: +(mem.swapused / 1024 / 1024 / 1024).toFixed(1),
    gpu: normalizeWhitespace(gpuNames) || inferredGpu || defaultIntegratedGpu,
    gpuCores: gpuCores && !isNaN(gpuCores) ? gpuCores : null,
    gpuVramMB: gpuController?.vram ?? null,
    os: `${osInfo.distro} ${osInfo.release}`,
    arch: os.arch(),
    machineModel: machineModel || null,
    powerMode,
    cpuCurrentSpeedGHz: cpuSpeed?.avg ?? null,
  };
}

export async function getCpuLoad(): Promise<number> {
  try {
    const load = await si.currentLoad();
    return +load.currentLoad.toFixed(1);
  } catch {
    return -1;
  }
}

export async function getMemoryUsage(): Promise<{
  usedGB: number;
  totalGB: number;
  percent: number;
}> {
  const mem = await si.mem();
  const totalGB = mem.total / 1024 / 1024 / 1024;
  const usedGB = (mem.total - mem.available) / 1024 / 1024 / 1024;
  return {
    usedGB: +usedGB.toFixed(1),
    totalGB: +totalGB.toFixed(1),
    percent: +((usedGB / totalGB) * 100).toFixed(1),
  };
}
