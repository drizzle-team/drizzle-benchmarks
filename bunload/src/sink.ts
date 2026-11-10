// DuckDB sink.
//
// Rows stream into a compressed in-memory table via the appender. When flushing
// is enabled, the table is rotated every `flush.rows` rows / `flush.everyMs` ms:
// a fresh table takes new rows immediately, and the full one is exported to a
// zstd parquet part on a second connection, then dropped — so memory stays flat
// and ingest never waits on disk. At the end parts are merged into one file.
import { DuckDBInstance, type DuckDBAppender, type DuckDBConnection } from '@duckdb/node-api';
import fs from 'node:fs';
import path from 'node:path';
import type { ChunkMsg } from './worker';

export interface FlushOpts {
  /** rotate after this many rows (0 = off) */
  rows: number;
  /** rotate at least this often, in ms (0 = off) */
  everyMs: number;
}

export interface SinkOpts {
  memoryLimit?: string;
  /** DuckDB threads; kept low so exports don't steal CPU from the load workers */
  threads?: number;
  /** directory for parquet parts; omit to keep everything in memory until the end */
  partsDir?: string;
  flush?: FlushOpts;
}

const sqlStr = (s: string) => `'${s.replaceAll("'", "''")}'`;
const REQUESTS_COLUMNS = `
  ts DOUBLE, duration_ms FLOAT, ttfb_ms FLOAT, status USMALLINT,
  error UTINYINT, vus USMALLINT, bytes UINTEGER, worker UTINYINT, iter UINTEGER, retries UTINYINT`;
// stored as epoch-ms DOUBLE (cheap to append), exported as a real TIMESTAMP
const EXPORT_SELECT = `make_timestamp((ts * 1000)::BIGINT) AS ts, * EXCLUDE (ts)`;

export class Sink {
  private reqs: DuckDBAppender | null = null;
  private metrics: DuckDBAppender | null = null;
  private table = '';
  private seq = 0;
  private rowsInTable = 0;
  private rotating: Promise<void> | null = null;
  private queue: ChunkMsg[] = [];
  private exporting: Promise<void> = Promise.resolve();
  private exportError: unknown = null;
  private timer: Timer | undefined;
  private finished = false;

  readonly parts: string[] = [];
  rowsFlushed = 0;

  private constructor(
    private readonly db: DuckDBInstance,
    private readonly con: DuckDBConnection, // ingest
    private readonly io: DuckDBConnection, // part exports
    private readonly opts: SinkOpts,
  ) {}

  static async create(opts: SinkOpts = {}) {
    const config: Record<string, string> = { threads: String(opts.threads ?? 2) };
    if (opts.memoryLimit) config.memory_limit = opts.memoryLimit;
    const db = await DuckDBInstance.create(':memory:', config);
    const con = await db.connect();
    // compressed in-memory storage: ~20 B/row instead of ~55 B/row, never touches disk
    await con.run(`ATTACH ':memory:' AS m (COMPRESS); USE m;`);
    await con.run(`CREATE TABLE metrics (ts DOUBLE, name VARCHAR, value DOUBLE);`);
    const io = await db.connect();
    await io.run(`USE m;`);

    const sink = new Sink(db, con, io, opts);
    await sink.openTable();
    sink.metrics = await con.createAppender('metrics');

    if (sink.flushing) {
      fs.rmSync(opts.partsDir!, { recursive: true, force: true });
      fs.mkdirSync(opts.partsDir!, { recursive: true });
      const every = opts.flush?.everyMs ?? 0;
      if (every > 0) sink.timer = setInterval(() => sink.rowsInTable > 0 && sink.rotate(), every);
    }
    return sink;
  }

  get flushing() {
    return !!this.opts.partsDir && ((this.opts.flush?.rows ?? 0) > 0 || (this.opts.flush?.everyMs ?? 0) > 0);
  }

  private async openTable() {
    this.table = `requests_${this.seq++}`;
    await this.con.run(`CREATE TABLE ${this.table} (${REQUESTS_COLUMNS});`);
    this.reqs = await this.con.createAppender(this.table);
    this.rowsInTable = 0;
  }

  appendChunk(c: ChunkMsg) {
    if (this.rotating) {
      this.queue.push(c); // appender is being swapped; replay right after
      return;
    }
    const a = this.reqs!;
    for (let i = 0; i < c.n; i++) {
      a.appendDouble(c.ts[i]!);
      a.appendFloat(c.dur[i]!);
      a.appendFloat(c.ttfb[i]!);
      a.appendUSmallInt(c.status[i]!);
      a.appendUTinyInt(c.err[i]!);
      a.appendUSmallInt(c.vus[i]!);
      a.appendUInteger(c.bytes[i]!);
      a.appendUTinyInt(c.worker);
      a.appendUInteger(c.iter[i]!);
      a.appendUTinyInt(c.retries[i]!);
      a.endRow();
    }
    this.rowsInTable += c.n;
    const maxRows = this.opts.flush?.rows ?? 0;
    if (this.opts.partsDir && maxRows > 0 && this.rowsInTable >= maxRows) this.rotate();
  }

