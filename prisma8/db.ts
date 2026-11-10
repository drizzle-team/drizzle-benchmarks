// Prisma 8 runtime. Contract emitted from prisma7/schema.prisma by `bun run generate`.
//
//   DRIVER=pg       node-postgres (default)
//   DRIVER=drizzle  Drizzle's Postgres driver (drizzle-orm/postgres), through ./drizzle-pg-pool.ts
//
// Either way the pool size is POOL_MAX (default 10), like the Drizzle servers.
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import { Pool as DrizzlePool } from 'drizzle-orm/postgres';
import pg from 'pg';
import { drizzlePgPool } from './drizzle-pg-pool.ts';
import type { Contract } from './generated/contract.d.ts';
import contractJson from './generated/contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export const driver = (process.env.DRIVER ?? 'pg') as 'pg' | 'drizzle';
const url = process.env.DATABASE_URL!;
const max = Number(process.env.POOL_MAX ?? 10);

function createDb() {
  switch (driver) {
    case 'pg':
      return postgres({ contract, pg: new pg.Pool({ connectionString: url, max }) });
    case 'drizzle':
      return postgres({
        contract,
        binding: { kind: 'pgPool', pool: drizzlePgPool(new DrizzlePool({ url, max })) as unknown as pg.Pool },
      });
    default:
      throw new Error(`unknown DRIVER=${driver} for Prisma 8 (expected pg | drizzle)`);
  }
}

export const db = createDb();
