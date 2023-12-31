import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { Pool } from "pg";
import { eq, placeholder, sql, asc } from "drizzle-orm";
import {
  customers,
  details,
  employees,
  orders,
  products,
  suppliers,
} from "./schema";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8, min: 8 });
const db = drizzle(pool, { schema, logger: false });

const p1 = db.query.customers
  .findMany({
    limit: placeholder("limit"),
    offset: placeholder("offset"),
    orderBy: customers.id,
  })
  .prepare("p1");

const p2 = db.query.customers
  .findFirst({
    where: eq(customers.id, placeholder("id")),
  })
  .prepare("p2");

const p3 = db.query.customers
  .findMany({
    where: sql`to_tsvector('english', ${
      customers.companyName
    }) @@ to_tsquery('english', ${placeholder("term")})`,
  })
  .prepare("p3");

const p4 = db.query.employees
  .findMany({
    limit: placeholder("limit"),
    offset: placeholder("offset"),
    orderBy: employees.id,
  })
  .prepare("p4");

const p5 = db.query.employees
  .findMany({
    with: {
      recipient: true,
    },
    where: eq(employees.id, placeholder("id")),
  })
  .prepare("p5");

const p6 = db.query.suppliers
  .findMany({
    limit: placeholder("limit"),
    offset: placeholder("offset"),
    orderBy: suppliers.id,
  })
  .prepare("p6");

const p7 = db.query.suppliers
  .findFirst({
    where: eq(suppliers.id, placeholder("id")),
  })
  .prepare("p7");

const p8 = db.query.products
  .findMany({
    limit: placeholder("limit"),
    offset: placeholder("offset"),
    orderBy: products.id,
  })
  .prepare("p8");

const p9 = db.query.products
  .findMany({
    where: eq(products.id, placeholder("id")),
    with: {
      supplier: true,
    },
  })
  .prepare("p9");

const p10 = db.query.products
  .findMany({
    where: sql`to_tsvector('english', ${
      products.name
    }) @@ to_tsquery('english', ${placeholder("term")})`,
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
  .limit(placeholder("limit"))
  .offset(placeholder("offset"))
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
  .where(eq(orders.id, placeholder("id")))
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
    where: eq(orders.id, placeholder("id")),
  })
  .prepare("p13");

const app = new Hono();
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

serve({
  fetch: app.fetch,
  port: 3000,
});
