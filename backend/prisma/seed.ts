import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Langues de départ (section 16). `enabled` ouvre la langue à la messagerie
// texte ; speech/translation/voiceSupported restent à false tant qu'aucun
// fournisseur IA n'est configuré (STT_PROVIDER / TRANSLATION_PROVIDER /
// TTS_PROVIDER) — voir section 40 : ne jamais afficher une capacité qui
// n'existe pas réellement.
const INITIAL_LANGUAGES = [
  { code: 'fr', name: 'Français', nativeName: 'Français' },
  { code: 'en', name: 'Anglais', nativeName: 'English' },
  { code: 'es', name: 'Espagnol', nativeName: 'Español' },
  { code: 'pt', name: 'Portugais', nativeName: 'Português' },
];

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg(process.env.DATABASE_URL ?? ''),
  });

  try {
    for (const language of INITIAL_LANGUAGES) {
      await prisma.language.upsert({
        where: { code: language.code },
        update: { name: language.name, nativeName: language.nativeName },
        create: { ...language, enabled: true },
      });
    }
    console.log(`Seed terminé : ${INITIAL_LANGUAGES.length} langues.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Échec du seed :', error);
  process.exit(1);
});
