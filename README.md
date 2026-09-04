# Glotta

Messagerie instantanée multilingue : texte et **vocaux traduits en temps réel**, avec conservation optionnelle et consentie de la voix de l'expéditeur.

> Je parle → l'application comprend → traduit → parle dans la langue du destinataire.

## État du projet

**Les 16 phases du plan de développement sont posées, plus une interface frontend fonctionnelle** : monorepo `frontend/` (Next.js) + `backend/` (NestJS) + `docker-compose.yml` (Postgres, Redis), schéma de données Prisma complet, inscription/connexion/JWT/sessions/récupération de compte, profils et langues, conversations directes, messages texte en temps réel via WebSocket (Socket.IO), présence en ligne/hors ligne multi-appareils, accusés de livraison/lecture réels, centre de notifications, enregistrement/envoi/suppression de messages vocaux, le pipeline complet Speech-to-Text → Traduction → Text-to-Speech avec garde-fou de consentement pour le clonage vocal (sans fournisseur réel branché — voir ci-dessous), les statuts/stories 24h, une passe sécurité/optimisation (rate limiting, en-têtes de sécurité, nettoyage planifié des données expirées, pagination), et une suite de tests d'intégration e2e contre une vraie base et de vraies connexions WebSocket — dont le test explicitement demandé par le cahier des charges (« un utilisateur A ne doit jamais pouvoir lire les messages de B et C »). Côté frontend : une page d'accueil publique (`/`, avec les langues réellement disponibles récupérées en direct), pages de connexion/inscription, un dashboard de conversation (liste, fenêtre de discussion temps réel, panneau d'infos, envoi et lecture de messages vocaux **et** d'images depuis le navigateur), des statuts/stories 24h (texte, image, vidéo et vocal, anneaux vu/non-vu, vues) et des paramètres de compte (profil, confidentialité, sécurité — mot de passe, sessions) branchés sur ce backend, aucune donnée simulée pour ce que l'API expose déjà. Le partage d'images dans les conversations a nécessité un ajout backend (`POST /messages/image`, `GET /messages/attachments/:id`) : `MessageType.IMAGE` et le modèle `Attachment` existaient dans le schéma depuis le début mais n'étaient encore reliés à aucun endpoint. Voir [`PHASES.md`](./PHASES.md) pour le détail phase par phase, y compris les vrais bugs trouvés et corrigés en testant cette interface — dont un qui dormait dans le backend depuis la Phase 14 (statuts vidéo au format webm servis avec un `Content-Type` audio, jamais couvert par un test avant cette passe).

**Transcription (Groq) et traduction (DeepL) sont réellement branchées et vérifiées en conditions réelles** : un message vocal envoyé est transcrit puis traduit automatiquement dans la langue de réception du destinataire, affiché dans l'interface (transcription, texte traduit, mis à jour en temps réel pendant que le pipeline tourne). La synthèse vocale traduite et le clonage de voix (ElevenLabs) sont câblés et testés contre l'API réelle, mais restent inactifs tant que le compte ElevenLabs n'est pas passé sur un plan payant (le clonage vocal instantané n'existe pas sur leur offre gratuite — vérifié en conditions réelles, pas supposé) ; en attendant, ces fonctionnalités renvoient une erreur explicite plutôt qu'un résultat simulé. Voir section « Fournisseurs IA » ci-dessous pour la configuration.

**Appels audio et vidéo réels (WebRTC), interface responsive (mobile/tablette), avatar de profil téléversable, images de taille uniforme et agrandissables, menu contextuel sur les messages vocaux** : signalisation via un namespace WebSocket dédié (`/calls`), STUN public + TURN de secours (Open Relay Project, gratuit) pour que deux appareils sur des réseaux différents puissent réellement se joindre, caméra activable à tout moment pendant un appel, historique des appels et bulle dédiée dans le fil de conversation. La disposition à 3-4 colonnes du bureau devient navigable écran par écran en dessous de 1024px (tablette portrait comprise), vérifié par captures d'écran réelles à plusieurs largeurs. Voir les sections « Menu vocal, images uniformes, avatar téléversable et appels audio réels » et « Appels vidéo et interface responsive » de [`PHASES.md`](./PHASES.md) pour le détail.

