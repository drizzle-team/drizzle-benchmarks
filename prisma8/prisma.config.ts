// Prisma 8 config. The contract is the repo's Prisma 7 schema (prisma7/schema.prisma), read as-is,
// so both Prisma versions run against the same model and the same database.
import { config } from 'dotenv';
import { definePrismaConfig } from 'prisma/config';
import { defineConfig as orm, prisma7Schema } from '@prisma/orm-postgres/config';

config({ path: new URL('../.env', import.meta.url).pathname });

export default definePrismaConfig({
  orm: orm({
    contract: prisma7Schema('../prisma7/schema.prisma'),
    output: 'generated',
  }),
});
