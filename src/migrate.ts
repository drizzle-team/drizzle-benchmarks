// Apply pending migrations from drizzle/ to DATABASE_URL, keeping existing data (the seed also
// migrates, but then inserts everything again). Uses the runtime migrator, which doesn't need the
// migration snapshots to be in drizzle-kit's latest format.
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres';
import { migrate } from 'drizzle-orm/postgres/migrator';

const db = drizzle(process.env.DATABASE_URL!);
await migrate(db, { migrationsFolder: 'drizzle' });
console.log('migrations applied');
process.exit(0);
