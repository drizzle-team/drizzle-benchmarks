// Build the data.json for orm.drizzle.team/benchmarks from finished runs: per-second rows per run, in the
// site's format (core1..core4, reqs_per_sec, fail_reqs_per_sec, latency_*), plus `vus`. The per-second
// monitor metrics prepare() also returns (proc.*, temp.*) are left out, they're not charted.
//
//   bun scripts/site-data.ts                                   # results/*.parquet → data.json
//   bun scripts/site-data.ts --out site.json results results-kysely --exclude 'kysely-*-drizzle-*'
//   bun viewer/serve.ts data.json                              # check it in the chart component
//
// Sources are folders of <run>.parquet. --exclude takes run-name globs (repeatable).
import { Glob } from 'bun';
import fs from 'node:fs';
import path from 'node:path';
import { prepare } from '../bunload/src';

const args = process.argv.slice(2);
let out = 'data.json';
const excludes: Glob[] = [];
const folders: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') out = args[++i];
  else if (args[i] === '--exclude') excludes.push(new Glob(args[++i]));
  else folders.push(args[i]);
}
if (folders.length === 0) folders.push('results');

const round = (v: number | null | undefined, d = 2) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

const data: Record<string, unknown[]> = {};
for (const folder of folders) {
  const names = fs
    .readdirSync(folder)
    .filter((f) => f.endsWith('.parquet') && !f.startsWith('metrics-') && !f.startsWith('cpu-usage-'))
    .map((f) => f.slice(0, -'.parquet'.length))
    .filter((n) => !excludes.some((g) => g.match(n)));
  const runs = await prepare({ folder, names });
  for (const [name, rows] of Object.entries(runs)) {
    if (data[name]) throw new Error(`run ${name} is in more than one folder`);
    data[name] = rows.map((r) => ({
      time: r.time,
      core1: round(r.core1, 1),
      core2: round(r.core2, 1),
      core3: round(r.core3, 1),
      core4: round(r.core4, 1),
      reqs_per_sec: r.reqs_per_sec,
      fail_reqs_per_sec: r.fail_reqs_per_sec,
      latency_95: round(r.latency_95),
      latency_90: round(r.latency_90),
      latency_99: round(r.latency_99),
      latency_average: round(r.latency_average),
      vus: r.vus,
    }));
  }
}

fs.writeFileSync(out, JSON.stringify(data));
const size = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`${out}: ${Object.keys(data).length} runs, ${size} MB`);
for (const [name, rows] of Object.entries(data)) console.log(`  ${name.padEnd(36)} ${rows.length} s`);
console.log(`check it: bun viewer/serve.ts ${path.relative(process.cwd(), path.resolve(out))}`);
