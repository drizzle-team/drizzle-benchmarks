// Peak rps per run, with latency and CPU per request there, as one markdown table sorted by peak.
// The peak is the first VU step within 1% of the best step's rps: where the server stopped gaining.
// Past it rps stays flat (the highest flat step is noise) and added VUs only wait in line.
//
//   bun scripts/peaks.ts results/*-full.parquet
//   bun scripts/peaks.ts --p95 50 results/*-full.parquet   # latency budget for the "within p95" column (default 100 ms)
//
// "within p95 ≤ N ms" is the best step whose p95 latency stays within the budget: what the server sustains
// before requests start queueing, the fairer number for servers whose rps keeps creeping up while latency
// explodes.
//
// A step's rps is the mean of the seconds at a steady VU count, the first of them skipped (the step
// change). CPU per request comes from the proc.* rows that `bun scripts/matrix.ts --cpu` records; "-"
// when the run has none. DuckDB comes with bunload (cd bunload && bun install)
import { DuckDBInstance } from '../bunload/node_modules/@duckdb/node-api';

const args = process.argv.slice(2);
const budgetAt = args.indexOf('--p95');
const budget = budgetAt >= 0 ? Number(args.splice(budgetAt, 2)[1]) : 100;
const files = args;
if (files.length === 0) {
  console.error('usage: bun scripts/peaks.ts results/<run>.parquet ...');
  process.exit(1);
}
const db = await (await DuckDBInstance.create(':memory:')).connect();

type Row = { run: string; bVus: number | null; bRps: number | null; vus: number; rps: number; p95: number; p99: number; failed: number; total: number; srv: number | null; pg: number | null; rest: number | null };
const rows: Row[] = [];
for (const f of files) {
  const run = f.split('/').pop()!.replace(/\.parquet$/, '');
  const m = (name: string) => `avg(value) filter (where metric = 'proc.${name}')`;
  const r = await db.runAndReadAll(`
    with req as (select epoch(ts)::bigint s, duration_ms, vus, status from '${f}' where metric is null),
    secs as (select s, max(vus) vus, min(vus) lo, count(*) n from req group by s),
    steady as (select s, vus, n, row_number() over (partition by vus order by s) i from secs where vus > 0 and lo = vus),
    step as (select vus, avg(n) rps, list(s) ss from steady where i > 1 group by vus having count(*) >= 2),
    peak as (select * from step where rps >= 0.99 * (select max(rps) from step) order by vus limit 1),
    steplat as (select st.vus, quantile_cont(r.duration_ms, 0.95) p95 from steady st join req r using (s) where st.i > 1 group by st.vus),
    inbudget as (select step.vus, step.rps from step join steplat using (vus) where steplat.p95 <= ${budget} order by step.rps desc limit 1),
    cpu as (select floor(epoch(ts))::bigint - 1 s, ${m('server')} srv, ${m('postgres')} pg,
              coalesce(${m('docker-proxy')}, 0) + ${m('irq')} + ${m('other')} rest
            from '${f}' where metric like 'proc.%' group by 1)
    select p.vus, p.rps, (select vus from inbudget) b_vus, (select rps from inbudget) b_rps,
      (select quantile_cont(duration_ms, 0.95) from req where list_contains(p.ss, s)) p95,
      (select quantile_cont(duration_ms, 0.99) from req where list_contains(p.ss, s)) p99,
      (select count(*) from req where status = 0 or status >= 400) failed,
      (select count(*) from req) total,
      (select avg(srv) from cpu where list_contains(p.ss, s)) srv,
      (select avg(pg) from cpu where list_contains(p.ss, s)) pg,
      (select avg(rest) from cpu where list_contains(p.ss, s)) rest
    from peak p`);
  const o = r.getRowObjects()[0];
  if (!o) {
    console.error(`${f}: no steady VU steps`);
    continue;
  }
  const n = (v: unknown) => (v == null ? null : Number(v));
  rows.push({ run, bVus: n(o.b_vus), bRps: n(o.b_rps), vus: n(o.vus)!, rps: n(o.rps)!, p95: n(o.p95)!, p99: n(o.p99)!, failed: n(o.failed)!, total: n(o.total)!, srv: n(o.srv), pg: n(o.pg), rest: n(o.rest) });
}

rows.sort((a, b) => b.rps - a.rps);
const fmt = (x: number) => Math.round(x).toLocaleString('en-US');
// % of one core → µs per request
const us = (pct: number | null, rps: number) => (pct == null ? '-' : String(Math.round((pct * 1e4) / rps)));
console.log(`| run | peak rps | at VUs | p95 / p99 at peak | rps within p95 ≤ ${budget} ms (at VUs) | CPU µs per request: server / Postgres / rest = total | failed |`);
console.log('|---|---|---|---|---|---|---|');
for (const x of rows) {
  const cpu = x.srv == null ? '-' : `${us(x.srv, x.rps)} / ${us(x.pg, x.rps)} / ${us(x.rest, x.rps)} = ${us(x.srv + x.pg! + x.rest!, x.rps)}`;
  console.log(`| ${x.run} | **${fmt(x.rps)}** | ${fmt(x.vus)} | ${x.p95.toFixed(1)} / ${x.p99.toFixed(1)} ms | ${x.bRps == null ? '-' : `${fmt(x.bRps)} (${fmt(x.bVus!)})`} | ${cpu} | ${x.failed ? `${fmt(x.failed)} of ${fmt(x.total)}` : 0} |`);
}
