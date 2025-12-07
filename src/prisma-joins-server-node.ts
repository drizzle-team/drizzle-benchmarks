import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import cpuUsage from './cpu-usage';

import cluster from 'cluster';
import os from 'os';
const numCPUs = os.cpus().length;

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

const app = new Hono();
app.route('', cpuUsage);
app.get('/customers', async (c) => {
  const limit = Number(c.req.query('limit'));
  const offset = Number(c.req.query('offset'));

  const result = await prisma.customer.findMany({
    take: limit,
    skip: offset,
  });

  return c.json(result);
});

app.get('/customer-by-id', async (c) => {
  const result = await prisma.customer.findFirst({
    where: {
      id: Number(c.req.query('id')!),
    },
  });
  return c.json(result);
});

app.get('/search-customer', async (c) => {
  const result = await prisma.customer.findMany({
    where: {
      companyName: {
        search: `${c.req.query('term')}:*`,
      },
    },
  });

  return c.json(result);
});

app.get('/employees', async (c) => {
  const limit = Number(c.req.query('limit'));
  const offset = Number(c.req.query('offset'));

  const result = await prisma.employee.findMany({
    take: limit,
    skip: offset,
  });
  return c.json(result);
});

app.get('/employee-with-recipient', async (c) => {
  const result = await prisma.employee.findUnique({
    where: {
      id: Number(c.req.query('id')!),
    },
    relationLoadStrategy: 'join',
    include: {
      recipient: true,
    },
  });
  return c.json([result]);
});

app.get('/suppliers', async (c) => {
  const limit = Number(c.req.query('limit'));
  const offset = Number(c.req.query('offset'));

  const result = await prisma.supplier.findMany({
    take: limit,
    skip: offset,
  });
  return c.json(result);
});

app.get('/supplier-by-id', async (c) => {
  const result = await prisma.supplier.findUnique({
    where: {
      id: Number(c.req.query('id')!),
    },
  });
  return c.json(result);
});

app.get('/products', async (c) => {
  const limit = Number(c.req.query('limit'));
  const offset = Number(c.req.query('offset'));

  const result = await prisma.product.findMany({
    take: limit,
    skip: offset,
  });
  return c.json(result);
});

app.get('/product-with-supplier', async (c) => {
  const result = await prisma.product.findUnique({
    where: {
      id: Number(c.req.query('id')!),
    },
    relationLoadStrategy: 'join',
    include: {
      supplier: true,
    },
  });
  return c.json([result]);
});

app.get('/search-product', async (c) => {
  const result = await prisma.product.findMany({
    where: {
      name: {
        search: `${c.req.query('term')}:*`,
      },
    },
  });

  return c.json(result);
});

app.get('/orders-with-details', async (c) => {
  const limit = Number(c.req.query('limit'));
  const offset = Number(c.req.query('offset'));

  const res = await prisma.order.findMany({
    relationLoadStrategy: 'join',
    include: {
      details: true,
    },
    take: limit,
    skip: offset,
    orderBy: {
      id: 'asc',
    },
  });

  const result = res.map((item) => {
    return {
      id: item.id,
      shippedDate: item.shippedDate,
      shipName: item.shipName,
      shipCity: item.shipCity,
      shipCountry: item.shipCountry,
      productsCount: item.details.length,
      quantitySum: item.details.reduce((sum, deteil) => (sum += +deteil.quantity), 0),
      totalPrice: item.details.reduce((sum, deteil) => (sum += +deteil.quantity * +deteil.unitPrice), 0),
    };
  });
  return c.json(result);
});

app.get('/order-with-details', async (c) => {
  const res = await prisma.order.findMany({
    relationLoadStrategy: 'join',
    include: {
      details: true,
    },
    where: {
      id: Number(c.req.query('id')!),
    },
  });

  const result = res.map((item) => {
    return {
      id: item.id,
      shippedDate: item.shippedDate,
      shipName: item.shipName,
      shipCity: item.shipCity,
      shipCountry: item.shipCountry,
      productsCount: item.details.length,
      quantitySum: item.details.reduce((sum, detail) => (sum += detail.quantity), 0),
      totalPrice: item.details.reduce((sum, detail) => (sum += detail.quantity * detail.unitPrice), 0),
    };
  });

  return c.json(result);
});

app.get('/order-with-details-and-products', async (c) => {
  const result = await prisma.order.findMany({
    where: {
      id: Number(c.req.query('id')!),
    },
    relationLoadStrategy: 'join',
    include: {
      details: {
        include: {
          product: true,
        },
      },
    },
  });

  return c.json(result);
});

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);

  //Fork workers
  for (let i = 0; i < 2; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker) => {
    console.log(`worker ${worker.process.pid} died`);
  });
} else {
  serve({
    fetch: app.fetch,
    port: 3001,
  });

  console.log(`Worker ${process.pid} started`);
}
