// Kysely database for the Kysely benchmark servers, with a selectable Postgres driver behind Kysely's own
// PostgresDialect:
//
//   DRIVER=drizzle  @drizzle-team/postgres/compat-kysely, Drizzle's Postgres driver. Kysely checks a client
//                   out per query; the adapter hands out leases that run standalone queries on the shared,
//                   pipelined pool and only pin a connection for transactions. It also names each distinct
//                   SQL text (autoName, on by default since 33d0f35), so Postgres parses and plans it once
//                   per connection                                                   default
//   DRIVER=pg       node-postgres (pg.Pool): every query unnamed (Parse + Bind + Execute each time)
//   DRIVER=postgresjs  postgres.js through kysely-postgres-js (PostgresJSDialect): the dialect reserves a
//                   connection per query and runs it with `prepare: true`, so postgres.js names and reuses
//                   a server-side statement per SQL text on each connection
//
// Same pool size per server process as the Drizzle servers (POOL_MAX, default 10). Kysely itself has no
// prepared statements; only the drizzle driver's autoName gives it server-side ones.
import 'dotenv/config';
import { type Generated, Kysely, PostgresDialect } from 'kysely';
import { createRequire } from 'node:module';

export type Driver = 'drizzle' | 'pg' | 'postgresjs';
export const driver = (process.env.DRIVER ?? 'drizzle') as Driver;
const url = process.env.DATABASE_URL!;
const max = Number(process.env.POOL_MAX ?? 10);

// the tables as the database has them (snake_case); the queries alias columns to the camelCase keys the
// Drizzle servers return
export interface DB {
  customers: {
    id: Generated<number>;
    company_name: string;
    contact_name: string;
    contact_title: string;
    address: string;
    city: string;
    postal_code: string | null;
    region: string | null;
    country: string;
    phone: string;
    fax: string | null;
  };
  employees: {
    id: Generated<number>;
    last_name: string;
    first_name: string | null;
    title: string;
    title_of_courtesy: string;
    birth_date: Date;
    hire_date: Date;
    address: string;
    city: string;
    postal_code: string;
    country: string;
    home_phone: string;
    extension: number;
    notes: string;
    recipient_id: number | null;
  };
  orders: {
    id: Generated<number>;
    order_date: Date;
    required_date: Date;
    shipped_date: Date | null;
    ship_via: number;
    freight: number;
    ship_name: string;
    ship_city: string;
    ship_region: string | null;
    ship_postal_code: string | null;
    ship_country: string;
    customer_id: number;
    employee_id: number;
  };
  suppliers: {
    id: Generated<number>;
    company_name: string;
    contact_name: string;
    contact_title: string;
    address: string;
    city: string;
    region: string | null;
    postal_code: string;
    country: string;
    phone: string;
  };
  products: {
    id: Generated<number>;
    name: string;
    quantity_per_unit: string;
    unit_price: number;
    units_in_stock: number;
    units_on_order: number;
    reorder_level: number;
    discontinued: number;
    supplier_id: number;
  };
  order_details: {
    unit_price: number;
    quantity: number;
    discount: number;
    order_id: number;
    product_id: number;
  };
}

const require = createRequire(import.meta.url);
export function createDb(): Kysely<DB> {
  switch (driver) {
    case 'drizzle': {
      const { createPool, Cursor } = require('@drizzle-team/postgres/compat-kysely') as typeof import('@drizzle-team/postgres/compat-kysely');
      return new Kysely<DB>({ dialect: new PostgresDialect({ pool: createPool({ url, max }), cursor: Cursor }) });
    }
    case 'pg': {
      const pg = require('pg') as typeof import('pg');
      return new Kysely<DB>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, min: max, max }) }) });
    }
    case 'postgresjs': {
      const { PostgresJSDialect } = require('kysely-postgres-js') as typeof import('kysely-postgres-js');
      const mod = require('postgres');
      const postgres = (mod.default ?? mod) as typeof import('postgres').default; // Bun's require gives the ESM namespace
      return new Kysely<DB>({ dialect: new PostgresJSDialect({ postgres: postgres(url, { max }) }) });
    }
    default:
      throw new Error(`unknown DRIVER=${driver} (expected drizzle | pg | postgresjs)`);
  }
}

/** server processes to fork: WORKERS, default one per CPU */
export const serverWorkers = (cpus: number) => Number(process.env.WORKERS ?? cpus);
