// The benchmark's routes on Drizzle ORM over Effect 4, for src/effect-server-node.ts. The same queries as
// the Drizzle servers (src/drizzle-server-node.ts), each prepared once at startup with .prepare('<name>');
// a request runs its prepared query's Effect through a ManagedRuntime, Effect's documented way to run
// Effect code from a framework such as Hono. The driver behind it is DRIVER, see ./effect-db.ts.
import { asc, eq, sql } from 'drizzle-orm';
import { ManagedRuntime } from 'effect';
import { Hono } from 'hono';
import cpuUsage from './cpu-usage.ts';
import { connector } from './effect-db.ts';
import { relations } from './relations.ts';
import { details, orders } from './schema.ts';

const { layer, makeWithDefaults } = connector();
const runtime = ManagedRuntime.make(layer as any);
// both connectors build a Drizzle Effect database with the same query API; untyped here, because the two
// connectors' layers and makeWithDefaults are a union TypeScript can't call
const db: any = await runtime.runPromise((makeWithDefaults as any)({ relations, jit: true }));

const page = { limit: sql.placeholder('limit'), offset: sql.placeholder('offset'), orderBy: { id: 'asc' as const } };
const byId = { where: { id: sql.placeholder('id') } };
const totals = {
  id: orders.id,
  shippedDate: orders.shippedDate,
  shipName: orders.shipName,
  shipCity: orders.shipCity,
  shipCountry: orders.shipCountry,
  productsCount: sql<number>`count(${details.productId})::int`,
  quantitySum: sql<number>`sum(${details.quantity})::int`,
  totalPrice: sql<number>`sum(${details.quantity} * ${details.unitPrice})::real`,
};

const p1 = db.query.customers.findMany(page).prepare('p1');
const p2 = db.query.customers.findFirst(byId).prepare('p2');
const p3 = db.query.customers
  .findMany({ where: { RAW: (c: any) => sql`to_tsvector('english', ${c.companyName}) @@ to_tsquery('english', ${sql.placeholder('term')})` } })
  .prepare('p3');
const p4 = db.query.employees.findMany(page).prepare('p4');
const p5 = db.query.employees.findMany({ with: { recipient: true }, ...byId }).prepare('p5');
const p6 = db.query.suppliers.findMany(page).prepare('p6');
const p7 = db.query.suppliers.findFirst(byId).prepare('p7');
const p8 = db.query.products.findMany(page).prepare('p8');
const p9 = db.query.products.findMany({ ...byId, with: { supplier: true } }).prepare('p9');
const p10 = db.query.products
  .findMany({ where: { RAW: (p: any) => sql`to_tsvector('english', ${p.name}) @@ to_tsquery('english', ${sql.placeholder('term')})` } })
  .prepare('p10');
const p11 = db
  .select(totals)
  .from(orders)
  .leftJoin(details, eq(details.orderId, orders.id))
  .groupBy(orders.id)
  .orderBy(asc(orders.id))
  .limit(sql.placeholder('limit'))
  .offset(sql.placeholder('offset'))
  .prepare('p11');
const p12 = db
  .select(totals)
  .from(orders)
  .leftJoin(details, eq(details.orderId, orders.id))
  .where(eq(orders.id, sql.placeholder('id')))
  .groupBy(orders.id)
  .orderBy(asc(orders.id))
  .prepare('p12');
const p13 = db.query.orders.findMany({ with: { details: { with: { product: true } } }, ...byId }).prepare('p13');

type Req = { req: { query(k: string): string | undefined } };
const pageOf = (c: Req) => ({ limit: Number(c.req.query('limit')), offset: Number(c.req.query('offset')) });
const idOf = (c: Req) => ({ id: c.req.query('id') });
const termOf = (c: Req) => ({ term: `${c.req.query('term')}:*` });
const run = (q: { execute(v: Record<string, unknown>): any }, values: Record<string, unknown>) => runtime.runPromise(q.execute(values));

const app = new Hono();
app.route('', cpuUsage);
app.get('/customers', async (c) => c.json(await run(p1, pageOf(c))));
app.get('/customer-by-id', async (c) => c.json(await run(p2, idOf(c))));
app.get('/search-customer', async (c) => c.json(await run(p3, termOf(c))));
app.get('/employees', async (c) => c.json(await run(p4, pageOf(c))));
app.get('/employee-with-recipient', async (c) => c.json(await run(p5, idOf(c))));
app.get('/suppliers', async (c) => c.json(await run(p6, pageOf(c))));
app.get('/supplier-by-id', async (c) => c.json(await run(p7, idOf(c))));
app.get('/products', async (c) => c.json(await run(p8, pageOf(c))));
app.get('/product-with-supplier', async (c) => c.json(await run(p9, idOf(c))));
app.get('/search-product', async (c) => c.json(await run(p10, termOf(c))));
app.get('/orders-with-details', async (c) => c.json(await run(p11, pageOf(c))));
app.get('/order-with-details', async (c) => c.json(await run(p12, idOf(c))));
app.get('/order-with-details-and-products', async (c) => c.json(await run(p13, idOf(c))));

export default app;
