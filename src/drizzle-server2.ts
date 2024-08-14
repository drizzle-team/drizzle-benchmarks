import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { alias } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { Pool } from "pg";
import { eq, ilike, placeholder, sql, asc } from "drizzle-orm";
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

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8, min: 8 });
const db = drizzle(pool, { schema });

const p1 = db
  .select()
  .from(customers)
  .limit(placeholder("limit"))
  .offset(placeholder("offset"))
  .prepare("p1");

const p2 = db
  .select()
  .from(customers)
  .where(eq(customers.id, placeholder("id")))
  .prepare("p2");

const p3 = db
  .select()
  .from(customers)
  .where(ilike(customers.companyName, placeholder("term")))
  .prepare("p3");

const p4 = db
  .select()
  .from(employees)
  .limit(placeholder("limit"))
  .offset(placeholder("offset"))
  .prepare("p4");

const e1 = alias(employees, "recipient");
const p5 = db
  .select()
  .from(employees)
  .where(eq(employees.id, placeholder("id")))
  .leftJoin(e1, eq(employees.id, e1.recipientId))
  .prepare("p5");

const p6 = db
  .select()
  .from(suppliers)
  .limit(placeholder("limit"))
  .offset(placeholder("offset"))
  .prepare("p6");

const p7 = db
  .select()
  .from(suppliers)
  .where(eq(suppliers.id, placeholder("id")))
  .prepare("p7");

const p8 = db
  .select()
  .from(products)
  .limit(placeholder("limit"))
  .offset(placeholder("offset"))
  .prepare("p8");

const p9 = db
  .select()
  .from(products)
  .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
  .where(eq(products.id, placeholder("id")))
  .prepare("p9");

const p10 = db
  .select()
  .from(products)
  .where(ilike(products.name, placeholder("term")))
  .prepare("p10");

const p11 = db
  .select({
    id: orders.id,
    shippedDate: orders.shippedDate,
    shipName: orders.shipName,
    shipCity: orders.shipCity,
    shipCountry: orders.shipCountry,
    productsCount: sql`count(${details.productId})`.as<number>(),
    quantitySum: sql`sum(${details.quantity})`.as<number>(),
    totalPrice:
      sql`sum(${details.quantity} * ${details.unitPrice})`.as<number>(),
  })
  .from(orders)
  .leftJoin(details, eq(orders.id, details.orderId))
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
    productsCount: sql`count(${details.productId})`.as<number>(),
    quantitySum: sql`sum(${details.quantity})`.as<number>(),
    totalPrice:
      sql`sum(${details.quantity} * ${details.unitPrice})`.as<number>(),
  })
  .from(orders)
  .leftJoin(details, eq(orders.id, details.orderId))
  .where(eq(orders.id, placeholder("id")))
  .groupBy(orders.id)
  .orderBy(asc(orders.id))
  .prepare("p12");

const p13 = db
  .select()
  .from(orders)
  .leftJoin(details, eq(orders.id, details.orderId))
  .leftJoin(products, eq(details.productId, products.id))
  .where(eq(orders.id, placeholder("orderId")))
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
  const term = `%${c.req.query("term")}%`;
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
  const term = `%${c.req.query("term")}%`;
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
