import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { createTestPrisma, resetDatabase } from './utils/test-db';
import { registerTestUser, TestUser } from './utils/test-users';

/**
 * Section admin (dashboard/métriques, gestion des utilisateurs, modération) —
 * aucun endpoint ne permet de s'auto-promouvoir admin (voir AdminGuard,
 * prisma/seed.ts) : ce fichier promeut directement en base, exactement
 * comme le ferait ADMIN_BOOTSTRAP_EMAIL en conditions réelles.
 */
describe('Admin (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: TestUser;
  let regular: TestUser;
  let conversationId: string;
  let messageId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    app = await createTestApp();

    admin = await registerTestUser(app, { username: 'admin_e2e' });
    regular = await registerTestUser(app, { username: 'regular_e2e' });
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });

    const conv = await request(app.getHttpServer())
      .post('/api/conversations')
      .set('Authorization', `Bearer ${regular.accessToken}`)
      .send({ userId: admin.id })
      .expect(201);
    conversationId = conv.body.id as string;

    const msg = await request(app.getHttpServer())
      .post('/api/messages')
      .set('Authorization', `Bearer ${regular.accessToken}`)
      .send({ conversationId, text: 'Un message à signaler' })
      .expect(201);
    messageId = msg.body.id as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("Un utilisateur normal n'a accès à rien sous /admin", () => {
    it.each([
      ['get', '/api/admin/metrics'],
      ['get', '/api/admin/users'],
      ['get', '/api/admin/reports'],
    ] as const)('%s %s renvoie 403', async (method, path) => {
      await request(app.getHttpServer())
        [method](path)
        .set('Authorization', `Bearer ${regular.accessToken}`)
        .expect(403);
    });

    it('PATCH /api/admin/users/:id renvoie 403', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/users/${regular.id}`)
        .set('Authorization', `Bearer ${regular.accessToken}`)
        .send({ isActive: false })
        .expect(403);
    });
  });

  describe('Un admin accède au tableau de bord et à la liste des utilisateurs', () => {
    it('GET /api/admin/metrics renvoie des compteurs réels', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/metrics')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      expect(res.body.users.total).toBeGreaterThanOrEqual(2);
      expect(res.body.messagesSent.total).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/admin/users trouve le compte régulier', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/users?q=regular_e2e')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      expect(res.body.items.map((u: { id: string }) => u.id)).toContain(regular.id);
    });

    it('PATCH /api/admin/users/:id désactive un compte, qui ne peut plus se reconnecter ensuite', async () => {
      const target = await registerTestUser(app, { username: 'to_deactivate' });

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${target.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ isActive: false })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: target.username, password: 'un-mot-de-passe-solide' })
        .expect(401);
    });
  });

  describe('Modération : signalement puis traitement par un admin', () => {
    let reportId: string;

    it('un utilisateur normal peut signaler un message', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/reports')
        .set('Authorization', `Bearer ${regular.accessToken}`)
        .send({ targetType: 'MESSAGE', targetId: messageId, reason: 'Contenu inapproprié' })
        .expect(201);
      reportId = res.body.id as string;
      expect(res.body.status).toBe('PENDING');
    });

    it('refuse de signaler une cible qui n’existe pas', async () => {
      await request(app.getHttpServer())
        .post('/api/reports')
        .set('Authorization', `Bearer ${regular.accessToken}`)
        .send({ targetType: 'MESSAGE', targetId: 'nope', reason: 'x' })
        .expect(404);
    });

    it("l'admin voit le signalement en attente", async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/reports?status=PENDING')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      const found = res.body.items.find((r: { id: string }) => r.id === reportId);
      expect(found).toBeDefined();
      expect(found.targetPreview).toBe('Un message à signaler');
    });

    it('REMOVE_CONTENT supprime réellement le message, et le signalement passe RESOLVED', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/reports/${reportId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ action: 'REMOVE_CONTENT' })
        .expect(200);

      // Même assertion que pour une suppression normale : deletedAt posé,
      // le texte n'est plus jamais renvoyé (voir access-isolation.e2e-spec.ts).
      const res = await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${regular.accessToken}`)
        .expect(200);
      const deleted = res.body.items.find((m: { id: string }) => m.id === messageId);
      expect(deleted.text).toBeNull();
    });

    it('un signalement déjà traité ne peut pas être retraité', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/reports/${reportId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ action: 'DISMISS' })
        .expect(400);
    });
  });
});