**Envoi de plusieurs photos/vidéos en un seul album** (`POST /messages/media`, type de message `MEDIA_ALBUM`) : sélection groupée avec aperçu/réordonnancement avant envoi, grille adaptative dans le fil (1 média : rendu classique ; 2 à 4 : mises en page dédiées ; 5+ : grille avec badge "+N"), visionneuse plein écran avec navigation. Première pièce d'une spécification plus large (« NEXORA », 30 sections, comportements type messagerie moderne à reproduire sans copier d'interface ni de code propriétaire) traitée dans l'ordre demandé par l'utilisateur — voir « Spécification NEXORA » dans [`PHASES.md`](./PHASES.md).

**Contacts : demandes, acceptation/refus, blocage et partage de carte** (`/contacts`) : demande de contact avec auto-acceptation quand l'autre partie avait déjà demandé en sens inverse, blocage/déblocage, panneau dédié dans la 2e colonne (recherche, demandes reçues, liste des contacts), et partage de la carte publique d'un utilisateur (avatar/nom/username/langue — jamais email/téléphone) comme message dans une conversation, avec bouton "Ajouter" dont l'état reflète la vraie relation. Deuxième pièce de la spécification NEXORA — voir [`PHASES.md`](./PHASES.md).

**Profil public par lien et QR code, avec scanner caméra réel** : onglet "Partager" dans les Paramètres (lien + QR généré côté client, copie, Web Share API), page `/profile/[userId]` (le bouton reflète la vraie relation de contact), page `/scan` qui décode un QR par la caméra en temps réel (`jsqr`) ou accepte un lien collé en repli — jamais de mot de passe ni de token de session dans le QR, et totalement indépendant de tout flux de connexion. Troisième pièce de la spécification NEXORA — voir [`PHASES.md`](./PHASES.md).

