// Where the server machine's CPU goes, per VU step: the server under test vs Postgres vs Docker's
// docker-proxy vs kernel interrupts, and CPU µs per request for each. Needs a run made with
// `bun scripts/matrix.ts --cpu` (bench/index.ts --procs), which stores proc.* metric rows in the parquet.
//
//   bun scripts/cpu-split.ts results/drizzle-bun14-drizzle-ramp.parquet [more.parquet ...]
//
// Requests and CPU samples are both timestamped by the load machine, joined per wall-clock second. Only
// seconds entirely inside a VU step count (the ramps between steps are skipped); a CPU sample covers the
// second before its timestamp. Runs from before --procs kept their samples in results/<run>.cpu.jsonl
// (timestamped by the server machine); those are read instead when the parquet has no proc.* rows.
// DuckDB comes with bunload (cd bunload && bun install)
import { DuckDBInstance } from '../bunload/node_modules/@duckdb/node-api';
import { existsSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: bun scripts/cpu-split.ts results/<run>.parquet ...');
  process.exit(1);
}
const db = await (await DuckDBInstance.create(':memory:')).connect();
const num = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? null : Number(v)]));

for (const f of files) {
  const procRows = Number((await db.runAndReadAll(`select count(*) from '${f}' where metric like 'proc.%'`)).getRows()[0][0]);
  const jsonl = f.replace(/\.parquet$/, '.cpu.jsonl');
  let cpu: string;
  if (procRows > 0) {
    const m = (name: string) => `avg(value) filter (where metric = 'proc.${name}')`;
    cpu = `select floor(epoch(ts))::bigint s, ${m('server')} as "server", ${m('postgres')} postgres,
      coalesce(${m('docker-proxy')}, 0) dproxy, ${m('irq')} kirq, ${m('other')} other, ${m('idle')} idle
      from '${f}' where metric like 'proc.%' group by 1`;
  } else if (existsSync(jsonl)) {
    cpu = `select floor(ts)::bigint s, coalesce("server", 0) as "server", coalesce(postgres, 0) postgres,
      coalesce("docker-proxy", 0) dproxy, softirq + irq kirq, coalesce(other, 0) other, idle
      from read_json_auto('${jsonl}')`;
  } else {
    console.error(`${f}: no CPU samples; rerun it with bun scripts/matrix.ts --cpu`);
    continue;
  }
  const r = await db.runAndReadAll(`
    with req as (select epoch(ts)::bigint s, duration_ms, vus from '${f}' where metric is null),
    secs as (select s, max(vus) vus, min(vus) lo, count(*) n from req group by s),
    -- seconds that sit entirely inside one step: the VU count never changed during them
    stepsec as (select s, vus, n from secs where vus > 0 and lo = vus),
    cpu as (${cpu}),
    lat as (select vus, quantile_cont(duration_ms, 0.95) p95 from req where s in (select s from stepsec) group by vus),
    j as (select st.vus, st.n, c.* exclude (s) from stepsec st join cpu c on c.s = st.s + 1)
    select vus, count(*) secs, round(avg(n)) rps, round(any_value(lat.p95), 1) p95,
      round(avg("server")) as "server", round(avg(postgres)) postgres, round(avg(dproxy)) docker_proxy,
      round(avg(kirq)) kernel_irq, round(avg(other)) other, round(avg(idle)) idle,
      round(avg("server") * 1e4 / avg(n)) server_us, round(avg(postgres) * 1e4 / avg(n)) postgres_us,
      round(avg(dproxy + kirq + other) * 1e4 / avg(n)) rest_us,
      round(avg("server" + postgres + dproxy + kirq + other) * 1e4 / avg(n)) total_us
    from j join lat using (vus) group by vus order by vus`);
  console.log(`\n${f.split('/').pop()}: CPU in % of one core (400 = 4 cores), *_us = CPU µs per request`);
  console.table(r.getRowObjects().map(num));
}
