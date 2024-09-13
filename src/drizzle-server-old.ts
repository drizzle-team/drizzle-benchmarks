import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { Pool } from "pg";
import { eq, ilike, sql } from "drizzle-orm";
import {
  customers,
  employees,
  products,
  suppliers,
} from "./schema";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8, min: 8 });
const db = drizzle(pool, { schema });

const p1 = db
  .select()
  .from(customers)
  .limit(sql.placeholder("limit"))
  .offset(sql.placeholder("offset"))
  .prepare("p1");

const p2 = db
  .select()
  .from(customers)
  .where(eq(customers.id, sql.placeholder("id")))
  .prepare("p2");

const p3 = db
  .select()
  .from(customers)
  .where(ilike(customers.companyName, sql.placeholder("term")))
  .prepare("p3");

const p4 = db
  .select()
  .from(employees)
  .limit(sql.placeholder("limit"))
  .offset(sql.placeholder("offset"))
  .prepare("p4");

const p6 = db
  .select()
  .from(suppliers)
  .limit(sql.placeholder("limit"))
  .offset(sql.placeholder("offset"))
  .prepare("p6");

const p7 = db
  .select()
  .from(suppliers)
  .where(eq(suppliers.id, sql.placeholder("id")))
  .prepare("p7");

const p8 = db
  .select()
  .from(products)
  .limit(sql.placeholder("limit"))
  .offset(sql.placeholder("offset"))
  .prepare("p8");


const p10 = db
  .select()
  .from(products)
  .where(ilike(products.name, sql.placeholder("term")))
  .prepare("p10");



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

app.get("/search-product", async (c) => {
  const term = `%${c.req.query("term")}%`;
  const result = await p10.execute({ term });
  return c.json(result);
});

serve({
  fetch: app.fetch,
  port: 3000,
});
