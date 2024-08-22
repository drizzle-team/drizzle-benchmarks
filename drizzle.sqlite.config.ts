import type { Config } from 'drizzle-kit';
import 'dotenv/config';

export default {
  schema: 'src/sqlite/schema.ts',
  out: 'src/sqlite/drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: 'src/sqlite/northwind.db',
  },
} satisfies Config;
