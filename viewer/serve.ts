// Local benchmark viewer — the chart renderer from orm.drizzle.team/benchmarks over your own runs.
//
//   bun viewer/serve.ts                       # results/ (parquet from bunload or the old k6 flow's prepare)
//   bun viewer/serve.ts results old/data.json # mix folders of parquet and prepared data.json files
//
// Folders are read with prepare() on every request, so reloading the page picks up new runs.
import fs from 'node:fs';
import path from 'node:path';
import { prepare } from '../bunload/src';
import index from './index.html';

const sources = (process.argv.slice(2).length ? process.argv.slice(2) : ['results']).map((s) => path.resolve(s));
const port = Number(process.env.PORT ?? 4321);

async function loadRuns() {
  const runs: Record<string, unknown[]> = {};
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    if (fs.statSync(src).isDirectory()) {
      const hasParquet = fs
        .readdirSync(src)
        .some((f) => f.endsWith('.parquet') && !f.startsWith('metrics-') && !f.startsWith('cpu-usage-'));
      if (hasParquet) Object.assign(runs, await prepare({ folder: src }));
    } else if (src.endsWith('.json')) {
      Object.assign(runs, await Bun.file(src).json()); // a data.json exported from /api/runs, or the docs site's data.json
    }
  }
  return runs;
}

const options = {
  // production bundling: Bun 1.3.14's dev/HMR bundler leaves CSS-module imports undefined
  // ("import_ControlPanel_module is not defined"); the regular bundler handles them fine
  development: false,
  routes: {
    '/': index,
    '/api/runs': async () => {
      try {
        return Response.json(await loadRuns());
      } catch (e) {
        return new Response(e instanceof Error ? e.message : String(e), { status: 500 });
      }
    },
  },
};

// fall back to a free port if the preferred one is taken (e.g. another viewer is running)
let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({ ...options, port });
} catch (e) {
  if ((e as { code?: string }).code !== 'EADDRINUSE') throw e;
  server = Bun.serve({ ...options, port: 0 });
  console.log(`port ${port} is in use, using ${server.port} instead`);
}

console.log(`bench viewer → ${server.url}  (sources: ${sources.map((s) => path.relative(process.cwd(), s) || '.').join(', ')})`);
