import { createDb, driver, serverWorkers } from './drizzle-db.ts';
import * as schema from './schema.ts';
import { eq, sql, asc } from 'drizzle-orm';
import { customers, details, employees, orders, products, suppliers } from './schema.ts';
import 'dotenv/config';
import cluster from 'cluster';
import os from 'os';
import { cpuStats, procStats } from './cpu-usage.ts';

const numCPUs = serverWorkers(os.cpus().length);

// DRIVER=bun (default) | drizzle | pg — see ./drizzle-db.ts
const db = createDb();

const p1 = db.query.customers
  .findMany({
    limit: sql.placeholder('limit'),
    offset: sql.placeholder('offset'),
    orderBy: {
      id: 'asc',
    },
  })
  .prepare('p1');

const p2 = db.query.customers
  .findFirst({
    where: {
      id: sql.placeholder('id'),
    },
  })
  .prepare('p2');

const p3 = db.query.customers
  .findMany({
    where: {
      RAW:(c) => sql`to_tsvector('english', ${c.companyName}) @@ to_tsquery('english', ${sql.placeholder('term')})`,
    },
  })
  .prepare('p3');

const p4 = db.query.employees
  .findMany({
    limit: sql.placeholder('limit'),
    offset: sql.placeholder('offset'),
    orderBy: {
      id: 'asc',
    },
  })
  .prepare('p4');

const p5 = db.query.employees
  .findMany({
    with: {
      recipient: true,
    },
    where: {
      id: sql.placeholder('id'),
    },
  })
  .prepare('p5');

const p6 = db.query.suppliers
  .findMany({
    limit: sql.placeholder('limit'),
    offset: sql.placeholder('offset'),
    orderBy: {
      id: 'asc',
    },
  })
  .prepare('p6');

const p7 = db.query.suppliers
  .findFirst({
    where: {
      id: sql.placeholder('id'),
    },
  })
  .prepare('p7');

const p8 = db.query.products
  .findMany({
    limit: sql.placeholder('limit'),
    offset: sql.placeholder('offset'),
    orderBy: {
      id: 'asc',
    },
  })
  .prepare('p8');

const p9 = db.query.products
  .findMany({
    where: {
      id: sql.placeholder('id'),
    },
    with: {
      supplier: true,
    },
  })
  .prepare('p9');

const p10 = db.query.products
  .findMany({
    where: {
      RAW:(p)=> sql`to_tsvector('english', ${p.name}) @@ to_tsquery('english', ${sql.placeholder('term')})`,
    },
  })
  .prepare('p10');

const p11 = db
  .select({
    id: orders.id,
    shippedDate: orders.shippedDate,
    shipName: orders.shipName,
    shipCity: orders.shipCity,
    shipCountry: orders.shipCountry,
    productsCount: sql<number>`count(${details.productId})::int`,
    quantitySum: sql<number>`sum(${details.quantity})::int`,
    totalPrice: sql<number>`sum(${details.quantity} * ${details.unitPrice})::real`,
  })
  .from(orders)
  .leftJoin(details, eq(details.orderId, orders.id))
  .groupBy(orders.id)
  .orderBy(asc(orders.id))
  .limit(sql.placeholder('limit'))
  .offset(sql.placeholder('offset'))
  .prepare('p11');

const p12 = db
  .select({
    id: orders.id,
    shippedDate: orders.shippedDate,
    shipName: orders.shipName,
    shipCity: orders.shipCity,
    shipCountry: orders.shipCountry,
    productsCount: sql<number>`count(${details.productId})::int`,
    quantitySum: sql<number>`sum(${details.quantity})::int`,
    totalPrice: sql<number>`sum(${details.quantity} * ${details.unitPrice})::real`,
  })
  .from(orders)
  .leftJoin(details, eq(details.orderId, orders.id))
  .where(eq(orders.id, sql.placeholder('id')))
  .groupBy(orders.id)
  .orderBy(asc(orders.id))
  .prepare('p12');

const p13 = db.query.orders
  .findMany({
    with: {
      details: {
        with: {
          product: true,
        },
      },
    },
    where: {
      id: sql.placeholder('id'),
    }
  })
  .prepare('p13');


// Same queries as drizzle-server-bun.ts (DRIVER / WORKERS / POOL_MAX apply), served by Elysia
// instead of Hono, to compare framework overhead on Bun. ELYSIA=2 runs Elysia 2.0 (the `elysia2` alias,
// 2.0.0-rc.4) instead of 1.4.
const elysiaVersion = process.env.ELYSIA === '2' ? '2' : '1.4';
const { Elysia } = (await import(elysiaVersion === '2' ? 'elysia2' : 'elysia')) as typeof import('elysia');
const app = new Elysia()
  .get('/stats', () => cpuStats())
  .get('/stats/procs', () => procStats())
  .get('/customers', ({ query }) => p1.execute({ limit: Number(query.limit), offset: Number(query.offset) }))
  .get('/customer-by-id', ({ query }) => p2.execute({ id: query.id }))
  .get('/search-customer', ({ query }) => p3.execute({ term: `${query.term}:*` }))
  .get('/employees', ({ query }) => p4.execute({ limit: Number(query.limit), offset: Number(query.offset) }))
  .get('/employee-with-recipient', ({ query }) => p5.execute({ id: query.id }))
  .get('/suppliers', ({ query }) => p6.execute({ limit: Number(query.limit), offset: Number(query.offset) }))
  .get('/supplier-by-id', ({ query }) => p7.execute({ id: query.id }))
  .get('/products', ({ query }) => p8.execute({ limit: Number(query.limit), offset: Number(query.offset) }))
  .get('/product-with-supplier', ({ query }) => p9.execute({ id: query.id }))
  .get('/search-product', ({ query }) => p10.execute({ term: `${query.term}:*` }))
  .get('/orders-with-details', ({ query }) => p11.execute({ limit: Number(query.limit), offset: Number(query.offset) }))
  .get('/order-with-details', ({ query }) => p12.execute({ id: query.id }))
  .get('/order-with-details-and-products', ({ query }) => p13.execute({ id: query.id }));

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker) => {
    console.log(`worker ${worker.process.pid} died`);
  });
} else {
  app.listen({ port: 3000, reusePort: true });
  console.log(`Worker ${process.pid} started (elysia ${elysiaVersion}, driver: ${driver})`);
}
