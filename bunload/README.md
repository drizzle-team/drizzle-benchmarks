# bunload

The load generator behind `bench/`, used as a library: you write a `.ts` file with the benchmark config and `bun run` it. It uses ramping-VU stages like k6's `ramping-vus`, a raw keep-alive HTTP/1.1 client (one socket per VU), worker threads, and an in-memory DuckDB sink that batch-writes zstd parquet.

```ts
// bench/index.ts   →   bun bench/index.ts http://192.168.31.144:3000 drizzle
import { mix, run, steps } from '../bunload/src';

const result = await run({
  host: process.argv[2]!,
  name: process.argv[3] ?? 'bench',
  stages: steps({ from: 200, to: 3000, step: 200, ramp: '5s', hold: '15s', lastHold: '55s' }),
  // deterministic request mix: a pure function of (seed, iter), no data file
  path: mix([
    { weight: 100, path: (r) => `/order-with-details?id=${r.int(1, 50_000)}` },
    { weight: 20, path: (r) => `/customer-by-id?id=${r.int(1, 10_000)}` },
    { weight: 2, path: (r) => `/customers?limit=50&offset=${r.int(0, 199) * 50}` },
  ], { seed: 1 }),
  sleepMs: (iter) => 75 * (iter % 6),
  workers: 2,
  output: { flushRows: 1_000_000, flushEvery: '30s' }, // false = in memory only
  monitor: {
    every: '200ms',
    async sample({ host, signal }) {
      const cpu = (await fetch(`${host}/stats`, { signal }).then((r) => r.json())) as number[];
      return { cpu }; // per-core CPU %; `cpu` feeds the viewer's CPU chart
    },
  },
});
// code after run() only runs on the main thread
console.log(result.rps, result.latency.p99, result.file);
```

`prepare({ folder, out? })` turns every run in a folder into per-second aggregates, in the docs site's `data.json` shape plus `vus` and `metrics`. The viewer uses it; its `/api/runs` endpoint serves the result.

The repo's full request mix lives in `bench/requests.ts`: `path: requests({ seed: 1, size: 'micro', search: false })`.

## Deterministic requests: `mix(routes, { seed })`

`mix()` returns a `path(iter)` function. For each iteration it positions a seeded hash-based random stream at `iter`, then picks a route by weight, and that route builds the path from the same stream (`r.int(min, max)`, `r.pick(arr)`, `r.next()`). Because it is a pure function of `(seed, iter)`:
- every worker, every run and every target gets the identical request sequence
- there is no state and no memory, and it costs ~50 ns per call
- out-of-order access is fine, which matters because workers interleave iterations

`Rng` is exported too, for use in `sleepMs` or custom generators (`new Rng(seed).at(iter).int(…)`).

## `run(config)` options

| option | default | |
|---|---|---|
| `host` | — | target base URL (http or https) |
| `stages` | — | `{ duration, target }[]`, ramped linearly like k6. `steps()` builds a step ladder |
| `path(iter)` | — | path + query; `iter` is one counter shared by all workers (k6 `iterationInTest`) |
| `sleepMs(iter)` | 0 | think time after each iteration |
| `init()` | — | runs once per worker before the test |
| `workers` | 2 | worker threads; VUs are split evenly across them |
| `timeout` | `30s` | per-request timeout |
| `gracefulStop` | = timeout | how long in-flight iterations may finish after the last stage |
| `name` / `folder` | `bench` / `results` | output is `<folder>/<name>.parquet` |
| `output` | `{ flushRows: 1e6, flushEvery: '30s' }` | batch-write parts every N rows / X time (`0` disables either); `false` = in memory only, nothing written |
| `monitor` | `serverStats()` | metrics sampled during the run (see below); `false` turns it off |
| `log` | `true` | per-second progress line + summary |
| `duckdbThreads` | 2 | kept low so parquet exports don't steal CPU from the load workers |
| `memoryLimit` | — | DuckDB memory_limit, e.g. `2GB` |
| `entry` | `Bun.main` | the file workers re-import to get the config |

