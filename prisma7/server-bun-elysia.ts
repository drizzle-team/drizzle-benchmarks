import { Elysia } from 'elysia';
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import cluster from 'cluster';
import os from 'os';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

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
    return prisma.customer.findMany({
      take: limit,
      skip: offset,
    });
  })
  .get('/customer-by-id', ({ query }) =>
    prisma.customer.findFirst({
      where: {
        id: Number(query.id!),
      },
    })
  )
  .get('/search-customer', ({ query }) =>
    prisma.customer.findMany({
      where: {
        companyName: {
          search: `${query.term}:*`,
        },
      },
    })
  )
  .get('/employees', ({ query }) => {
    const limit = Number(query.limit);
    const offset = Number(query.offset);
    return prisma.employee.findMany({
      take: limit,
      skip: offset,
    });
  })
  .get('/employee-with-recipient', async ({ query }) => {
    const result = await prisma.employee.findUnique({
      where: {
        id: Number(query.id!),
      },
      include: {
        recipient: true,
      },
    });
    return [result];
  })
  .get('/suppliers', ({ query }) => {
    const limit = Number(query.limit);
    const offset = Number(query.offset);
    return prisma.supplier.findMany({
      take: limit,
      skip: offset,
    });
  })
  .get('/supplier-by-id', ({ query }) =>
    prisma.supplier.findUnique({
      where: {
        id: Number(query.id!),
      },
    })
  )
  .get('/products', ({ query }) => {
    const limit = Number(query.limit);
    const offset = Number(query.offset);
    return prisma.product.findMany({
      take: limit,
      skip: offset,
    });
  })
  .get('/product-with-supplier', async ({ query }) => {
    const result = await prisma.product.findUnique({
      where: {
        id: Number(query.id!),
      },
      include: {
        supplier: true,
      },
    });
    return [result];
  })
  .get('/search-product', ({ query }) =>
    prisma.product.findMany({
      where: {
        name: {
          search: `${query.term}:*`,
        },
      },
    })
  )
  .get('/orders-with-details', async ({ query }) => {
    const limit = Number(query.limit);
    const offset = Number(query.offset);

    const res = await prisma.order.findMany({
      include: {
        details: true,
      },
      take: limit,
      skip: offset,
      orderBy: {
        id: 'asc',
      },
    });

    return res.map((item) => ({
      id: item.id,
      shippedDate: item.shippedDate,
      shipName: item.shipName,
      shipCity: item.shipCity,
      shipCountry: item.shipCountry,
      productsCount: item.details.length,
      quantitySum: item.details.reduce((sum, deteil) => (sum += +deteil.quantity), 0),
      totalPrice: item.details.reduce((sum, deteil) => (sum += +deteil.quantity * +deteil.unitPrice), 0),
    }));
  })
  .get('/order-with-details', async ({ query }) => {
    const res = await prisma.order.findMany({
      include: {
        details: true,
      },
      where: {
        id: Number(query.id!),
      },
    });

    return res.map((item) => ({
      id: item.id,
      shippedDate: item.shippedDate,
      shipName: item.shipName,
      shipCity: item.shipCity,
      shipCountry: item.shipCountry,
      productsCount: item.details.length,
      quantitySum: item.details.reduce((sum, detail) => (sum += detail.quantity), 0),
      totalPrice: item.details.reduce((sum, detail) => (sum += detail.quantity * detail.unitPrice), 0),
    }));
  })
  .get('/order-with-details-and-products', ({ query }) =>
    prisma.order.findMany({
      where: {
        id: Number(query.id!),
      },
      include: {
        details: {
          include: {
            product: true,
          },
        },
      },
    })
  );

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);
  for (let i = 0; i < 2; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker) => {
    console.log(`worker ${worker.process.pid} died`);
  });
} else {
  app.listen({ port: 3001, reusePort: true });
  console.log(`Worker ${process.pid} started`);
}
