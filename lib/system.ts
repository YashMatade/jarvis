// Lightweight system health reporter used by the proactive monitor.
// Runs only in Node (execs `df` / `pmset` on macOS). Results are cached to
// avoid hammering subprocesses on every scheduler tick.

import os from "os";
import { exec as execCb } from "child_process";
import { promisify } from "util";

const exec = promisify(execCb);

export interface SystemHealth {
  cpuPct: number;
  ramUsedPct: number;
  diskUsedPct: number;
  batteryPct?: number;
  batteryCharging?: boolean;
  load: number;
  checkedAt: number;
}

let cached: SystemHealth | null = null;

interface DiskUsage {
  usedPct: number;
}

async function readDiskUsage(): Promise<DiskUsage> {
  const platform = os.platform();
  try {
    if (platform === "darwin" || platform === "linux") {
      const { stdout } = await exec("df -k -P / | tail -n 1");
      const parts = stdout.trim().split(/\s+/);
      const capacity = parts[4]; // e.g. "42%"
      const pct = parseInt(capacity, 10);
      if (Number.isFinite(pct)) return { usedPct: pct };
    }
  } catch {
    // Fall through.
  }
  return { usedPct: 0 };
}

async function readBattery(): Promise<
  { pct: number; charging: boolean } | undefined
> {
  if (os.platform() !== "darwin") return undefined;
  try {
    const { stdout } = await exec("pmset -g batt");
    const line =
      stdout.split("\n").find((l) => l.includes("%")) || "";
    const match = line.match(/(\d+)%/);
    if (!match) return undefined;
    const charging = /discharging/i.test(line) ? false : true;
    return { pct: parseInt(match[1], 10), charging };
  } catch {
    return undefined;
  }
}

interface CpuSample {
  idle: number;
  total: number;
}

function sampleCpu(): CpuSample {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
    idle += t.idle;
  }
  return { idle, total };
}

async function measureCpuPct(): Promise<number> {
  const first = sampleCpu();
  // Tiny delay lets the counters advance so the delta reflects live usage.
  await new Promise((r) => setTimeout(r, 120));
  const second = sampleCpu();
  const idleDelta = second.idle - first.idle;
  const totalDelta = second.total - first.total;
  if (totalDelta <= 0) return 0;
  return Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
}

export async function getSystemHealth(force = false): Promise<SystemHealth> {
  const now = Date.now();
  if (!force && cached && now - cached.checkedAt < 60_000) {
    return cached;
  }

  const [disk, battery, cpuPct] = await Promise.all([
    readDiskUsage(),
    readBattery(),
    measureCpuPct(),
  ]);

  const mem = 1 - os.freemem() / os.totalmem();
  const health: SystemHealth = {
    cpuPct,
    ramUsedPct: Math.round(mem * 100),
    diskUsedPct: disk.usedPct,
    load: os.loadavg()[0] ?? 0,
    checkedAt: now,
  };
  if (battery) {
    health.batteryPct = battery.pct;
    health.batteryCharging = battery.charging;
  }

  cached = health;
  return health;
}
