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

    it("invalide aussi immédiatement l'access token déjà émis (et pas seulement au prochain refresh)", async () => {
      const user = await registerTestUser(app);

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(401);
    });
  });

  describe('DELETE /api/auth/sessions/:id', () => {
    it("révoque immédiatement l'access token de la session ciblée, pas seulement le refresh token", async () => {
      const username = `auth_e2e_sessions_${Date.now()}`;
      const password = 'un-mot-de-passe-solide';
      const owner = await registerTestUser(app, { username, password });

      // Deuxième "appareil" : connexion séparée pour le même compte, avec
      // sa propre session à révoquer depuis la première.
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: username, password })
        .expect(200);
      const otherAccessToken = loginRes.body.accessToken as string;

      const sessionsRes = await request(app.getHttpServer())
        .get('/api/auth/sessions')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);
      const otherSession = (sessionsRes.body as Array<{ id: string; isCurrent: boolean }>).find(
        (s) => !s.isCurrent,
      );
      expect(otherSession).toBeDefined();

      await request(app.getHttpServer())
        .delete(`/api/auth/sessions/${otherSession!.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${otherAccessToken}`)
        .expect(401);
    });
  });

  describe('PATCH /api/auth/change-password', () => {
    it('révoque les autres sessions : leur access token devient inutilisable', async () => {
      const username = `auth_e2e_changepwd_${Date.now()}`;
      const password = 'un-mot-de-passe-solide';
      const owner = await registerTestUser(app, { username, password });

      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: username, password })
        .expect(200);
      const otherAccessToken = loginRes.body.accessToken as string;

      await request(app.getHttpServer())
        .patch('/api/auth/change-password')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ currentPassword: password, newPassword: 'un-nouveau-mot-de-passe-solide' })
        .expect(204);

      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${otherAccessToken}`)
        .expect(401);
    });
  });

  describe('Cookies httpOnly (audit de sécurité, migration hors localStorage)', () => {
    function extractCookie(res: request.Response, name: string): string | undefined {
      const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
      return raw?.find((c) => c.startsWith(`${name}=`));
    }

    it('pose glotta_access et glotta_refresh (httpOnly) à la connexion', async () => {
      const username = `auth_e2e_cookies_${Date.now()}`;
      const password = 'un-mot-de-passe-solide';
      await registerTestUser(app, { username, password });

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: username, password })
        .expect(200);

      const access = extractCookie(res, 'glotta_access');
      const refresh = extractCookie(res, 'glotta_refresh');
      expect(access).toBeDefined();
      expect(access).toContain('HttpOnly');
      expect(refresh).toBeDefined();
      expect(refresh).toContain('HttpOnly');
      expect(refresh).toContain('Path=/api/auth/refresh');
    });

    it('authentifie une requête via le cookie glotta_access, sans en-tête Authorization', async () => {
      const user = await registerTestUser(app, { username: `auth_e2e_cookie_auth_${Date.now()}` });

      const res = await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Cookie', `glotta_access=${user.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(user.id);
    });

    it('accepte un refresh via le cookie glotta_refresh seul (sans corps)', async () => {
      const user = await registerTestUser(app, {
        username: `auth_e2e_cookie_refresh_${Date.now()}`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', `glotta_refresh=${user.refreshToken}`)
        .send({})
        .expect(200);

      expect(typeof res.body.accessToken).toBe('string');
    });

    it('efface les cookies à la déconnexion', async () => {
      const user = await registerTestUser(app, {
        username: `auth_e2e_cookie_logout_${Date.now()}`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(204);

      const access = extractCookie(res, 'glotta_access');
      expect(access).toContain('Expires=Thu, 01 Jan 1970');
    });
  });

  describe('POST /api/auth/web/adopt-tokens', () => {
    it("pose les cookies à partir d'un access token valide (liaison QR Web)", async () => {
      const user = await registerTestUser(app, { username: `auth_e2e_adopt_${Date.now()}` });

      const res = await request(app.getHttpServer())
        .post('/api/auth/web/adopt-tokens')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ refreshToken: user.refreshToken })
        .expect(204);

      const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
      expect(raw?.some((c) => c.startsWith('glotta_access='))).toBe(true);
      expect(raw?.some((c) => c.startsWith('glotta_refresh='))).toBe(true);
    });

    it('refuse sans access token valide', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/web/adopt-tokens')
        .send({ refreshToken: 'peu-importe' })
        .expect(401);
    });
  });
});
