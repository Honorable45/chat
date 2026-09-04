import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { io, Socket } from 'socket.io-client';
import { createTestApp } from './utils/test-app';
import { createTestPrisma, resetDatabase } from './utils/test-db';
import { registerTestUser, TestUser } from './utils/test-users';

jest.setTimeout(15_000);

/**
 * Régression dédiée : toutes les autres suites e2e tournent avec
 * DISABLE_RATE_LIMITING=true (.env.test) pour ne pas déclencher le vrai
 * rate limiting pendant des inscriptions/connexions en rafale — ce qui les
 * rend structurellement incapables d'attraper un bug qui ne se produit que
 * lorsque le rate limiting HTTP (ThrottlerGuard, APP_GUARD global) est
 * réellement actif sur un contexte WebSocket. C'est exactement ce qui s'est
 * produit en conditions réelles (dev, rate limiting actif) : chaque message
 * "message:typing" échouait avec `TypeError: res.header is not a function`
 * — ThrottlerGuard suppose un objet réponse Express, absent en WebSocket.
 * Corrigé par @SkipThrottle() sur EventsGateway (voir events.gateway.ts).
 */
describe('WebSocket avec rate limiting HTTP actif (e2e, régression)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let baseUrl: string;
  let a: TestUser;
  let b: TestUser;
  let conversationId: string;
  let previousFlag: string | undefined;

  beforeAll(async () => {
    previousFlag = process.env.DISABLE_RATE_LIMITING;
    process.env.DISABLE_RATE_LIMITING = 'false';

    prisma = createTestPrisma();
    await resetDatabase(prisma);
    app = await createTestApp();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    a = await registerTestUser(app, { username: 'throttle_ws_a' });
    b = await registerTestUser(app, { username: 'throttle_ws_b' });

    const request = (await import('supertest')).default;
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
    process.env.DISABLE_RATE_LIMITING = previousFlag;
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

  it("relaie message:typing sans lever d'exception quand le rate limiting HTTP est actif", async () => {
    const socketA = await connect(a.accessToken);
    const socketB = await connect(b.accessToken);

    const received = new Promise((resolve) => socketB.once('message:typing', resolve));
    const exceptionReceived = new Promise((resolve) => socketA.once('exception', resolve));

    socketA.emit('message:typing', { conversationId });

    const result = await Promise.race([
      received.then((payload) => ({ kind: 'received' as const, payload })),
      exceptionReceived.then((payload) => ({ kind: 'exception' as const, payload })),
    ]);

    expect(result.kind).toBe('received');
    expect(result.payload).toMatchObject({ conversationId, userId: a.id });

    socketA.close();
    socketB.close();
  });
});