  /** one monitor sample; list values are stored as name.1, name.2, … */
  appendMetrics(ts: number, sample: Record<string, number | readonly number[] | null | undefined>) {
    const a = this.metrics;
    if (!a) return;
    const put = (name: string, v: number) => {
      if (!Number.isFinite(v)) return;
      a.appendDouble(ts);
      a.appendVarchar(name);
      a.appendDouble(v);
      a.endRow();
    };
    for (const [name, v] of Object.entries(sample)) {
      if (typeof v === 'number') put(name, v);
      else if (Array.isArray(v)) v.forEach((x, i) => typeof x === 'number' && put(`${name}.${i + 1}`, x));
    }
  }

  /** Swap in a fresh table; export the full one in the background. */
  private rotate(): Promise<void> {
    if (this.rotating) return this.rotating;
    this.rotating = (async () => {
      const full = this.table;
      const rows = this.rowsInTable;
      this.reqs!.closeSync(); // flushes buffered rows into `full`
      await this.openTable();
      this.rotating = null;
      for (const c of this.queue.splice(0)) this.appendChunk(c);
      if (rows === 0) {
        await this.io.run(`DROP TABLE ${full};`);
        return;
      }
      const file = path.join(this.opts.partsDir!, `part-${String(this.parts.length).padStart(5, '0')}.parquet`);
      this.parts.push(file);
      this.exporting = this.exporting.then(async () => {
        try {
          // no ORDER BY: rows are already in arrival order (workers interleave within ~250ms),
          // and sorting each part costs ~80MB of RSS that the allocator never hands back
          await this.io.run(
            `COPY (SELECT ${EXPORT_SELECT} FROM ${full}) TO ${sqlStr(file)} (FORMAT parquet, COMPRESSION zstd);`,
          );
          await this.io.run(`DROP TABLE ${full};`);
          this.rowsFlushed += rows;
        } catch (e) {
          this.exportError ??= e;
          console.error(`failed to export ${file}:`, e);
        }
      });
    })();
    return this.rotating;
  }

  /** Stop accepting rows; with flushing, export the tail and wait for all parts. */
  async finish() {
    if (this.finished) return;
    this.finished = true;
    clearInterval(this.timer);
    if (this.rotating) await this.rotating;
    if (this.flushing) {
      await this.rotate();
      await this.exporting;
      if (this.exportError) throw this.exportError;
    }
    this.reqs?.closeSync();
    this.metrics?.closeSync();
    this.reqs = this.metrics = null;
  }

  close() {
    this.io.closeSync();
    this.con.closeSync();
    this.db.closeSync();
  }

  /** SQL relation holding every request row (parts on disk, or the in-memory table). */
  private get source() {
    return this.flushing
      ? `(SELECT epoch_ms(ts)::DOUBLE AS ts, * EXCLUDE (ts) FROM read_parquet([${this.parts.map(sqlStr).join(', ')}]))`
      : this.table;
  }

  async summary() {
    if (this.flushing && this.parts.length === 0) return { requests: 0 } as Record<string, any>;
    const r = await this.con.run(`
      SELECT
        count(*)::BIGINT AS requests,
        count(*) FILTER (WHERE status = 0 OR status >= 400)::BIGINT AS failed,
        count(*) FILTER (WHERE error = 1)::BIGINT AS timeouts,
        count(*) FILTER (WHERE error = 2)::BIGINT AS connect_errors,
        count(*) FILTER (WHERE error IN (3, 4))::BIGINT AS conn_closed_or_parse,
        count(*) FILTER (WHERE retries > 0)::BIGINT AS retried,
        (max(ts) - min(ts)) / 1000 AS seconds,
        avg(duration_ms) FILTER (WHERE status BETWEEN 1 AND 399) AS avg_ms,
        quantile_cont(duration_ms, [0.5, 0.9, 0.95, 0.99]) FILTER (WHERE status BETWEEN 1 AND 399) AS p,
        max(duration_ms) FILTER (WHERE status BETWEEN 1 AND 399) AS max_ms,
        sum(bytes)::BIGINT AS body_bytes
      FROM ${this.source}
    `);
    return (await r.getRowObjectsJS())[0] as Record<string, any>;
  }

  /**
   * One file per run. Request rows have `metric` NULL; monitor samples are rows with `ts`,
   * `metric` and `value` set and the request columns NULL (nulls cost next to nothing in parquet).
   */
  async writeParquet(file: string) {
    const out = `TO ${sqlStr(file)} (FORMAT parquet, COMPRESSION zstd)`;
    const metrics = `SELECT make_timestamp((ts * 1000)::BIGINT) AS ts, name AS metric, value FROM metrics`;
    if (this.flushing) {
      // parts are listed in order and DuckDB preserves insertion order, so this is a cheap streaming concat
      const requests = this.parts.length
        ? `SELECT * FROM read_parquet([${this.parts.map(sqlStr).join(', ')}])`
        : `SELECT ${EXPORT_SELECT} FROM ${this.table}`; // empty table, keeps the schema
      await this.con.run(`COPY (${requests} UNION ALL BY NAME (${metrics} ORDER BY ts, metric)) ${out}`);
      fs.rmSync(this.opts.partsDir!, { recursive: true, force: true });
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await this.con.run(
        `COPY (SELECT ${EXPORT_SELECT} FROM ${this.table} UNION ALL BY NAME ${metrics} ORDER BY ts, metric NULLS FIRST) ${out}`,
      );
    }
  }
}
