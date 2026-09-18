import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { createTestPrisma, resetDatabase } from './utils/test-db';
import { registerTestUser, TestUser } from './utils/test-users';

/**
 * Section 4 de l'audit de sécurité : `fields`/`fieldSize`/`parts` n'étaient
 * bornés sur AUCUN des endpoints d'upload (memoryStorage() + `fileSize`
 * seul) — un attaquant pouvait empiler des milliers de champs multipart
 * sans jamais toucher à la taille d'un fichier, indépendamment de tout
 * média envoyé. Vérifie que `UPLOAD_FIELD_LIMITS` (voir
 * uploads/media-upload.constants.ts) rejette bien ce type de requête.
 */
describe('Limites d’upload multipart (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let user: TestUser;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    app = await createTestApp();
    user = await registerTestUser(app, { username: 'upload_limits' });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('refuse une requête multipart avec un nombre de champs excessif (POST /users/me/avatar)', async () => {
    let req = request(app.getHttpServer())
      .post('/api/users/me/avatar')
      .set('Authorization', `Bearer ${user.accessToken}`);

    // UPLOAD_FIELD_LIMITS.fields = 10 : on en envoie largement plus, sans
    // même joindre de fichier — la garde doit se déclencher avant tout
    // traitement de fichier.
    for (let i = 0; i < 50; i += 1) {
      req = req.field(`spam${i}`, 'x'.repeat(100));
    }

    const res = await req;
    expect([400, 413]).toContain(res.status);
  });
});
