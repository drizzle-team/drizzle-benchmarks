import { Elysia } from 'elysia';
import { drizzle } from 'drizzle-orm/bun-sql';
import { relations } from './relations';
import { eq, sql, asc } from 'drizzle-orm';
import { customers, details, orders, products } from './schema';
import 'dotenv/config';
import cluster from 'cluster';
import os from 'os';

// const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, min: 10, max: 10 });
// const client = new Bun.SQL(process.env.DATABASE_URL!, { max: 20});
const db = drizzle({ connection:{
  url: process.env.DATABASE_URL!,
}, relations, logger: false, jit: true });

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
      RAW:(c)=> sql`to_tsvector('english', ${c.companyName}) @@ to_tsquery('english', ${sql.placeholder('term')})`,
    },
  })
  .prepare();

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
      RAW:(p)=> sql`to_tsvector('english', ${p.name}) @@ to_tsquery('english', ${sql.placeholder('term')})`,
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
  for (let i = 0; i < 4; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker) => {
    console.log(`worker ${worker.process.pid} died`);
  });
} else {
  app.listen({ port: 3000, reusePort: true });
  console.log(`Worker ${process.pid} started`);
}
