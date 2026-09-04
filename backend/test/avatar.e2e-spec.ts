import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { createTestPrisma, resetDatabase } from './utils/test-db';
import { registerTestUser, TestUser } from './utils/test-users';

/**
 * Ce que les tests unitaires de ProfilesService ne peuvent pas garantir :
 * que GET /users/:id/avatar est bien accessible SANS token — c'est un choix
 * délibéré (UserAvatarController, séparé de UsersController pour échapper à
 * son JwtAuthGuard de classe), et une régression ici (ex. un guard ajouté
 * par erreur) ne serait détectée par aucun test si ce n'est pas vérifié via
 * une vraie requête HTTP.
 */
describe('Avatar (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let alice: TestUser;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    app = await createTestApp();
    alice = await registerTestUser(app, { username: 'avatar_alice' });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('renvoie 404 pour un avatar avant tout téléversement', async () => {
    await request(app.getHttpServer()).get(`/api/users/${alice.id}/avatar`).expect(404);
  });

  it('accepte le téléversement puis sert le fichier sans aucun token', async () => {
    const upload = await request(app.getHttpServer())
      .post('/api/users/me/avatar')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .attach(
        'avatar',
        // Signature JPEG réelle (0xFF 0xD8 0xFF) : depuis l'audit de
        // sécurité, ProfilesService vérifie les octets du fichier en plus
        // du Content-Type déclaré (voir file-signature.util.ts).
        Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(197, 5)]),
        { filename: 'photo.jpg', contentType: 'image/jpeg' },
      )
      .expect(201);
    expect(upload.body.avatarStorageKey).toBeTruthy();

    // Aucun en-tête Authorization ici — c'est tout l'intérêt du test.
    const res = await request(app.getHttpServer()).get(`/api/users/${alice.id}/avatar`).expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    // Régression réelle (trouvée en testant dans un vrai navigateur, pas
    // détectée par un test avant ça) : helmet() pose
    // `Cross-Origin-Resource-Policy: same-origin` par défaut sur toutes les
    // réponses, ce qui bloque silencieusement une balise <img> chargée
    // depuis une autre origine (net::ERR_BLOCKED_BY_RESPONSE côté
    // navigateur, sans aucune erreur serveur) — exactement l'usage que
    // cette route existe pour permettre. Voir UserAvatarController.
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('GET /users/me reflète avatarUrl et avatarUploaded après le téléversement', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);

    expect(res.body.profile.avatarUploaded).toBe(true);
    expect(res.body.profile.avatarUrl).toBe(`/api/users/${alice.id}/avatar`);
  });

  it('DELETE /users/me/avatar supprime le fichier — 404 ensuite', async () => {
    await request(app.getHttpServer())
      .delete('/api/users/me/avatar')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(204);

    await request(app.getHttpServer()).get(`/api/users/${alice.id}/avatar`).expect(404);
  });
});
