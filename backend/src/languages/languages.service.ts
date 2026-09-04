import { BadRequestException, Injectable } from '@nestjs/common';
import { Language } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Registre des langues (section 16 du cahier des charges) : aucune langue
 * n'est codée en dur ailleurs dans le code — tout passe par ce service, qui
 * lit la table `Language`. La gestion admin (créer/désactiver une langue)
 * est hors MVP (section 41) — les langues sont ajoutées via `prisma/seed.ts`
 * pour l'instant ; seule la lecture est exposée aux clients.
 */
@Injectable()
export class LanguagesService {
  constructor(private readonly prisma: PrismaService) {}

  findEnabled(): Promise<Language[]> {
    return this.prisma.language.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Toujours appelée pour valider un champ de requête (langue principale à
   * l'inscription, langue de réception préférée, langue déclarée d'un audio
   * à transcrire...) — jamais pour résoudre une ressource depuis l'URL. Une
   * langue inconnue est donc une requête invalide (400), pas une ressource
   * absente (404), cohérent avec findManyEnabledByCodes ci-dessous.
   */
  async findEnabledByCode(code: string): Promise<Language> {
    const language = await this.prisma.language.findUnique({ where: { code } });
    if (!language || !language.enabled) {
      throw new BadRequestException(`Langue inconnue ou non disponible : "${code}".`);
    }
    return language;
  }

  /** Résout plusieurs codes en une fois (ex. langues parlées d'un profil). */
  async findManyEnabledByCodes(codes: string[]): Promise<Language[]> {
    if (codes.length === 0) return [];

    const uniqueCodes = [...new Set(codes)];
    const languages = await this.prisma.language.findMany({
      where: { code: { in: uniqueCodes }, enabled: true },
    });

    if (languages.length !== uniqueCodes.length) {
      const found = new Set(languages.map((l) => l.code));
      const missing = uniqueCodes.filter((code) => !found.has(code));
      throw new BadRequestException(
        `Langue(s) inconnue(s) ou non disponible(s) : ${missing.join(', ')}.`,
      );
    }

    return languages;
  }
}
