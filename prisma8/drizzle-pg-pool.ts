// Lets Prisma 8 run on Drizzle's Postgres driver (drizzle-orm/postgres) instead of node-postgres.
//
// Prisma 8 accepts a node-postgres `pg.Pool` (recognised by duck typing: totalCount / idleCount /
// waitingCount) and only uses a small slice of it: pool.connect() → client.query(config) →
// client.release(). It asks for every column as raw text (`types: serverTextTypes`, an identity
// parser) because its codecs decode from strings only (`fromWire(wire: string)`); there is no
// bytes-in path. node-postgres does the same bytes → string step for every column, so this shim
// does just that: it runs each query with Drizzle's `mode: 'raw'` (each row is the Postgres DataRow
// body) and reads the text values straight out of it, with no per-cell Buffer objects.
// Statement names are passed through, so Prisma's prepared statements stay server-side prepared.
import type { Pool } from 'drizzle-orm/postgres';

type PgQueryConfig = { text: string; values?: readonly unknown[]; name?: string };
type DrizzleConnection = Awaited<ReturnType<Pool['connect']>>['client'];

/** DataRow body: int16 field count, then per field an int32 length (-1 = NULL) and that many bytes. */
function decodeRow(row: Buffer, columns: readonly string[]) {
  const out: Record<string, string | null> = {};
  let offset = 2;
  for (let i = 0; i < columns.length; i++) {
    const length = row.readInt32BE(offset);
    offset += 4;
    if (length < 0) {
      out[columns[i]!] = null;
    } else {
      out[columns[i]!] = row.toString('utf8', offset, offset + length);
      offset += length;
    }
  }
  return out;
}

class DrizzlePgClient {
  releaseConnection: () => void = () => {};
  private readonly connection: DrizzleConnection;

  // a plain field, not a parameter property: Node's type stripping can't run those
  constructor(connection: DrizzleConnection) {
    this.connection = connection;
  }

  async query(config: string | PgQueryConfig, values?: readonly unknown[]) {
    const { text, values: params = [], name } = typeof config === 'string' ? { text: config, values } : config;
    const result = await this.connection.query(text, [...(params ?? [])], { name, mode: 'raw' });
    const columns = result.columns;
    const rows = result.rows.map((row) => decodeRow(row, columns));
    return { rows, rowCount: result.rowCount, command: result.command, fields: columns.map((name) => ({ name })) };
  }

  release() {
    this.releaseConnection();
  }

  // pg clients emit 'error' / 'end'; Drizzle's driver surfaces connection failures as rejected queries.
  on() {
    return this;
  }
}

/** A `pg.Pool`-shaped view of a Drizzle driver Pool, for `postgres({ binding: { kind: 'pgPool', pool } })`. */
export function drizzlePgPool(pool: Pool) {
  // One wrapper per physical connection: Prisma tracks per client object which connections already
  // have its session settings (SELECT set_config(...)), so a new wrapper per checkout would re-run them.
  const clients = new WeakMap<DrizzleConnection, DrizzlePgClient>();
  return {
    get totalCount() {
      return pool.size;
    },
    get idleCount() {
      return pool.idleCount;
    },
    get waitingCount() {
      return pool.waiting;
    },
    async connect() {
      const { client, release } = await pool.connect();
      let wrapper = clients.get(client);
      if (!wrapper) {
        wrapper = new DrizzlePgClient(client);
        clients.set(client, wrapper);
      }
      wrapper.releaseConnection = release;
      return wrapper;
    },
    async end() {
      await pool.end();
    },
    on() {
      return this;
    },
  };
}
