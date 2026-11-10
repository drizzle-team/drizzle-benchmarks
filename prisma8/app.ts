// The benchmark routes on Prisma 8, ported 1:1 from prisma7/server-*.ts (same queries, same
// response shapes), shared by server-bun.ts and server-node.ts.
//
// Every query is a server-side prepared statement, like the Drizzle servers' `.prepare('p1')`:
// db.prepare() builds it once at startup, then each request only binds its parameters
// (Postgres parses/plans it once per connection). Passing the ORM's `.prepared` description
// (not just its `.plan`) makes `query()` return the same result the plain ORM call returns.
import { toTsquery } from '@prisma/orm-postgres/target/full-text';
import { Hono } from 'hono';
import cpuUsage from '../src/cpu-usage.ts';
import { db } from './db.ts';

const { Customer, Employee, Supplier, Product, Order } = db.orm.public;
const runtime = db.runtime();
const INT = 'pg/int4@1';
const TEXT = 'pg/text@1';

// Paginated queries order by id: Prisma 7 adds `ORDER BY id ASC` to take/skip on its own, Prisma 8 doesn't.
// Search: Prisma 7's `search: 'term:*'` is to_tsquery('term:*'); toTsquery takes the same string.
const customers = await db.prepare({ limit: INT, offset: INT }, (p) =>
  Customer.orderBy((r) => r.id.asc()).limit(p.limit).offset(p.offset).prepared.all(),
);
const customerById = await db.prepare({ id: INT }, (p) => Customer.where({ id: p.id }).prepared.first());
const searchCustomer = await db.prepare({ term: TEXT }, (p) =>
  Customer.where((r) => r.companyName.fullTextMatches(toTsquery(p.term))).prepared.all(),
);
const employees = await db.prepare({ limit: INT, offset: INT }, (p) =>
  Employee.orderBy((r) => r.id.asc()).limit(p.limit).offset(p.offset).prepared.all(),
);
const employeeWithRecipient = await db.prepare({ id: INT }, (p) =>
  Employee.where({ id: p.id }).include('recipient').prepared.first(),
);
const suppliers = await db.prepare({ limit: INT, offset: INT }, (p) =>
  Supplier.orderBy((r) => r.id.asc()).limit(p.limit).offset(p.offset).prepared.all(),
);
const supplierById = await db.prepare({ id: INT }, (p) => Supplier.where({ id: p.id }).prepared.first());
const products = await db.prepare({ limit: INT, offset: INT }, (p) =>
  Product.orderBy((r) => r.id.asc()).limit(p.limit).offset(p.offset).prepared.all(),
);
const productWithSupplier = await db.prepare({ id: INT }, (p) =>
  Product.where({ id: p.id }).include('supplier').prepared.first(),
);
const searchProduct = await db.prepare({ term: TEXT }, (p) =>
  Product.where((r) => r.name.fullTextMatches(toTsquery(p.term))).prepared.all(),
);
// Order summaries aggregate in SQL, like the Drizzle servers: count/sum over a LEFT JOIN … GROUP BY,
// so Postgres returns one small row per order instead of every detail row. The ORM can't sum an
// expression (quantity * unit_price) over a relation, so this uses the SQL builder with fns.raw.
const { orders, order_details } = db.sql.public;
const orderSummary = () =>
  orders
    .outerLeftJoin(order_details, (f, fns) => fns.eq(f.order_details.order_id, f.orders.id))
    .select((f, fns) => ({
      id: f.orders.id,
      shippedDate: f.orders.shipped_date,
      shipName: f.orders.ship_name,
      shipCity: f.orders.ship_city,
      shipCountry: f.orders.ship_country,
      productsCount: fns.raw`count(${f.order_details.product_id})::int`.returns({ codecId: INT, nullable: false }),
      quantitySum: fns.raw`sum(${f.order_details.quantity})::int`.returns({ codecId: INT, nullable: true }),
      totalPrice: fns.raw`sum(${f.order_details.quantity} * ${f.order_details.unit_price})::real`.returns({
        codecId: 'pg/float4@1',
        nullable: true,
      }),
    }));
const ordersWithDetails = await db.prepare({ limit: INT, offset: INT }, (p) =>
  orderSummary()
    .groupBy((f) => f.orders.id)
    .orderBy((f) => f.orders.id, { direction: 'asc' })
    .limit(p.limit)
    .offset(p.offset)
    .build(),
);
const orderWithDetails = await db.prepare({ id: INT }, (p) =>
  orderSummary()
    .where((f, fns) => fns.eq(f.orders.id, p.id))
    .groupBy((f) => f.orders.id)
    .build(),
);
const orderWithDetailsAndProducts = await db.prepare({ id: INT }, (p) =>
  Order.where({ id: p.id })
    .include('details', (details) => details.include('product'))
    .prepared.all(),
);

type Query = { req: { query(k: string): string | undefined } };
const page = (c: Query) => ({ limit: Number(c.req.query('limit')), offset: Number(c.req.query('offset')) });
const id = (c: Query) => ({ id: Number(c.req.query('id')) });
const term = (c: Query) => ({ term: `${c.req.query('term') ?? ''}:*` });

export const app = new Hono();
app.route('', cpuUsage);

app.get('/customers', async (c) => c.json(await customers.query(runtime, page(c))));
app.get('/customer-by-id', async (c) => c.json(await customerById.query(runtime, id(c))));
app.get('/search-customer', async (c) => c.json(await searchCustomer.query(runtime, term(c))));
app.get('/employees', async (c) => c.json(await employees.query(runtime, page(c))));
app.get('/employee-with-recipient', async (c) => c.json([await employeeWithRecipient.query(runtime, id(c))]));
app.get('/suppliers', async (c) => c.json(await suppliers.query(runtime, page(c))));
app.get('/supplier-by-id', async (c) => c.json(await supplierById.query(runtime, id(c))));
app.get('/products', async (c) => c.json(await products.query(runtime, page(c))));
app.get('/product-with-supplier', async (c) => c.json([await productWithSupplier.query(runtime, id(c))]));
app.get('/search-product', async (c) => c.json(await searchProduct.query(runtime, term(c))));
app.get('/orders-with-details', async (c) => c.json(await ordersWithDetails.query(runtime, page(c))));
app.get('/order-with-details', async (c) => c.json(await orderWithDetails.query(runtime, id(c))));
app.get('/order-with-details-and-products', async (c) =>
  c.json(await orderWithDetailsAndProducts.query(runtime, id(c))),
);
