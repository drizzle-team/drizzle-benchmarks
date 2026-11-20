// Prisma 8 runtime. Contract emitted from prisma7/schema.prisma by `bun run generate`.
//
//   DRIVER=pg       node-postgres (default)
//   DRIVER=drizzle  Drizzle's Postgres driver, @drizzle-team/postgres/compat-prisma8: a pg.Pool-shaped pool whose
//                   statements outside a transaction are shared, pipelined pool queries. Prisma 8's statement
//                   names (db.prepare) pass through, so they stay server-side prepared
//
// Either way the pool size is POOL_MAX (default 10), like the Drizzle servers.
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import { createPool } from '@drizzle-team/postgres/compat-prisma8';
import pg from 'pg';
import type { Contract } from './generated/contract.d.ts';
import contractJson from './generated/contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export const driver = (process.env.DRIVER ?? 'pg') as 'pg' | 'drizzle';
const url = process.env.DATABASE_URL!;
const max = Number(process.env.POOL_MAX ?? 10);
// DRIVER=drizzle only, as the Drizzle servers: unset/auto = driver default, off = no pipelining, <n> = fixed depth
const pipe = process.env.PIPELINE;
const pipeline = !pipe || pipe === 'auto' ? undefined : pipe === 'off' ? false : { depth: Number(pipe) };

function createDb() {
  switch (driver) {
    case 'pg':
      return postgres({ contract, pg: new pg.Pool({ connectionString: url, max }) });
    case 'drizzle':
      return postgres({
        contract,
        binding: { kind: 'pgPool', pool: createPool({ url, max, pipeline }) as unknown as pg.Pool },
      });
    default:
      throw new Error(`unknown DRIVER=${driver} for Prisma 8 (expected pg | drizzle)`);
  }
}

export const db = createDb();
