// Drizzle database for the benchmark servers, with a selectable Postgres driver:
//
//   DRIVER=pg       node-postgres (pg.Pool)                       default on Node
//   DRIVER=drizzle  drizzle-orm/postgres (Drizzle's own driver)
//   DRIVER=bun      Bun.SQL                                        default on Bun, Bun only
//
// Every driver gets the same pool size per server process (POOL_MAX, default 10).
import 'dotenv/config';
import { createRequire } from 'node:module';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { relations } from './relations.ts';

export type Driver = 'pg' | 'drizzle' | 'bun';

const isBun = typeof Bun !== 'undefined';
export const driver = (process.env.DRIVER ?? (isBun ? 'bun' : 'pg')) as Driver;
const url = process.env.DATABASE_URL!;
const max = Number(process.env.POOL_MAX ?? 10);

// All three are pg-core databases with the same query API; typed as one for the handlers.
type Db = NodePgDatabase<typeof relations>;

// Synchronous require() (via createRequire, as these are ES modules) so only the selected driver
// gets loaded, on both Node and Bun.
const require = createRequire(import.meta.url);
export function createDb(): Db {
  switch (driver) {
    case 'pg': {
      const pg = require('pg') as typeof import('pg');
      const { drizzle } = require('drizzle-orm/node-postgres') as typeof import('drizzle-orm/node-postgres');
      const client = new pg.Pool({ connectionString: url, min: max, max });
      return drizzle({ client, relations, jit: true });
    }
    case 'drizzle': {
      const { Pool, drizzle } = require('drizzle-orm/postgres') as typeof import('drizzle-orm/postgres');
      const client = new Pool({ url, max });
      return drizzle({ client, relations, jit: true }) as unknown as Db;
    }
    case 'bun': {
      if (!isBun) throw new Error('DRIVER=bun needs the Bun runtime (bun src/drizzle-server-bun.ts)');
      const { drizzle } = require('drizzle-orm/bun-sql') as typeof import('drizzle-orm/bun-sql');
      const client = new Bun.SQL(url, { bigint: true, prepare: true, max });
      return drizzle({ client, relations, jit: true }) as unknown as Db;
    }
    default:
      throw new Error(`unknown DRIVER=${driver} (expected pg | drizzle | bun)`);
  }
}

/** server processes to fork: WORKERS, default one per CPU */
export const serverWorkers = (cpus: number) => Number(process.env.WORKERS ?? cpus);
