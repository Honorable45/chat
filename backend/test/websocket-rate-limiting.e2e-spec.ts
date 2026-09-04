import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { createTestPrisma, resetDatabase } from './utils/test-db';
import { registerTestUser, TestUser } from './utils/test-users';

jest.setTimeout(15_000);

/**
 * Régression dédiée (audit de sécurité) : ThrottlerGuard (HTTP) ne peut pas
 * s'appliquer aux WebSockets (voir @SkipThrottle() sur EventsGateway/
 * CallsGateway), ce qui laissait chaque événement entrant sans AUCUNE
 * limite de débit — un compte authentifié pouvait spammer `message:typing`
 * ou la signalisation d'appel sans retenue. Comblé par SocketRateLimiter
 * (voir socket-rate-limiter.ts), vérifié ici contre une vraie connexion
 * WebSocket plutôt que seulement au niveau de la classe utilitaire (déjà
 * couverte par socket-rate-limiter.spec.ts).
 */
describe('Limite de débit WebSocket (e2e, audit de sécurité)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let baseUrl: string;
  let a: TestUser;
  let b: TestUser;
  let conversationId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    app = await createTestApp();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    a = await registerTestUser(app, { username: 'ratelimit_ws_a' });
    b = await registerTestUser(app, { username: 'ratelimit_ws_b' });

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

  function connect(token: string, namespace = ''): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(`${baseUrl}${namespace}`, {
        auth: { token },
        reconnection: false,
        forceNew: true,
        transports: ['websocket'],
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err: Error) => reject(err));
    });
  }

  it("plafonne 'message:typing' au-delà de la limite plutôt que de tout relayer sans borne", async () => {
    const socketA = await connect(a.accessToken);
    const socketB = await connect(b.accessToken);

    let received = 0;
    socketB.on('message:typing', () => {
      received += 1;
    });

    // La limite (voir events.gateway.ts : typingLimiter) est de 20 par
    // fenêtre de 10s — on en envoie nettement plus pour vérifier qu'un
    // excédent est bien absorbé plutôt que relayé.
    const burst = 40;
    for (let i = 0; i < burst; i += 1) {
      socketA.emit('message:typing', { conversationId });
    }

    // Laisse le temps aux événements autorisés d'être relayés (chacun
    // déclenche une vraie requête base de données côté serveur).
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(received).toBeGreaterThan(0);
    expect(received).toBeLessThan(burst);
    expect(received).toBeLessThanOrEqual(20);

    socketA.close();
    socketB.close();
  });

  it("plafonne les actions d'appel ('call:invite') au-delà de la limite plutôt que de toutes les traiter", async () => {
    const socketA = await connect(a.accessToken, '/calls');
    const socketB = await connect(b.accessToken, '/calls');
    socketB.on('call:incoming', () => {
      // Consomme l'événement pour ne pas laisser le socket B en attente —
      // seul le nombre d'invitations réellement traitées par A nous intéresse ici.
    });

    function invite(): Promise<{ ok: boolean; error?: string }> {
      return new Promise((resolve) => {
        socketA.emit(
          'call:invite',
          { conversationId, calleeId: b.id, type: 'AUDIO' },
          (ack: { ok: boolean; error?: string }) => resolve(ack),
        );
      });
    }

    // La limite (voir calls.gateway.ts : actionLimiter) est de 20 par
    // fenêtre de 10s — on en envoie nettement plus. Chaque invitation
    // acceptée échoue de toute façon métier-parlant après la première (appel
    // déjà en cours), seul le message d'erreur renvoyé nous intéresse ici :
    // "Trop de requêtes" doit apparaître avant d'épuiser les 25 tentatives.
    const attempts = 25;
    const results: { ok: boolean; error?: string }[] = [];
    for (let i = 0; i < attempts; i += 1) {
      results.push(await invite());
    }

    const rateLimited = results.filter(
      (r) => r.error === 'Trop de requêtes, réessayez dans quelques secondes.',
    );
    expect(rateLimited.length).toBeGreaterThan(0);

    socketA.close();
    socketB.close();
  });
});
