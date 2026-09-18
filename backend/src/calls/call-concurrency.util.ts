import type { PrismaClient } from '@prisma/client';

/**
 * "Un utilisateur ne peut avoir qu'une seule session d'appel active"
 * (section 12) — croise Call (1:1) ET GroupCall (jusqu'ici jamais vérifiés
 * ensemble : CallsService.invite() ne regardait que Call, GroupCallsService
 * ne regardait rien du tout). Une fonction autonome plutôt qu'une méthode
 * d'un des deux services : CallsModule dépend déjà de GroupCallsModule
 * (jamais l'inverse, voir group-calls.module.ts) — GroupCallsService ne
 * peut donc pas injecter CallsService sans créer un cycle. Les deux
 * services important cette même fonction pure évite le problème sans
 * dupliquer la logique.
 */
export async function isUserInAnyCall(
  prisma: Pick<PrismaClient, 'call' | 'groupCallParticipant'>,
  userId: string,
  // Exclu de la vérification : celui qu'on est justement en train de
  // rejoindre (être RINGING/JOINED dans CET appel n'est jamais "occupé
  // ailleurs", sans quoi accepter sa propre invitation serait bloqué).
  options: { excludeGroupCallId?: string } = {},
): Promise<boolean> {
  const [call, groupParticipation] = await Promise.all([
    prisma.call.findFirst({
      where: {
        status: { in: ['RINGING', 'ACTIVE'] },
        OR: [{ callerId: userId }, { calleeId: userId }],
      },
      select: { id: true },
    }),
    prisma.groupCallParticipant.findFirst({
      where: {
        userId,
        status: { in: ['RINGING', 'JOINED'] },
        groupCall: { status: 'ACTIVE' },
        ...(options.excludeGroupCallId ? { groupCallId: { not: options.excludeGroupCallId } } : {}),
      },
      select: { id: true },
    }),
  ]);
  return call !== null || groupParticipation !== null;
}
