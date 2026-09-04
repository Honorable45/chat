import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { createTestPrisma, resetDatabase } from './utils/test-db';
import { registerTestUser, TestUser } from './utils/test-users';

jest.setTimeout(15_000);

/**
 * Item 8 de la spécification NEXORA (tests/sécurité) : deux réglages de
 * confidentialité (`whoCanMessageMe`, `whoCanSeeMyStatus`) existaient dans
 * le schéma et l'API depuis le début mais n'étaient jamais réellement
 * appliqués nulle part — un utilisateur pouvait les changer sans que rien
 * ne change en pratique. Maintenant qu'un vrai carnet de contacts existe
 * (item 2), les deux sont câblés sur `ContactsService` et vérifiés ici avec
 * de vraies requêtes REST, jamais seulement au niveau du service.
 */
describe('Privacy enforcement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let a: TestUser;
  let b: TestUser;
  let c: TestUser;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    app = await createTestApp();
    await app.listen(0);

    a = await registerTestUser(app, { username: 'priv_a' });
    b = await registerTestUser(app, { username: 'priv_b' });
    c = await registerTestUser(app, { username: 'priv_c' });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function becomeContacts(x: TestUser, y: TestUser) {
    const sent = await request(app.getHttpServer())
      .post('/api/contacts/requests')
      .set('Authorization', `Bearer ${x.accessToken}`)
      .send({ userId: y.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/contacts/requests/${sent.body.id}/accept`)
      .set('Authorization', `Bearer ${y.accessToken}`)
      .expect(201);
  }

  describe('whoCanMessageMe', () => {
    it('NOBODY : personne ne peut démarrer une nouvelle conversation, même un inconnu total', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/me/profile')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .send({ whoCanMessageMe: 'NOBODY' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/conversations')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ userId: b.id })
        .expect(403);
    });

    it('CONTACTS : refuse un non-contact, autorise un contact accepté', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/me/profile')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .send({ whoCanMessageMe: 'CONTACTS' })
        .expect(200);

      // C n'est pas en contact avec B : refusé.
      await request(app.getHttpServer())
        .post('/api/conversations')
        .set('Authorization', `Bearer ${c.accessToken}`)
        .send({ userId: b.id })
        .expect(403);

      // A devient contact de B : autorisé.
      await becomeContacts(a, b);
      await request(app.getHttpServer())
        .post('/api/conversations')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ userId: b.id })
        .expect(201);
    });

    it('une conversation déjà existante reste utilisable même si le réglage change ensuite en NOBODY', async () => {
      // A et B ont déjà une conversation (test précédent) — B repasse à NOBODY.
      await request(app.getHttpServer())
        .patch('/api/users/me/profile')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .send({ whoCanMessageMe: 'NOBODY' })
        .expect(200);

      // Ré-appeler POST /conversations pour la même paire renvoie l'existante, jamais un 403.
      await request(app.getHttpServer())
        .post('/api/conversations')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ userId: b.id })
        .expect(201);

      await request(app.getHttpServer())
        .patch('/api/users/me/profile')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .send({ whoCanMessageMe: 'EVERYONE' })
        .expect(200);
    });
  });

  describe('whoCanSeeMyStatus (visibilité CONTACTS d’un statut)', () => {
    it("un statut CONTACTS n'apparaît pas pour quelqu'un qui n'est pas un contact accepté", async () => {
      await request(app.getHttpServer())
        .post('/api/statuses')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ type: 'TEXT', text: 'Visible seulement de mes contacts', visibility: 'CONTACTS' })
        .expect(201);

      const feedForC = await request(app.getHttpServer())
        .get('/api/statuses')
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(200);
      expect(feedForC.body.some((s: { author: { id: string } }) => s.author.id === a.id)).toBe(false);
    });

    it('le même statut apparaît pour un contact accepté (A et B le sont déjà, voir plus haut)', async () => {
      const feedForB = await request(app.getHttpServer())
        .get('/api/statuses')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .expect(200);
      expect(feedForB.body.some((s: { author: { id: string } }) => s.author.id === a.id)).toBe(true);
    });
  });
});
