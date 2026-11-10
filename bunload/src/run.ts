import path from 'node:path';
import { runtime } from './runtime';
import { parseDuration, resolveStages, totalDuration } from './schedule';
import { serverStats } from './monitors';
import { Sink } from './sink';
import type { BenchConfig, MetricSample, Monitor, RunResult } from './types';
import type { ChunkMsg, StartMsg } from './worker';

const SKIPPED: RunResult = Object.freeze({
  name: '',
  requests: 0,
  failed: 0,
  timeouts: 0,
  connectErrors: 0,
  closedOrParseErrors: 0,
  retried: 0,
  seconds: 0,
  rps: 0,
  latency: { avg: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 },
  bodyBytes: 0,
  monitorErrors: 0,
  file: null,
}) as RunResult;

/** True inside bunload worker threads (where your bench file is re-imported). */
export const isWorker = !Bun.isMainThread;

/**
 * Run a load test. Call it from the file you `bun run`.
 *
 * Every worker thread re-imports that file to get your closures (path/sleepMs/init),
 * so top-level code runs once per worker too — like k6's init context. Code *after*
 * `await run(...)` only runs on the main thread. Guard other side effects with `isWorker`.
 */
export function run(config: BenchConfig): Promise<RunResult> {
  const index = runtime.calls++;
  const ctx = runtime.ctx;
  if (ctx) {
    if (index === ctx.runIndex) {
      ctx.capture(config);
      return new Promise(() => {}); // never resolves in a worker
    }
    return Promise.resolve(SKIPPED); // an earlier run() in the same file; let the file proceed
  }
  if (runtime.active) throw new Error('bunload: run() calls must be sequential (await each one)');
  runtime.active = true;
  return runMain(config, index).finally(() => {
    runtime.active = false;
  });
}

