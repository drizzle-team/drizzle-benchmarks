import { Hono } from 'hono';
import { readdirSync, readFileSync } from 'node:fs';
import os from 'os';

interface CpuUsage {
  usage: number;
  total: number;
}

let temp: CpuUsage[] = [];

// per-core CPU % since the previous call (empty on the first call)
export function cpuStats(): number[] {
  const cpuUsage = os.cpus().map((cpu) => {
    const { user, nice, sys, irq, idle } = cpu.times;
    const total = user + nice + sys + irq + idle;
    const usage = user + nice + sys + irq;
    return { usage, total };
  });

  let result: number[] = [];
  if (temp.length > 0) {
    result = cpuUsage.map((cpu, index) => {
      const usageDiff = cpu.usage - temp[index].usage;
      const totalDiff = cpu.total - temp[index].total;
      return parseInt(((100 * usageDiff) / totalDiff).toFixed());
    });
  }
  temp = cpuUsage;
  return result;
}

// Raw CPU counters of the whole machine, for `bench/index.ts --procs`, which samples this once a second
// and turns two samples into % per process group (the server, Postgres, docker-proxy, ...): every
// process as [pid, comm, utime + stime], and the kernel's irq / softirq / idle from /proc/stat. All in
// USER_HZ ticks (1/100 s); `up` is /proc/uptime, the server's clock for the interval between samples;
// `temp` is the CPU package temperature in °C (the x86_pkg_temp thermal zone, null without one).
// Stateless, so any worker can answer. Linux only ({} elsewhere). Costs ~1 ms per call on the server.
export function procStats() {
  if (process.platform !== 'linux') return {};
  const procs: [number, string, number][] = [];
  for (const pid of readdirSync('/proc')) {
    if (pid.charCodeAt(0) > 57) continue; // not a pid
    let s: string;
    try {
      s = readFileSync(`/proc/${pid}/stat`, 'latin1');
    } catch {
      continue; // exited
    }
    const close = s.lastIndexOf(')');
    const f = s.slice(close + 2).split(' '); // f[0] is field 3 (state); utime and stime are fields 14, 15
    procs.push([Number(pid), s.slice(s.indexOf('(') + 1, close), Number(f[11]) + Number(f[12])]);
  }
  // cpu  user nice system idle iowait irq softirq steal
  const t = readFileSync('/proc/stat', 'latin1').slice(0, 200).split('\n')[0].split(/ +/).slice(1).map(Number);
  const up = Number(readFileSync('/proc/uptime', 'latin1').split(' ')[0]);
  return { up, irq: t[5] + t[6], idle: t[3] + t[4], temp: cpuTemp(), procs };
}

let tempZone: string | null | undefined;
function cpuTemp(): number | null {
  if (tempZone === undefined) {
    tempZone = null;
    try {
      for (const z of readdirSync('/sys/class/thermal')) {
        const dir = `/sys/class/thermal/${z}`;
        try {
          if (readFileSync(`${dir}/type`, 'latin1').trim() === 'x86_pkg_temp') tempZone = `${dir}/temp`;
        } catch {}
      }
    } catch {}
  }
  if (!tempZone) return null;
  try {
    return Number(readFileSync(tempZone, 'latin1')) / 1000;
  } catch {
    return null;
  }
}

const app = new Hono();
app.get('/stats', (c) => c.json(cpuStats()));
app.get('/stats/procs', (c) => c.json(procStats()));

export default app;
