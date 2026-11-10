import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7. Lives in prisma7/ (not the repo root) so the Prisma 8 CLI in prisma8/ doesn't
// find it when it walks up looking for parent configs.
export default defineConfig({
  schema: './schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
