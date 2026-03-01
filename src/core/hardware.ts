import si from "systeminformation";
import type { HardwareInfo } from "../types.js";
import os from "node:os";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

type PowerMode = "low-power" | "balanced" | "performance" | "unknown";

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

  const gpuCoresRaw = gpuController?.cores;
  const gpuCores = gpuCoresRaw ? parseInt(String(gpuCoresRaw), 10) : null;

  const memType = memLayout.length > 0 ? memLayout[0].type : null;

  return {
    cpu: `${cpu.manufacturer} ${cpu.brand}`,
    cpuCores: cpu.cores,
    cpuPCores: cpu.performanceCores || null,
    cpuECores: cpu.efficiencyCores || null,
    cpuFreqGHz: cpu.speed || null,
    totalMemoryGB: +(mem.total / 1024 / 1024 / 1024).toFixed(1),
    freeMemoryGB: +(mem.available / 1024 / 1024 / 1024).toFixed(1),
    memoryType: memType || null,
    swapTotalGB: +(mem.swaptotal / 1024 / 1024 / 1024).toFixed(1),
    swapUsedGB: +(mem.swapused / 1024 / 1024 / 1024).toFixed(1),
    gpu: gpuNames || "Integrated / Apple Silicon",
    gpuCores: gpuCores && !isNaN(gpuCores) ? gpuCores : null,
    gpuVramMB: gpuController?.vram ?? null,
    os: `${osInfo.distro} ${osInfo.release}`,
    arch: os.arch(),
    machineModel: machineModel || null,
    powerMode,
    cpuCurrentSpeedGHz: cpuSpeed?.avg ?? null,
  };
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
