// Load test one server. Requests are generated deterministically at runtime (bench/requests.ts).
//   bun bench/index.ts http://192.168.31.144:3000 drizzle           # full: 300 → 4800 VUs, +300 every 20s, 5m40s
//   bun bench/index.ts http://192.168.31.144:3000 drizzle --quick   # 500 → 3000 VUs in 60s
//   bun bench/index.ts http://192.168.31.144:3000 drizzle --requests 1000000   # the full ramp, stop at 1M requests
//   bun bench/index.ts http://192.168.31.144:3000 drizzle --ramp 8000  # find the peak: 0 → 3000 VUs in 60s
//                       (+250 every 5s), then +200 every 10s up to 8000; ends early once saturated
//                       (two steps gaining < --min-gain % rps, default 2, or 5s average latency > --stop-ms, default 200)
//   add --no-warmup to skip the 10s unrecorded warm-up before the measured run
//   add --procs to also record where the server machine's CPU goes, once a second (see procsMonitor below)
import { isWorker, type Monitor, run, steps } from '../bunload/src';
import { requests } from './requests';

const host = process.argv[2] ?? process.env.HOST ?? 'http://localhost:3000';
const name = process.argv[3] ?? process.env.NAME ?? 'my-bench';
const quick = process.argv.includes('--quick');
const requestsArg = process.argv.indexOf('--requests');
const iterations = requestsArg > 0 ? Number(process.argv[requestsArg + 1]) : undefined;
if (iterations !== undefined && !(iterations > 0)) throw new Error('--requests needs a positive number');
const warmup = !process.argv.includes('--no-warmup');
const rampArg = process.argv.indexOf('--ramp');
const rampTo = rampArg > 0 ? Number(process.argv[rampArg + 1]) : undefined;
if (rampTo !== undefined && !(rampTo > 3000)) throw new Error('--ramp needs a VU count above 3000');
const procs = process.argv.includes('--procs');
const stopArg = process.argv.indexOf('--stop-ms');
const stopMs = stopArg > 0 ? Number(process.argv[stopArg + 1]) : 200;
if (!(stopMs > 0)) throw new Error('--stop-ms needs a positive number of ms');
const gainArg = process.argv.indexOf('--min-gain');
const minGain = gainArg > 0 ? Number(process.argv[gainArg + 1]) : 2; // %: a step gaining less counts as flat
if (!(minGain >= 0)) throw new Error('--min-gain needs a percentage');

// --ramp ends the run once the server is saturated, so every config stops just past its own peak:
// - rps: two VU steps in a row gained less than 2% over the best step so far (past the peak rps stays
//   flat and added VUs only queue). A step's rps is the mean of its seconds at a steady VU count,
//   minus the first (the step change); steps shorter than 3 such seconds are skipped.
// - safety: the last 5s averaged more than --stop-ms (default 200) latency, or 1% of them failed.
// Requests are counted per second as they complete.
type Sec = { vus: number; requests: number; failed: number; latencySumMs: number };
const window: Sec[] = [];
let step: Sec[] = [];
let best = 0;
let flat = 0;
const stepRps = (secs: Sec[]) => (secs.length < 3 ? 0 : secs.slice(1).reduce((a, x) => a + x.requests, 0) / (secs.length - 1));
const saturated = (s: Sec) => {
  const end = (why: string) => (console.log(`saturated at ${s.vus} VUs: ${why}; ending the run`), true);
  window.push(s);
  if (window.length > 5) window.shift();
  if (window.length === 5) {
    const req = window.reduce((a, w) => a + w.requests, 0);
    const failed = window.reduce((a, w) => a + w.failed, 0);
    const avg = req > failed ? window.reduce((a, w) => a + w.latencySumMs, 0) / (req - failed) : Infinity;
    if (failed > req / 100) return end(`${failed} of ${req} requests failed in the last 5s`);
    if (avg > stopMs) return end(`last 5s averaged ${avg.toFixed(1)} ms`);
  }
  if (step.length && s.vus !== step[0].vus) {
    // a step just ended
    const rps = stepRps(step);
    if (rps > 0) {
      if (best > 0 && rps < best * (1 + minGain / 100)) flat++;
      else flat = 0;
      best = Math.max(best, rps);
      if (flat >= 2) return end(`two steps without a ${minGain}% gain (best ${best.toFixed(0)} rps, last ${rps.toFixed(0)})`);
    }
    step = [];
  }
  step.push(s);
  return false;
};

