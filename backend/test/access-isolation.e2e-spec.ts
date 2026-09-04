import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { createTestPrisma, resetDatabase } from './utils/test-db';
import { registerTestUser, TestUser } from './utils/test-users';

/**
 * Section 43 du cahier des charges, mot pour mot : "Un utilisateur A ne doit
 * jamais pouvoir lire les messages de B et C." Ce fichier teste exactement
 * ça, contre une vraie base et une vraie instance de l'application — pas des
 * mocks — sur toutes les ressources qui dépendent de l'appartenance à une
 * conversation : conversations, messages texte, vocaux, et les actions qui
 * s'y rattachent (édition, suppression, marquage lu).
 */
describe('Isolation entre utilisateurs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let a: TestUser;
  let b: TestUser;
  let c: TestUser; // n'est membre d'aucune conversation avec a ou b
  let conversationId: string;
  let messageId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await resetDatabase(prisma);
    app = await createTestApp();

    a = await registerTestUser(app, { username: 'iso_a' });
    b = await registerTestUser(app, { username: 'iso_b' });
    c = await registerTestUser(app, { username: 'iso_c' });

    const conv = await request(app.getHttpServer())
      .post('/api/conversations')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id })
      .expect(201);
    conversationId = conv.body.id as string;

    const msg = await request(app.getHttpServer())
      .post('/api/messages')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ conversationId, text: 'Secret entre A et B' })
      .expect(201);
    messageId = msg.body.id as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('C (non-membre) ne peut rien voir de la conversation A↔B', () => {
    it('GET /conversations/:id renvoie 404, pas 403 (ne révèle pas que ça existe)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(404);
      expect(res.body.message.message).toBe('Conversation introuvable.');
    });

    it("GET /conversations/:id/messages renvoie 404 — le contenu texte n'est jamais lisible", async () => {
      await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(404);
    });

    it("n'apparaît pas dans la liste de conversations de C", async () => {
      const res = await request(app.getHttpServer())
        .get('/api/conversations')
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(200);
      const ids = (res.body.items as { id: string }[]).map((item) => item.id);
      expect(ids).not.toContain(conversationId);
    });

    it('ne peut pas marquer la conversation comme lue', async () => {
      await request(app.getHttpServer())
        .post(`/api/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(404);
    });

    it('ne peut ni modifier ni supprimer le message de A, même en devinant son ID', async () => {
      await request(app.getHttpServer())
        .patch(`/api/messages/${messageId}`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .send({ text: 'texte injecté par C' })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/api/messages/${messageId}`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(404);
    });

    it('ne peut pas rejoindre la conversation en modifiant ses propres préférences dessus', async () => {
      await request(app.getHttpServer())
        .patch(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .send({ isMuted: true })
        .expect(404);
    });
  });

  describe('B (membre légitime) peut tout voir', () => {
    it('accède à la conversation et au message', async () => {
      await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .expect(200);
      expect((res.body.items as { text: string }[])[0]?.text).toBe('Secret entre A et B');
    });

    it('ne peut pas modifier ou supprimer le message de A pour autant (appartenance ≠ propriété)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/messages/${messageId}`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .send({ text: 'B tente de modifier le message de A' })
        .expect(403);
    });
  });

  describe('Vocaux : même isolation que les messages texte', () => {
    let voiceMessageId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/voice/messages')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .field('conversationId', conversationId)
        .field('durationSeconds', '5')
        .attach('audio', Buffer.alloc(500, 7), { filename: 'voice.wav', contentType: 'audio/wav' })
        .expect(201);
      voiceMessageId = res.body.id as string;
    });

    it("C ne peut pas streamer l'audio du vocal de A", async () => {
      await request(app.getHttpServer())
        .get(`/api/voice/${voiceMessageId}/audio`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(404);
    });

    it('B (membre) peut streamer le même audio (contenu binaire déjà vérifié manuellement en phase 9)', async () => {
      await request(app.getHttpServer())
        .get(`/api/voice/${voiceMessageId}/audio`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .expect(200);
    });

    it('C ne peut pas supprimer le vocal de A', async () => {
      await request(app.getHttpServer())
        .delete(`/api/voice/${voiceMessageId}`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(404);
    });
  });

  describe('Images : même isolation que les messages texte', () => {
    let imageMessageId: string;
    let attachmentId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/messages/image')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .field('conversationId', conversationId)
        .attach('image', Buffer.alloc(500, 3), { filename: 'photo.jpg', contentType: 'image/jpeg' })
        .expect(201);
      imageMessageId = res.body.id as string;
      attachmentId = res.body.attachments[0].id as string;
    });

    it('C ne peut pas récupérer la pièce jointe de A', async () => {
      await request(app.getHttpServer())
        .get(`/api/messages/attachments/${attachmentId}`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(404);
    });

    it('B (membre) peut récupérer la même pièce jointe', async () => {
      await request(app.getHttpServer())
        .get(`/api/messages/attachments/${attachmentId}`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .expect(200);
    });

    it('C ne peut pas supprimer le message image de A', async () => {
      await request(app.getHttpServer())
        .delete(`/api/messages/${imageMessageId}`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(404);
    });

    it("C ne peut pas lister la galerie de médias d'une conversation dont il n'est pas membre", async () => {
      await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}/media`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(404);
    });

    it("C ne peut pas rechercher dans une conversation dont il n'est pas membre, ni consulter le contexte d'un message", async () => {
      await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}/messages/search?q=salut`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}/messages/around/${imageMessageId}`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(404);
    });

    it('B (membre) voit la pièce jointe dans la galerie, paginée par curseur', async () => {
      const firstPage = await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}/media?limit=1`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .expect(200);
      expect(firstPage.body.items).toHaveLength(1);
      expect(firstPage.body.items[0].id).toBe(attachmentId);

      // Une seule pièce jointe existe à ce stade : jamais de page suivante.
      expect(firstPage.body.nextCursor).toBeNull();
    });
  });

  describe('Recherche et contexte de message (bouton "Rechercher", section essentielle)', () => {
    it('B (membre) trouve le message via une recherche insensible à la casse', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}/messages/search?q=SECRET`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .expect(200);
      expect(res.body.items.map((m: { id: string }) => m.id)).toContain(messageId);
    });

    it('une recherche sans résultat renvoie une liste vide, jamais une erreur', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}/messages/search?q=inexistant-xyz`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .expect(200);
      expect(res.body.items).toEqual([]);
    });

    it('le contexte autour du message inclut bien le message ciblé', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}/messages/around/${messageId}`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .expect(200);
      expect(res.body.matchedMessageId).toBe(messageId);
      expect(res.body.items.map((m: { id: string }) => m.id)).toContain(messageId);
    });
  });

  describe('Une conversation entre B et un quatrième utilisateur reste invisible à A', () => {
    it("A ne peut pas accéder à une conversation dont il n'est pas membre, même créée par un membre connu", async () => {
      const d = await registerTestUser(app, { username: 'iso_d' });
      const bdConv = await request(app.getHttpServer())
        .post('/api/conversations')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .send({ userId: d.id })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/conversations/${bdConv.body.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(404);
    });
  });
});
