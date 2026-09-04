import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { createTestPrisma, resetDatabase } from './utils/test-db';
import { registerTestUser, TestUser } from './utils/test-users';

jest.setTimeout(15_000);

/**
 * Couvre le partage de contact et les demandes d'ajout de bout en bout via
 * de vraies requêtes REST + un vrai socket (jamais de simulation) — ce que
 * ne peut pas garantir ContactsService.spec.ts seul : que les routes sont
 * réellement câblées, que message:new est bien diffusé en temps réel pour
 * une carte de contact partagée, et que l'isolation entre utilisateurs
 * (jamais accéder à la demande ou à la carte d'un autre) tient réellement.
 */
describe('Contacts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let baseUrl: string;
  let a: TestUser;
  let b: TestUser;
  let c: TestUser;
  let convAB: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    app = await createTestApp();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    a = await registerTestUser(app, { username: 'contact_a' });
    b = await registerTestUser(app, { username: 'contact_b' });
    c = await registerTestUser(app, { username: 'contact_c' });

    const ab = await request(app.getHttpServer())
      .post('/api/conversations')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id })
      .expect(201);
    convAB = ab.body.id as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function connect(token: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(baseUrl, {
        auth: { token },
        reconnection: false,
        forceNew: true,
        transports: ['websocket'],
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err: Error) => reject(err));
    });
  }

  it('GET /contacts/status/:userId renvoie NONE avant toute demande', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/contacts/status/${b.id}`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    expect(res.body).toEqual({ status: 'NONE' });
  });

  it('déroule une demande de contact complète : envoi → visible des deux côtés → acceptation → contacts', async () => {
    const sent = await request(app.getHttpServer())
      .post('/api/contacts/requests')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id })
      .expect(201);
    expect(sent.body.status).toBe('PENDING');
    const requestId = sent.body.id as string;

    const statusForA = await request(app.getHttpServer())
      .get(`/api/contacts/status/${b.id}`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    expect(statusForA.body).toEqual({ status: 'PENDING_SENT' });

    const statusForB = await request(app.getHttpServer())
      .get(`/api/contacts/status/${a.id}`)
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    expect(statusForB.body).toEqual({ status: 'PENDING_RECEIVED' });

    const incoming = await request(app.getHttpServer())
      .get('/api/contacts/requests')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    expect(incoming.body).toContainEqual(
      expect.objectContaining({ id: requestId, user: expect.objectContaining({ id: a.id }) }),
    );

    await request(app.getHttpServer())
      .post(`/api/contacts/requests/${requestId}/accept`)
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(201);

    const contactsOfA = await request(app.getHttpServer())
      .get('/api/contacts')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    expect(contactsOfA.body).toContainEqual(expect.objectContaining({ id: b.id }));

    const contactsOfB = await request(app.getHttpServer())
      .get('/api/contacts')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    expect(contactsOfB.body).toContainEqual(expect.objectContaining({ id: a.id }));

    const notificationsOfA = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    expect(notificationsOfA.body.items).toContainEqual(
      expect.objectContaining({ type: 'CONTACT_ACCEPTED' }),
    );
  });

  it('refuse d’accepter ou de refuser la demande de quelqu’un d’autre', async () => {
    const sent = await request(app.getHttpServer())
      .post('/api/contacts/requests')
      .set('Authorization', `Bearer ${c.accessToken}`)
      .send({ userId: a.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/contacts/requests/${sent.body.id}/accept`)
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/contacts/requests/${sent.body.id}/decline`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(201);

    const statusForC = await request(app.getHttpServer())
      .get(`/api/contacts/status/${a.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(200);
    expect(statusForC.body).toEqual({ status: 'NONE' });
  });

  it('bloque puis débloque : une demande envoyée pendant le blocage est refusée, puis redevient possible', async () => {
    await request(app.getHttpServer())
      .post('/api/contacts/block')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: c.id })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/contacts/requests')
      .set('Authorization', `Bearer ${c.accessToken}`)
      .send({ userId: a.id })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/contacts/unblock')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: c.id })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/contacts/requests')
      .set('Authorization', `Bearer ${c.accessToken}`)
      .send({ userId: a.id })
      .expect(201);
  });

  it('POST /contacts/share publie une carte CONTACT_SHARE, diffusée en temps réel et hydratable via GET /contacts/message/:id', async () => {
    const socketB = await connect(b.accessToken);
    const received = new Promise((resolve) => socketB.once('message:new', resolve));

    const shareRes = await request(app.getHttpServer())
      .post('/api/contacts/share')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ conversationId: convAB, userId: c.id })
      .expect(201);
    expect(shareRes.body.type).toBe('CONTACT_SHARE');
    expect(shareRes.body.sharedContact).toMatchObject({ id: c.id });
    // Seules des informations publiques transitent — jamais email/téléphone.
    expect(shareRes.body.sharedContact.email).toBeUndefined();

    const payload = await received;
    expect(payload).toMatchObject({ type: 'CONTACT_SHARE', senderId: a.id });

    const hydrated = await request(app.getHttpServer())
      .get(`/api/contacts/message/${shareRes.body.id}`)
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    expect(hydrated.body.sharedContact).toMatchObject({ id: c.id });

    socketB.close();
  });

  it('refuse à un non-membre de la conversation d’hydrater une carte partagée', async () => {
    const shareRes = await request(app.getHttpServer())
      .post('/api/contacts/share')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ conversationId: convAB, userId: b.id })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/contacts/message/${shareRes.body.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(404);
  });
});