async function runMain(config: BenchConfig, runIndex: number): Promise<RunResult> {
  const host = config.host.replace(/\/$/, '');
  const name = config.name ?? 'bench';
  const workers = config.workers ?? 2;
  const log = config.log ?? true;
  const entry = path.resolve(config.entry ?? Bun.main);
  const totalMs = totalDuration(resolveStages(config.stages));
  const monitors: Monitor[] =
    config.monitor === false ? [] : config.monitor ? [config.monitor].flat() : [serverStats()];
  const save = config.output !== false;
  const out = config.output || {};
  const folder = path.resolve(config.folder ?? 'results');
  const flush = { rows: out.flushRows ?? 1_000_000, everyMs: parseDuration(out.flushEvery ?? '30s') };

  const sink = await Sink.create({
    memoryLimit: config.memoryLimit,
    threads: config.duckdbThreads,
    partsDir: save ? path.join(folder, `${name}.parts`) : undefined,
    flush,
  });

  // ---- live per-second progress -------------------------------------------
  let secCount = 0;
  let secFail = 0;
  let secDurSum = 0;
  let secVus = 0;
  let totalCount = 0;
  let peakRss = 0;

  const onChunk = (c: ChunkMsg) => {
    sink.appendChunk(c);
    totalCount += c.n;
    secCount += c.n;
    for (let i = 0; i < c.n; i++) {
      const s = c.status[i]!;
      if (s === 0 || s >= 400) secFail++;
      else secDurSum += c.dur[i]!;
    }
    if (c.n) secVus = c.vus[c.n - 1]!;
  };

  // ---- workers -------------------------------------------------------------
  const startAt = Date.now() + 1500 + workers * 100; // time for workers to import + init
  const iterCounter = new SharedArrayBuffer(4);
  const pool: Worker[] = [];
  let done = 0;

  const finished = new Promise<void>((resolve, reject) => {
    for (let i = 0; i < workers; i++) {
      const w = new Worker(new URL('./worker.ts', import.meta.url));
      w.onmessage = (ev: MessageEvent) => {
        const m = ev.data;
        if (m.type === 'chunk') onChunk(m);
        else if (m.type === 'error') reject(new Error(`bunload worker ${i}: ${m.message}`));
        else if (m.type === 'done' && ++done === workers) resolve();
      };
      w.onerror = (e) => reject(new Error(`bunload worker ${i}: ${e.message}`));
      const msg: StartMsg = {
        type: 'start',
        index: i,
        workers,
        host,
        entry,
        runIndex,
        stages: config.stages,
        startAt,
        chunkRows: config.chunkRows ?? 16_384,
        maxIterations: config.iterations ?? 0,
        iterCounter,
      };
      w.postMessage(msg);
      pool.push(w);
    }
  });

  let interrupted = false;
  const onSigint = () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.log('\nstopping… (Ctrl-C again to abort; flushed parts are kept)');
    for (const w of pool) w.postMessage({ type: 'stop' });
  };
  process.on('SIGINT', onSigint);

  // ---- monitors (server CPU, DB stats, load generator, …) --------------------
  // Each samples on its own interval on the main thread; a slow or failing sample is skipped.
  let monitorErrors = 0;
  let lastMonitorError = '';
  const latest: MetricSample = {}; // for the progress line
  const monitorTimers = monitors.map((m) => {
    let busy = false;
    const timeout = parseDuration(m.timeout ?? '1s');
    return setInterval(
      async () => {
        if (busy || Date.now() < startAt) return;
        busy = true;
        try {
          const sample = await m.sample({ host, signal: AbortSignal.timeout(timeout) });
          sink.appendMetrics(Date.now(), sample);
          Object.assign(latest, sample);
        } catch (e) {
          monitorErrors++;
          lastMonitorError = e instanceof Error ? e.message : String(e);
        } finally {
          busy = false;
        }
      },
      parseDuration(m.every ?? '200ms'),
    );
  });
  const fmtLatest = () =>
    Object.entries(latest)
      .slice(0, 4)
      .map(([k, v]) => {
        const n = Array.isArray(v) ? v.reduce((a: number, b: number) => a + b, 0) / (v.length || 1) : (v as number);
        return `${k}=${Number.isFinite(n) ? n.toFixed(1) : '-'}`;
      })
      .join(' ');

  const progress = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage.rss());
    const elapsed = (Date.now() - startAt) / 1000;
    if (elapsed < 0) return;
    if (log) {
      const ok = secCount - secFail;
      console.log(
        `[${name} ${elapsed.toFixed(0).padStart(4)}s/${(totalMs / 1000).toFixed(0)}s] vus=${String(secVus).padStart(5)} ` +
          `rps=${String(secCount).padStart(7)} fail=${String(secFail).padStart(5)} ` +
          `avg=${ok ? (secDurSum / ok).toFixed(2) : '-'}ms total=${totalCount}` +
          (sink.flushing ? ` flushed=${sink.rowsFlushed}` : '') +
          (monitors.length ? ` | ${fmtLatest() || 'no samples'}${monitorErrors ? ` (${monitorErrors} monitor errors)` : ''}` : ''),
      );
    }
    secCount = secFail = secDurSum = 0;
  }, 1000);

  if (log) {
    const outDesc = !save
      ? 'in memory only'
      : sink.flushing
        ? `parquet parts every ${flush.rows || '∞'} rows / ${flush.everyMs ? flush.everyMs / 1000 + 's' : '∞'}`
        : 'parquet at the end';
    console.log(
      `bunload ${name} → ${host} | workers=${workers} | ${(totalMs / 1000).toFixed(0)}s` +
        (config.iterations ? ` or ${config.iterations.toLocaleString('en-US')} requests, whichever first` : '') +
        ` | ${outDesc}`,
    );
  }

  try {
    await finished;
  } finally {
    clearInterval(progress);
    for (const t of monitorTimers) clearInterval(t);
    process.off('SIGINT', onSigint);
    for (const w of pool) w.terminate();
  }
  await sink.finish();

  const s = await sink.summary();
  const p = (s.p as number[] | null) ?? [];
  const num = (v: unknown) => (v == null ? 0 : Number(v));
  const result: RunResult = {
    name,
    requests: num(s.requests),
    failed: num(s.failed),
    timeouts: num(s.timeouts),
    connectErrors: num(s.connect_errors),
    closedOrParseErrors: num(s.conn_closed_or_parse),
    retried: num(s.retried),
    seconds: num(s.seconds),
    rps: num(s.requests) / (num(s.seconds) || 1),
    latency: {
      avg: num(s.avg_ms),
      p50: num(p[0]),
      p90: num(p[1]),
      p95: num(p[2]),
      p99: num(p[3]),
      max: num(s.max_ms),
    },
    bodyBytes: num(s.body_bytes),
    monitorErrors,
    file: null,
  };

  if (save) {
    const requests = path.join(folder, `${name}.parquet`);
    await sink.writeParquet(requests);
    result.file = requests;
  }
  sink.close();

  if (log) {
    const f = (v: number) => v.toFixed(2);
    const l = result.latency;
    console.log(
      `\n${name}\n` +
        `  requests  ${result.requests}  (${result.rps.toFixed(0)} rps avg over ${f(result.seconds)}s)\n` +
        `  failed    ${result.failed}  (timeouts ${result.timeouts}, connect ${result.connectErrors}, closed/parse ${result.closedOrParseErrors})\n` +
        `  retried   ${result.retried}  (stale keep-alive closed before any response → retried once, like k6)\n` +
        `  latency   avg ${f(l.avg)}  p50 ${f(l.p50)}  p90 ${f(l.p90)}  p95 ${f(l.p95)}  p99 ${f(l.p99)}  max ${f(l.max)} ms\n` +
        `  memory    peak rss ${(peakRss / 1024 / 1024).toFixed(0)} MiB` +
        (monitorErrors ? `\n  monitor   ${monitorErrors} failed samples (last: ${lastMonitorError})` : '') +
        (result.file ? `\n  saved     ${result.file}` : ''),
    );
  }
  return result;
}
