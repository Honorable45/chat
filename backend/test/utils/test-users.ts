import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

export interface TestUser {
  id: string;
  username: string;
  accessToken: string;
  refreshToken: string;
}

let counter = 0;

/** Compte de test complet (inscrit + connecté) — un compte différent à chaque appel. */
export async function registerTestUser(
  app: INestApplication,
  overrides: Partial<{
    firstName: string;
    lastName: string;
    username: string;
    email: string;
    password: string;
    primaryLanguageCode: string;
  }> = {},
): Promise<TestUser> {
  counter += 1;
  const suffix = `${Date.now()}${counter}`;

  const body = {
    firstName: overrides.firstName ?? 'Test',
    lastName: overrides.lastName ?? 'User',
    username: overrides.username ?? `e2e${suffix}`,
    email: overrides.email ?? `e2e${suffix}@example.com`,
    password: overrides.password ?? 'un-mot-de-passe-solide',
    primaryLanguageCode: overrides.primaryLanguageCode ?? 'fr',
  };

  const response = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send(body)
    .expect(201);

  return {
    id: response.body.user.id as string,
    username: response.body.user.username as string,
    accessToken: response.body.accessToken as string,
    refreshToken: response.body.refreshToken as string,
  };
}
