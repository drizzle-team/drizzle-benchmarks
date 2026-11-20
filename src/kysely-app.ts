// The benchmark's routes on Kysely, for src/kysely-server-bun.ts and src/kysely-server-node.ts. Same
// routes, parameters and response shapes as the Drizzle servers: columns aliased to camelCase, relations
// nested as JSON with Kysely's jsonObjectFrom / jsonArrayFrom (one query per request, like Drizzle's
// relational queries).
//
// Every query is built and compiled to SQL once, at startup (`.compile()`), the way the Drizzle servers
// `.prepare()` theirs; a request only swaps its values into the compiled parameters and runs it with
// db.executeQuery(). Kysely's PostgresDialect has no server-side prepared statements: on DRIVER=pg Postgres
// parses and plans every query; DRIVER=drizzle names each distinct SQL text itself (see ./kysely-db.ts).
import { Hono } from 'hono';
import { type Compilable, sql } from 'kysely';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import cpuUsage from './cpu-usage.ts';
import { createDb } from './kysely-db.ts';

const db = createDb();

// `<alias>.<column> as <key>` for every column, the keys the Drizzle servers return
const cols = (alias: string, map: Record<string, string>) => Object.entries(map).map(([key, col]) => `${alias}.${col} as ${key}`) as any[];
const customer = {
  id: 'id', companyName: 'company_name', contactName: 'contact_name', contactTitle: 'contact_title', address: 'address',
  city: 'city', postalCode: 'postal_code', region: 'region', country: 'country', phone: 'phone', fax: 'fax',
};
const employee = {
  id: 'id', lastName: 'last_name', firstName: 'first_name', title: 'title', titleOfCourtesy: 'title_of_courtesy',
  birthDate: 'birth_date', hireDate: 'hire_date', address: 'address', city: 'city', postalCode: 'postal_code',
  country: 'country', homePhone: 'home_phone', extension: 'extension', notes: 'notes', recipientId: 'recipient_id',
};
const supplier = {
  id: 'id', companyName: 'company_name', contactName: 'contact_name', contactTitle: 'contact_title', address: 'address',
  city: 'city', region: 'region', postalCode: 'postal_code', country: 'country', phone: 'phone',
};
const product = {
  id: 'id', name: 'name', quantityPerUnit: 'quantity_per_unit', unitPrice: 'unit_price', unitsInStock: 'units_in_stock',
  unitsOnOrder: 'units_on_order', reorderLevel: 'reorder_level', discontinued: 'discontinued', supplierId: 'supplier_id',
};
const order = {
  id: 'id', orderDate: 'order_date', requiredDate: 'required_date', shippedDate: 'shipped_date', shipVia: 'ship_via',
  freight: 'freight', shipName: 'ship_name', shipCity: 'ship_city', shipRegion: 'ship_region',
  shipPostalCode: 'ship_postal_code', shipCountry: 'ship_country', customerId: 'customer_id', employeeId: 'employee_id',
};
const detail = { unitPrice: 'unit_price', quantity: 'quantity', discount: 'discount', orderId: 'order_id', productId: 'product_id' };

type Req = { req: { query(k: string): string | undefined } };
const page = (c: Req) => ({ limit: Number(c.req.query('limit')), offset: Number(c.req.query('offset')) });
const byId = (c: Req) => ({ id: Number(c.req.query('id')) });
const search = (c: Req) => ({ term: `${c.req.query('term')}:*` });

// Compile a query once, with a marker value for each named parameter; the returned function runs it with
// the markers' slots in the compiled parameters replaced by the call's values.
function compiled<A extends string>(names: readonly A[], build: (p: Record<A, any>) => Compilable<any>) {
  const marker = (n: string) => `\u0000${n}`;
  const query = build(Object.fromEntries(names.map((n) => [n, marker(n)])) as Record<A, any>).compile();
  const slots = query.parameters.map((v) => (typeof v === 'string' && v.startsWith('\u0000') ? (v.slice(1) as A) : null));
  for (const n of names) if (!slots.includes(n)) throw new Error(`parameter ${n} not in ${query.sql}`);
  return async (args: Record<A, unknown>) =>
    (await db.executeQuery<any>({ ...query, parameters: slots.map((n, i) => (n ? args[n] : query.parameters[i])) })).rows;
}

// orders with their detail count and sums, for /orders-with-details and /order-with-details
const orderTotals = () =>
  db
    .selectFrom('orders as o')
    .leftJoin('order_details as d', 'd.order_id', 'o.id')
    .select([
      'o.id as id',
      'o.shipped_date as shippedDate',
      'o.ship_name as shipName',
      'o.ship_city as shipCity',
      'o.ship_country as shipCountry',
      sql<number>`count(d.product_id)::int`.as('productsCount'),
      sql<number>`sum(d.quantity)::int`.as('quantitySum'),
      sql<number>`sum(d.quantity * d.unit_price)::real`.as('totalPrice'),
    ])
    .groupBy('o.id')
    .orderBy('o.id');

