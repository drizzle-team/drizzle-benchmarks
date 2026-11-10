// Worker thread: runs its share of VUs, records one row per request into
// columnar typed arrays and transfers full chunks to the main thread.
declare var self: Worker;

import { Conn, ERR_CLOSED, ERR_CONNECT, ERR_NONE, ERR_TIMEOUT, parseTarget } from './http';
import { runtime } from './runtime';
import { parseDuration, resolveStages, shareOf, targetAt, totalDuration, type Stage } from './schedule';
import type { BenchConfig } from './types';

export interface StartMsg {
  type: 'start';
  index: number;
  workers: number;
  host: string;
  entry: string; // user's bench file; re-imported here to get closures (path/sleepMs/init)
  runIndex: number; // which run() call in that file this worker belongs to
  stages: Stage[];
  startAt: number; // epoch ms
  chunkRows: number;
  iterCounter: SharedArrayBuffer; // global iteration counter shared by all workers (k6 iterationInTest)
}

export interface ChunkMsg {
  type: 'chunk';
  worker: number;
  n: number;
  ts: Float64Array; // epoch ms, request end
  dur: Float32Array; // ms, write -> last byte
  ttfb: Float32Array; // ms, write -> first byte
  status: Uint16Array; // 0 = no response
  err: Uint8Array;
  vus: Uint16Array; // global target VUs at that moment
  bytes: Uint32Array; // body bytes
  iter: Uint32Array; // global iteration → path(iter) reproduces the exact request
  retries: Uint8Array; // 1 = retried on a fresh connection (stale keep-alive), like Go/k6
}

const epochNow = () => performance.timeOrigin + performance.now();

let cfg: StartMsg;
let scenario: BenchConfig;
let timeout = 30_000;
let stopping = false;
let currentTarget = 0;
let hardStopped = false; // in-flight requests interrupted at the end are dropped (like k6)

// ---- metrics buffer --------------------------------------------------------
let n = 0;
let ts!: Float64Array, dur!: Float32Array, ttfb!: Float32Array;
let status!: Uint16Array, err!: Uint8Array, vus!: Uint16Array, bytes!: Uint32Array;
let iters!: Uint32Array, retries!: Uint8Array;

function alloc() {
  const r = cfg.chunkRows;
  ts = new Float64Array(r);
  dur = new Float32Array(r);
  ttfb = new Float32Array(r);
  status = new Uint16Array(r);
  err = new Uint8Array(r);
  vus = new Uint16Array(r);
  bytes = new Uint32Array(r);
  iters = new Uint32Array(r);
  retries = new Uint8Array(r);
  n = 0;
}

function flush() {
  if (n === 0) return;
  const msg: ChunkMsg = { type: 'chunk', worker: cfg.index, n, ts, dur, ttfb, status, err, vus, bytes, iter: iters, retries };
  self.postMessage(msg, {
    transfer: [ts.buffer, dur.buffer, ttfb.buffer, status.buffer, err.buffer, vus.buffer, bytes.buffer, iters.buffer, retries.buffer] as ArrayBuffer[],
  });
  alloc();
}

function record(endEpoch: number, d: number, fb: number, st: number, e: number, b: number, it: number, rt: number) {
  if (hardStopped) return;
  ts[n] = endEpoch;
  dur[n] = d;
  ttfb[n] = fb;
  status[n] = st;
  err[n] = e;
  vus[n] = currentTarget;
  bytes[n] = b;
  iters[n] = it;
  retries[n] = rt;
  if (++n === cfg.chunkRows) flush();
}

// ---- VUs -------------------------------------------------------------------
const inflight = new Set<Conn>();
const vuStop: boolean[] = [];
let running = 0;
let iterCounter!: Uint32Array;
let allVUsDone: (() => void) | null = null;

