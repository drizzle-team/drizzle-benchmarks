// Load test one server. Requests are generated deterministically at runtime (bench/requests.ts).
//   bun bench/index.ts http://192.168.31.144:3000 drizzle           # full: 0 → 3000 VUs, ~5m40s
//   bun bench/index.ts http://192.168.31.144:3000 drizzle --quick   # 500 → 3000 VUs in 60s
import { run, steps } from '../bunload/src';
import { requests } from './requests';

const host = process.argv[2] ?? process.env.HOST ?? 'http://localhost:3000';
const name = process.argv[3] ?? process.env.NAME ?? 'my-bench';
const quick = process.argv.includes('--quick');

const result = await run({
  host,
  name,
  folder: 'results',
  workers: 2,
  stages: quick
    ? steps({ from: 500, to: 3000, step: 500, ramp: '5s', hold: '5s' })
    : steps({ from: 200, to: 3000, step: 200, ramp: '5s', hold: '15s', lastHold: '55s' }),
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
  ],
});

// Only reached on the main thread (in workers run() never resolves).
console.log(`${result.name}: ${result.rps.toFixed(0)} rps, p99 ${result.latency.p99.toFixed(2)}ms`);