**Notifications jamais redondantes pour une conversation déjà ouverte** : le frontend déclare au backend (`conversation:opened`/`closed`) quelle conversation est réellement à l'écran ; `NotificationsService` ne crée plus de notification "nouveau message" pour un destinataire qui la regarde déjà sur au moins un de ses appareils, sans jamais toucher à la diffusion temps réel du message lui-même ni aux notifications d'appel (sonnerie indépendante de l'écran affiché). Quatrième pièce de la spécification NEXORA — voir [`PHASES.md`](./PHASES.md).

**Deux sonneries d'appel distinctes (ringback/ringtone) et rappel d'un appel manqué** : sons entièrement synthétisés côté client (oscillateurs Web Audio, aucun fichier audio existant ni ressource protégée), motif différent selon qu'on attend une réponse ou qu'on reçoit l'appel ; bouton "Rappeler" sur toute bulle d'appel manqué. Cinquième et sixième pièces de la spécification NEXORA — voir [`PHASES.md`](./PHASES.md).

**Synchronisation multi-appareils** : un appel accepté/refusé sur un appareil arrête de sonner sur les autres appareils connectés du même compte (`call:resolved-elsewhere`) ; lire une conversation sur un appareil remet aussi à zéro son badge non-lu sur les autres. Septième pièce de la spécification NEXORA — voir [`PHASES.md`](./PHASES.md).

**Réglages de confidentialité réellement appliqués** (`whoCanMessageMe`, `whoCanSeeMyStatus`) : existaient depuis le début sans jamais être vérifiés côté serveur — désormais câblés sur le vrai carnet de contacts (`ContactsService`), qui bloque respectivement le démarrage d'une nouvelle conversation et la visibilité d'un statut "Contacts uniquement" pour qui n'est pas un contact accepté. Huitième et dernière pièce de la spécification NEXORA — voir [`PHASES.md`](./PHASES.md).

**La spécification NEXORA (30 sections) est maintenant posée en intégralité**, dans l'ordre demandé : médias multiples → partage de contact → profil public + QR → logique de notifications → appels vocaux → appels vidéo → multi-appareils → tests/sécurité. Voir [`PHASES.md`](./PHASES.md) pour le détail de chaque item.

## Stack

| Côté | Techs |
|---|---|
| Frontend | Next.js 16 (App Router), TypeScript, React, Tailwind CSS, Socket.IO client |
| Backend | NestJS 12, TypeScript, Prisma ORM, PostgreSQL, Socket.IO, JWT (access + refresh) |
| Infra | Docker Compose (Postgres, Redis) — Redis et une file d'attente (BullMQ) seront activés à partir de la phase traduction |

## Structure du dépôt

```text
frontend/            Application Next.js (App Router)
backend/
  prisma/schema.prisma  Modèle de données complet (User, Conversation, Message,
                         VoiceMessage, MessageTranslation, Notification, Status…)
  src/
    auth/              Inscription, connexion, JWT, sessions
    users/ profiles/    Comptes et profils (langues, confidentialité, consentement voix)
    languages/          Registre extensible des langues supportées
    conversations/      Conversations et membres
    contacts/            Demandes de contact, blocage, partage de carte
    messages/           Messages texte et images, statuts envoyé/livré/lu
    voice/              Upload et lecture des messages vocaux
    translations/       Pipeline STT → traduction → TTS (fournisseurs interchangeables)
    notifications/      Notifications in-app
    presence/           En ligne / hors ligne / typing / recording (WebSocket)
    statuses/           Statuts/stories 24h
    uploads/            Validation et stockage des fichiers
    websocket/          Gateway Socket.IO
    prisma/             Service Prisma partagé
    common/              Filtres, guards, décorateurs transverses
docker-compose.yml    Postgres + Redis pour le développement local
```

## Installation

Prérequis : Node.js ≥ 20, npm, Docker (ou un PostgreSQL/Redis déjà installés localement).

### 1. Base de données et Redis

```bash
docker compose up -d
```

<details>
<summary>Si Podman refuse de démarrer avec une erreur "database static dir ... does not match" (environnements confinés type snap)</summary>

Podman (utilisé ici en émulation de la commande `docker`) peut refuser de
démarrer si son état de stockage a été initialisé depuis un autre contexte
(ex. `$HOME` redirigé par un confinement snap). Plutôt que de réinitialiser
le stockage partagé — ce qui effacerait aussi les conteneurs d'autres
projets —, on peut isoler Postgres dans une racine dédiée :

```bash
mkdir -p /tmp/glotta-podman/storage /tmp/glotta-podman/run
podman --root /tmp/glotta-podman/storage --runroot /tmp/glotta-podman/run run -d \
  --name glotta-postgres \
  -e POSTGRES_USER=glotta -e POSTGRES_PASSWORD=glotta -e POSTGRES_DB=glotta \
  -p 127.0.0.1:5432:5432 \
  docker.io/library/postgres:16-alpine
```

Redis peut tourner nativement sur la machine (`redis-server`) si le port
6379 est déjà occupé par un service système — `REDIS_URL` dans `.env` pointe
déjà vers `localhost:6379`, aucun changement nécessaire dans ce cas.
</details>

### 2. Backend

```bash
cd backend
cp .env.example .env        # ajuster les secrets JWT au minimum
npm install
npm run prisma:migrate      # crée les tables à partir de prisma/schema.prisma
npm run prisma:seed         # langues de départ (fr, en, es, pt) — requis pour /auth/register
npm run start:dev           # http://localhost:4000/api — Swagger sur /api/docs
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev                 # http://localhost:3000
```

## Variables d'environnement

Voir `backend/.env.example` et `frontend/.env.example`. Points clés :

- `DATABASE_URL` : connexion PostgreSQL utilisée par Prisma.
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` : à générer (`openssl rand -hex 32`), jamais commités.
- `STORAGE_DRIVER` : `local` en développement ; un driver S3-compatible sera ajouté pour la production (fichiers audio/images).
- `STT_PROVIDER` (`"none"` ou `"groq"`), `TRANSLATION_PROVIDER` (`"none"` ou `"deepl"`), `TTS_PROVIDER` (`"none"` ou `"elevenlabs"`) : tant qu'une variable vaut `none`, l'étape correspondante du pipeline reste désactivée — aucune fausse traduction n'est produite. Chacune a sa propre `*_API_KEY`.
- `STUN_URLS` / `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` (appels audio) : optionnelles, un STUN Google et un TURN public gratuit (Open Relay Project) sont utilisés par défaut si omises.

## Migrations Prisma

```bash
cd backend
npm run prisma:migrate   # développement — crée une migration + l'applique
npm run prisma:generate  # régénère le client après une modification manuelle du schéma
npm run prisma:studio    # interface d'inspection de la base
```

## Tests

```bash
cd backend
npm test          # unitaires (mocks Prisma/JWT — aucune base requise)
npm run test:cov  # avec couverture
npm run test:e2e  # intégration : vraie base Postgres + vrai WebSocket
```

NestJS 12 est distribué en ESM pur ; les scripts `test*` passent déjà le
flag Node `--experimental-vm-modules` requis par Jest pour charger ces
paquets (via `cross-env`) — rien à configurer.

Les tests e2e (`test/*.e2e-spec.ts`) ont besoin d'une base **séparée** de
celle du développement, jamais partagée :

```bash
cd backend
createdb glotta_test   # ou : docker/podman exec ... createdb -U glotta glotta_test
DOTENV_CONFIG_PATH=.env.test npx prisma migrate deploy
DOTENV_CONFIG_PATH=.env.test npm run prisma:seed
npm run test:e2e
```

`backend/.env.test` (suivi en dépôt — ne contient que des secrets locaux
factices) pointe vers `glotta_test`, désactive tous les fournisseurs IA
(`*_PROVIDER=none`, pour ne jamais dépendre d'un vrai appel externe
pendant les tests) et neutralise le rate limiting via
`DISABLE_RATE_LIMITING=true` (voir `app.module.ts` — cette variable ne
doit **jamais** apparaître dans `.env`/`.env.example`, le comportement de
production reste actif). Les trois suites (`auth`, `access-isolation`,
`websocket`) vident intégralement la base entre elles et tournent en
série (`maxWorkers: 1`) puisqu'elles partagent cette même base.

## Fournisseurs IA

Le module `translations/` héberge des services derrière des interfaces (`SpeechToTextService`, `TranslationService`, `TextToSpeechService`, `VoiceIdentityService`), orchestrés par `VoiceTranslationPipelineService` (VoiceMessage → STT → Traduction → TTS), afin qu'aucun fournisseur ne soit imposé de façon irréversible. Ajouter un vrai fournisseur consiste à implémenter l'interface correspondante et à l'ajouter au sélecteur du service — jamais à modifier les appelants.

Fournisseurs actuellement implémentés (gratuits, testés en conditions réelles) :

| Étape | Fournisseur | Configuration |
|---|---|---|
| Speech-to-Text | [Groq](https://console.groq.com) (Whisper large-v3) | `STT_PROVIDER="groq"`, `STT_API_KEY` |
| Traduction | [DeepL Free](https://www.deepl.com/pro-api) (500k car./mois) | `TRANSLATION_PROVIDER="deepl"`, `TRANSLATION_API_KEY` |
| Text-to-Speech / clonage vocal | [ElevenLabs](https://elevenlabs.io) | `TTS_PROVIDER="elevenlabs"`, `TTS_API_KEY` |

Pour ElevenLabs, la clé API doit avoir les permissions **Text to Speech** et **Voices** (lecture + écriture) activées sur le tableau de bord — une clé par défaut n'en a aucune. Le clonage vocal instantané (`POST /users/me/voice-model`) nécessite en plus un plan payant ElevenLabs : leur offre gratuite ne l'inclut pas (constaté en conditions réelles, HTTP 400 "upgrade your plan").

Tant qu'une variable vaut `"none"` (ou que la clé associée est absente — `isConfigured()` reflète le fournisseur réellement construit, pas seulement la variable demandée), la fonctionnalité concernée reste inactive et le dit clairement (503) plutôt que de simuler un résultat. Le clonage/reproduction de la voix d'un utilisateur (`VoiceIdentityService.resolveVoiceReference`) ne s'active jamais sans le consentement explicite stocké sur son profil (`Profile.voiceCloningConsent`) et un modèle vocal déjà enregistré — les deux sont vérifiés à chaque exécution du pipeline, jamais mis en cache.

## Sécurité

- Mots de passe hashés (jamais stockés en clair).
- JWT access + refresh, sessions révocables (`UserSession`).
- Chaque accès à une conversation, un message ou un vocal doit être vérifié contre l'appartenance réelle de l'utilisateur (`ConversationMember`) — jamais uniquement via l'ID de la ressource.
- Rate limiting (`@nestjs/throttler`) : 60 req/min/IP par défaut, limites plus strictes sur les routes d'authentification sensibles (login/register 5/min, password-reset/request 3/min). Ce paquet ne déclare pas encore NestJS 12 dans son `peerDependencies` — installé via `legacy-peer-deps=true` (`backend/.npmrc`), fonctionnement réel vérifié (voir PHASES.md phase 15).
- En-têtes de sécurité HTTP (`helmet`) : CSP désactivée volontairement (voir `main.ts`), les autres protections standard actives.
- Nettoyage planifié (`@nestjs/schedule`) des sessions, jetons de réinitialisation et statuts expirés, en tâche de fond horaire.

## Mobile (futur)

L'architecture backend (API REST + WebSocket, indépendante du frontend) est conçue pour qu'une application Flutter (Android/iOS) puisse consommer la même API sans réécriture.
# chat
