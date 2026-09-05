import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LanguagesService } from '../languages/languages.service';
import { PresenceInfo, PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveAvatarUrl } from '../profiles/avatar.util';
import { UpdateUserDto } from './dto/update-user.dto';

const USER_WITH_RELATIONS = {
  profile: true,
  primaryLanguage: true,
  preferredReceiveLanguage: true,
  spokenLanguages: { include: { language: true } },
} satisfies Prisma.UserInclude;

type UserWithRelations = Prisma.UserGetPayload<{ include: typeof USER_WITH_RELATIONS }>;

function toLanguageSummary(language: { code: string; name: string; nativeName: string }) {
  return { code: language.code, name: language.name, nativeName: language.nativeName };
}

/** Vue complète pour le propriétaire du compte ("moi") — jamais renvoyée pour un autre utilisateur. */
function toMeDto(user: UserWithRelations, presence: PresenceInfo) {
  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    // Distingue un compte admin côté client (voir l'app admin séparée,
    // AdminGuard fait de toute façon foi côté serveur — ce champ ne sert
    // qu'à afficher/masquer l'interface, jamais une décision de sécurité).
    role: user.role,
    isOnline: presence.isOnline,
    lastSeenAt: presence.lastSeenAt,
    primaryLanguage: user.primaryLanguage ? toLanguageSummary(user.primaryLanguage) : null,
    preferredReceiveLanguage: user.preferredReceiveLanguage
      ? toLanguageSummary(user.preferredReceiveLanguage)
      : null,
    spokenLanguages: user.spokenLanguages.map((entry) => toLanguageSummary(entry.language)),
    profile: user.profile
      ? {
          avatarUrl: resolveAvatarUrl(user.profile, user.id),
          // Distingue un avatar téléversé (bouton "Supprimer" pertinent,
          // l'URL ci-dessus pointe vers notre propre backend) d'une URL
          // externe saisie à la main.
          avatarUploaded: Boolean(user.profile.avatarStorageKey),
          statusText: user.profile.statusText,
          showLastSeen: user.profile.showLastSeen,
          showOnlineStatus: user.profile.showOnlineStatus,
          showReadReceipts: user.profile.showReadReceipts,
          whoCanMessageMe: user.profile.whoCanMessageMe,
          whoCanSeeMyStatus: user.profile.whoCanSeeMyStatus,
          notificationsEnabled: user.profile.notificationsEnabled,
          voiceCloningConsent: user.profile.voiceCloningConsent,
          // Jamais l'identifiant réel du modèle (référence interne au
          // fournisseur de clonage) — seulement s'il en existe un.
          voiceModelRegistered: Boolean(user.profile.voiceModelId),
        }
      : null,
    createdAt: user.createdAt,
  };
}

/** Vue publique — ce que voit un autre utilisateur (jamais email/téléphone/préférences privées). */
function toPublicDto(user: UserWithRelations, presence: PresenceInfo) {
  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: resolveAvatarUrl(user.profile, user.id),
    statusText: user.profile?.statusText ?? null,
    isOnline: presence.isOnline,
    lastSeenAt: presence.lastSeenAt,
    primaryLanguage: user.primaryLanguage ? toLanguageSummary(user.primaryLanguage) : null,
    spokenLanguages: user.spokenLanguages.map((entry) => toLanguageSummary(entry.language)),
  };
}

export type MeDto = ReturnType<typeof toMeDto>;
export type PublicUserDto = ReturnType<typeof toPublicDto>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly languages: LanguagesService,
    private readonly presence: PresenceService,
  ) {}

  async getMe(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: USER_WITH_RELATIONS,
    });
    // respectPrivacy: false — on ne cache jamais à quelqu'un ses propres réglages.
    const presence = await this.presence.getPresence(userId, false);
    return toMeDto(user, presence);
  }

  async updateMe(userId: string, dto: UpdateUserDto): Promise<MeDto> {
    await this.assertIdentifiersAvailable(userId, dto);

    const primaryLanguage = dto.primaryLanguageCode
      ? await this.languages.findEnabledByCode(dto.primaryLanguageCode)
      : undefined;
    const preferredLanguage = dto.preferredReceiveLanguageCode
      ? await this.languages.findEnabledByCode(dto.preferredReceiveLanguageCode)
      : undefined;
    const spokenLanguages = dto.spokenLanguageCodes
      ? await this.languages.findManyEnabledByCodes(dto.spokenLanguageCodes)
      : undefined;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        username: dto.username,
        email: dto.email,
        phone: dto.phone,
        primaryLanguageId: primaryLanguage?.id,
        preferredReceiveLanguageId: preferredLanguage?.id,
        // Remplace intégralement les langues parlées quand la liste est fournie
        // (nested write sur la table de jointure explicite UserSpokenLanguage).
        ...(spokenLanguages
          ? {
              spokenLanguages: {
                deleteMany: {},
                create: spokenLanguages.map((language) => ({ languageId: language.id })),
              },
            }
          : {}),
      },
      include: USER_WITH_RELATIONS,
    });

    const presence = await this.presence.getPresence(userId, false);
    return toMeDto(user, presence);
  }

  async getPublicProfile(targetUserId: string): Promise<PublicUserDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: USER_WITH_RELATIONS,
    });
    if (!user || !user.isActive) {
      throw new NotFoundException('Utilisateur introuvable.');
    }
    const presence = await this.presence.getPresence(targetUserId);
    return toPublicDto(user, presence);
  }

  async search(query: string, excludeUserId: string): Promise<PublicUserDto[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      throw new BadRequestException('La recherche doit contenir au moins 2 caractères.');
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: { not: excludeUserId },
        isActive: true,
        OR: [
          { username: { contains: trimmed, mode: 'insensitive' } },
          { firstName: { contains: trimmed, mode: 'insensitive' } },
          { lastName: { contains: trimmed, mode: 'insensitive' } },
        ],
      },
      include: USER_WITH_RELATIONS,
      orderBy: { username: 'asc' },
      take: 20,
    });

    return Promise.all(
      users.map(async (user) => toPublicDto(user, await this.presence.getPresence(user.id))),
    );
  }

  /** Vérifie unicité username/email/phone en s'excluant soi-même (section 23). */
  private async assertIdentifiersAvailable(userId: string, dto: UpdateUserDto): Promise<void> {
    const checks: Array<Promise<void>> = [];

    if (dto.username) {
      checks.push(
        this.prisma.user.findUnique({ where: { username: dto.username } }).then((existing) => {
          if (existing && existing.id !== userId) {
            throw new ConflictException("Ce nom d'utilisateur est déjà pris.");
          }
        }),
      );
    }
    if (dto.email) {
      checks.push(
        this.prisma.user.findUnique({ where: { email: dto.email } }).then((existing) => {
          if (existing && existing.id !== userId) {
            throw new ConflictException('Cet email est déjà utilisé.');
          }
        }),
      );
    }
    if (dto.phone) {
      checks.push(
        this.prisma.user.findUnique({ where: { phone: dto.phone } }).then((existing) => {
          if (existing && existing.id !== userId) {
            throw new ConflictException('Ce numéro est déjà utilisé.');
          }
        }),
      );
    }

    await Promise.all(checks);
  }
}
