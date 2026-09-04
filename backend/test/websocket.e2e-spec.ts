import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { createTestPrisma, resetDatabase } from './utils/test-db';
import { registerTestUser, TestUser } from './utils/test-users';

jest.setTimeout(15_000);

describe('WebSocket (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let baseUrl: string;
  let a: TestUser;
  let b: TestUser;
  let c: TestUser; // n'est membre d'aucune conversation avec a ou b
  let conversationId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    app = await createTestApp();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    a = await registerTestUser(app, { username: 'ws_a' });
    b = await registerTestUser(app, { username: 'ws_b' });
    c = await registerTestUser(app, { username: 'ws_c' });

    const conv = await request(app.getHttpServer())
      .post('/api/conversations')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id })
      .expect(201);
    conversationId = conv.body.id as string;
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

  it('refuse une connexion sans token', async () => {
    await expect(
      new Promise<void>((resolve, reject) => {
        const socket = io(baseUrl, {
          auth: {},
          reconnection: false,
          forceNew: true,
          transports: ['websocket'],
        });
        const timeout = setTimeout(() => reject(new Error('ni connect ni disconnect reçu')), 5000);
        socket.on('connect_error', () => {
          clearTimeout(timeout);
          resolve();
        });
        socket.on('disconnect', () => {
          clearTimeout(timeout);
          resolve();
        });
      }),
    ).resolves.toBeUndefined();
  });

  it('accepte une connexion avec un token valide', async () => {
    const socket = await connect(a.accessToken);
    expect(socket.connected).toBe(true);
    socket.close();
  });

  it('relaie message:typing au membre (B) mais jamais à un non-membre (C)', async () => {
    const socketA = await connect(a.accessToken);
    const socketB = await connect(b.accessToken);
    const socketC = await connect(c.accessToken);

    const bReceived = new Promise((resolve) => socketB.once('message:typing', resolve));
    let cReceivedSomething = false;
    socketC.once('message:typing', () => {
      cReceivedSomething = true;
    });

    socketA.emit('message:typing', { conversationId });

    const payload = await bReceived;
    expect(payload).toMatchObject({ conversationId, userId: a.id });

    // Laisse une chance à un éventuel (mauvais) envoi à C de se produire.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(cReceivedSomething).toBe(false);

    socketA.close();
    socketB.close();
    socketC.close();
  });

  it("ne relaie rien du tout si l'émetteur prétend écrire dans une conversation dont il n'est pas membre", async () => {
    const socketC = await connect(c.accessToken);
    const socketB = await connect(b.accessToken);

    let bReceivedSomething = false;
    socketB.once('message:typing', () => {
      bReceivedSomething = true;
    });

    // C n'est pas membre de conversationId (A↔B) : ne doit rien déclencher.
    socketC.emit('message:typing', { conversationId });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(bReceivedSomething).toBe(false);

    socketC.close();
    socketB.close();
  });

  it('diffuse message:new en temps réel au destinataire quand un message est envoyé via REST', async () => {
    const socketB = await connect(b.accessToken);
    const received = new Promise((resolve) => socketB.once('message:new', resolve));

    await request(app.getHttpServer())
      .post('/api/messages')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ conversationId, text: 'Salut en temps réel' })
      .expect(201);

    const payload = await received;
    expect(payload).toMatchObject({ text: 'Salut en temps réel', senderId: a.id });

    socketB.close();
  });

  /**
   * Section 14-18 du cahier des charges : jamais de notification "nouveau
   * message" redondante quand le destinataire a déjà la conversation
   * ouverte à l'écran — vérifié ici via de vrais sockets et une vraie
   * requête REST, pas seulement au niveau du service (voir
   * NotificationsService.create + PresenceService.isViewingConversation).
   */
  it('ne crée aucune notification (ni notification:new) pour un message reçu dans une conversation déjà ouverte', async () => {
    const socketB = await connect(b.accessToken);
    socketB.emit('conversation:opened', { conversationId });
    await new Promise((resolve) => setTimeout(resolve, 200)); // laisse le serveur traiter l'événement avant d'envoyer

    let notificationReceived = false;
    socketB.once('notification:new', () => {
      notificationReceived = true;
    });
    const messageReceived = new Promise((resolve) => socketB.once('message:new', resolve));

    const sent = await request(app.getHttpServer())
      .post('/api/messages')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ conversationId, text: 'Message pendant que B regarde déjà' })
      .expect(201);

    // Le message lui-même continue d'arriver en temps réel (c'est la
    // notification "en plus" — badge/notification-center — qui doit
    // disparaître, jamais les données de la conversation elle-même).
    await expect(messageReceived).resolves.toMatchObject({ id: sent.body.id });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(notificationReceived).toBe(false);

    const notifications = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    expect(
      notifications.body.items.some(
        (n: { payload?: { messageId?: string } }) => n.payload?.messageId === sent.body.id,
      ),
    ).toBe(false);

    socketB.close();
  });

  it('recrée la notification normalement une fois la conversation refermée (conversation:closed)', async () => {
    const socketB = await connect(b.accessToken);
    socketB.emit('conversation:opened', { conversationId });
    await new Promise((resolve) => setTimeout(resolve, 200));
    socketB.emit('conversation:closed', {});
    await new Promise((resolve) => setTimeout(resolve, 200));

    const notificationReceived = new Promise((resolve) => socketB.once('notification:new', resolve));

    const sent = await request(app.getHttpServer())
      .post('/api/messages')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ conversationId, text: 'Message après fermeture de la conversation' })
      .expect(201);

    await notificationReceived;

    const notifications = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    expect(
      notifications.body.items.some(
        (n: { payload?: { messageId?: string } }) => n.payload?.messageId === sent.body.id,
      ),
    ).toBe(true);

    socketB.close();
  });

  /**
   * Section 21-22 du cahier des charges : lire une conversation sur un
   * appareil doit se répercuter sur les AUTRES appareils connectés du même
   * compte (badge non-lu à zéro), pas seulement chez l'autre participant
   * (accusé de lecture ✓✓) — vérifié avec deux vraies connexions socket
   * pour le compte A.
   */
  it('propage message:read aux autres appareils du lecteur lui-même, pas seulement à l’autre participant', async () => {
    const socketA1 = await connect(a.accessToken);
    const socketA2 = await connect(a.accessToken); // même compte, "autre appareil"
    const socketB = await connect(b.accessToken);

    await request(app.getHttpServer())
      .post('/api/messages')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .send({ conversationId, text: 'Message à lire depuis un autre appareil' })
      .expect(201);

    const readOnA2 = new Promise((resolve) => socketA2.once('message:read', resolve));
    const readOnB = new Promise((resolve) => socketB.once('message:read', resolve));

    await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);

    const payloadOnA2 = (await readOnA2) as { conversationId: string; readerId: string };
    expect(payloadOnA2).toMatchObject({ conversationId, readerId: a.id });
    const payloadOnB = (await readOnB) as { conversationId: string; readerId: string };
    expect(payloadOnB).toMatchObject({ conversationId, readerId: a.id });

    socketA1.close();
    socketA2.close();
    socketB.close();
  });
});
