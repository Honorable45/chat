import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL ?? '') });
}

/**
 * Vide toutes les tables entre deux suites e2e, sauf `languages` (seed
 * conservé — les tests s'appuient dessus pour l'inscription) et la table
 * interne de suivi des migrations. Découvre les tables dynamiquement plutôt
 * que de les lister à la main : reste correct si le schéma évolue.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const KEEP = new Set(['languages', '_prisma_migrations']);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const targets = tables.map((t) => t.tablename).filter((name) => !KEEP.has(name));
  if (targets.length === 0) return;

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${targets.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}
