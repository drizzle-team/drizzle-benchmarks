// Per-second aggregates for charts — same shape as bench/prepare.ts (data.json), plus `vus`
// and `metrics` (per-second average of every monitor metric).
import { DuckDBInstance } from '@duckdb/node-api';
import fs from 'node:fs';
import path from 'node:path';

export interface PrepareOptions {
  /** folder with <name>.parquet files from run(). Default 'results'. */
  folder?: string;
  /** only these runs (default: every <name>.parquet in the folder) */
  names?: string[];
  /** write JSON here; omit to only return the data */
  out?: string;
}

export type PreparedRow = {
  time: Date;
  /** server CPU from the `cpu` monitor metric (cpu.1..cpu.4) — what the site's CPU chart reads */
  core1?: number;
  core2?: number;
  core3?: number;
  core4?: number;
  reqs_per_sec: number;
  fail_reqs_per_sec: number;
  latency_95: number;
  latency_90: number;
  latency_99: number;
  latency_average: number;
  vus: number;
  /** every monitor metric, averaged over the second */
  metrics: Record<string, number>;
};

const q = (p: string) => `'${p.replaceAll("'", "''")}'`;
const isRunFile = (f: string) => f.endsWith('.parquet') && !f.startsWith('metrics-') && !f.startsWith('cpu-usage-');

export async function prepare(opts: PrepareOptions = {}): Promise<Record<string, PreparedRow[]>> {
  const folder = path.resolve(opts.folder ?? 'results');
  const names = opts.names ?? fs.readdirSync(folder).filter(isRunFile).map((f) => f.slice(0, -'.parquet'.length));

  const db = await DuckDBInstance.create(':memory:');
  const con = await db.connect();
  const data: Record<string, PreparedRow[]> = {};
  try {
    for (const name of names) {
      const file = q(path.join(folder, `${name}.parquet`));
      // requests and monitor metrics share one file (metric rows have `metric` set); runs recorded
      // before that have only request rows here and their metrics in metrics-<name>.parquet
      const columns = (await (await con.run(`DESCRIBE SELECT * FROM read_parquet(${file})`)).getRowObjectsJS()).map(
        (c) => c.column_name as string,
      );
      const combined = columns.includes('metric');
      const legacyMetrics = path.join(folder, `metrics-${name}.parquet`);
      const metricsSql = combined
        ? `SELECT ts, metric AS name, value FROM read_parquet(${file}) WHERE metric IS NOT NULL`
        : fs.existsSync(legacyMetrics)
          ? `SELECT ts, name, value FROM read_parquet(${q(legacyMetrics)})`
          : null;

      const reqs = await con.run(`
        SELECT
          time_bucket(INTERVAL '1s', ts) AS time,
          count(*)::INTEGER AS reqs_per_sec,
          (count(*) FILTER (WHERE status = 0 OR status >= 400))::INTEGER AS fail_reqs_per_sec,
          quantile_cont(duration_ms, 0.95) FILTER (WHERE status BETWEEN 1 AND 399) AS latency_95,
          quantile_cont(duration_ms, 0.90) FILTER (WHERE status BETWEEN 1 AND 399) AS latency_90,
          quantile_cont(duration_ms, 0.99) FILTER (WHERE status BETWEEN 1 AND 399) AS latency_99,
          avg(duration_ms) FILTER (WHERE status BETWEEN 1 AND 399) AS latency_average,
          max(vus)::INTEGER AS vus
        FROM read_parquet(${file})
        ${combined ? 'WHERE metric IS NULL' : ''}
        GROUP BY 1
        ORDER BY 1
      `);
      const rows = (await reqs.getRowObjectsJS()) as unknown as PreparedRow[];

      // monitor metrics: per-second average per metric name, merged onto the request rows
      const bySecond = new Map<number, Record<string, number>>();
      if (metricsSql) {
        const m = await con.run(`
          SELECT time_bucket(INTERVAL '1s', ts) AS time, name, avg(value) AS value
          FROM (${metricsSql})
          GROUP BY ALL
        `);
        for (const r of (await m.getRowObjectsJS()) as { time: Date; name: string; value: number }[]) {
          const key = r.time.getTime();
          (bySecond.get(key) ?? bySecond.set(key, {}).get(key)!)[r.name] = r.value;
        }
      }
      for (const row of rows) {
        const metrics = bySecond.get(row.time.getTime()) ?? {};
        row.metrics = metrics;
        if ('cpu.1' in metrics) {
          row.core1 = metrics['cpu.1'];
          row.core2 = metrics['cpu.2'];
          row.core3 = metrics['cpu.3'];
          row.core4 = metrics['cpu.4'];
        }
      }
      data[name] = rows;
    }
  } finally {
    con.closeSync();
    db.closeSync();
  }
  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(data, null, 2));
  return data;
}
