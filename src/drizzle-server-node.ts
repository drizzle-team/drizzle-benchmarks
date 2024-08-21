import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import pg from "pg";
import { eq, sql, asc } from "drizzle-orm";
import cpuUsage from "./cpu-usage";
import {
  customers,
  details,
  employees,
  orders,
  products,
  suppliers,
} from "./schema";
import "dotenv/config";
import cluster from 'cluster';
import os from "os"

const numCPUs = os.cpus().length;

const pool = new pg.native.Pool({ connectionString: process.env.DATABASE_URL, max: 8, min: 8 });
const db = drizzle(pool, { schema, logger: false });

const p1 = db.query.customers
  .findMany({
    limit: sql.placeholder("limit"),
    offset: sql.placeholder("offset"),
    orderBy: customers.id,
  })
  .prepare("p1");

const p2 = db.query.customers
  .findFirst({
    where: eq(customers.id, sql.placeholder("id")),
  })
  .prepare("p2");

const p3 = db.query.customers
  .findMany({
    where: sql`to_tsvector('english', ${customers.companyName
      }) @@ to_tsquery('english', ${sql.placeholder("term")})`,
  })
  .prepare("p3");

const p4 = db.query.employees
  .findMany({
    limit: sql.placeholder("limit"),
    offset: sql.placeholder("offset"),
    orderBy: employees.id,
  })
  .prepare("p4");

const p5 = db.query.employees
  .findMany({
    with: {
      recipient: true,
    },
    where: eq(employees.id, sql.placeholder("id")),
  })
  .prepare("p5");

const p6 = db.query.suppliers
  .findMany({
    limit: sql.placeholder("limit"),
    offset: sql.placeholder("offset"),
    orderBy: suppliers.id,
  })
  .prepare("p6");

const p7 = db.query.suppliers
  .findFirst({
    where: eq(suppliers.id, sql.placeholder("id")),
  })
  .prepare("p7");

const p8 = db.query.products
  .findMany({
    limit: sql.placeholder("limit"),
    offset: sql.placeholder("offset"),
    orderBy: products.id,
  })
  .prepare("p8");

const p9 = db.query.products
  .findMany({
    where: eq(products.id, sql.placeholder("id")),
    with: {
      supplier: true,
    },
  })
  .prepare("p9");

const p10 = db.query.products
  .findMany({
    where: sql`to_tsvector('english', ${products.name
      }) @@ to_tsquery('english', ${sql.placeholder("term")})`,
  })
  .prepare("p10");

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
  .limit(sql.placeholder("limit"))
  .offset(sql.placeholder("offset"))
  .prepare("p11");

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
  .where(eq(orders.id, sql.placeholder("id")))
  .groupBy(orders.id)
  .orderBy(asc(orders.id))
  .prepare("p12");

const p13 = db.query.orders
  .findMany({
    with: {
      details: {
        with: {
          product: true,
        },
      },
    },
    where: eq(orders.id, sql.placeholder("id")),
  })
  .prepare("p13");

const app = new Hono();
app.route('', cpuUsage);
app.get("/customers", async (c) => {
  const limit = Number(c.req.query("limit"));
  const offset = Number(c.req.query("offset"));
  const result = await p1.execute({ limit, offset });
  return c.json(result);
});

app.get("/customer-by-id", async (c) => {
  const result = await p2.execute({ id: c.req.query("id") });
  return c.json(result);
});

app.get("/search-customer", async (c) => {
  // const term = `%${c.req.query("term")}%`;
  const term = `${c.req.query("term")}:*`;
  const result = await p3.execute({ term });
  return c.json(result);
});

app.get("/employees", async (c) => {
  const limit = Number(c.req.query("limit"));
  const offset = Number(c.req.query("offset"));
  const result = await p4.execute({ limit, offset });
  return c.json(result);
});

app.get("/employee-with-recipient", async (c) => {
  const result = await p5.execute({ id: c.req.query("id") });
  return c.json(result);
});

app.get("/suppliers", async (c) => {
  const limit = Number(c.req.query("limit"));
  const offset = Number(c.req.query("offset"));

  const result = await p6.execute({ limit, offset });
  return c.json(result);
});

app.get("/supplier-by-id", async (c) => {
  const result = await p7.execute({ id: c.req.query("id") });
  return c.json(result);
});

app.get("/products", async (c) => {
  const limit = Number(c.req.query("limit"));
  const offset = Number(c.req.query("offset"));

  const result = await p8.execute({ limit, offset });
  return c.json(result);
});

app.get("/product-with-supplier", async (c) => {
  const result = await p9.execute({ id: c.req.query("id") });
  return c.json(result);
});

app.get("/search-product", async (c) => {
  // const term = `%${c.req.query("term")}%`;
  const term = `${c.req.query("term")}:*`;
  const result = await p10.execute({ term });
  return c.json(result);
});

app.get("/orders-with-details", async (c) => {
  const limit = Number(c.req.query("limit"));
  const offset = Number(c.req.query("offset"));

  const result = await p11.execute({ limit, offset });
  return c.json(result);
});

app.get("/order-with-details", async (c) => {
  const result = await p12.execute({ id: c.req.query("id") });
  return c.json(result);
});

app.get("/order-with-details-and-products", async (c) => {
  const result = await p13.execute({ id: c.req.query("id") });
  return c.json(result);
});

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);

  //Fork workers
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker) => {
    console.log(`worker ${worker.process.pid} died`);
  })
} else {
  serve({
    fetch: app.fetch,
    port: 3000,
  });
  console.log(`Worker ${process.pid} started`);
}
