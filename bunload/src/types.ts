import type { Stage } from './schedule';

export type Duration = string | number; // '5s', '1m30s', '250ms' or ms

/** A metric is a number, or a list of numbers (stored as name.1, name.2, … e.g. per-core CPU). */
export type MetricSample = Record<string, number | readonly number[] | null | undefined>;

/**
 * Something sampled on an interval during the run, on the main thread — server CPU from an
 * endpoint, DB stats from a query, the load generator's own CPU, anything.
 */
export interface Monitor {
  /** sampling interval. Default 200ms */
  every?: Duration;
  /** a sample slower than this is aborted and skipped. Default 1s */
  timeout?: Duration;
  sample(ctx: { host: string; signal: AbortSignal }): MetricSample | Promise<MetricSample>;
}

export interface BenchConfig {
  /** Target base URL, e.g. http://192.168.31.144:3000 (http or https). */
  host: string;
  /** k6-style ramping-vus stages (linear ramp to `target` over `duration`). */
  stages: Stage[];
  /** Path + query for the given global iteration (shared across workers, like k6 iterationInTest). */
  path(iter: number): string;
  /** Think time after each iteration, in ms. */
  sleepMs?(iter: number): number;
  /** Runs once in every worker before the test starts. */
  init?(): void | Promise<void>;

  /** Worker threads; VUs are split evenly across them. Default 2. */
  workers?: number;
  /** Per-request timeout. Default 30s. */
  timeout?: Duration;
  /** After the last stage, how long in-flight iterations may finish. Default = timeout (max 30s). */
  gracefulStop?: Duration;

  /** Output file base name. Default 'bench'. */
  name?: string;
  /** Output folder (relative to cwd). Default 'results'. */
  folder?: string;
  /**
   * Parquet output. `false` = keep everything in memory, print summary only.
   * Rows are batch-written to parts every `flushRows` rows / `flushEvery`, whichever first
   * (0 disables either; both 0 = write once at the end), then merged into <folder>/<name>.parquet.
   */
  output?: false | { flushRows?: number; flushEvery?: Duration };
  /**
   * Metrics sampled during the run, stored in <folder>/<name>.parquet as rows with `metric` + `value`.
   * Default: serverStats() — GET `${host}/stats` returning per-core CPU %. `false` = off.
   * Return `{ cpu: [..] }` to feed the CPU charts (cpu.1..cpu.4 become core1..core4).
   */
  monitor?: false | Monitor | Monitor[];

  /** Print per-second progress + summary. Default true. */
  log?: boolean;
  /** DuckDB threads (kept low so exports don't steal CPU from workers). Default 2. */
  duckdbThreads?: number;
  /** DuckDB memory_limit, e.g. '2GB'. */
  memoryLimit?: string;
  /** Rows per chunk transferred from workers to main. Default 16384. */
  chunkRows?: number;
  /** File workers import to get this config. Default Bun.main (the file you `bun run`). */
  entry?: string;
}

export interface RunResult {
  name: string;
  requests: number;
  failed: number;
  timeouts: number;
  connectErrors: number;
  closedOrParseErrors: number;
  /** requests retried once on a fresh connection after a stale keep-alive close (not failures) */
  retried: number;
  seconds: number;
  rps: number;
  latency: { avg: number; p50: number; p90: number; p95: number; p99: number; max: number };
  bodyBytes: number;
  monitorErrors: number;
  /** <folder>/<name>.parquet (requests + monitor metrics), null with `output: false` */
  file: string | null;
}