async function vu(id: number) {
  running++;
  const target = parseTarget(cfg.host);
  const conn = new Conn(target);
  try {
    while (!vuStop[id] && !stopping) {
      const iter = Atomics.add(iterCounter, 0, 1);
      if (!conn.alive) {
        const t = performance.now();
        if (!(await conn.connect())) {
          const now = performance.now();
          record(epochNow(), now - t, 0, 0, ERR_CONNECT, 0, iter, 0);
          await Bun.sleep(Math.max(10, scenario.sleepMs?.(iter) ?? 0));
          continue;
        }
      }
      const path = scenario.path(iter);
      inflight.add(conn);
      let e = await conn.request(path, timeout);
      const t0 = conn.t0;
      let retried = 0;
      // Like Go's net/http (and so k6): a GET on a *reused* keep-alive connection that the server
      // closed before sending any byte is retried once on a fresh connection. The duration covers
      // both attempts, and the `retries` column keeps it visible.
      if (e === ERR_CLOSED && conn.reused && conn.tFirst === 0 && !stopping) {
        const left = timeout - (performance.now() - t0);
        if (left > 0 && (await conn.connect())) {
          retried = 1;
          e = await conn.request(path, left);
        }
      }
      inflight.delete(conn);
      const d = conn.tEnd - t0;
      record(
        performance.timeOrigin + conn.tEnd,
        d,
        conn.tFirst ? conn.tFirst - t0 : d,
        e === ERR_NONE ? conn.status : 0,
        e,
        conn.bytes,
        iter,
        retried,
      );
      const s = scenario.sleepMs?.(iter) ?? 0;
      if (s > 0 && !stopping) await Bun.sleep(s);
    }
  } finally {
    conn.close();
    running--;
    if (running === 0) allVUsDone?.();
  }
}

function scaleTo(want: number) {
  // active = VUs not marked to stop
  let active = 0;
  for (let i = 0; i < vuStop.length; i++) if (!vuStop[i]) active++;
  if (want > active) {
    // revive stopped slots first? simpler: always start fresh VUs at new ids
    for (let k = active; k < want; k++) {
      const id = vuStop.length;
      vuStop.push(false);
      vu(id).catch(reportError);
    }
  } else if (want < active) {
    let toStop = active - want;
    for (let i = vuStop.length - 1; i >= 0 && toStop > 0; i--) {
      if (!vuStop[i]) {
        vuStop[i] = true;
        toStop--;
      }
    }
  }
}

// ---- config capture ----------------------------------------------------------
// Import the user's bench file (not awaited: it may top-level-await run()). Its run() call
// with our index hands us the config and never resolves, so code after it doesn't run here.
function captureConfig(entry: string, runIndex: number): Promise<BenchConfig> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${entry} did not call run() #${runIndex} within 60s in the worker`)),
      60_000,
    );
    runtime.ctx = {
      runIndex,
      capture(config) {
        clearTimeout(timer);
        resolve(config);
      },
    };
    import(entry).catch((e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

// ---- main ------------------------------------------------------------------
function reportError(e: unknown) {
  self.postMessage({ type: 'error', message: e instanceof Error ? (e.stack ?? e.message) : String(e) });
}

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === 'stop') stopping = true;
  else if (msg.type === 'start')
    start(msg as StartMsg).catch(reportError);
};

async function start(msg: StartMsg) {
  cfg = msg;
  iterCounter = new Uint32Array(cfg.iterCounter);
  scenario = await captureConfig(cfg.entry, cfg.runIndex);
  timeout = parseDuration(scenario.timeout ?? 30_000);
  await scenario.init?.();
  alloc();
  self.postMessage({ type: 'ready', worker: cfg.index });

  const stages = resolveStages(cfg.stages);
  const total = totalDuration(stages);

  const wait = cfg.startAt - epochNow();
  if (wait > 0) await Bun.sleep(wait);

  // timeout sweeper + periodic flush (so main sees near-real-time data)
  const sweeper = setInterval(() => {
    const now = performance.now();
    for (const c of inflight) if (c.deadline && now > c.deadline) c.abort(ERR_TIMEOUT);
  }, 100);
  const flusher = setInterval(flush, 250);

  // scheduler
  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = epochNow() - cfg.startAt;
      const t = stopping ? -1 : targetAt(stages, elapsed);
      if (t < 0) {
        clearInterval(timer);
        resolve();
        return;
      }
      currentTarget = t;
      scaleTo(shareOf(t, cfg.workers, cfg.index));
    };
    const timer = setInterval(tick, 50);
    tick();
  });

  // graceful stop: let iterations finish, hard-abort after gracefulStopMs
  stopping = true;
  currentTarget = 0;
  const grace = scenario.gracefulStop != null ? parseDuration(scenario.gracefulStop) : Math.min(timeout, 30_000);
  if (running > 0) {
    await Promise.race([new Promise<void>((r) => (allVUsDone = r)), Bun.sleep(grace)]);
  }
  hardStopped = true;
  for (const c of inflight) c.abort(ERR_TIMEOUT);
  clearInterval(sweeper);
  clearInterval(flusher);
  flush();
  self.postMessage({ type: 'done', worker: cfg.index, durationMs: total });
}
