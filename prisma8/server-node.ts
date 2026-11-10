// Prisma 8 on Node + Hono:  node prisma8/server-node.ts   (port 3003, WORKERS default one per CPU core, like the Drizzle servers)
import 'dotenv/config';
import { serve } from '@hono/node-server';
import cluster from 'cluster';
import os from 'os';
import { app } from './app.ts';
import { driver } from './db.ts';

const workers = Number(process.env.WORKERS ?? os.cpus().length);
const port = Number(process.env.PORT ?? 3003);

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running (Prisma 8, ${workers} workers)`);
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on('exit', (worker) => console.log(`worker ${worker.process.pid} died`));
} else {
  serve({ fetch: app.fetch, port });
  console.log(`Worker ${process.pid} started on :${port} (driver: ${driver})`);
}
