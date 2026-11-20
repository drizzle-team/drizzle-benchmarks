// Drizzle ORM on Effect 4 for the Effect benchmark server, with a selectable Postgres driver:
//
//   DRIVER=effect   drizzle-orm/effect-postgres on @effect/sql-pg (Effect's own driver, its own wire protocol),
//                   `multiplex: true`: statements from many fibers are pipelined on each pooled connection
//                   (up to 32 per connection, Effect's default); MULTIPLEX=0 turns that off (@effect/sql-pg's
//                   own default), one statement per connection at a time. It decodes `real` in binary, so `totalPrice`
//                   shows the float32's exact digits (31836.779296875 for 31836.78), as on Bun.SQL
//   DRIVER=drizzle  drizzle-orm/postgres/effect on DrizzlePostgresClient (Drizzle's Postgres driver
//                   as an Effect SqlClient). Statements outside a transaction run on the pool's shared
//                   connections, pipelined with other fibers' statements; it has no multiplex option
//
// On both, the server's queries are prepared with .prepare('<name>') and Drizzle passes that name to the
// driver, so each runs as a named server-side statement. Both connectors come from the drizzle-orm the other
// servers use (45b4a38, the rc6 preview build of PR #6588, with its own bundled copy of the driver).
//
// Same pool size per server process as the other servers (POOL_MAX, default 10).
import 'dotenv/config';
import { Redacted } from 'effect';
import { createRequire } from 'node:module';

export type Driver = 'effect' | 'drizzle';
export const driver = (process.env.DRIVER ?? 'effect') as Driver;
const url = process.env.DATABASE_URL!;
const max = Number(process.env.POOL_MAX ?? 10);

const require = createRequire(import.meta.url);
/** the driver's layer and the connector's makeWithDefaults, which builds the database from it */
export function connector() {
  switch (driver) {
    case 'effect': {
      const { PgClient } = require('@effect/sql-pg') as typeof import('@effect/sql-pg');
      const { makeWithDefaults } = require('drizzle-orm/effect-postgres') as typeof import('drizzle-orm/effect-postgres');
      return {
        layer: PgClient.layer({ url: Redacted.make(url), maxConnections: max, minConnections: max, multiplex: process.env.MULTIPLEX !== '0' }),
        makeWithDefaults,
      };
    }
    case 'drizzle': {
      const { DrizzlePostgresClient } = require('drizzle-orm/postgres/client/effect/node') as typeof import('drizzle-orm/postgres/client/effect/node');
      const { makeWithDefaults } = require('drizzle-orm/postgres/effect') as typeof import('drizzle-orm/postgres/effect');
      return { layer: DrizzlePostgresClient.layer({ url: Redacted.make(url), maxConnections: max }), makeWithDefaults };
    }
    default:
      throw new Error(`unknown DRIVER=${driver} (expected effect | drizzle)`);
  }
}

/** server processes to fork: WORKERS, default one per CPU */
export const serverWorkers = (cpus: number) => Number(process.env.WORKERS ?? cpus);