// CPU of the server machine per process group, from two samples of its GET /stats/procs (raw /proc
// counters, src/cpu-usage.ts and go/procstats.go) a second apart. Stored as metric rows proc.server,
// proc.postgres, proc.docker-proxy, proc.other, proc.irq (hard + soft interrupts) and proc.idle, each
// in % of one core (400 = all of a 4-core machine), covering the second before the row's ts; and
// temp.cpu, the CPU package temperature in °C at the sample.
// Read them with scripts/cpu-split.ts.
const group = (comm: string) =>
  /^(bun|node|MainThread|bench-go)/.test(comm) ? 'server' // the server under test
  : comm.startsWith('postgres') ? 'postgres'
  : comm.startsWith('docker-proxy') ? 'docker-proxy'
  : 'other';
type ProcStats = { up: number; irq: number; idle: number; temp?: number | null; procs: [number, string, number][] };
let last: (Omit<ProcStats, 'procs'> & { procs: Map<number, [string, number]> }) | undefined;
const procsMonitor: Monitor = {
  every: '1s',
  async sample({ host, signal }) {
    const s = (await fetch(`${host}/stats/procs`, { signal }).then((r) => r.json())) as ProcStats;
    if (!s.procs) return {}; // not Linux
    const prev = last;
    last = { ...s, procs: new Map(s.procs.map(([pid, comm, ticks]) => [pid, [comm, ticks]])) };
    const dt = prev ? s.up - prev.up : 0;
    if (!prev || dt <= 0) return {};
    // a process counts from its second sample on (same pid and name in both)
    const g: Record<string, number> = { server: 0, postgres: 0, 'docker-proxy': 0, other: 0 };
    for (const [pid, comm, ticks] of s.procs) {
      const p = prev.procs.get(pid);
      if (p && p[0] === comm) g[group(comm)] += Math.max(0, ticks - p[1]);
    }
    // ticks are 1/100 s, so ticks per second = % of one core
    const pct = (ticks: number) => Math.round((10 * ticks) / dt) / 10;
    return {
      ...Object.fromEntries(Object.entries(g).map(([k, v]) => [`proc.${k}`, pct(v)])),
      'proc.irq': pct(s.irq - prev.irq),
      'proc.idle': pct(s.idle - prev.idle),
      ...(s.temp != null ? { 'temp.cpu': s.temp } : {}),
    };
  },
};

// Warm-up, not recorded: a fresh server opens its Postgres connections, prepares its statements on
// each of them and JIT-compiles its hot paths during the first seconds of load, which shows up as a
// latency bump at the start of every run. 10s of the same request mix at up to 200 VUs first, so
// the measured run starts on a warm server (and replays the same request sequence from iteration 0).
// --no-warmup skips it.
if (warmup) {
  if (!isWorker) console.log('warming up for 10s (not recorded)…');
  await run({
    host,
    name: `${name}-warmup`,
    workers: 2,
    stages: [
      { duration: '3s', target: 200 },
      { duration: '7s', target: 200 },
    ],
    timeout: '30s',
    path: requests({ seed: 1, size: 'micro', search: false }),
    sleepMs: (iter) => 75 * (iter % 6),
    output: false,
    monitor: false,
    log: false,
  });
}

const result = await run({
  host,
  name,
  folder: 'results',
  // past 3000 VUs the request rate outgrows 2 load-generator threads
  workers: rampTo || !quick ? 4 : 2,
  stages: rampTo
    ? [
        ...steps({ from: 250, to: 3000, step: 250, ramp: '1s', hold: '4s' }),
        ...steps({ from: 3200, to: rampTo, step: 200, ramp: '2s', hold: '8s' }),
      ]
    : quick
    ? steps({ from: 500, to: 3000, step: 500, ramp: '5s', hold: '5s' })
    : // full: +300 VUs every 20s (1s ramp, 19s hold) up to 4800, the last step held 39s: 5m40s in all.
      // With --requests the last hold is open-ended, so the request count ends the run.
      steps({ from: 300, to: 4800, step: 300, ramp: '1s', hold: '19s', lastHold: iterations ? '2h' : '39s' }),
  iterations,
  onSecond: rampTo ? saturated : undefined,
  timeout: '30s',
  path: requests({ seed: 1, size: 'micro', search: false }),
  sleepMs: (iter) => 75 * (iter % 6),
  output: { flushRows: 1_000_000, flushEvery: '30s' }, // or `false` to keep it all in memory
  // sampled on the main thread during the run, stored in results/<name>.parquet as metric rows
  monitor: [
    {
      every: '200ms',
      async sample({ host, signal }) {
        // per-core CPU % from the server under test; `cpu` feeds the viewer's CPU chart
        const cpu = (await fetch(`${host}/stats`, { signal }).then((r) => r.json())) as number[];
        return { cpu };
      },
    },
    ...(procs ? [procsMonitor] : []),
  ],
});

// Only reached on the main thread (in workers run() never resolves).
console.log(`${result.name}: ${result.rps.toFixed(0)} rps, p99 ${result.latency.p99.toFixed(2)}ms`);
