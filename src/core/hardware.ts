import si from "systeminformation";
import type { HardwareInfo } from "../types.js";
import os from "node:os";

export async function getHardwareInfo(): Promise<HardwareInfo> {
  const [cpu, mem, graphics, osInfo, memLayout] = await Promise.all([
    si.cpu(),
    si.mem(),
    si.graphics(),
    si.osInfo(),
    si.memLayout(),
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
