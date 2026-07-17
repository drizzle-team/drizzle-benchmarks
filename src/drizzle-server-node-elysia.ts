
import { Elysia } from 'elysia';
import cluster from 'cluster';
import 'dotenv/config';
import { asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres';
import os from 'os';
import {createPool} from 'minipg';
import { relations } from './relations';
import { details, orders } from './schema';

console.log(process.env.DATABASE_URL);

const pool = createPool({ url: process.env.DATABASE_URL!, max: 10 });
const db = drizzle({ client: pool, relations });

const p1 = db.query.customers
  .findMany({
    limit: sql.placeholder('limit'),
    offset: sql.placeholder('offset'),
    orderBy: {
      id: 'asc',
    },
  })
  .prepare();

const p2 = db.query.customers
  .findFirst({
    where: {
      id: sql.placeholder('id'),
    },
  })
  .prepare();

const p3 = db.query.customers
  .findMany({
    where: {
      RAW:(customers)=> sql`to_tsvector('english', ${customers.companyName}) @@ to_tsquery('english', ${sql.placeholder('term')})`,
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
  .prepare();

const p5 = db.query.employees
  .findMany({
    with: {
      recipient: true,
    },
    where: {
      id: sql.placeholder('id'),
    },
  })
  .prepare();

const p6 = db.query.suppliers
  .findMany({
    limit: sql.placeholder('limit'),
    offset: sql.placeholder('offset'),
    orderBy: {
      id: 'asc',
    },
  })
  .prepare();

const p7 = db.query.suppliers
  .findFirst({
    where: {
      id: sql.placeholder('id'),
    },
  })
  .prepare();

const p8 = db.query.products
  .findMany({
    limit: sql.placeholder('limit'),
    offset: sql.placeholder('offset'),
    orderBy: {
      id: 'asc',
    },
  })
  .prepare();

const p9 = db.query.products
  .findMany({
    where: {
      id: sql.placeholder('id'),
    },
    with: {
      supplier: true,
    },
  })
  .prepare();

const p10 = db.query.products
  .findMany({
    where: {
      RAW:(products)=> sql`to_tsvector('english', ${products.name}) @@ to_tsquery('english', ${sql.placeholder('term')})`,
    },
  })
  .prepare();

const p11 = db
  .select({
    id: orders.id,
    shippedDate: orders.shippedDate,
    shipName: orders.shipName,
    shipCity: orders.shipCity,
    shipCountry: orders.shipCountry,
    productsCount: sql<number>`count(${details.productId})::int`,
    quantitySum: sql<number>`sum(${details.quantity})::int`,
    totalPrice: sql<number>`sum(${details.quantity} * ${details.unitPrice})`,
  })
  .from(orders)
  .leftJoin(details, eq(details.orderId, orders.id))
  .groupBy(orders.id)
  .orderBy(asc(orders.id))
  .limit(sql.placeholder('limit'))
  .offset(sql.placeholder('offset'))
  .prepare();

const p12 = db
  .select({
    id: orders.id,
    shippedDate: orders.shippedDate,
    shipName: orders.shipName,
    shipCity: orders.shipCity,
    shipCountry: orders.shipCountry,
    productsCount: sql<number>`count(${details.productId})::int`,
    quantitySum: sql<number>`sum(${details.quantity})::int`,
    totalPrice: sql<number>`sum(${details.quantity} * ${details.unitPrice})`,
  })
  .from(orders)
  .leftJoin(details, eq(details.orderId, orders.id))
  .where(eq(orders.id, sql.placeholder('id')))
  .groupBy(orders.id)
  .orderBy(asc(orders.id))
  .prepare();

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
    },
  })
  .prepare();

interface CpuUsage {
  usage: number;
  total: number;
}

let cpuTemp: CpuUsage[] = [];

const app = new Elysia()
  .get('/stats', () => {
    const cpus = os.cpus();
    const cpuUsage = cpus.map((cpu) => {
      const { user, nice, sys, irq, idle } = cpu.times;
      const total = user + nice + sys + irq + idle;
      const usage = user + nice + sys + irq;
      return { usage, total };
    });

    let result: number[] = [];
    if (cpuTemp.length > 0) {
      result = cpuUsage.map((cpu, index) => {
        const usageDiff = cpu.usage - cpuTemp[index].usage;
        const totalDiff = cpu.total - cpuTemp[index].total;
        return parseInt(((100 * usageDiff) / totalDiff).toFixed());
      });
    }
    cpuTemp = cpuUsage;

    return result;
  })
  .get('/customers', ({ query }) => {
    const limit = Number(query.limit);
    const offset = Number(query.offset);
    return p1.execute({ limit, offset });
  })
  .get('/customer-by-id', ({ query }) => p2.execute({ id: query.id }))
  .get('/search-customer', ({ query }) => {
    const term = `${query.term}:*`;
    return p3.execute({ term });
  })
  .get('/employees', ({ query }) => {
    const limit = Number(query.limit);
    const offset = Number(query.offset);
    return p4.execute({ limit, offset });
  })
  .get('/employee-with-recipient', ({ query }) => p5.execute({ id: query.id }))
  .get('/suppliers', ({ query }) => {
    const limit = Number(query.limit);
    const offset = Number(query.offset);
    return p6.execute({ limit, offset });
  })
  .get('/supplier-by-id', ({ query }) => p7.execute({ id: query.id }))
  .get('/products', ({ query }) => {
    const limit = Number(query.limit);
    const offset = Number(query.offset);
    return p8.execute({ limit, offset });
  })
  .get('/product-with-supplier', ({ query }) => p9.execute({ id: query.id }))
  .get('/search-product', ({ query }) => {
    const term = `${query.term}:*`;
    return p10.execute({ term });
  })
  .get('/orders-with-details', ({ query }) => {
    const limit = Number(query.limit);
    const offset = Number(query.offset);
    return p11.execute({ limit, offset });
  })
  .get('/order-with-details', ({ query }) => p12.execute({ id: query.id }))
  .get('/order-with-details-and-products', ({ query }) => p13.execute({ id: query.id }));

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);
  for (let i = 0; i < os.cpus().length; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker) => {
    console.log(`worker ${worker.process.pid} died`);
  });
} else {
  app.listen({ port: 3000, reusePort: true });
  console.log(`Worker ${process.pid} started`);
}
