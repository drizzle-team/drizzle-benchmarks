// Drizzle ORM on Effect 4, Node + Hono, port 3005. DRIVER=effect (default) | drizzle, see ./effect-db.ts
import { serve } from '@hono/node-server';
import cluster from 'cluster';
import os from 'os';
import { driver, serverWorkers } from './effect-db.ts';

const numCPUs = serverWorkers(os.cpus().length);

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);
  for (let i = 0; i < numCPUs; i++) cluster.fork();
  cluster.on('exit', (worker) => console.log(`worker ${worker.process.pid} died`));
} else {
  // the app builds its SqlClient at import, so only the workers load it
  const { default: app } = await import('./effect-app.ts');
  serve({ fetch: app.fetch, port: 3005 });
  console.log(`Worker ${process.pid} started (effect, driver: ${driver})`);
}
