// Kysely on Node + Hono, port 3004. DRIVER=drizzle (default) | pg, see ./kysely-db.ts
import { serve } from '@hono/node-server';
import cluster from 'cluster';
import os from 'os';
import app from './kysely-app.ts';
import { driver, serverWorkers } from './kysely-db.ts';

const numCPUs = serverWorkers(os.cpus().length);

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);
  for (let i = 0; i < numCPUs; i++) cluster.fork();
  cluster.on('exit', (worker) => console.log(`worker ${worker.process.pid} died`));
} else {
  serve({ fetch: app.fetch, port: 3004 });
  console.log(`Worker ${process.pid} started (kysely, driver: ${driver})`);
}
