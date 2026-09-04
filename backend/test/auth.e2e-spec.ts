import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { createTestPrisma, resetDatabase } from './utils/test-db';
import { registerTestUser } from './utils/test-users';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('POST /api/auth/register', () => {
    it('crée un compte réel en base et renvoie des tokens, jamais le hash du mot de passe', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          firstName: 'Honoré',
          lastName: 'K.',
          username: 'auth_e2e_1',
          email: 'auth_e2e_1@example.com',
          password: 'un-mot-de-passe-solide',
          primaryLanguageCode: 'fr',
        })
        .expect(201);

      expect(res.body.user.username).toBe('auth_e2e_1');
      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(typeof res.body.accessToken).toBe('string');
      expect(typeof res.body.refreshToken).toBe('string');

      const stored = await prisma.user.findUnique({ where: { username: 'auth_e2e_1' } });
      expect(stored?.passwordHash).not.toBe('un-mot-de-passe-solide'); // jamais en clair
    });

    it("refuse un nom d'utilisateur déjà pris (409)", async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          firstName: 'Autre',
          lastName: 'Personne',
          username: 'auth_e2e_1', // déjà pris par le test précédent
          email: 'autre@example.com',
          password: 'un-mot-de-passe-solide',
          primaryLanguageCode: 'fr',
        })
        .expect(409);
    });

    it('refuse sans email ni téléphone (400)', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          firstName: 'Sans',
          lastName: 'Contact',
          username: 'auth_e2e_sans_contact',
          password: 'un-mot-de-passe-solide',
          primaryLanguageCode: 'fr',
        })
        .expect(400);
    });

    it('refuse une langue principale inconnue (400)', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          firstName: 'Langue',
          lastName: 'Inconnue',
          username: 'auth_e2e_langue',
          email: 'langue@example.com',
          password: 'un-mot-de-passe-solide',
          primaryLanguageCode: 'zz',
        })
        .expect(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('connecte avec les bons identifiants', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'auth_e2e_1', password: 'un-mot-de-passe-solide' })
        .expect(200);
    });

    it('refuse un mauvais mot de passe avec un message générique', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'auth_e2e_1', password: 'mauvais-mot-de-passe' })
        .expect(401);
      expect(res.body.message.message).toBe('Identifiants invalides.');
    });

    it('refuse un identifiant inconnu avec exactement le même message générique', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: 'personne-nexiste-pas', password: 'peu-importe' })
        .expect(401);
      expect(res.body.message.message).toBe('Identifiants invalides.');
    });
  });

  describe('Routes protégées', () => {
    it('refuse sans token (401)', async () => {
      await request(app.getHttpServer()).get('/api/users/me').expect(401);
    });

    it('refuse avec un token invalide (401)', async () => {
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', 'Bearer ceci-nest-pas-un-jwt')
        .expect(401);
    });

    it('autorise avec un token valide', async () => {
      const user = await registerTestUser(app);
      const res = await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.id).toBe(user.id);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('renvoie de nouveaux tokens valides avec un refresh token valide', async () => {
      const user = await registerTestUser(app);

      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(200);

      expect(typeof res.body.accessToken).toBe('string');
      // Le nouveau token fonctionne réellement.
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
    });

    it('refuse un refresh token invalide (401)', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: 'ceci-nest-pas-un-refresh-token' })
        .expect(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('invalide bien la session : le refresh token ne fonctionne plus après', async () => {
      const user = await registerTestUser(app);

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(401);
    });
  });
});
