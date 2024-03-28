import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const app = new Hono();
app.get("/customers", async (c) => {
  const limit = Number(c.req.query("limit"));
  const offset = Number(c.req.query("offset"));

  const result = await prisma.customer.findMany({
    take: limit,
    skip: offset,
  });

  return c.json(result);
});

app.get("/customer-by-id", async (c) => {
  const result = await prisma.customer.findFirst({
    where: {
      id: Number(c.req.query("id")!),
    },
  });
  return c.json(result);
});

app.get("/search-customer", async (c) => {
  const term = `${c.req.query("term")}:*`;
  const result = await prisma.$queryRaw`select * from "customers" where to_tsvector('english', "customers"."companyName") @@ to_tsquery('english', ${term});`;


  return c.json(result);
});

app.get("/employees", async (c) => {
  const limit = Number(c.req.query("limit"));
  const offset = Number(c.req.query("offset"));

  const result = await prisma.employee.findMany({
    take: limit,
    skip: offset,
  });
  return c.json(result);
});

app.get("/employee-with-recipient", async (c) => {
  const result = await prisma.employee.findUnique({
    where: {
      id: Number(c.req.query("id")!),
    },
    include: {
      recipient: true,
    },
  });
  return c.json([result]);
});

app.get("/suppliers", async (c) => {
  const limit = Number(c.req.query("limit"));
  const offset = Number(c.req.query("offset"));

  const result = await prisma.supplier.findMany({
    take: limit,
    skip: offset,
  });
  return c.json(result);
});

app.get("/supplier-by-id", async (c) => {
  const result = await prisma.supplier.findUnique({
    where: {
      id: Number(c.req.query("id")!),
    },
  });
  return c.json(result);
});

app.get("/products", async (c) => {
  const limit = Number(c.req.query("limit"));
  const offset = Number(c.req.query("offset"));

  const result = await prisma.product.findMany({
    take: limit,
    skip: offset,
  });
  return c.json(result);
});

app.get("/product-with-supplier", async (c) => {
  const result = await prisma.product.findUnique({
    where: {
      id: Number(c.req.query("id")!),
    },
    include: {
      supplier: true,
    },
  });
  return c.json([result]);
});

app.get("/search-product", async (c) => {
  const term = `${c.req.query("term")}:*`;
  const result = await prisma.$queryRaw`select * from "products" where to_tsvector('english', "products"."name") @@ to_tsquery('english', ${term});`;

  return c.json(result);
});

app.get("/orders-with-details", async (c) => {
  const limit = Number(c.req.query("limit"));
  const offset = Number(c.req.query("offset"));

  const res = await prisma.order.findMany({
    include: {
      details: true,
    },
    take: limit,
    skip: offset,
    orderBy: {
      id: "asc",
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
      quantitySum: item.details.reduce(
        (sum, deteil) => (sum += +deteil.quantity),
        0
      ),
      totalPrice: item.details.reduce(
        (sum, deteil) => (sum += +deteil.quantity * +deteil.unitPrice),
        0
      ),
    };
  });
  return c.json(result);
});

app.get("/order-with-details", async (c) => {
  const res = await prisma.order.findMany({
    include: {
      details: true,
    },
    where: {
      id: Number(c.req.query("id")!),
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
      quantitySum: item.details.reduce(
        (sum, detail) => (sum += detail.quantity),
        0
      ),
      totalPrice: item.details.reduce(
        (sum, detail) => (sum += detail.quantity * detail.unitPrice),
        0
      ),
    };
  });

  return c.json(result);
});

app.get("/order-with-details-and-products", async (c) => {
  const result = await prisma.order.findMany({
    where: {
      id: Number(c.req.query("id")!),
    },
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

serve({
  fetch: app.fetch,
  port: 3001,
});
