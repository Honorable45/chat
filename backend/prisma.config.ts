import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Configuration Prisma 7 pour la CLI (migrate, studio, generate).
// Le runtime applicatif (PrismaService) configure sa propre connexion via un
// driver adapter — voir src/prisma/prisma.service.ts.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    seed: 'ts-node prisma/seed.ts',
  },
});
