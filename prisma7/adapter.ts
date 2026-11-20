// The Prisma 7 driver adapter for the Prisma 7 servers, by DRIVER:
//
//   DRIVER=pg       @prisma/adapter-pg (node-postgres)                                         default
//   DRIVER=drizzle  @drizzle-team/postgres/compat-prisma7, Drizzle's Postgres driver, a drop-in for adapter-pg:
//                   statements outside a transaction are shared, pipelined pool queries
//
// STATEMENT_NAMES=1 gives every distinct SQL text a server-side statement name, through the adapters'
// `statementNameGenerator` option (both take it), so Postgres parses and plans each query once per connection.
// Without it (Prisma 7's default) every query goes unnamed and Postgres parses and plans it on every run.
// Pool size per process: POOL_MAX (default 10), like the Drizzle servers.
import { PrismaPg as DrizzlePrismaPg } from '@drizzle-team/postgres/compat-prisma7';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

export const driver = (process.env.DRIVER ?? 'pg') as 'pg' | 'drizzle';
export const statementNames = process.env.STATEMENT_NAMES === '1';
const url = process.env.DATABASE_URL!;
const max = Number(process.env.POOL_MAX ?? 10);

// one name per distinct SQL text, never reused for other SQL
const names = new Map<string, string>();
const statementNameGenerator = (query: { sql: string }) => {
  let name = names.get(query.sql);
  if (name === undefined) {
    name = `prisma_${names.size.toString(36)}`;
    names.set(query.sql, name);
  }
  return name;
};
const options = statementNames ? { statementNameGenerator } : undefined;

export function createAdapter() {
  switch (driver) {
    case 'pg':
      return new PrismaPg({ connectionString: url, max }, options);
    case 'drizzle':
      return new DrizzlePrismaPg({ url, max }, options);
    default:
      throw new Error(`unknown DRIVER=${driver} for Prisma 7 (expected pg | drizzle)`);
  }
}
