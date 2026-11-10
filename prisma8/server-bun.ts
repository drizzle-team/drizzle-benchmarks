// Prisma 8 on Bun + Hono:  bun prisma8/server-bun.ts   (port 3003, WORKERS default one per CPU core, like the Drizzle servers)
import 'dotenv/config';
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
  Bun.serve({ fetch: app.fetch, port, reusePort: true });
  console.log(`Worker ${process.pid} started on :${port} (driver: ${driver})`);
}
