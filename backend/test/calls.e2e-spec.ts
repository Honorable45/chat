import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { createTestPrisma, resetDatabase } from './utils/test-db';
import { registerTestUser, TestUser } from './utils/test-users';

jest.setTimeout(15_000);

interface AckResponse {
  ok: boolean;
  error?: string;
  busy?: boolean;
  callMessage?: {
    id: string;
    call: { id: string; status: string; durationSeconds: number | null };
  };
}

/**
 * Couvre la signalisation d'appel de bout en bout via de vrais sockets sur
 * le namespace "/calls" (jamais de simulation) — ce que ne peut pas garantir
 * CallsService.spec.ts seul : que le namespace authentifie réellement,
 * relaie au bon utilisateur et au bon utilisateur seulement, et que l'état
 * persisté (GET /calls/message/:id) reflète bien ce que les sockets ont vu.
 */
describe('Calls (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let baseUrl: string;
  let a: TestUser;
  let b: TestUser;
  let c: TestUser;
  let convAB: string;
  let convBC: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    app = await createTestApp();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    a = await registerTestUser(app, { username: 'call_a' });
    b = await registerTestUser(app, { username: 'call_b' });
    c = await registerTestUser(app, { username: 'call_c' });

    const ab = await request(app.getHttpServer())
      .post('/api/conversations')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id })
      .expect(201);
    convAB = ab.body.id as string;

    const bc = await request(app.getHttpServer())
      .post('/api/conversations')
      .set('Authorization', `Bearer ${c.accessToken}`)
      .send({ userId: b.id })
      .expect(201);
    convBC = bc.body.id as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function connect(token: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(`${baseUrl}/calls`, {
        auth: { token },
        reconnection: false,
        forceNew: true,
        transports: ['websocket'],
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err: Error) => reject(err));
    });
  }

  function ack(socket: Socket, event: string, payload: unknown): Promise<AckResponse> {
    return new Promise((resolve) => socket.emit(event, payload, resolve));
  }

  it('renvoie au moins un serveur STUN sur GET /calls/ice-servers', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/calls/ice-servers')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).toContain('stun:');
  });

  it('refuse une connexion au namespace /calls sans token', async () => {
    await expect(
      new Promise<void>((resolve, reject) => {
        const socket = io(`${baseUrl}/calls`, { auth: {}, reconnection: false, forceNew: true });
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

  it('déroule un appel complet : invitation → acceptation → signalisation relayée → fin, et persiste la durée', async () => {
    const socketA = await connect(a.accessToken);
    const socketB = await connect(b.accessToken);

    const incoming = new Promise((resolve) => socketB.once('call:incoming', resolve));
    const inviteRes = await ack(socketA, 'call:invite', { conversationId: convAB, calleeId: b.id });
    expect(inviteRes.ok).toBe(true);
    expect(inviteRes.busy).toBe(false);
    const callId = inviteRes.callMessage!.call.id;
    const messageId = inviteRes.callMessage!.id;

    const incomingPayload = (await incoming) as { call: { id: string; status: string } };
    expect(incomingPayload.call.id).toBe(callId);
    expect(incomingPayload.call.status).toBe('RINGING');

    const accepted = new Promise((resolve) => socketA.once('call:accepted', resolve));
    const acceptRes = await ack(socketB, 'call:accept', { callId });
    expect(acceptRes.ok).toBe(true);
    expect((await accepted) as { call: { status: string } }).toMatchObject({
      call: { status: 'ACTIVE' },
    });

    // Signalisation SDP/ICE : contenu opaque, relayé tel quel au seul autre participant.
    const offerReceived = new Promise((resolve) => socketB.once('call:offer', resolve));
    socketA.emit('call:offer', { callId, data: { type: 'offer', sdp: 'fake-sdp-a' } });
    expect(await offerReceived).toEqual({ callId, data: { type: 'offer', sdp: 'fake-sdp-a' } });

    const answerReceived = new Promise((resolve) => socketA.once('call:answer', resolve));
    socketB.emit('call:answer', { callId, data: { type: 'answer', sdp: 'fake-sdp-b' } });
    expect(await answerReceived).toEqual({ callId, data: { type: 'answer', sdp: 'fake-sdp-b' } });

    const iceReceived = new Promise((resolve) => socketB.once('call:ice-candidate', resolve));
    socketA.emit('call:ice-candidate', { callId, data: { candidate: 'fake-candidate' } });
    expect(await iceReceived).toEqual({ callId, data: { candidate: 'fake-candidate' } });

    await new Promise((resolve) => setTimeout(resolve, 1100)); // pour une durée mesurable > 0
    const ended = new Promise((resolve) => socketA.once('call:ended', resolve));
    const endRes = await ack(socketB, 'call:end', { callId });
    expect(endRes.ok).toBe(true);
    expect((await ended) as { call: { status: string } }).toMatchObject({
      call: { status: 'ENDED' },
    });

    const details = await request(app.getHttpServer())
      .get(`/api/calls/message/${messageId}`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    expect(details.body.call.status).toBe('ENDED');
    expect(details.body.call.durationSeconds).toBeGreaterThanOrEqual(1);

    socketA.close();
    socketB.close();
  });

  it('expose la langue d’envoi de chaque partie et gère le choix de langue de réception', async () => {
    const socketA = await connect(a.accessToken);
    const socketB = await connect(b.accessToken);

    const incoming = new Promise<{ call: { id: string; callerLanguage: string | null } }>(
      (resolve) => socketB.once('call:incoming', resolve),
    );
    const inviteRes = await ack(socketA, 'call:invite', { conversationId: convAB, calleeId: b.id });
    const callId = inviteRes.callMessage!.call.id;

    // La langue d'envoi (profil) est portée par le DTO d'appel — sert au
    // client à pré-remplir « recevoir en… » sur l'écran d'appel entrant.
    const incomingPayload = await incoming;
    expect(incomingPayload.call.callerLanguage).toBe('fr');

    // L'appelé décroche en demandant une langue de réception valide.
    const acceptRes = await ack(socketB, 'call:accept', { callId, receiveLanguage: 'en' });
    expect(acceptRes.ok).toBe(true);

    // L'appelant change sa propre langue de réception en cours d'appel :
    // l'autre partie est prévenue via call:language-changed.
    const languageChanged = new Promise<{ userId: string; language: string | null }>((resolve) =>
      socketB.once('call:language-changed', resolve),
    );
    const setRes = await ack(socketA, 'call:set-language', { callId, language: 'es' });
    expect(setRes.ok).toBe(true);
    expect(await languageChanged).toMatchObject({ userId: a.id, language: 'es' });

    // Une langue inconnue est refusée proprement (jamais d'exception non gérée).
    const badRes = await ack(socketA, 'call:set-language', { callId, language: 'zz' });
    expect(badRes.ok).toBe(false);

    // Fragment de voix : aucun fournisseur configuré en test → aucune
    // traduction émise, mais surtout aucun plantage.
    let translated = false;
    socketB.once('call:translated-speech', () => {
      translated = true;
    });
    socketA.emit('call:speech-chunk', {
      callId,
      audio: Buffer.from('not-real-audio').toString('base64'),
      mimeType: 'audio/webm',
      seq: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(translated).toBe(false);

    await ack(socketB, 'call:end', { callId });
    socketA.close();
    socketB.close();
  });

  it("relaie 'call:rejected' quand l'appelé refuse, et persiste DECLINED", async () => {
    const socketA = await connect(a.accessToken);
    const socketB = await connect(b.accessToken);

    const inviteRes = await ack(socketA, 'call:invite', { conversationId: convAB, calleeId: b.id });
    const callId = inviteRes.callMessage!.call.id;
    const messageId = inviteRes.callMessage!.id;

    const rejected = new Promise((resolve) => socketA.once('call:rejected', resolve));
    const rejectRes = await ack(socketB, 'call:reject', { callId });
    expect(rejectRes.ok).toBe(true);
    expect((await rejected) as { call: { status: string } }).toMatchObject({
      call: { status: 'DECLINED' },
    });

    const details = await request(app.getHttpServer())
      .get(`/api/calls/message/${messageId}`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    expect(details.body.call.status).toBe('DECLINED');

    socketA.close();
    socketB.close();
  });

  it("renvoie busy:true sans sonner chez l'appelé déjà en communication", async () => {
    const socketA = await connect(a.accessToken);
    const socketB = await connect(b.accessToken);
    const socketC = await connect(c.accessToken);

    const inviteAB = await ack(socketA, 'call:invite', { conversationId: convAB, calleeId: b.id });
    expect(inviteAB.ok && !inviteAB.busy).toBe(true);

    let bGotAnotherRing = false;
    socketB.once('call:incoming', () => {
      bGotAnotherRing = true;
    });

    const inviteCB = await ack(socketC, 'call:invite', { conversationId: convBC, calleeId: b.id });
    expect(inviteCB).toMatchObject({ ok: true, busy: true });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(bGotAnotherRing).toBe(false);

    // Nettoyage : l'appelant A raccroche l'appel resté en sonnerie.
    await ack(socketA, 'call:cancel', { callId: inviteAB.callMessage!.call.id });

    socketA.close();
    socketB.close();
    socketC.close();
  });

  it("marque l'appel MISSED et prévient l'appelé quand l'appelant se déconnecte pendant la sonnerie", async () => {
    const socketA = await connect(a.accessToken);
    const socketB = await connect(b.accessToken);

    const inviteRes = await ack(socketA, 'call:invite', { conversationId: convAB, calleeId: b.id });
    const messageId = inviteRes.callMessage!.id;

    const cancelled = new Promise((resolve) => socketB.once('call:cancelled', resolve));
    socketA.close(); // fermeture brutale, jamais de call:cancel explicite

    expect((await cancelled) as { call: { status: string } }).toMatchObject({
      call: { status: 'MISSED' },
    });

    const details = await request(app.getHttpServer())
      .get(`/api/calls/message/${messageId}`)
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    expect(details.body.call.status).toBe('MISSED');

    socketB.close();
  });

  it('GET /calls liste l’historique avec la bonne direction pour chaque participant', async () => {
    const socketA = await connect(a.accessToken);
    const socketB = await connect(b.accessToken);

    const inviteRes = await ack(socketA, 'call:invite', { conversationId: convAB, calleeId: b.id });
    await ack(socketA, 'call:cancel', { callId: inviteRes.callMessage!.call.id });

    const asA = await request(app.getHttpServer())
      .get('/api/calls')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    const entryA = asA.body.items.find(
      (i: { messageId: string }) => i.messageId === inviteRes.callMessage!.id,
    );
    expect(entryA).toMatchObject({
      direction: 'outgoing',
      status: 'MISSED',
      otherUser: { id: b.id },
    });

    const asB = await request(app.getHttpServer())
      .get('/api/calls')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    const entryB = asB.body.items.find(
      (i: { messageId: string }) => i.messageId === inviteRes.callMessage!.id,
    );
    expect(entryB).toMatchObject({
      direction: 'incoming',
      status: 'MISSED',
      otherUser: { id: a.id },
    });

    socketA.close();
    socketB.close();
  });

  it("ne relaie aucune signalisation à un utilisateur qui ne participe pas à l'appel", async () => {
    const socketA = await connect(a.accessToken);
    const socketB = await connect(b.accessToken);
    const socketC = await connect(c.accessToken);

    const inviteRes = await ack(socketA, 'call:invite', { conversationId: convAB, calleeId: b.id });
    const callId = inviteRes.callMessage!.call.id;

    let cReceivedSomething = false;
    socketC.once('call:offer', () => {
      cReceivedSomething = true;
    });

    // C tente d'injecter une offre dans un appel auquel il ne participe pas.
    socketC.emit('call:offer', { callId, data: { type: 'offer', sdp: 'intrus' } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(cReceivedSomething).toBe(false);

    await ack(socketA, 'call:cancel', { callId });
    socketA.close();
    socketB.close();
    socketC.close();
  });

  /**
   * Section 21-22 du cahier des charges : un appel accepté (ou refusé) sur
   * un appareil doit interrompre la sonnerie sur les AUTRES appareils
   * connectés du même utilisateur — vérifié ici avec deux vraies connexions
   * socket pour le même compte B (deux "appareils"), jamais simulé.
   */
  it('interrompt la sonnerie sur les autres appareils de l’appelé quand il accepte depuis l’un d’eux', async () => {
    const socketA = await connect(a.accessToken);
    const socketB1 = await connect(b.accessToken);
    const socketB2 = await connect(b.accessToken); // même compte, "autre appareil"

    const incomingOnBoth = Promise.all([
      new Promise((resolve) => socketB1.once('call:incoming', resolve)),
      new Promise((resolve) => socketB2.once('call:incoming', resolve)),
    ]);
    const inviteRes = await ack(socketA, 'call:invite', { conversationId: convAB, calleeId: b.id });
    await incomingOnBoth; // sonne bien sur les deux appareils

    const resolvedOnB2 = new Promise((resolve) =>
      socketB2.once('call:resolved-elsewhere', resolve),
    );
    let b1ReceivedResolvedElsewhere = false;
    socketB1.once('call:resolved-elsewhere', () => {
      b1ReceivedResolvedElsewhere = true;
    });

    const acceptRes = await ack(socketB1, 'call:accept', {
      callId: inviteRes.callMessage!.call.id,
    });
    expect(acceptRes.ok).toBe(true);

    const payload = (await resolvedOnB2) as { call: { status: string } };
    expect(payload.call.status).toBe('ACTIVE');
    // Jamais renvoyé à l'appareil qui vient lui-même d'accepter (voir `client.to(...)` côté gateway).
    expect(b1ReceivedResolvedElsewhere).toBe(false);

    await ack(socketB1, 'call:end', { callId: inviteRes.callMessage!.call.id });
    socketA.close();
    socketB1.close();
    socketB2.close();
  });

  it('interrompt aussi la sonnerie sur les autres appareils quand l’appel est refusé depuis l’un d’eux', async () => {
    const socketA = await connect(a.accessToken);
    const socketB1 = await connect(b.accessToken);
    const socketB2 = await connect(b.accessToken);

    const inviteRes = await ack(socketA, 'call:invite', { conversationId: convAB, calleeId: b.id });

    const resolvedOnB2 = new Promise((resolve) =>
      socketB2.once('call:resolved-elsewhere', resolve),
    );
    const rejectRes = await ack(socketB1, 'call:reject', {
      callId: inviteRes.callMessage!.call.id,
    });
    expect(rejectRes.ok).toBe(true);

    const payload = (await resolvedOnB2) as { call: { status: string } };
    expect(payload.call.status).toBe('DECLINED');

    socketA.close();
    socketB1.close();
    socketB2.close();
  });
});