const q = {
  customers: compiled(['limit', 'offset'], (p) => db.selectFrom('customers as c').select(cols('c', customer)).orderBy('c.id').limit(p.limit).offset(p.offset)),
  customerById: compiled(['id'], (p) => db.selectFrom('customers as c').select(cols('c', customer)).where('c.id', '=', p.id).limit(1)),
  searchCustomer: compiled(['term'], (p) =>
    db.selectFrom('customers as c').select(cols('c', customer)).where(sql<boolean>`to_tsvector('english', c.company_name) @@ to_tsquery('english', ${p.term})`),
  ),
  employees: compiled(['limit', 'offset'], (p) => db.selectFrom('employees as e').select(cols('e', employee)).orderBy('e.id').limit(p.limit).offset(p.offset)),
  employeeWithRecipient: compiled(['id'], (p) =>
    db
      .selectFrom('employees as e')
      .select(cols('e', employee))
      .select((eb) => jsonObjectFrom(eb.selectFrom('employees as r').select(cols('r', employee)).whereRef('r.id', '=', 'e.recipient_id')).as('recipient'))
      .where('e.id', '=', p.id),
  ),
  suppliers: compiled(['limit', 'offset'], (p) => db.selectFrom('suppliers as s').select(cols('s', supplier)).orderBy('s.id').limit(p.limit).offset(p.offset)),
  supplierById: compiled(['id'], (p) => db.selectFrom('suppliers as s').select(cols('s', supplier)).where('s.id', '=', p.id).limit(1)),
  products: compiled(['limit', 'offset'], (p) => db.selectFrom('products as p').select(cols('p', product)).orderBy('p.id').limit(p.limit).offset(p.offset)),
  productWithSupplier: compiled(['id'], (p) =>
    db
      .selectFrom('products as p')
      .select(cols('p', product))
      .select((eb) => jsonObjectFrom(eb.selectFrom('suppliers as s').select(cols('s', supplier)).whereRef('s.id', '=', 'p.supplier_id')).as('supplier'))
      .where('p.id', '=', p.id),
  ),
  searchProduct: compiled(['term'], (p) =>
    db.selectFrom('products as p').select(cols('p', product)).where(sql<boolean>`to_tsvector('english', p.name) @@ to_tsquery('english', ${p.term})`),
  ),
  ordersWithDetails: compiled(['limit', 'offset'], (p) => orderTotals().limit(p.limit).offset(p.offset)),
  orderWithDetails: compiled(['id'], (p) => orderTotals().where('o.id', '=', p.id)),
  orderWithDetailsAndProducts: compiled(['id'], (p) =>
    db
      .selectFrom('orders as o')
      .select(cols('o', order))
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('order_details as d')
            .select(cols('d', detail))
            .select((eb2) => jsonObjectFrom(eb2.selectFrom('products as p').select(cols('p', product)).whereRef('p.id', '=', 'd.product_id')).as('product'))
            .whereRef('d.order_id', '=', 'o.id'),
        ).as('details'),
      )
      .where('o.id', '=', p.id),
  ),
};

const app = new Hono();
app.route('', cpuUsage);
app.get('/customers', async (c) => c.json(await q.customers(page(c))));
app.get('/customer-by-id', async (c) => c.json((await q.customerById(byId(c)))[0]));
app.get('/search-customer', async (c) => c.json(await q.searchCustomer(search(c))));
app.get('/employees', async (c) => c.json(await q.employees(page(c))));
app.get('/employee-with-recipient', async (c) => c.json(await q.employeeWithRecipient(byId(c))));
app.get('/suppliers', async (c) => c.json(await q.suppliers(page(c))));
app.get('/supplier-by-id', async (c) => c.json((await q.supplierById(byId(c)))[0]));
app.get('/products', async (c) => c.json(await q.products(page(c))));
app.get('/product-with-supplier', async (c) => c.json(await q.productWithSupplier(byId(c))));
app.get('/search-product', async (c) => c.json(await q.searchProduct(search(c))));
app.get('/orders-with-details', async (c) => c.json(await q.ordersWithDetails(page(c))));
app.get('/order-with-details', async (c) => c.json(await q.orderWithDetails(byId(c))));
app.get('/order-with-details-and-products', async (c) => c.json(await q.orderWithDetailsAndProducts(byId(c))));

export default app;