`run()` resolves to a `RunResult`: request, failure and retry counts, rps, latency avg/p50/p90/p95/p99/max, and the output file path.

## Monitors: `monitor`

A monitor is a function you write, sampled on its own interval on the main thread during the run. It can read server CPU from an endpoint, run a DB stats query, read memory: anything that returns named numbers.

```ts
monitor: [
  { every: '200ms', sample: async ({ host, signal }) => ({ cpu: await fetch(`${host}/stats`, { signal }).then((r) => r.json()) }) },
  { every: '1s', sample: async () => ({ 'db.connections': await countConnections() }) },
],
```

- **Return value:** `sample()` returns `{ name: number | number[] }`. A list is stored as `name.1`, `name.2`, …, so `{ cpu: [..] }` becomes `cpu.1..cpu.4`. Those four feed the viewer's CPU chart as `core1..core4`.
- **Failures:** a sample slower than `timeout` (default 1s) is aborted, and one that throws is skipped. Both are counted and shown in the summary.
- **Default:** omitting `monitor` uses `serverStats()`, i.e. GET `${host}/stats` returning per-core CPU % as a JSON array.

## How the closures reach the workers

Every worker thread re-imports your entry file. When the file calls `run(config)`, the call hands the config, closures included, to the worker instead of starting a new test, and it never resolves there. So:
- top-level code before `run()` runs once per worker (load data there, or in `init`)
- code after `await run()` runs only on the main thread
- with several `run()` calls in one file, run sequentially, code *between* them also runs in the later runs' workers, where earlier `run()` calls return an empty result. Guard side effects there with `isWorker`.

Errors thrown in `init`, `path` or `sleepMs` reject `run()` on the main thread.

## Output

Each run writes one file, `<folder>/<name>.parquet`, holding both requests and monitor samples:
- **Request rows** have `metric` NULL.
- **Metric rows** have `ts`, `metric` and `value` set and the request columns NULL.

So filter on `metric IS NULL` for requests and `metric IS NOT NULL` for metrics.

| column | |
|---|---|
| `ts` | request end time, or sample time |
| `duration_ms` | write → last byte, like k6 `http_req_duration` (covers both attempts when retried) |
| `ttfb_ms` | write → first byte |
| `status` | 0 = no response |
| `error` | 1 timeout, 2 connect, 3 closed, 4 parse |
| `vus` | target VUs at the time |
| `bytes` | response body bytes |
| `worker` | worker thread index |
| `iter` | global iteration; with a deterministic `path(iter)` it reproduces the exact URL |
| `retries` | 1 = retried once on a fresh connection (see Notes) |
| `metric` / `value` | monitor sample, e.g. `cpu.1` = 37.0 |

While running, rows go into a compressed in-memory DuckDB table. At each flush that table is swapped for a fresh one and written to `<name>.parts/part-NNNNN.parquet` on a second connection, so request ingest never waits on disk. At the end the parts are concatenated into one file. If the process is killed, the parts are left behind. Ctrl-C stops gracefully and still saves; a second Ctrl-C aborts.

## Notes

- **Why not `fetch`:** with hundreds of concurrent requests in one process, Bun's `fetch` stops reusing connections (we saw ~15k sockets in TIME_WAIT and throughput collapsing), so it would measure connection setup rather than the server.
- **Retries, like Go and k6:** if a server closes a *reused* keep-alive connection before sending any byte, the GET is retried once on a fresh connection. It's recorded as one request with `retries = 1`, and its duration covers both attempts. Failures on a fresh connection are not retried.
- **Ramp-down and stop:** a VU finishes its current iteration before stopping. In-flight requests still running when `gracefulStop` runs out are dropped and not recorded, like k6.
- **Memory:** DuckDB uses about 10–20 B/row. Each worker costs about 60 MB plus whatever the file loads at top level, and anything loaded there is loaded once per worker. That's another reason to generate requests rather than load them from a file: a short run peaked at 318 MB loading a 14 MB request list, and at 149 MB with `mix()`.
