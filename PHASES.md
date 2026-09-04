# Feuille de route Glotta

Construction progressive : chaque phase doit compiler, typer et être vérifiée avant de passer à la suivante (voir section 45 du cahier des charges).

| Phase | Contenu | État |
|---|---|---|
| 1 | Architecture du projet (monorepo, Prisma, modules NestJS, docker-compose) | ✅ fait |
| 2 | Authentification (inscription, connexion, JWT access+refresh, sessions) | ✅ fait |
| 3 | Profils et langues | ✅ fait |
| 4 | Conversations | ✅ fait |
| 5 | Messages en temps réel (WebSocket) | ✅ fait |
| 6 | Présence en ligne | ✅ fait |
| 7 | Messages livrés/lus | ✅ fait |
| 8 | Notifications | ✅ fait |
| 9 | Enregistrement et envoi de vocaux | ✅ fait |
| 10 | Speech-to-Text | ✅ fait (architecture — aucun fournisseur réel configuré) |
| 11 | Traduction | ✅ fait (architecture — aucun fournisseur réel configuré) |
| 12 | Text-to-Speech | ✅ fait (architecture — aucun fournisseur réel configuré) |
| 13 | Conservation de la voix avec consentement | ✅ fait (garde-fou de consentement — inscription d'un modèle vocal différée, voir notes) |
| 14 | Statuts (stories 24h) | ✅ fait |
| 15 | Sécurité et optimisation (dont rate limiting) | ✅ fait |
| 16 | Tests | ✅ fait |
| — | Interface (frontend : auth, dashboard de conversation) | ✅ fait |

## Ce qui a été posé en Phase 1

- `frontend/` : app Next.js 16 (App Router, TypeScript, Tailwind).
- `backend/` : app NestJS 12 (TypeScript strict), avec un module vide par domaine
  fonctionnel (`auth`, `users`, `profiles`, `languages`, `conversations`,
  `messages`, `voice`, `translations`, `notifications`, `presence`,
  `statuses`, `uploads`, `websocket`), un `PrismaModule` global, un filtre
  d'exception commun, Swagger sur `/api/docs`.
- `backend/prisma/schema.prisma` : les 15 modèles de données du cahier des
  charges (User, Profile, Language, Conversation, ConversationMember,
  Message, VoiceMessage, MessageTranslation, MessageRead, Notification,
  Status, StatusView, Reaction, Attachment, UserSession) avec relations
  normalisées.
- `docker-compose.yml` : Postgres + Redis pour le développement local.
- `.env.example` (frontend et backend).

## Ce qui a été posé en Phase 2

- `AuthModule` complet : `POST /auth/register`, `POST /auth/login`,
  `POST /auth/refresh` (rotation du refresh token), `POST /auth/logout`,
  `POST /auth/logout-all`, `PATCH /auth/change-password`,
  `GET /auth/sessions`, `DELETE /auth/sessions/:id`,
  `POST /auth/password-reset/request` + `/confirm`.
- Mots de passe hashés avec bcrypt (jamais stockés en clair) ; refresh tokens
  et tokens de réinitialisation également stockés sous forme de hash
  (`UserSession.refreshTokenHash`, `PasswordResetToken.tokenHash`) — une fuite
  de la base ne rend aucun token réutilisable.
- JWT access + refresh avec secrets distincts, guard `JwtAuthGuard` +
  décorateur `@CurrentUser()` réutilisables par tous les modules suivants.
- Vérification stricte d'appartenance sur les sessions (`revokeSession`) —
  un utilisateur ne peut pas révoquer la session d'un autre (section 23).
- `LanguagesService` (résolution par code) + seed des 4 langues de départ
  (`prisma/seed.ts`), nécessaires pour valider la langue principale choisie
  à l'inscription.
- `MailService` : aucun fournisseur d'email réel branché (`MAIL_PROVIDER`) —
  le lien de réinitialisation est journalisé en développement, jamais
  présenté comme envoyé (section 40).
- 9 tests unitaires sur `AuthService` (mocks Prisma/JWT — pas besoin d'une
  base de données pour les faire tourner) : `npm test`.

### Point technique notable

NestJS 12 est distribué en ESM pur (`"type": "module"`). Jest a donc besoin
du flag `--experimental-vm-modules` pour charger ces paquets — déjà câblé
dans les scripts `test*` du `package.json` via `cross-env`. Rien à faire de
plus pour lancer `npm test`.

### Vérifications effectuées (Phase 2)

`tsc --noEmit`, `nest build`, `eslint` (0 erreur), 9 tests Jest passés, et
démarrage réel du serveur compilé avec test manuel des routes `/auth/*`
(rejet 401 sans token, 400 sur DTO invalide, 500 générique — jamais l'erreur
Prisma brute — quand la base n'est pas joignable). La création de compte de
bout en bout (avec une vraie base Postgres) reste à valider par vous en
local : `docker compose up -d && npm run prisma:migrate && npm run prisma:seed`.

### Vulnérabilités connues (non bloquantes)

`npm audit` signale 2 CVE "high" (`deepmerge-ts`, `mysql2`) uniquement dans
les dépendances internes du **CLI** `prisma` (pas dans `@prisma/client`, donc
jamais exposées par l'API en production). Le correctif automatique
forcerait un retour à `prisma@6`, incompatible avec la configuration Prisma 7
mise en place (driver adapters). À surveiller lors des prochaines mises à
jour de Prisma plutôt qu'à corriger maintenant.

## Ce qui a été posé en Phase 3

- `GET /languages` (public, sans auth) : liste les langues activées — alimente
  les sélecteurs de langue à l'inscription et dans les paramètres.
- `LanguagesService.findManyEnabledByCodes` : résout plusieurs codes en une
  fois (langues parlées d'un profil), avec message d'erreur listant les
  codes invalides.
- `GET /users/me` : vue complète du compte (infos, langues, profil) —
  jamais renvoyée pour un autre utilisateur.
- `PATCH /users/me` : modification prénom/nom/username/email/téléphone/
  langues, avec les mêmes vérifications d'unicité qu'à l'inscription (en
  s'excluant soi-même du contrôle).
- `PATCH /users/me/profile` : photo (URL — l'upload de fichier arrive en
  phase 9), statut, confidentialité (`showLastSeen`, `showOnlineStatus`,
  `showReadReceipts`, `whoCanMessageMe`, `whoCanSeeMyStatus`), et le
  consentement de clonage vocal (`voiceCloningConsent`, horodaté à chaque
  changement — section 15).
- `GET /users/:id` : profil public d'un autre utilisateur — ne renvoie
  jamais email, téléphone, langue de réception préférée ni réglages de
  confidentialité.
- `GET /users/search?q=` : recherche par username/prénom/nom (utile pour
  démarrer une conversation en phase 4).
- Gestion admin des langues (créer/désactiver une langue) volontairement
  **hors MVP** (section 41) — ajout via `prisma/seed.ts` pour l'instant ;
  une vraie interface admin (section 36) viendra après le MVP.

### Bug de câblage trouvé au démarrage réel

`JwtAuthGuard`, utilisé par `UsersController`, a de nouveau échoué à
résoudre `AuthModuleOptions` — cette fois parce que `PassportModule.register()`
scope ses providers au module qui l'importe, et `UsersModule` ne l'importait
pas. Plutôt que de redéclarer `PassportModule.register()` dans chaque module
protégé, `AuthModule` le ré-exporte désormais : tout module qui veut protéger
ses routes n'a qu'à importer `AuthModule`. Encore une fois, ce bug n'est
sorti qu'au démarrage réel du serveur compilé, pas à la compilation.

### Vérifications effectuées (Phase 3)

`tsc --noEmit`, `nest build`, `eslint` (0 erreur), 18 tests Jest passés
(9 phase 2 + 9 nouveaux : `UsersService` avec mocks Prisma, et validation
réelle du DTO `UpdateProfileDto` via `class-validator` — utile car les
routes protégées n'ont pas pu être testées de bout en bout sans base de
données ni token valide dans cet environnement). Démarrage réel du serveur
compilé avec toutes les routes `/users/*` et `/languages` mappées et testées
manuellement (401 sans token, ordre de routing `me`/`search` avant `:id`
confirmé).

## Ce qui a été posé en Phase 4

- `POST /conversations` : crée une conversation directe avec un autre
  utilisateur — **idempotent** : si une conversation directe existe déjà
  entre les deux, elle est renvoyée telle quelle plutôt que dupliquée.
- `GET /conversations` : liste les conversations de l'utilisateur courant
  (participant, dernier message, compteur de non-lus, préférences
  archivage/muet), triée par activité récente.
- `GET /conversations/:id` : détail d'une conversation, avec vérification
  stricte d'appartenance (section 23) — 404 générique (jamais 403) pour ne
  pas révéler qu'une conversation existe à quelqu'un qui n'en est pas membre.
- `PATCH /conversations/:id` : archiver/couper les notifications, propre à
  chaque membre (jamais aux autres participants).
- `lastMessage` et `unreadCount` interrogent réellement la table `Message` —
  ils resteront `null`/`0` tant que la phase 5 n'existe pas, mais aucun code
  à changer ici quand elle arrivera.

### Point technique notable

Contrairement aux phases 2 et 3, **aucun bug de câblage DI** cette fois :
`ConversationsModule` importe `AuthModule` dès sa première version, suivant
le motif établi en phase 3.

### Vérifications effectuées (Phase 4)

`tsc --noEmit`, `nest build`, `eslint` (0 erreur), 25 tests Jest passés
(18 précédents + 7 nouveaux sur `ConversationsService` : rejet d'une
conversation avec soi-même, idempotence de la création, 404 systématique
pour un non-membre — y compris sur une conversation inexistante, pour ne
rien laisser deviner). Démarrage réel du serveur avec toutes les routes
`/conversations*` mappées et testées manuellement (401 sans token).

## Ce qui a été posé en Phase 5

- `EventsGateway` (Socket.IO, `WebsocketModule`) : un seul gateway pour tout
  le temps réel. Chaque socket authentifié (JWT dans `auth.token` ou header
  `Authorization` de la poignée de main) rejoint une room `user:<id>` — on
  diffuse toujours **à un utilisateur**, jamais à une room de conversation,
  pour ne jamais avoir à faire confiance à ce qu'un client prétend avoir
  rejoint.
- `message:typing` / `message:stop_typing` : le client émet, le serveur
  vérifie que l'émetteur est bien membre actif de la conversation avant de
  relayer aux autres membres — sinon, silence (pas d'erreur qui
  confirmerait l'existence de la conversation).
- `POST /messages`, `GET /conversations/:id/messages` (paginé par curseur,
  30 messages par défaut, jamais tout l'historique d'un coup — section 33),
  `PATCH /messages/:id`, `DELETE /messages/:id` (suppression douce : le
  texte est vidé, `deletedAt` horodaté, idempotent).
- Chaque message créé/modifié/supprimé déclenche `message:new` /
  `message:updated` / `message:deleted` vers les autres membres — sans ça,
  éditer ou supprimer un message n'aurait aucun effet en temps réel pour
  l'autre participant, ce qui aurait contredit l'objectif même de la phase.
- Envoyer un message fait remonter `Conversation.updatedAt`, donc la
  conversation revient en tête de `GET /conversations` sans changement
  côté `ConversationsService` (déjà écrit pour ça en phase 4).
- Réactions emoji et transfert de message (section 12) volontairement
  différés — non explicitement listés dans les 16 phases du cahier des
  charges ; à ajouter en polish plus tard si besoin.

### Vérification manuelle du WebSocket (pas seulement REST)

`socket.io-client` ajouté en dev-dependency pour un test de bout en bout
contre le serveur réellement démarré : connexion sans token → refusée,
connexion avec un JWT valide (signé avec le même secret que `.env`) →
acceptée et room rejointe, `message:typing` sur une conversation
inexistante → aucun crash, aucun effet (silencieux, comme prévu). Au
passage, ce test a mis en évidence un détail réel du cycle de vie
Socket.IO : l'événement `connect` côté client se déclenche dès la
connexion de transport, avant que le hook serveur asynchrone n'ait vérifié
le token — la déconnexion arrive juste après. Ce n'est pas une faille :
chaque handler revérifie `client.data.userId` avant d'agir, donc cette
micro-fenêtre ne permet rien.

### Vérifications effectuées (Phase 5)

`tsc --noEmit`, `nest build`, `eslint` (0 erreur), 35 tests Jest passés
(25 précédents + 10 nouveaux sur `MessagesService` : membership, réponse à
un message d'une autre conversation, édition/suppression réservées à
l'auteur, pagination). Démarrage réel du serveur avec toutes les routes
`/messages*` mappées et le gateway abonné à ses événements, plus le test
WebSocket de bout en bout décrit ci-dessus.

## Ce qui a été posé en Phase 6

- `User.lastSeenAt` ajouté au schéma : seule donnée de présence persistée
  (dernière déconnexion). Le statut "en ligne" lui-même **n'est jamais
  écrit en base** — dérivé en mémoire des sockets réellement connectés
  (`PresenceService`), pour ne jamais afficher un état qui pourrait mentir
  après un crash ou un restart du serveur.
- Multi-appareils géré correctement : un utilisateur connecté depuis deux
  appareils reste "en ligne" tant qu'au moins un socket est ouvert ; seule
  la dernière déconnexion déclenche `user:offline` et horodate `lastSeenAt`.
- `user:online` / `user:offline` diffusés uniquement aux utilisateurs qui
  partagent une conversation avec la personne concernée — jamais à tout le
  monde — et seulement si `Profile.showOnlineStatus` l'autorise (section 22).
- Présence exposée dans `GET /users/me` (jamais masquée à soi-même),
  `GET /users/:id`, `GET /users/search` et les participants de
  `GET /conversations*` — respectant `showOnlineStatus`/`showLastSeen` du
  propriétaire du profil consulté dans tous les cas sauf "moi-même".
- `PresenceModule` et `WebsocketModule` ont une dépendance circulaire
  assumée (le gateway déclenche la présence sur connexion/déconnexion : la
  présence diffuse via le gateway), résolue avec `forwardRef()` des deux
  côtés — motif standard NestJS pour ce cas précis.

### Deux bugs de résilience trouvés en conditions réelles (pas de la simple compilation)

Testé en connectant un vrai client Socket.IO contre le serveur démarré,
base de données injoignable (même limitation d'environnement que d'habitude)
— ce qui a révélé deux problèmes que ni `tsc` ni les tests unitaires
n'auraient pu attraper :

1. Une connexion pourtant authentifiée (JWT valide) était rejetée si la
   diffusion de présence échouait juste après, parce que l'appel à
   `PresenceService` se trouvait dans le même bloc `try/catch` que la
   vérification du token.
2. Pire : une erreur de base de données pendant `handleDisconnect` **faisait
   planter tout le process Node** (rejet de promesse non rattrapé), ce qui
   aurait déconnecté tous les utilisateurs, pas seulement celui qui se
   déconnectait.

Corrigé en isolant le suivi de présence de l'authentification dans le
gateway (son échec est journalisé en `WARN`, jamais fatal) et en rendant
`broadcastPresence` résiliente aux pannes base de données (best-effort :
une notification de présence manquée n'a aucune conséquence grave, le
client la retrouvera via `GET /users/me` à sa prochaine requête).

### Limite connue

La présence en mémoire ne fonctionne que pour une seule instance de
serveur. Un déploiement multi-instances devra remplacer la `Map` interne
par un registre partagé (Redis, déjà prévu dans `docker-compose.yml` mais
pas encore branché à cet usage).

### Vérifications effectuées (Phase 6)

`tsc --noEmit`, `nest build`, `eslint` (0 erreur), 42 tests Jest passés
(35 précédents + 7 nouveaux sur `PresenceService` : multi-appareils,
confidentialité, et résilience à une panne base de données). Démarrage réel
du serveur, test WebSocket de bout en bout ayant révélé puis confirmé la
correction des deux bugs ci-dessus.

## Base de données réelle enfin disponible

Le blocage Docker/Podman signalé depuis la Phase 1 a été contourné : Podman
refusait de démarrer à cause d'un conflit de configuration dans le stockage
partagé de la machine (`database static dir "" does not match...`), visible
uniquement dans cet environnement de développement précis. Plutôt que de
réinitialiser ce stockage partagé — utilisé par d'autres projets sans lien
avec Glotta, visibles dans ce même stockage — Postgres tourne désormais dans
une racine Podman isolée dédiée (`/tmp/glotta-podman`), démarrée à la main
(voir commande dans l'historique ; à formaliser en script si besoin). Redis
tourne nativement sur la machine (port 6379 déjà occupé par un service
système). Migrations appliquées, langues seedées. **Tout ce qui suit a été
vérifié de bout en bout contre une vraie base**, plus seulement via des
mocks Jest.

## Ce qui a été posé en Phase 7

- `POST /conversations/:id/read` : marque comme lus tous les messages reçus
  (jamais ses propres messages) via de vraies lignes `MessageRead` — pas
  seulement une date sur la conversation. La lecture implique la livraison :
  tout message encore `deliveredAt: null` la reçoit au passage.
- `deliveredAt` réel dès l'envoi si le destinataire est actuellement en
  ligne (présence de la phase 6) ; sinon reste `null` jusqu'à la lecture —
  pas de rattrapage rétroactif à la reconnexion pour ce MVP (limite
  assumée, notée dans le code).
- `readAt` par message (vues `GET /conversations/:id/messages`), calculé à
  partir des vraies lignes `MessageRead` — jamais simulé.
- Diffusion `message:read` aux autres membres à chaque marquage.
- Validé de bout en bout avec une vraie base : un message envoyé reste
  `deliveredAt: null` tant que le destinataire ne l'a pas lu (hors ligne au
  moment de l'envoi), puis `deliveredAt` et `readAt` se renseignent tous les
  deux exactement au moment où il marque la conversation comme lue.

### Correction mineure

`POST /conversations/:id/read` renvoyait un 201 (comportement par défaut de
`@Post`) alors qu'il ne crée aucune ressource — corrigé en 200.

### Vérifications effectuées (Phase 7)

`tsc --noEmit`, `nest build`, `eslint` (0 erreur), 47 tests Jest passés
(42 précédents + 5 nouveaux sur `MessagesService` : livraison conditionnée
à la présence, accusés de lecture, idempotence). Plus, pour la première
fois, un test de bout en bout réel (inscription → connexion → conversation
→ message → lecture) contre Postgres.

## Ce qui a été posé en Phase 8

- `Profile.notificationsEnabled` (interrupteur global, section 11) —
  `NotificationsService.create` ne crée silencieusement rien si désactivé :
  jamais de notification fantôme créée puis cachée côté client.
- `NotificationsService` générique (`create`, `list` paginé par curseur,
  `unreadCount`, `markRead`, `markAllRead`), pensé pour être appelé par
  n'importe quel module futur (vocal, traduction, statuts) — pas seulement
  les messages.
- `MessagesService` crée une notification `NEW_MESSAGE` à chaque envoi, en
  plus (et indépendamment) de l'événement WebSocket `message:new` : le
  centre de notifications reste utile même si le destinataire n'était pas
  connecté pour recevoir l'événement temps réel.
- `GET /notifications`, `GET /notifications/unread-count` (alimente le
  badge — section 11), `PATCH /notifications/:id/read`,
  `PATCH /notifications/read-all`.
- `notification:new` diffusé en temps réel à la création.
- Types de notification **non** câblés pour l'instant (`NEW_VOICE_MESSAGE`,
  `INCOMING_CALL`, `TRANSLATION_COMPLETED`, `CONTACT_REQUEST`, `REACTION`) :
  les fonctionnalités correspondantes n'existent pas encore. Les créer
  maintenant aurait été prématuré — l'enum `NotificationType` les couvre
  déjà, chaque phase future n'aura qu'à appeler `NotificationsService.create`.
- Les vraies notifications push navigateur (Web Push) restent explicitement
  hors MVP (section 11 : "prévoir l'intégration future") — seul le centre
  de notifications in-app est construit ici.

### Vérifications effectuées (Phase 8)

`tsc --noEmit`, `nest build`, `eslint` (0 erreur), 53 tests Jest passés
(47 précédents + 6 nouveaux sur `NotificationsService`). Testé de bout en
bout contre la vraie base : compteur à 0, envoi d'un message par un autre
utilisateur, compteur passe à 1, contenu de la notification correct,
`read-all` le ramène à 0.

## Ce qui a été posé en Phase 9

- `UploadsModule` : `StorageService`, driver "local" (disque), pensé pour
  qu'un driver S3-compatible se substitue plus tard sans toucher aux
  appelants (section 2/38). Échoue tôt et clairement si `STORAGE_DRIVER`
  vaut autre chose que `local` — jamais un driver silencieusement ignoré.
  Protection explicite contre la traversée de répertoire (`../../etc/...`).
- `VoiceMessage.audioUrl` renommé en `audioStorageKey` (migration) : ce
  champ est une clé de stockage interne, jamais un chemin exposé — corrigé
  avant qu'un nom trompeur ne s'installe dans la durée.
- `POST /voice/messages` (multipart/form-data) : upload audio + métadonnées
  (durée, waveform, réponse à un message), validation stricte du type MIME
  et de la taille (section 23), même logique de livraison/notification que
  les messages texte (présence, `message:new`, notification
  `NEW_VOICE_MESSAGE`).
- `GET /voice/:messageId/audio` : streaming authentifié avec vérification
  d'appartenance à la conversation — jamais de fichier servi en statique
  public. Type MIME déduit de l'extension réellement stockée.
- Vérifié de bout en bout contre la vraie base **et de vrais fichiers** :
  upload → stockage → récupération → comparaison binaire (fichier identique
  à l'octet près), plus les cas d'erreur réels : 404 pour un non-membre qui
  tente de lire le vocal (aucune fuite d'information), 400 avec message
  clair pour un type de fichier refusé ou une requête sans fichier.

### Vérifications effectuées (Phase 9)

`tsc --noEmit`, `nest build`, `eslint` (0 erreur), 68 tests Jest passés
(53 précédents + 15 nouveaux : `VoiceService` et `StorageService`, dont un
test dédié à la protection contre la traversée de répertoire). Test manuel
de bout en bout avec upload réel via curl (`-F "audio=@fichier;type=..."`)
contre le serveur et la base réellement démarrés.

## Ce qui a été posé en Phase 10

**Aucun fournisseur Speech-to-Text réel n'a été configuré** (pas de clé API
fournie) : cette phase construit l'architecture complète du premier maillon
du pipeline de traduction (section 38), avec un comportement honnête tant
qu'aucun fournisseur n'est branché — jamais de fausse transcription
(section 40).

- `TranslationsModule` devient réel : `SpeechToTextService` sélectionne un
  provider selon `STT_PROVIDER` (toujours `"none"` par défaut). Ajouter un
  vrai fournisseur (OpenAI Whisper, Google Speech-to-Text…) consistera à
  écrire une classe qui respecte `SpeechToTextProvider` et à l'ajouter au
  switch de `buildProvider()` — aucun appelant (`VoiceService`,
  `VoiceController`) n'aura à changer.
- `UnconfiguredSpeechToTextProvider` : échoue toujours avec un message clair
  ("La transcription vocale est temporairement indisponible…") plutôt que
  de renvoyer un texte inventé.
- Envoyer un vocal déclenche une tentative de transcription **automatique,
  best-effort et non bloquante** — mais seulement si un fournisseur est
  réellement configuré (`isConfigured()`). Sinon, rien ne se déclenche :
  pas d'événement `translation:started` fantôme, pas de tentative vouée à
  l'échec. Le vocal est de toute façon déjà entièrement envoyé et
  utilisable (section 35 : mode dégradé, jamais de message retardé ou
  perdu à cause de la traduction).
- `POST /voice/:messageId/transcribe` : relance manuelle — renvoie un 503
  explicite si aucun fournisseur n'est configuré (jamais un faux succès).
- `PATCH /voice/:messageId/language` : correction manuelle de la langue
  détectée (section 19), réservée à l'auteur du vocal.
- Événements temps réel `translation:started` / `translation:completed` /
  `translation:failed` diffusés à tous les membres de la conversation
  (auteur inclus) — prêts à être utilisés par les phases 11-13
  (traduction, TTS) qui émettront sur ces mêmes canaux.
- Vérifié en conditions réelles : un vocal s'envoie et reste pleinement
  utilisable sans fournisseur configuré, la retranscription manuelle
  renvoie bien un 503 clair, et la correction manuelle de langue fonctionne
  de bout en bout contre la vraie base.

### Vérifications effectuées (Phase 10)

`tsc --noEmit`, `nest build`, `eslint` (0 erreur), 74 tests Jest passés
(68 précédents + 6 nouveaux couvrant : absence de tentative si non
configuré, déclenchement + mise à jour du transcript si configuré,
diffusion de `translation:failed` en cas d'échec du fournisseur, rejet du
retranscribe manuel sans fournisseur, contrôle d'accès de la correction de
langue). Démarrage réel du serveur avec toutes les routes `/voice/*`
mappées et testées manuellement.

## Ce qui a été posé en Phase 11

**Toujours aucun fournisseur de traduction réel configuré** — même logique
qu'en phase 10 : architecture complète, comportement honnête (section 40).

- `TranslationService` : même principe que `SpeechToTextService` (sélection
  de provider par `TRANSLATION_PROVIDER`, `UnconfiguredTranslationProvider`
  qui échoue toujours explicitement).
- **Refactor** : la logique STT + traduction a été extraite de `VoiceService`
  vers un nouvel orchestrateur, `VoiceTranslationPipelineService`, qui suit
  exactement le schéma du cahier des charges (section 38 : VoiceMessage →
  SpeechToTextService → TranslationService → [TextToSpeechService, phase
  12]). `VoiceService` ne fait plus que déclencher le pipeline en tâche de
  fond après l'envoi — il ne connaît plus les détails de la transcription.
  Ce découpage a été possible parce que `MessageTranslation` (posé dès la
  phase 1) est explicitement lié à `VoiceMessage`, pas aux messages texte :
  le schéma de données avait déjà tranché que ce pipeline est spécifique
  aux vocaux, pas une fonctionnalité générale de traduction de texte.
- Une fois un transcript obtenu (phase 10) avec une langue reconnue, le
  pipeline calcule la ou les langues cibles distinctes à partir des
  préférences réelles (`User.preferredReceiveLanguage`) des autres membres
  de la conversation, et ignore une cible identique à la langue source
  (inutile de "traduire" du français vers le français).
- `MessageTranslation` (posée dès la phase 1, jamais utilisée jusqu'ici) est
  maintenant réellement peuplée : `PENDING` → `PROCESSING` →
  `COMPLETED`/`FAILED`, avec `errorMessage` interne jamais exposé tel quel
  (section 34).
- Les traductions sont exposées dans `GET .../voice/*` : section 18
  ("afficher l'original ET la traduction") — jamais l'original supprimé au
  profit de la traduction.
- Événements `translation:started`/`completed`/`failed` désormais utilisés
  pour les deux étapes (`stage: 'transcription'` et `stage: 'translation'`),
  sur les canaux déjà posés en phase 10.

### Vérifications effectuées (Phase 11)

`tsc --noEmit`, `nest build`, `eslint` (0 erreur), 81 tests Jest passés
(74 précédents + 7 nouveaux sur `VoiceTranslationPipelineService`, dont un
test dédié au cas "langue détectée non reconnue" et un à "langue cible déjà
parlée"). Démarrage réel du serveur après ce refactor de câblage assez
conséquent — aucune erreur de dépendance cette fois (contrairement aux
phases 2, 3 et 6) — et test manuel confirmant qu'envoyer un vocal continue
de fonctionner normalement avec la nouvelle structure.

## Ce qui a été posé en Phases 12 et 13 (traitées ensemble)

Construites dans la même passe car intrinsèquement liées : le TTS ne doit
jamais tenter de cloner une voix sans vérifier le consentement d'abord.
**Toujours aucun fournisseur TTS/clonage réel configuré.**

- `TextToSpeechService` : même principe que les deux services précédents
  (sélection par `TTS_PROVIDER`, `UnconfiguredTextToSpeechProvider` qui
  échoue toujours explicitement).
- `VoiceIdentityService.resolveVoiceReference()` : le garde-fou concret de
  la section 15. Ne renvoie une référence de voix clonée que si **les deux
  conditions sont réunies** — `Profile.voiceCloningConsent` actif ET un
  `voiceModelId` déjà enregistré — sinon `null`, et le pipeline synthétise
  alors avec une voix générique. Résolu à nouveau à chaque exécution
  (jamais mis en cache) : un consentement révoqué entre l'envoi du vocal et
  l'exécution du pipeline est immédiatement respecté.
- Le pipeline enchaîne maintenant complètement : transcription → traduction
  → synthèse vocale, chaque étape best-effort et indépendante (l'échec de
  l'une ne défait jamais le résultat acquis de la précédente — vérifié par
  un test dédié : le texte traduit reste `COMPLETED` même si la synthèse
  échoue ensuite).
- `MessageTranslation.translatedAudioStorageKey` (renommé depuis
  `translatedAudioUrl`, même correction que pour `VoiceMessage` en phase 9)
  et `usedVoiceCloning` sont maintenant réellement peuplés.
- `GET /voice/:messageId/translations/:languageCode/audio` : même contrat
  d'accès authentifié que l'audio original.
- **Volontairement différé** : l'inscription d'un modèle vocal
  (`Profile.voiceModelId`) — upload d'échantillons pour entraîner un clone,
  section 32 "aperçu de ma voix"/"supprimer mon modèle vocal". Sans
  fournisseur de clonage réel pour la tester, construire ce flux maintenant
  ne produirait qu'un endpoint mort (section 40). Le garde-fou de
  consentement, lui, est réel et testé dès maintenant — il protège déjà
  contre tout clonage non autorisé, prêt à fonctionner dès qu'un
  `voiceModelId` existera.

### Vérifications effectuées (Phases 12-13)

`tsc --noEmit`, `nest build`, `eslint` (0 erreur), 85 tests Jest passés
(81 précédents + 4 nouveaux sur l'étape TTS du pipeline, dont un test qui
vérifie explicitement qu'aucun clonage ne se déclenche sans consentement
**et** modèle, et un autre que le clonage s'active bien quand les deux sont
réunis). Démarrage réel du serveur, nouvelle route testée manuellement
(404 propre pour un audio traduit qui n'existe pas), et confirmation qu'un
envoi de vocal continue de fonctionner normalement avec le pipeline étendu.

## Ce qui a été posé en Phase 14

- `StatusesModule` : `POST /statuses` (texte, ou photo/vidéo/vocal en
  multipart), `GET /statuses` (tout ce qui m'est visible et pas encore
  expiré), `GET /statuses/:id/media` (streaming authentifié),
  `GET /statuses/:id/views` (réservé à l'auteur), `POST /statuses/:id/view`,
  `DELETE /statuses/:id`.
- Expiration à 24h calculée à la création (`expiresAt`), appliquée en
  filtrant chaque lecture (`expiresAt > now()`) — un statut expiré devient
  invisible immédiatement, sans job de nettoyage. La suppression physique
  des lignes/fichiers expirés est différée à la phase 15 (optimisation) :
  ne change rien au comportement observable, juste du ménage de stockage.
- Validation de fichier par type (image/vidéo/vocal), chacun avec ses
  propres formats et limites de taille — nouvelles constantes
  `media-upload.constants.ts` aux côtés de celles pour les vocaux.
- `Status.mediaUrl` renommé `mediaStorageKey` (même correction que pour
  `VoiceMessage`/`MessageTranslation` — jamais un chemin exposé directement).
- Nombre de vues et liste des personnes ayant vu : **privés, réservés à
  l'auteur** (section 21) — jamais exposés aux autres viewers, même pas le
  chiffre seul.

### Décision de conception à noter

Le cahier des charges prévoit une visibilité "contacts sélectionnés", mais
**aucun système de contacts/amis n'a jamais été construit** dans ce projet
(ni en phase 3, ni ailleurs — juste une recherche libre d'utilisateurs).
`CONTACTS` est donc défini pragmatiquement comme "quelqu'un avec qui je
partage déjà une conversation active" — solution de repli honnête et
documentée dans le code, pas une fonctionnalité contacts complète. Une
vraie liste de contacts (avec sélection individuelle par statut) reste à
construire si besoin, hors des 16 phases du cahier des charges.

### Vérifications effectuées (Phase 14)

`tsc --noEmit`, `nest build`, `eslint` (0 erreur), 100 tests Jest passés
(85 précédents + 15 nouveaux). Testé de bout en bout contre la vraie base
et de vrais scénarios à deux comptes : un statut `EVERYONE` visible par une
inconnue ; un statut `CONTACTS` invisible pour elle tant qu'aucune
conversation n'existe, avec 404 propre sur une tentative d'accès direct
(aucune fuite d'existence) ; puis visible dès qu'une conversation démarre
entre les deux comptes — la logique "contact = conversation partagée"
validée en conditions réelles, pas seulement en théorie.

## Ce qui a été posé en Phase 15

- **Rate limiting** (`@nestjs/throttler`) : limite globale par défaut
  (60 req/min/IP) sur toutes les routes HTTP, avec des limites plus
  strictes sur les endpoints d'authentification sensibles — `POST
  /auth/login` et `/register` (5/min), `/auth/refresh` (20/min),
  `/auth/password-reset/request` (3/min, contre l'énumération d'emails et
  le spam), `/auth/password-reset/confirm` (5/min). `@nestjs/throttler`
  reste bloqué en amont sur NestJS 12 dans son `peerDependencies` (ne va
  que jusqu'à `^11.0.0`), mais **fonctionne réellement** avec — installé de
  force (`.npmrc` avec `legacy-peer-deps=true`, expliqué en commentaire) et
  **vérifié en conditions réelles** : 7 tentatives de connexion d'affilée
  donnent 5×401 puis 2×429, chiffres exacts attendus. Limite connue : ce
  guard ne couvre que les routes HTTP, pas les connexions WebSocket.
- **Nettoyage planifié** (`@nestjs/schedule`, `CleanupService`,
  `MaintenanceModule`) : purge horaire des sessions expirées, jetons de
  réinitialisation de mot de passe expirés, et statuts expirés (ligne +
  fichier média). Ne change aucun comportement observable — les lectures
  filtraient déjà par expiration — juste la libération de l'espace de
  stockage et de la base. Chaque tâche isolée par son propre try/catch
  (même leçon que `PresenceService`, phase 6). Requête de nettoyage des
  sessions **vérifiée contre la vraie base** : une session expirée
  manuellement en SQL a été supprimée par la requête exacte du service,
  et une seule — les 5 autres sessions actives n'ont pas bougé.
- **En-têtes de sécurité** (`helmet`) : CSP désactivée explicitement
  (casserait Swagger sans bénéfice réel pour une API qui ne sert pas de
  HTML applicatif) ; les autres en-têtes standard (`X-Content-Type-Options`,
  `X-Frame-Options`, HSTS…) vérifiés présents sur une vraie réponse.
- **Pagination de `GET /conversations`** : jusqu'ici non paginée (seule
  liste qui pouvait grossir sans borne). Au passage, extraction d'un
  `PaginationQueryDto` commun réutilisé par messages/notifications/
  conversations — trois DTOs identiques dupliqués depuis les phases 5/8
  n'ont plus de raison de l'être.
- **Suppression des messages vocaux** : trouvé pendant la revue que
  `VoiceService` n'avait jamais d'équivalent à `MessagesService.remove()`
  — un vocal envoyé ne pouvait jamais être supprimé. Ajouté
  (`DELETE /voice/:messageId`), même contrat que les messages texte :
  réservé à l'auteur, suppression douce idempotente, fichier audio effacé
  du stockage. Vérifié de bout en bout : suppression → lecture ensuite
  → 404 → nouvelle suppression → toujours 200 (idempotent).

### Décision de conception à noter (revue sécurité)

Un access token JWT déjà émis reste valide jusqu'à son expiration
(15 min par défaut) même si la session est révoquée ou le mot de passe
changé entre-temps — seuls le refresh et les futures requêtes après
expiration voient la révocation. C'est le compromis standard des systèmes
JWT à courte durée de vie (vérifier la révocation à chaque requête
demanderait une lecture base à chaque appel, annulant l'intérêt d'un JWT
sans état) — pas un oubli, mais un choix explicite qu'il valait la peine
de noter clairement plutôt que de laisser implicite.

### Explicitement différé

Validation du contenu réel des fichiers uploadés (vérification des
"magic bytes" au-delà du simple `Content-Type` déclaré par le client, qui
peut être falsifié) — défense en profondeur réelle mais non critique tant
que les fichiers ne sont jamais servis autrement qu'en streaming
authentifié avec un `Content-Type` recalculé côté serveur (jamais celui
fourni par le client). À ajouter si des fournisseurs IA venaient à traiter
ces fichiers de façon moins contrôlée.

### Vérifications effectuées (Phase 15)

`tsc --noEmit`, `nest build`, `eslint` (0 erreur), 111 tests Jest passés
(100 précédents + 11 nouveaux : `CleanupService` et suppression des
messages vocaux). Démarrage réel du serveur à chaque étape, et pour la
première fois dans ce projet, une vérification contre la vraie base pour
une fonctionnalité qui n'a pas d'endpoint HTTP à elle seule (le nettoyage
planifié) — exécutée manuellement via un script isolé plutôt que d'attendre
une heure que le cron se déclenche.

## Ce qui a été posé en Phase 16

Tests d'intégration (e2e) en conditions quasi réelles : base Postgres
séparée (`glotta_test`, jamais celle de développement), vraie application
Nest bootstrée (`app.init()` + `app.listen(0)` pour le WebSocket),
requêtes HTTP réelles via `supertest`, vraies connexions Socket.IO via
`socket.io-client`. Trois suites :

- **`test/auth.e2e-spec.ts`** (13 tests) : inscription (succès, doublon de
  nom d'utilisateur → 409, ni email ni téléphone → 400, langue inconnue →
  400), connexion (succès, mauvais mot de passe et identifiant inconnu →
  même message générique « Identifiants invalides. », pour ne jamais
  révéler si un compte existe), routes protégées (401 sans token, 401 avec
  un token invalide, 200 avec un token valide), refresh (nouveau token
  réellement utilisable, refresh invalide → 401), déconnexion (le refresh
  token ne fonctionne plus après logout — vérifié en le réutilisant).
- **`test/access-isolation.e2e-spec.ts`** (le test explicitement demandé
  par le cahier des charges, section 43 : « un utilisateur A ne doit
  jamais pouvoir lire les messages de B et C »). A crée une conversation
  directe avec B et y envoie un message texte puis un vocal (upload réel
  d'un fichier). Un troisième utilisateur C, non-membre, reçoit **404**
  (pas 403 — l'existence même de la conversation n'est pas révélée) sur
  la lecture de la conversation, la liste des messages, le marquage lu,
  l'édition/suppression d'un message, la lecture et la suppression du
  vocal ; la conversation n'apparaît pas dans la liste de C. B (membre
  légitime) peut bien lire conversation/messages/vocal, mais reçoit
  **403** (pas 404 — la ressource existe et B la voit, mais n'en est pas
  l'auteur) en tentant d'éditer ou supprimer un message d'A : distinction
  vérifiée entre appartenance à la conversation et propriété du message.
  Un dernier cas confirme qu'une conversation entre B et un quatrième
  utilisateur D reste invisible (404) pour A, alors même qu'A connaît B.
- **`test/websocket.e2e-spec.ts`** (5 tests) : connexion refusée sans
  token, acceptée avec un token valide, `message:typing` relayé au membre
  B mais jamais à un non-membre C, un `message:typing` émis par C
  (usurpant une conversation dont il n'est pas membre) n'est jamais
  transmis à B, et `message:new` est bien poussé en temps réel à B quand
  A envoie un message via l'API REST pendant que le socket de B est
  ouvert.

Infrastructure de test créée au passage : `.env.test` (base, secrets et
fournisseurs IA distincts de dev — tous les fournisseurs IA à `none` pour
ne jamais dépendre d'un vrai appel externe pendant les tests),
`test/utils/test-db.ts` (vide toutes les tables entre les suites via
`TRUNCATE ... CASCADE`, sauf `languages` qui reste seedée), et
`test/utils/test-users.ts` (inscription d'un utilisateur de test avec un
nom d'utilisateur garanti unique).

### Deux bugs réels trouvés en écrivant ces tests (ni compilation, ni simple exécution)

- **Noms d'utilisateur de test invalides** : mes propres fixtures
  utilisaient des tirets (`auth-e2e-1`, `iso-a`, `ws-a`), que la vraie
  regex de `RegisterDto.username` (lettres/chiffres/points/underscores
  uniquement) rejette à raison avec un 400 — bug dans mes tests, pas dans
  l'app, diagnostiqué en loggant le corps de la réponse réelle plutôt
  qu'en devinant. Corrigé (tirets → underscores).
- **`LanguagesService.findEnabledByCode` renvoyait 404 au lieu de 400** :
  utilisé uniquement pour valider un champ de requête (langue principale
  à l'inscription, langue de réception préférée, langue déclarée d'un
  audio à transcrire) — jamais pour résoudre une ressource depuis une
  URL. Un code de langue inconnu dans le corps d'une requête est une
  requête invalide, pas une ressource absente ; `findManyEnabledByCodes`,
  juste à côté dans le même fichier, le faisait déjà correctement en 400.
  Trouvé par le test e2e d'inscription (`langue principale inconnue`, qui
  attendait 400 et recevait 404) — un vrai bug de l'application, présent
  depuis la Phase 1, jamais détecté par les tests unitaires parce qu'ils
  mockent `LanguagesService` et ne testent donc jamais son comportement
  interne. Corrigé, et vérifié qu'aucun appelant (auth, profil, vocal) ne
  dépendait du type d'exception précédent.

### Rate limiting neutralisé pendant les tests, pas contourné au niveau du test

Une suite e2e qui inscrit plusieurs utilisateurs de suite déclenchait la
vraie limite de `/auth/register` (5/min), provoquant des 429 sans rapport
avec ce qui était testé. Deux approches côté module de test ont échoué
(`overrideGuard()` — connu pour ne pas intercepter un guard global
enregistré via `APP_GUARD` — puis `overrideProvider(APP_GUARD)`, qui ne
fonctionne pas non plus : Nest ne réévalue pas les enhancers globaux déjà
collectés au bootstrap dans un module de test). Résolu au niveau de la
vraie configuration du module plutôt qu'en luttant contre le mécanisme de
test : `ThrottlerModule.forRoot()` accepte une option `skipIf` globale,
activée uniquement par `DISABLE_RATE_LIMITING=true` dans `.env.test`
(jamais dans `.env`/`.env.example`) — le comportement de production,
lui, déjà vérifié en conditions réelles en Phase 15, reste intact.

### Vérifications effectuées (Phase 16)

`tsc --noEmit`, `nest build`, `eslint` (0 erreur), 111 tests unitaires
(inchangés), et pour la première fois du projet une vraie suite e2e :
30 tests (`auth`, `access-isolation`, `websocket`) passés contre une base
Postgres réelle et de vraies connexions Socket.IO — aucun résultat simulé
ou mocké à ce niveau. Backend, frontend et Postgres confirmés en ligne
(`200`/`200`/`accepting connections`) à l'issue de la phase.

## Interface (frontend)

Le frontend `frontend/` était resté au squelette par défaut de
`create-next-app` pendant les 16 phases (tout le travail précédent portait
sur le backend). Posé à partir d'une maquette fournie par l'utilisateur
(chat de groupe, thème sombre) : le backend ne gère que les conversations
directes (1-à-1) pour le MVP — les groupes sont explicitement hors scope
(`ConversationType.GROUP`, jamais créé) — donc la maquette sert de
référence visuelle (mise en page 3 colonnes, palette, bulles, panneau
d'infos) adaptée à une vraie conversation 1-à-1, sur décision explicite de
l'utilisateur d'accepter des éléments cosmétiques statiques (grille de
médias partagés, dégradés d'avatar) là où le backend n'a rien à afficher.

Posé et branché sur le vrai backend (aucune donnée de démonstration pour
ce qui EST disponible côté API) :

- **Auth** (`/login`, `/register`) : formulaires réels contre
  `POST /auth/login|register`, langues chargées depuis `GET /languages`,
  tokens persistés et rafraîchis automatiquement (`AuthProvider`,
  `api.ts` — un seul refresh en vol même si plusieurs requêtes échouent en
  401 simultanément, session invalide → redirection `/login` via un
  événement DOM plutôt qu'un `window.location.href` en dur).
- **Dashboard de conversation** (`/chat`) : rail d'icônes (compte,
  déconnexion, notifications avec badge temps réel), liste des
  conversations réelles (`GET /conversations`, tri par `updatedAt`,
  recherche client, accès rapide), fenêtre de discussion (historique
  paginé par curseur, séparateurs de jour, indicateur de frappe et
  diffusion temps réel via WebSocket, accusés envoyé/livré/lu), panneau
  d'infos (membres réels d'une conversation DIRECT — toujours exactement
  2, jamais un chiffre inventé —, mise en sourdine réelle via
  `PATCH /conversations/:id`), recherche d'utilisateurs et démarrage de
  conversation réels (`GET /users/search`, `POST /conversations`).
- **Messages vocaux** : lecture réelle et authentifiée (blob récupéré avec
  le token puis joué localement) depuis `GET /voice/:id/audio` — la
  bulle affiche des barres décoratives (l'amplitude réelle n'est exposée
  que par l'événement socket au moment de l'envoi, jamais par
  `GET /conversations/:id/messages`), jamais présentées comme une vraie
  forme d'onde. **Enregistrement et envoi** ajoutés dans un second temps
  (voir ci-dessous) : le bouton micro était initialement désactivé, le
  partage d'images et les appels restent eux hors de cette passe (boutons
  visibles mais désactivés, avec infobulle) — fonctionnalités à part
  entière, pas seulement une question d'habillage.

### Enregistrement et envoi de messages vocaux

Ajouté après un premier retour utilisateur ("continue") pointant vers le
bouton micro laissé désactivé. `useVoiceRecorder` (MediaRecorder de
l'API navigateur, formats testés dans l'ordre `audio/webm` → `audio/ogg`
→ `audio/mp4` via `MediaRecorder.isTypeSupported`, arrêt automatique à
`MAX_VOICE_DURATION_SECONDS` = 300 s pour rester synchronisé avec la
limite serveur) branché sur `MessageInput`, qui bascule l'intégralité de
la barre de saisie en interface d'enregistrement (minuteur, annuler,
envoyer) plutôt que de bricoler un état caché. Envoi réel en `multipart/
form-data` vers `POST /voice/messages` (`api.ts` étendu pour accepter un
corps `FormData` sans jamais poser `Content-Type` à la main — le
navigateur doit fixer la frontière multipart lui-même). La réponse de cet
endpoint (et l'événement socket `message:new` pour un vocal) a une forme
différente de celle des messages texte (champ imbriqué `voice`, jamais
`text`/`readAt`) — extrait dans `lib/normalize-message.ts`, partagé entre
la réception temps réel et l'envoi, pour ne plus dupliquer cette
conversion comme c'était le cas au premier jet.

Vérifié en conditions réelles, pas seulement via TypeScript : un fichier
WAV construit à la main envoyé exactement comme le ferait le navigateur
(mêmes champs multipart), lu ensuite via `GET /voice/:id/audio` avec une
taille de fichier identique en retour (aucune corruption), et reçu en
temps réel par un second compte via une vraie connexion Socket.IO
pendant que le premier envoyait — les trois avant tout affichage dans le
navigateur lui-même.

### Bug réel trouvé en testant l'interface en conditions réelles (pas en e2e)

En validant le temps réel avec deux vrais comptes et de vraies connexions
Socket.IO contre le serveur de dev (donc rate limiting HTTP réellement
actif, contrairement à toute la suite e2e qui le désactive via
`DISABLE_RATE_LIMITING`), chaque message entrant sur le gateway
(`message:typing`, `message:stop_typing`) échouait silencieusement côté
serveur avec `TypeError: res.header is not a function`. Cause : `Throttler
Guard` est enregistré globalement (`APP_GUARD`, Phase 15) pour les routes
HTTP, mais son implémentation pose des en-têtes `X-RateLimit-*` sur un
objet réponse Express — inexistant dans un contexte WebSocket. Résultat :
les indicateurs de frappe étaient cassés en dev/prod depuis la Phase 15,
sans qu'aucun test ne puisse le détecter (l'e2e désactive justement le
rate limiting partout). Corrigé par `@SkipThrottle()` sur `EventsGateway`
(le gateway a de toute façon son propre contrôle d'accès réel, vérifié en
base — cette exclusion ne retire aucune protection). Une régression
dédiée a été ajoutée (`test/websocket-throttling.e2e-spec.ts`), qui
réactive volontairement le rate limiting pour cette seule suite et
vérifie qu'un `message:typing` n'échoue plus — confirmée pour de vrai en
la faisant échouer sans le correctif avant de le restaurer.

### Vérifications effectuées (interface)

Contrat de données vérifié champ par champ contre le vrai backend (pas
seulement les types TypeScript) : inscription, connexion, recherche,
création de conversation, envoi/lecture de messages texte et vocaux
(upload multipart réel, lecture audio identique octet pour octet en
retour), marquage lu, et temps réel (`message:new` texte et vocal,
`message:typing`) via deux vrais comptes et de vraies connexions
Socket.IO, avant et après le correctif ci-dessus. Backend : `tsc`,
`nest build`, `eslint` (0 erreur), 111 tests unitaires, 31 tests e2e
(30 + la nouvelle régression). Frontend : `tsc --noEmit`, `next build`,
`eslint` (0 erreur — plusieurs vrais avertissements des nouvelles règles
React 19/Next 16 corrigés proprement, pas désactivés : `setState`
synchrone dans un effet, mutation pendant le rendu, lecture de ref
pendant le rendu).

### Paramètres du compte

Ajouté après un nouveau "continue" : jusqu'ici plusieurs endpoints backend
déjà construits et testés (profil, confidentialité, sessions, mot de
passe) n'avaient tout simplement aucune surface dans l'interface —
impossible de changer son mot de passe, de révoquer un appareil ou de
régler ses préférences de confidentialité sans passer par l'API
directement. `SettingsModal` (accessible depuis le menu du compte dans
`IconRail`) couvre les trois, en trois onglets :

- **Profil** : prénom/nom, URL d'avatar, statut, langue principale,
  langue de réception préférée, langues parlées — `PATCH /users/me` et
  `PATCH /users/me/profile` en parallèle, puis rechargement de `/users/me`.
- **Confidentialité** : les 5 interrupteurs et 2 sélecteurs de
  `UpdateProfileDto` (dernière connexion, statut en ligne, accusés de
  lecture, notifications, consentement au clonage vocal, qui peut
  m'écrire/voir mes statuts).
- **Sécurité** : changement de mot de passe (`PATCH /auth/change-password`),
  liste des appareils connectés avec révocation individuelle
  (`GET`/`DELETE /auth/sessions`) et déconnexion groupée
  (`POST /auth/logout-all`).

Bug réel trouvé en vérifiant le contrat plutôt qu'en faisant confiance
aux types écrits à la main : `api.users.updateProfile` était typé
`Promise<Me>` alors que `PATCH /users/me/profile` renvoie en réalité la
ligne `Profile` Prisma brute (`UsersController.updateMyProfile` délègue
directement à `ProfilesService.update()`, jamais reconstruite en `MeDto`)
— un type qui aurait fait planter tout code lisant `result.profile.xxx`
sur cette réponse. Aucun composant ne s'en servait directement (chacun
appelle `refreshMe()` juste après, qui refait un vrai `GET /users/me`),
donc pas de bug visible à l'usage, mais le type était faux et l'aurait
fait planter au premier jour où quelqu'un s'y serait fié. Corrigé en
ajoutant le vrai type `ProfileRecord` (voir `lib/types.ts`).

### Interruption d'environnement pendant cette passe

Le conteneur Postgres et les deux serveurs de dev ont disparu en cours de
route (stockage Podman réinitialisé par le sandbox, même symptôme déjà
noté en Phase 7) — détecté immédiatement par les vérifications en
conditions réelles (connexions refusées) plutôt que supposé résolu.
Conteneur recréé, migrations et seed rejoués, comptes de démonstration
reconstruits, avant de reprendre les vérifications de paramètres.

### Statuts (stories 24h)

Encore un "continue" — repéré en cherchant la prochaine fonctionnalité
backend déjà complète (Phase 14, section 21) mais totalement absente de
l'interface : `StatusesController`/`StatusesService` existaient depuis
longtemps (texte, image, vidéo, vocal, expiration à 24h, visibilité,
compteur de vues réservé à l'auteur), le bouton caméra de `IconRail`
restait désactivé faute d'écran. `StatusesModal` (composeur texte + image,
anneaux façon "story" groupés par auteur, indicateur vu/non-vu réel) et
`StatusViewer` (plein écran, barres de progression, avance automatique,
pause au clic maintenu, liste des vues pour ses propres statuts,
suppression) couvrent maintenant texte et image ; vidéo et vocal
affichent un message honnête plutôt qu'un écran cassé (composeur limité à
texte/image dans cette passe, seuls types que `StatusComposer` propose).

Bug réel trouvé en vérifiant le contrat plutôt qu'en faisant confiance à
`<img src>` : `GET /statuses/:id/media` est protégé par `JwtAuthGuard`
(comme l'audio des messages vocaux), or une balise `<img>` ne peut porter
aucun en-tête `Authorization` — et l'URL renvoyée par le backend
(`mediaUrl`) est de toute façon relative à son propre domaine, pas à
celui du frontend. Un `<img src={mediaUrl}>` direct aurait donc échoué
dans les deux sens à la fois (mauvaise origine, pas de token). Corrigé en
extrayant `AuthenticatedImage` (récupère l'image en blob authentifié puis
l'affiche via une URL d'objet locale) sur le même principe que
`VoiceMessageBubble` — testé avant toute chose contre le backend réel
(recherche client, avatar, deux comptes, un contenu image envoyé par un
compte et effectivement affiché sans erreur par l'autre).

Vérifié de bout en bout contre le vrai backend : création (texte et
image), octets identiques entre le fichier envoyé et celui récupéré via
l'endpoint de streaming, comptage et liste des vues, marquage vu.

### Partage d'images dans les conversations

Cette fois le "continue" touchait au **backend** : `MessageType.IMAGE` et
le modèle `Attachment` existaient dans le schéma depuis la Phase 1 mais
n'étaient utilisés nulle part — ni endpoint, ni service, le bouton image
de `MessageInput` restait désactivé. Ajouté sur le même principe que les
messages vocaux (Phase "Enregistrement et envoi de messages vocaux"
ci-dessus) plutôt que de dupliquer une architecture différente :

- `POST /messages/image` (multipart, réutilise `ALLOWED_IMAGE_MIME_TYPES`/
  `MAX_IMAGE_SIZE_BYTES` déjà définis pour les statuts photo) crée un
  `Message` de type IMAGE avec un `Attachment` imbriqué en une seule
  transaction, exactement comme `VoiceService.send` pour les vocaux.
- `GET /messages/attachments/:id` streame le fichier — membre de la
  conversation du message parent obligatoire, 404 sinon (jamais 403).
- `toMessageDto` (donc `GET /conversations/:id/messages` **et**
  l'événement socket `message:new`) renvoie désormais un tableau
  `attachments` — contrairement aux vocaux, une seule forme de DTO pour
  les deux canaux, pas de normalisation particulière côté frontend à
  prévoir.

Point de conception noté au passage : `Attachment.url` est un nom de
champ hérité (jamais renommé en `*StorageKey` contrairement à
`VoiceMessage`/`Status` lors de la passe sécurité de la Phase 15) — sa
valeur réelle est une clé de stockage interne, jamais une URL exposable
directement. Pas de migration pour autant : renommer une seule colonne
inutilisée ailleurs n'aurait rien changé pour personne, documenté dans
le code à l'endroit où c'est écrit plutôt que dans une migration.

Côté frontend : bouton image de `MessageInput` maintenant fonctionnel
(sélection de fichier, aperçu avec légende optionnelle avant envoi),
rendu de la bulle image via `AuthenticatedImage` (déjà introduit pour les
statuts), aperçu "📷 Photo" dans la liste des conversations. Testé de
bout en bout contre le vrai backend avant tout affichage navigateur :
octets identiques entre l'envoi et le téléchargement, présent dans
l'historique **et** reçu en temps réel avec exactement la même forme.

Complété par 10 nouveaux tests unitaires (`sendImage`, `streamAttachment`,
et la suppression du fichier joint à la suppression du message) et 3
nouveaux cas dans `access-isolation.e2e-spec.ts` (C ne peut ni récupérer
ni faire supprimer la pièce jointe de A, B le peut) — 34 tests e2e au
total désormais, 131 tests unitaires.

Bug d'environnement (pas de code) trouvé au passage : la base de test
(`glotta_test`) n'avait plus été réensemencée depuis la reconstruction du
conteneur Postgres plus tôt dans cette session — toute la suite e2e
échouait en 400 sur l'inscription ("langue inconnue"), rien à voir avec
le code ajouté. Repéré immédiatement en lançant réellement la suite
plutôt que de supposer qu'elle passerait.

### Statuts vidéo et vocaux

Complète les statuts (posés plus haut avec texte/image seulement) : la
composition supporte maintenant les 4 types du backend — sélecteur
image/vidéo (fichier) et vocal (`useVoiceRecorder`, déjà construit pour
les messages vocaux, réutilisé tel quel), et `StatusViewer` les lit
réellement (`AuthenticatedVideo`, nouveau, et `StatusVoicePlayer`, sur le
principe de `VoiceMessageBubble`) au lieu d'afficher le message
"pas encore pris en charge" laissé volontairement en place précédemment.
Vidéo et vocal avancent sur la fin réelle de leur lecture (`onEnded`),
pas sur le minuteur fixe de texte/image qui n'aurait aucun sens pour eux.
`AuthenticatedImage` a été redécoupé pour partager son mécanisme de
récupération (blob authentifié) via `useAuthenticatedBlobUrl`, désormais
commun à l'image et à la vidéo plutôt que dupliqué.

### Bug réel trouvé en testant les statuts vidéo (existant depuis la Phase 14, jamais couvert par un test)

`StatusesService` fusionnait les tables d'extensions image/vidéo/audio en
une seule pour résoudre le `Content-Type` au streaming — mais "webm" est
une extension partagée par `video/webm` **et** `audio/webm`, et la fusion
faisait gagner arbitrairement l'audio : un statut **vidéo** au format
webm était donc servi avec `Content-Type: audio/webm`, jamais détecté
faute d'un seul test sur `streamMedia` en trois phases d'existence.
Repéré en testant la nouvelle fonctionnalité contre le vrai backend
(`content-type: audio/webm` en retour d'un upload vidéo) avant même
d'ouvrir le navigateur. Corrigé en résolvant le type MIME par type de
statut (déjà connu en base) plutôt que par une extension ambiguë — le
type ne peut plus se tromper puisqu'il n'y a plus qu'une seule table
candidate par appel. Ajouté 5 tests à `statuses.service.spec.ts`
(`streamMedia` n'en avait aucun), dont un qui vérifie explicitement que
vidéo et vocal en `.webm` résolvent chacun leur propre type — 136 tests
unitaires au total pour le backend.

### Page d'accueil publique

`/` redirigeait silencieusement vers `/login` ou `/chat` sans jamais rien
montrer à quelqu'un qui ne connaît pas encore l'application — pas de
présentation, aucun moyen de comprendre ce qu'est Glotta avant de s'y
inscrire. Remplacé par une vraie page d'accueil pour les visiteurs non
connectés (les utilisateurs déjà authentifiés continuent d'être
redirigés directement vers `/chat`, comportement inchangé) : accroche,
mise en avant des fonctionnalités réelles (traduction vocale, texte/
vocal/images, présence, statuts), un aperçu de conversation illustrant
concrètement le principe (texte original + traduction, comme l'exige la
section 18 du cahier des charges), et la liste des langues **réellement
disponibles** — récupérée en direct via `GET /languages` (public, déjà
utilisé par la page d'inscription), jamais une liste inventée qui
pourrait se désynchroniser de ce que l'inscription accepte vraiment.

### Vérifications effectuées (interface, suite)

`tsc --noEmit`, `next build`, `eslint` (0 erreur) pour chaque ajout de
cette passe interface. Backend : `tsc`, `nest build`, `eslint` (0 erreur),
136 tests unitaires, 34 tests e2e — tous verts à l'issue de la dernière
modification.

## Fournisseurs IA réels branchés (Groq, DeepL, ElevenLabs)

Jusqu'ici les trois services de traduction (Phases 10-13) tournaient
volontairement en mode "non configuré" — code interchangeable prêt,
aucun vrai fournisseur écrit, comme prévu par le cahier des charges
(section 40 : jamais de résultat simulé). Sur demande explicite, les
trois cases commentées ont été remplacées par de vrais fournisseurs :

- **Speech-to-Text** : Groq (Whisper large-v3, gratuit) —
  `GroqSpeechToTextProvider`.
- **Traduction** : DeepL Free (500k caractères/mois) —
  `DeepLTranslationProvider`, gère la bascule `api-free`/`api` selon le
  suffixe `:fx` de la clé et les variantes régionales exigées par DeepL
  (EN → EN-US, PT → PT-PT).
- **Text-to-Speech / clonage vocal** : ElevenLabs —
  `ElevenLabsTextToSpeechProvider`.

`isConfigured()` des trois services a été corrigé au passage : il
reflétait auparavant la variable d'environnement brute (`STT_PROVIDER`)
plutôt que le fournisseur réellement construit — un `STT_PROVIDER="groq"`
sans `STT_API_KEY` aurait laissé croire au pipeline qu'une transcription
était possible alors qu'elle aurait échoué à coup sûr. Verrouillé par 3
nouveaux tests (un par service).

### Clonage vocal : l'inscription d'un modèle, différée depuis la Phase 12, est construite

`Profile.voiceModelId` n'était jusqu'ici jamais renseigné (lecture seule
dans `VoiceIdentityService`) — l'inscription attendait justement qu'un
vrai fournisseur existe pour être testée en conditions réelles plutôt
qu'à l'aveugle. Ajouté :

- `POST /users/me/voice-model` (multipart, exige un consentement déjà
  actif — jamais l'inverse) et `DELETE /users/me/voice-model`, sur
  `UsersController` (même principe que le profil : une seule surface
  `/users/me`).
- `VoiceIdentityService.enroll`/`removeModel` parlent directement à
  l'API ElevenLabs (`voices/add`, `voices/:id` DELETE) — un couplage à un
  fournisseur précis, inévitable ici puisque `TextToSpeechProvider` ne
  définit aucun contrat générique pour *enregistrer* une voix (seulement
  pour en synthétiser une déjà connue).
- Interface dans Paramètres → Confidentialité : enregistrement (réutilise
  `useVoiceRecorder`, déjà construit pour les messages vocaux) ou import
  d'un fichier, visible uniquement si le consentement est actif.
- `GET /users/me` expose désormais `profile.voiceModelRegistered`
  (booléen — jamais l'identifiant réel du modèle, référence interne au
  fournisseur).

### Affichage réel de la transcription et de la traduction — jusqu'ici absent de l'interface

Trou trouvé en marge de cette demande : même fonctionnel côté backend
depuis les Phases 10-13, aucun écran n'affichait transcription ou
traduction d'un message vocal — `VoiceMessageBubble` ne gérait que la
lecture de l'audio original. Corrigé :

- `GET /voice/:messageId` (nouveau) renvoie transcription et traductions
  d'un vocal déjà envoyé — sans lui, seuls les vocaux fraîchement reçus
  en direct (événement socket) auraient ce détail, jamais ceux chargés
  depuis l'historique (`GET /conversations/:id/messages` ne les a jamais
  connus, par conception — voir la Phase "Enregistrement et envoi de
  messages vocaux" plus haut).
- Le frontend hydrate en arrière-plan chaque vocal de l'historique qui
  n'a pas encore ce détail, et écoute désormais les événements socket
  `translation:started/completed/failed` (jusqu'ici jamais suivis) pour
  mettre à jour l'affichage en temps réel pendant que le pipeline tourne.
- `VoiceMessageBubble` affiche la transcription, puis la traduction dans
  la langue de réception préférée du viewer (une seule, jamais toutes —
  section 18) avec un bouton pour écouter l'audio traduit s'il existe,
  et un état honnête ("traduction en cours...", "indisponible") sinon —
  jamais de texte inventé en l'absence de résultat.

### Deux vrais bugs trouvés en conditions réelles (pas en test unitaire)

- **Extension audio rejetée par Groq** : `GroqSpeechToTextProvider`
  déduisait l'extension du fichier en coupant le sous-type MIME
  (`audio/x-wav` → `"x-wav"`) — Groq n'accepte qu'une liste fermée
  d'extensions (`wav`, jamais `x-wav`), donc tout vocal enregistré en WAV
  échouait en HTTP 400 dès le premier vrai appel. Corrigé en réutilisant
  `ALLOWED_AUDIO_MIME_TYPES` (déjà la bonne table de correspondance)
  plutôt qu'en reconstruisant l'extension à la main. Verrouillé par un
  test de non-régression.
- **ElevenLabs, plan gratuit** : deux limites découvertes en testant en
  direct, non documentées à l'avance — impossible d'utiliser une voix
  "library" (générique) via l'API sur le plan gratuit (HTTP 402), et le
  **clonage vocal instantané n'est pas inclus dans le plan gratuit du
  tout** (HTTP 400, "upgrade your plan"). Le code est prêt et fonctionnera
  dès qu'un compte payant sera activé ; en attendant, la synthèse vocale
  traduite reste honnêtement indisponible plutôt que simulée — décision
  prise explicitement avec l'utilisateur plutôt que supposée.

Groq et DeepL, eux, ont été vérifiés fonctionnant réellement de bout en
bout : un vocal envoyé par Alice a été transcrit ("you") puis traduit en
français ("toi") automatiquement, en conditions réelles, avant tout
affichage dans le navigateur.

### Vérifications effectuées

Backend : `tsc`, `nest build`, `eslint` (0 erreur), 167 tests unitaires
(dont 3 fournisseurs entièrement testés avec `fetch` simulé, le service
d'inscription vocale, et la régression Groq), 34 tests e2e. Frontend :
`tsc --noEmit`, `next build`, `eslint` (0 erreur). Testé en direct contre
de vraies API (Groq, DeepL, ElevenLabs) avec de vraies clés avant toute
vérification côté navigateur.

## Menu vocal, images uniformes, avatar téléversable et appels audio réels

### Message vocal : menu contextuel (supprimer, afficher la traduction, partager)

`VoiceMessageBubble` affichait jusqu'ici la traduction en permanence dès
qu'elle existait. Remplacé par un menu "⋮" (trois points verticaux, en
bout de bulle) avec trois actions : **Supprimer** (propres messages
uniquement, réutilise `DELETE /voice/:messageId`, déjà existant),
**Afficher/masquer la traduction** (bascule locale — la traduction n'est
plus affichée par défaut), et **Partager** (Web Share API,
`navigator.share` avec le fichier audio récupéré en `Blob`, repli
silencieux si l'API n'est pas disponible).

### Images de taille uniforme et agrandissables (chat + statuts)

Les vignettes d'image dans une conversation variaient jusqu'ici selon les
proportions du fichier d'origine. `MessageBubble` impose désormais une
taille fixe (`IMAGE_THUMBNAIL_SIZE = 220px`, `object-cover`) pour toutes
les images, cliquables pour ouvrir `ImageLightbox` (nouveau composant :
recouvrement plein écran, fermeture au clic en dehors ou touche Échap,
image affichée à sa taille réelle via `object-contain`). Au niveau des
statuts, `StatusViewer` traitait déjà l'image avec `object-contain` mais
pas la vidéo (`AuthenticatedVideo` sans `object-fit` explicite) — les deux
utilisent maintenant la même classe pour un comportement de cadrage
identique.

### Avatar de profil réellement téléversable

Jusqu'ici seule une URL externe saisie à la main était possible
(`Profile.avatarUrl`). Ajouté :

- `Profile.avatarStorageKey` (migration `add_avatar_storage_key`) —
  prioritaire sur `avatarUrl` quand les deux sont renseignés
  (`resolveAvatarUrl()`, nouveau, centralise la résolution partout où un
  avatar est exposé : conversations, statuts, `GET /users/me` et
  `GET /users/:id`).
- `POST /users/me/avatar` (multipart) et `DELETE /users/me/avatar` sur
  `UsersController`, délégant à `ProfilesService.setAvatar/removeAvatar`
  (réutilise `ALLOWED_IMAGE_MIME_TYPES`/`MAX_IMAGE_SIZE_BYTES`, déjà
  définis pour les images de message).
- `GET /users/:id/avatar` (nouveau `UserAvatarController`) — **le seul
  contrôleur de l'application délibérément hors du `JwtAuthGuard`** :
  un avatar doit être chargeable par une simple balise `<img src>`, sans
  en-tête d'autorisation, comme n'importe quelle image publique de profil.
- Interface : bouton de téléversement dans Paramètres → Profil, URL
  externe désactivée tant qu'un avatar est téléversé (exclusivité
  reflétée à la fois en base et dans le formulaire).

Vérifié en direct par upload/téléchargement à l'identique (comparaison
d'octets) sans aucun en-tête `Authorization`, visible par l'autre membre
d'une conversation, et 404 correct après suppression — 4 tests e2e
dédiés en plus des tests unitaires du service.

### Appels audio réels (WebRTC), jusqu'ici totalement absents

Périmètre validé avec l'utilisateur avant de commencer : audio uniquement
(pas de vidéo pour cette passe), signalisation WebSocket, et un serveur
TURN de secours pour que deux appareils sur des réseaux différents
puissent réellement se joindre (pas seulement sur le même réseau local).

**Backend** — nouveau module `calls` :

- `Call` (nouveau modèle Prisma, migration `add_calls`) — un appel est
  aussi un `Message` (nouveau type `CALL`, relation 1:1) : il apparaît
  dans le fil de la conversation ("Appel manqué", "Appel · 2:14") et
  alimente `Conversation.lastMessage` exactement comme les autres types,
  sans aucune table séparée à interroger pour l'historique du fil.
  Statuts : `RINGING → ACTIVE → {DECLINED, MISSED, ENDED}`.
- `CallsGateway`, namespace WebSocket dédié `/calls` — **volontairement
  séparé d'`EventsGateway`**, pas ajouté dedans : `CallsService` a besoin
  de `NotificationsService` (notifications `INCOMING_CALL`/`MISSED_CALL`,
  cette dernière nouvelle), qui dépend elle-même de `WebsocketModule` pour
  diffuser — les regrouper dans `EventsGateway` aurait fermé un cycle de
  modules à trois sauts (Websocket → Calls → Notifications → Websocket)
  que `forwardRef()` ne couvre proprement que pour des cycles à deux
  (comme `PresenceModule`, déjà en place). Un namespace séparé n'a besoin
  d'aucune des deux dépendances d'`EventsGateway` : aucun cycle à
  résoudre. `verifySocketUserId()` (extrait d'`EventsGateway`, qui l'utilise
  aussi désormais) évite de dupliquer la vérification du token JWT entre
  les deux gateways.
- Événements : `call:invite` (avec réponse `busy` immédiate si l'appelé
  est déjà en communication, sans jamais le faire sonner), `call:accept`,
  `call:reject`, `call:cancel` (raccroché par l'appelant avant réponse —
  compté `MISSED`, jamais `DECLINED`), `call:end`, puis relais opaque de
  la signalisation WebRTC (`call:offer`/`call:answer`/`call:ice-candidate`)
  — jamais interprétée côté serveur, et jamais relayée à quiconque ne
  participe pas à l'appel (vérifié à chaque relais, même logique que
  `relayToOtherMembers` dans `EventsGateway`). `handleDisconnect` résout
  tout appel resté `RINGING`/`ACTIVE` d'un socket qui se déconnecte
  brutalement (fermeture d'onglet, perte réseau) — sans quoi l'autre
  partie resterait bloquée indéfiniment.
- `GET /calls/ice-servers` — STUN public (Google, gratuit) toujours
  inclus, TURN de secours configurable (défaut : Open Relay Project,
  service TURN public et gratuit, cf. `.env.example`) pour les paires
  d'appareils qu'un STUN seul ne peut pas connecter.
- `GET /calls/message/:messageId` (hydratation à la demande, même
  principe que `GET /voice/:messageId`) et `GET /calls` (historique tous
  fils confondus, avec direction sortant/entrant du point de vue de
  l'appelant — alimente le panneau "Appels" de la navigation).

**Frontend** :

- `useCall` (nouveau hook), monté une seule fois au niveau de la page de
  chat — jamais par conversation, pour qu'un appel entrant sonne quelle
  que soit la conversation ouverte. Connexion Socket.IO dédiée au
  namespace `/calls`, `RTCPeerConnection` avec les serveurs ICE du
  backend, micro demandé au moment de l'action explicite de
  l'utilisateur (démarrer ou accepter un appel), jamais en silence.
- `CallOverlay` (plein écran, sonnerie entrante/sortante, appel actif
  avec chronomètre et coupure micro, bref message de fin) et
  `CallsHistoryModal` (liste des appels, ouverte depuis la nouvelle
  entrée "Appels" du rail d'icônes).
- Bouton d'appel dans l'en-tête de conversation (jusqu'ici désactivé,
  "bientôt disponible"), activé pour les conversations directes.
- Bulle CALL dans le fil (icône téléphone + statut/durée) et
  prévisualisation dans la liste des conversations ("Appel manqué" en
  rouge, "Appel entrant...", "Appel · 2:14"...) — même donnée
  (`Call.status`/`durationSeconds`) affichée aux deux endroits.

Vérifié de bout en bout contre le vrai serveur avec deux comptes réels et
de vrais sockets (jamais simulé) : invitation → sonnerie reçue →
acceptation → relais d'offre/réponse/ICE → fin d'appel → durée persistée
correctement, plus `busy`, refus, raccroché avant réponse (`MISSED`),
déconnexion brutale pendant la sonnerie, et l'historique `GET /calls` vu
par chacun des deux participants. 8 tests e2e (vrais sockets sur le
namespace `/calls`) et 22 tests unitaires (`CallsService`) en plus de
cette vérification manuelle.

### Vérifications effectuées

Backend : `tsc`, `eslint` (0 erreur), 198 tests unitaires, 46 tests e2e.
Frontend : `tsc --noEmit`, `next build`, `eslint` (0 erreur). Backend et
frontend relancés proprement après ces changements et revérifiés en
conditions réelles (pas seulement via la suite de tests).

## Appels vidéo et interface responsive (mobile/tablette)

### Vidéo ajoutée aux appels existants, sans nouvelle infrastructure de signalisation

Décision prise avec l'utilisateur : la vidéo s'ajoute aux appels déjà
construits (jamais un second système parallèle), activable/désactivable à
tout moment pendant l'appel — pas seulement choisie à l'invitation.

- `Call.type` accepte désormais `VIDEO` en plus de `AUDIO` (migration
  `add_video_call_type`) — choisi à l'invitation (`call:invite` accepte
  `type`), reflète juste l'intention initiale de l'appelant. La caméra
  elle-même reste indépendante : côté frontend, `useCall.toggleVideo()`
  peut l'activer à tout moment pendant l'appel, y compris pour un appel
  démarré en audio.
- **Aucun changement de signalisation côté backend** au-delà de ce champ
  `type` et d'un nouvel événement générique `call:video-state`
  (`{enabled}`, relayé tel quel comme `call:ice-candidate` — même
  `relaySignal()` réutilisé) : l'ajout d'une piste vidéo à une connexion
  WebRTC déjà établie déclenche une renégociation (nouvelle offre/réponse)
  qui passe par les événements `call:offer`/`call:answer` déjà en place.
  `pc.onnegotiationneeded` n'est attaché qu'une fois la connexion initiale
  établie (jamais à la création du `RTCPeerConnection`) pour ne jamais
  entrer en conflit avec l'offre manuelle de la connexion.
- `call:video-state` existe parce qu'un `track.enabled = false` distant
  n'est pas observable côté récepteur par les seules API WebRTC — sans ce
  signal explicite, impossible de savoir s'il faut afficher la vidéo de
  l'autre participant ou son avatar.
- `CallOverlay` affiche la vidéo distante plein cadre dès qu'elle est
  active (avatar sinon, quel que soit le type d'appel initial), un aperçu
  de sa propre caméra en incrustation, et un bouton caméra à côté du micro
  pendant l'appel actif.
- Deux boutons distincts dans l'en-tête de conversation (audio / vidéo)
  plutôt qu'un choix caché dans un menu — geste le plus direct.

Vérifié en direct (vrais comptes, vrais sockets, et captures d'écran
Chrome headless avec un faux flux caméra) : type `VIDEO` correctement
propagé de l'invitation à l'appelé, relais `call:video-state` fonctionnel,
aperçu caméra locale effectivement affiché pendant un appel sortant. 19
tests unitaires `CallsService` (dont le nouveau cas `VIDEO`), 199 au total
côté backend, 46 tests e2e — tous verts.

### Interface responsive (mobile + tablette)

La mise en page à 3-4 colonnes côte à côte (rail d'icônes, liste des
conversations, fenêtre de discussion, panneau d'infos) devient navigable
écran par écran en dessous du seuil `lg` (1024px, Tailwind) — tablette
portrait comprise, comme demandé. Au-dessus de ce seuil, aucun changement
visuel : la disposition desktop reste strictement identique.

- `IconRail` et `ConversationList` se masquent (`hidden lg:flex`) dès
  qu'une conversation est ouverte sur petit écran, laissant `ChatWindow`
  toute la largeur ; un chevron de retour (nouveau, visible seulement
  `lg:hidden`) ramène à la liste.
- `InfoPanel`, jusqu'ici une colonne latérale fixe, devient un
  recouvrement plein écran (`fixed inset-0`) en dessous de `lg`, strictement
  identique à son apparence de colonne latérale au-dessus.
- Grilles à deux colonnes serrées sur petit écran (prénom/nom du profil,
  inscription) passent à une colonne en dessous de `sm` (640px) ; onglets
  des Paramètres rendus défilables horizontalement par sécurité.
- Modales (Statuts, Nouvelle conversation, Historique des appels) : déjà
  correctement responsives par construction (`w-full max-w-*` + marge
  extérieure) — un oubli de marge extérieure sur la modale "Nouvelle
  conversation" corrigé au passage. Paramètres a cessé d'être une modale
  peu après (voir section suivante).
- `CallOverlay` (plein écran par nature) et les pages d'authentification
  (déjà `max-w-sm` centré) ne nécessitaient aucun changement.

Vérifié par captures d'écran réelles (Chrome headless piloté par script,
comptes réels, pas de simulation visuelle) à plusieurs largeurs (390px
téléphone, 768px tablette portrait, 1440px desktop) : liste vide, liste
avec conversations, fil de discussion avec bouton retour, panneau d'infos
en recouvrement, Paramètres en une colonne, appel vidéo sortant avec
aperçu caméra — tout confirmé visuellement, pas seulement par lecture du
code Tailwind.

### Vérifications effectuées

Backend : `tsc`, `eslint` (0 erreur), 199 tests unitaires, 46 tests e2e.
Frontend : `tsc --noEmit`, `next build`, `eslint` (0 erreur), plus
vérification visuelle par captures d'écran réelles à plusieurs largeurs
(voir ci-dessus) — jamais uniquement la compilation.

## Paramètres : de la modale à une vraie page à 4 colonnes

Demande initiale : reprendre la mise en page et le style d'une maquette de
référence fournie par l'utilisateur (nav, liste, formulaire, aperçu du
profil en direct) pour l'écran Paramètres uniquement — portée validée
explicitement avant de commencer (pas de refonte du reste de l'interface,
pas de vrai système de thème clair/sombre inexistant à ce jour).

- `SettingsModal` (modale flottante) remplacé par `SettingsPage`, qui
  occupe le même emplacement que `ChatWindow` dans la mise en page du chat
  (`chat/page.tsx`) plutôt qu'un recouvrement — la liste des conversations
  reste visible à côté, comme dans la maquette, et sélectionner une
  conversation referme Paramètres pour rouvrir la discussion.
- Nouvelle 4e colonne `ProfilePreviewPanel` ("Aperçu du profil"),
  visible à partir de `xl` (1280px) : reflète en temps réel ce qu'un autre
  utilisateur verrait (nom, avatar, statut, langue principale/de réception,
  membre depuis, clonage de voix) — **avant tout enregistrement**, pendant
  que l'utilisateur tape.
- Pour que l'aperçu soit vraiment en direct sans dupliquer d'état,
  `SettingsPage` possède désormais le brouillon des champs concernés
  (prénom, nom, statut, langues) et le passe en contrôlé à `ProfileSection`
  (auparavant géré en état local, propre à lui) — resynchronisé depuis
  `user` uniquement quand sa référence change réellement (après un
  Enregistrer ou un Réinitialiser), jamais pendant la frappe. Fait pendant
  le rendu plutôt que dans un `useEffect` (motif recommandé par React pour
  ajuster un état dérivé d'une prop) pour ne pas déclencher de rendu
  intermédiaire inutile.
- Onglet "Notifications" séparé de "Confidentialité" (le réglage existait
  déjà, `Profile.notificationsEnabled` — simple déplacement dans son propre
  onglet, comme la maquette, pas une nouvelle fonctionnalité) ; onglet
  "Apparence" ajouté à l'état désactivé ("bientôt disponible", même motif
  que "Discussions vocales" dans le rail d'icônes) plutôt que de simuler un
  changement de thème qui n'existe pas.
- Badge appareil photo superposé à l'avatar (déclenche le même sélecteur de
  fichier que le bouton "Changer la photo").
- Volontairement omis de la maquette : lien de profil public cliquable et
  bouton "Voir mon profil public" — nécessiteraient une vraie page de
  profil public accessible par URL, qui n'existe pas ; les ajouter aurait
  affiché un lien qui ne mène nulle part.

### Fidélité visuelle resserrée sur une seconde passe

L'utilisateur a demandé une reproduction plus fidèle après la première
version — portée reconfirmée explicitement : les détails visuels de
l'écran Paramètres, pas le rail de navigation global (déjà tranché avant).
Ajouté : icônes sur chaque onglet, sous-titre sous "Paramètres", bouton
"Réinitialiser" avec icône, libellé "Photo de profil", bouton "Changer la
photo" en dégradé plein avec icône (au lieu d'un simple bouton bordé),
compteur de caractères sur le champ Statut, boutons de pied de formulaire
"Annuler"/"Enregistrer les modifications" (au lieu d'un seul bouton), et un
champ **Nom d'utilisateur** éditable avec icône "@" — celui-ci est une
vraie fonctionnalité nouvelle (pas juste visuelle) : `PATCH /users/me`
acceptait déjà `username` avec la vérification d'unicité existante
(section 23), seul un champ dans l'interface manquait pour l'utiliser.
Dans l'aperçu : espace réservé "Un mot sur vous..." affiché même sans
statut renseigné (au lieu de disparaître), libellé aligné sur la maquette
("Utilisation de la voix").

Régression trouvée en vérifiant sur mobile (390px) : le sous-titre sur
deux lignes chevauchait le bouton "Réinitialiser" dans l'en-tête. Corrigé
en masquant le sous-titre et le libellé texte de "Réinitialiser" (icône
seule) en dessous de `sm` (640px) — jamais repéré par la première capture
d'écran desktop uniquement, confirme l'intérêt de vérifier à plusieurs
largeurs à chaque changement visuel, pas seulement une fois.

Vérifié par captures d'écran réelles à plusieurs largeurs (desktop 1600px
avec la 4e colonne, mobile 390px), y compris une frappe en direct dans le
champ Statut confirmant que l'aperçu se met bien à jour avant tout
enregistrement, et la fermeture de Paramètres en sélectionnant une
conversation.

### Vérifications effectuées

Frontend : `tsc --noEmit`, `next build`, `eslint` (0 erreur), vérification
visuelle par captures d'écran réelles (desktop et mobile, aperçu en direct
confirmé). Aucun changement backend pour cette section.

### Bug réel : avatar bloqué par Cross-Origin-Resource-Policy

Signalé par l'utilisateur en testant en conditions réelles (photo de
profil qui ne s'affichait pas) — jamais détecté par les tests, ni par une
première vérification au `curl` (qui n'applique pas les politiques de
sécurité du navigateur). Cause réelle, trouvée en inspectant la console
d'un vrai navigateur : `helmet()` (section 23) pose
`Cross-Origin-Resource-Policy: same-origin` par défaut sur toutes les
réponses — ce qui bloque silencieusement (`net::ERR_BLOCKED_BY_RESPONSE`,
aucune erreur serveur) l'usage même pour lequel `GET /users/:id/avatar`
existe : être chargée par une balise `<img>` depuis une autre origine
(frontend:3000 → backend:4000). Corrigé en posant explicitement
`Cross-Origin-Resource-Policy: cross-origin` sur cette seule route — le
reste de l'API garde la protection par défaut de helmet. Au passage :
`test/utils/test-app.ts` n'appliquait ni `helmet()` ni `enableCors()`
malgré un commentaire affirmant reproduire fidèlement `main.ts` — corrigé
aussi (sans quoi ce bug, ou un similaire, resterait indétectable par les
tests e2e à l'avenir), avec une régression dédiée dans `avatar.e2e-spec.ts`.
Revérifié dans un vrai navigateur (Chrome piloté par script) après le
correctif : l'avatar se charge partout où il apparaît (Paramètres, liste
des conversations, en-tête de discussion) — un seul point de correction
pour toute l'appli, puisque tout passe par le même composant `Avatar` et
la même route backend.

## Navigation : le rail d'icônes pilote désormais la 2e colonne

Demande utilisateur : que cliquer un bouton du rail d'icônes affiche son
contenu dans la 2e colonne, comme "Discussions" déjà présent, plutôt que
d'ouvrir une modale flottante pour "Statuts" et "Appels".

- `StatusesModal`/`CallsHistoryModal` remplacés par `StatusesPanel`/
  `CallsPanel` : même contenu (listes, cartes) mais sans l'habillage modal,
  occupant le même emplacement que `ConversationList` (2e colonne). Le
  visionnage d'un statut (`StatusViewer`) et la composition
  (`StatusComposer`) restent des recouvrements — immersion volontairement
  conservée, ce n'est pas ce que l'utilisateur a demandé de changer.
- `IconRail` reçoit désormais `activeView` (`"conversations" | "statuses" |
  "calls"`) au lieu de callbacks d'ouverture de modale — les trois boutons
  concernés se surlignent correctement selon la vue active, plus seulement
  "Conversations" figé en permanence comme avant.
- Sélectionner une conversation (depuis la liste, ou une entrée de
  l'historique des appels) ramène `activeView` sur `"conversations"` —
  cohérent avec le fait qu'on regarde alors à nouveau une discussion.
- Comportement mobile (< `lg`) inchangé dans son principe : la vue active
  de la 2e colonne prend tout l'écran tant qu'aucune conversation n'est
  ouverte, exactement comme `ConversationList` déjà avant.

Vérifié par captures d'écran réelles : clic sur chaque bouton du rail →
contenu correspondant en 2e colonne avec le bon surlignage, retour à
"Conversations" fonctionnel, et le même comportement plein écran sur
mobile (390px) que `ConversationList`.

### Vérifications effectuées

Frontend : `tsc --noEmit`, `next build`, `eslint` (0 erreur), vérification
visuelle par captures d'écran réelles (desktop et mobile, cycle complet de
navigation entre les trois vues). Aucun changement backend pour cette
section.

## Spécification NEXORA : médias multiples (1/8)

Nouvelle spécification utilisateur en 30 sections (comportements type
messagerie moderne — jamais l'interface ni le code propriétaire d'une
appli existante), à traiter dans l'ordre donné, une fonctionnalité
réellement finie avant la suivante : 1) médias multiples, 2) partage de
contact, 3) profil + QR, 4) logique de notifications, 5) appels vocaux,
6) appels vidéo, 7) multi-appareils, 8) tests/sécurité. Item 1 traité ici.

### "MediaBatch/Album" : plusieurs photos/vidéos envoyées en une seule action

Jusqu'ici, `POST /messages/image` n'acceptait qu'un seul fichier, jamais
de vidéo, et chaque envoi devenait un message séparé — pas de notion de
groupe. Remplacé par un flux unifié :

- **Backend** — nouveau type de message `MEDIA_ALBUM` (remplace `IMAGE`
  pour tout nouvel envoi, même un seul fichier — l'affichage s'adapte
  côté frontend selon le nombre de pièces jointes) et `POST
  /messages/media` (`FilesInterceptor`, jusqu'à `MAX_MEDIA_ALBUM_ITEMS`
  = 10 fichiers, images et vidéos mélangées). Un seul `Message`, un
  `Attachment` par fichier (le modèle le permettait déjà — `messageId`
  optionnel, relation `hasMany` — il manquait juste l'endpoint). Chaque
  fichier validé (type MIME, taille — limites distinctes image/vidéo)
  *avant* toute écriture ; un seul fichier invalide rejette tout l'album,
  jamais un envoi partiel.
- `Attachment` étendu : `type` (IMAGE/VIDEO), `fileName`,
  `durationSeconds`, `width`, `height`, `position` (ordre explicite —
  Prisma ne garantit pas l'ordre d'un `include` sans `orderBy`).
  **Dimensions/durée jamais recalculées côté serveur** (pas de
  ffmpeg/sharp disponible dans cet environnement, et `image-size` a été
  essayé puis retiré — deux failles DoS non corrigées à ce jour dans ses
  parseurs ICNS/JXL/HEIF, `fixAvailable: false`, inacceptable sur un
  chemin d'upload authentifié mais public dans son contenu) : lues
  réellement côté client avant l'envoi (`<img>`/`<video>` du navigateur,
  jamais inventées) et transmises en métadonnées, exactement comme
  `VoiceMessage.durationSeconds` le fait déjà pour les vocaux — purement
  cosmétique, jamais utilisé pour une décision de sécurité.
- **Frontend** — `MediaComposerModal` (sélection groupée, aperçu en
  grille, retrait, réordonnancement par flèches, légende, envoi groupé) ;
  `MediaAlbumGrid` dans `MessageBubble` (1 média : identique à l'ancien
  rendu IMAGE ; 2/3/4 : mises en page dédiées ; 5+ : grille de 4 avec
  badge "+N") ; `MediaGalleryLightbox` (visionneuse plein écran,
  navigation précédent/suivant au clavier et à la souris, sur tous les
  médias de l'album y compris au-delà des 4 visibles). Vignette vidéo :
  un vrai `<video preload="metadata">` (première image réelle du
  fichier, jamais une miniature générée) plutôt qu'un espace réservé.
- Aperçu de la liste des conversations ("📷 3 médias", "🎥 Vidéo") :
  `Conversation.lastMessage` étendu avec `mediaCount`/`mediaHasVideo`,
  même principe que les champs `call*` déjà ajoutés pour les appels.
- `type IMAGE` reste géré en lecture pour tous les messages déjà
  existants (aucune migration de données) — seul le chemin d'envoi
  change.

Vérifié en direct : `curl` multipart avec deux images réelles (album de
2, bytes vérifiés), puis parcours complet dans un vrai navigateur piloté
par script — sélection de 5 photos, aperçu, légende, envoi, rendu en
grille 2×2 avec badge "+1", ouverture de la visionneuse et navigation
"1/2" → "2/2". 8 nouveaux tests unitaires (`sendMedia` : aucun fichier,
trop de fichiers, type refusé, taille refusée par type, non-membre,
album multi-fichiers correctement ordonné/classé, JSON de métadonnées
invalide ignoré proprement, aperçu de notification adapté), 207 tests
unitaires et 46 tests e2e au total, tous verts.

### Vérifications effectuées

Backend : `tsc`, `eslint` (0 erreur), 207 tests unitaires, 46 tests e2e.
Frontend : `tsc --noEmit`, `next build`, `eslint` (0 erreur), vérification
en direct par navigateur piloté par script (pas seulement des captures
statiques — interaction réelle : sélection de fichiers, envoi, navigation
dans la visionneuse).

## Spécification NEXORA : partage de contact (2/8)

### Demandes de contact (PENDING/ACCEPTED/DECLINED/BLOCKED) et partage de carte publique

Nouveau modèle `ContactRequest` (`requesterId`/`recipientId`/`status`/
`blockedById`, contrainte unique `[requesterId, recipientId]`) — pas de
table `Contact` séparée : "être en contact" se déduit d'une ligne
`ACCEPTED`, interrogée dans les deux sens, pour ne jamais dupliquer la
même relation. `SharedContact` (1—1 avec un `Message` de type
`CONTACT_SHARE`) porte uniquement `sharedUserId` : la carte affichée est
reconstruite à la demande via `UsersService.getPublicProfile()` — jamais
email/téléphone, réutilise exactement la vue déjà utilisée pour tout
profil public ailleurs dans l'appli.

- **Backend** — `ContactsModule`/`ContactsService`/`ContactsController`
  sous `/contacts` : `POST /requests` (envoi — accepte automatiquement si
  l'autre avait déjà une demande PENDING dans l'autre sens, relance une
  demande DECLINED plutôt que d'en dupliquer une), `POST
  /requests/:id/accept|decline`, `DELETE /requests/:id` (annulation par
  son auteur), `GET /requests?direction=incoming|sent`, `GET /contacts`
  (liste des contacts acceptés), `POST /block|unblock`, `GET
  /status/:userId` (NONE/PENDING_SENT/PENDING_RECEIVED/ACCEPTED/
  BLOCKED_BY_ME/BLOCKED_BY_THEM — pilote le bouton affiché sur une
  carte), `POST /share` (crée le message `CONTACT_SHARE`, diffusé en
  temps réel via `EventsGateway.emitToUsers('message:new', ...)`,
  jamais restreint aux contacts déjà acceptés de l'expéditeur — partager
  la carte de quelqu'un avec un tiers est volontairement permis, comme
  partager un lien de profil), `GET /message/:messageId` (hydratation à
  la demande depuis l'historique — même principe que `GET
  /calls/message/:id`, mais ici la forme renvoyée est déjà un `Message`
  complet, pas de type/convertisseur séparé côté frontend contrairement
  aux appels). Nouveau `NotificationType.CONTACT_ACCEPTED` (il n'existait
  jusqu'ici aucun moyen de prévenir l'auteur d'une demande qu'elle avait
  été acceptée).
- Aucun `forwardRef()` nécessaire pour `ContactsModule` (contrairement à
  `CallsModule`) : rien n'a besoin d'injecter `ContactsService` dans
  `EventsGateway`/`WebsocketModule`, le graphe reste un DAG simple.
- **Frontend** — nouvelle entrée "Contacts" dans le rail d'icônes
  (`UsersIcon`), 2e colonne `ContactsPanel` (demandes reçues avec
  accepter/refuser, recherche + envoi de demande, liste des contacts —
  cliquer en ouvre/démarre la conversation directe). `MessageBubble`
  affiche une carte de contact (`ContactShareCard`) pour tout message
  `CONTACT_SHARE` : avatar/nom/username, bouton "Ajouter" dont l'état
  (NONE/PENDING/ACCEPTÉ/...) est chargé au montage via `GET
  /contacts/status/:userId`. Nouveau bouton "Partager un contact" dans la
  zone de saisie (`ShareContactModal`, même UX de recherche que
  `NewConversationModal`) — le message part par la même voie que les
  autres envois (`page.tsx` l'ajoute localement puisque `shareContact` ne
  diffuse `message:new` qu'aux *autres* membres, jamais à l'expéditeur).
- Statuts de confidentialité `whoCanMessageMe`/`whoCanSeeMyStatus`
  restent volontairement non branchés sur cette relation pour l'instant
  (hors périmètre explicite de "partage de contact", à réévaluer si
  demandé plus tard).

Vérifié en direct : 30 nouveaux tests unitaires (`sendRequest` — auto-
acceptation croisée, relance d'une demande DECLINED, blocage dans les
deux sens avec message distinct selon qui a bloqué, etc. —, `accept`/
`decline`/`cancel`/`block`/`unblock`/`statusWith`/`shareContact`/
`getByMessageId`), 6 tests e2e avec vraies requêtes REST + un vrai socket
(diffusion `message:new` en temps réel pour une carte partagée,
isolation stricte — jamais accéder à la demande ou à la carte d'un
autre). Parcours complet dans un vrai navigateur piloté par script :
recherche "carol", envoi de la demande, acceptation côté carol par API,
notification `CONTACT_ACCEPTED` reçue côté alice (badge du rail à jour),
carol apparaît dans la liste de contacts d'alice, partage de la carte de
carol dans la conversation avec Bob (rendu correct dans la bulle et
l'aperçu de la liste "👤 Contact partagé"), rechargement confirmant que
le bouton de la carte reflète bien le nouveau statut ACCEPTED (✓ plutôt
que "Ajouter"). 237 tests unitaires et 52 tests e2e au total, tous verts.

### Vérifications effectuées

Backend : `tsc`, `eslint` (0 erreur), 237 tests unitaires, 52 tests e2e.
Frontend : `tsc --noEmit`, `eslint` (0 erreur), vérification en direct
par navigateur piloté par script (recherche, envoi/acceptation de
demande, partage de carte, statut mis à jour après rechargement) plutôt
que des captures statiques seules.

## Spécification NEXORA : profil public + QR code (3/8)

### Lien de profil partageable et QR code, scan en temps réel côté client

Aucune route backend nouvelle : `GET /users/:id` (déjà authentifié,
public dans son contenu) et `/contacts/*` suffisaient. Le lien de profil
encode uniquement l'id utilisateur — déjà un identifiant public non
sensible (exposé tel quel par `GET /users/:id`, les URLs d'avatar, le
`senderId` de chaque message...), jamais un mot de passe, un token de
session ou une donnée privée, et totalement indépendant de tout flux de
connexion (il n'en existe d'ailleurs aucun basé sur un QR dans cette
appli) — conformément à la contrainte de sécurité explicite du cahier des
charges.

- **Frontend uniquement** — nouvel onglet "Partager" dans les Paramètres
  (`ProfileShareSection`) : QR code généré côté client (`qrcode`, simple
  encodage local, aucun appel réseau), lien affiché en clair, "Copier le
  lien", "Partager" (Web Share API si disponible, repli sur la copie), et
  un bouton "Scanner un code".
- Nouvelle page `/profile/[userId]` — profil public (avatar, nom,
  username, langue), protégée comme n'importe quelle route authentifiée
  (redirection vers `/login` si anonyme). Le bouton d'action reflète la
  vraie relation via `GET /contacts/status/:userId` : "Ajouter en
  contact" (NONE), "Demande envoyée" (PENDING_SENT), invitation à
  répondre depuis Contacts (PENDING_RECEIVED), "Envoyer un message"
  (ACCEPTED — crée/ouvre la conversation directe), "Débloquer"
  (BLOCKED_BY_ME), état indisponible sans détail (BLOCKED_BY_THEM — ne
  révèle jamais qui a bloqué qui à la victime). `/chat` accepte
  désormais un paramètre `?c=<conversationId>` (consommé puis retiré de
  l'URL) pour ouvrir directement la conversation venant d'être créée
  depuis ce bouton.
- Nouvelle page `/scan` — décodage réel de QR code côté client
  (`jsqr`, appliqué en boucle sur les images de `getUserMedia`), jamais
  de simulation. N'accepte que les liens reconnus comme un profil Glotta
  (`parseProfileUrl`, backend `/profile/:id` uniquement) : un QR
  quelconque scanné n'entraîne jamais de navigation vers une destination
  arbitraire. Repli explicite si la caméra est indisponible/refusée :
  champ "coller un lien de profil".
- Supply-chain : `qrcode` et `jsqr` vérifiés via `npm audit` avant
  adoption (0 vulnérabilité, aucun script d'installation propre à ces
  deux paquets — voir le précédent avec `image-size` retiré plus tôt pour
  la même raison).

Vérifié en direct, y compris le chemin caméra réel (pas seulement le
repli) : QR généré dans Paramètres → Partager, décodé indépendamment
côté serveur (`jsQR` sur les octets bruts du PNG) pour confirmer qu'il
encode exactement `http://localhost:3000/profile/<id d'Alice>` ; visite
du profil de Bob par lien direct, clic "Ajouter en contact", persistance
confirmée après rechargement (`GET /contacts/status/:userId` re-fetché,
pas un simple état local) ; page `/scan` : repli caméra indisponible
affiché correctement, lien collé valide → navigation correcte, lien
arbitraire (`https://evil.example.com/...`) → rejeté, aucune navigation ;
puis **décodage caméra réel** : caméra simulée de Chrome
(`--use-fake-device-for-media-stream` + un fichier Y4M généré à partir du
QR PNG réel, converti en I420 image par image) branchée sur `/scan`
connecté en tant que Bob — décodage effectif par `jsQR` sur les frames de
la fausse caméra, navigation automatique vers le profil d'Alice, bouton
reflétant correctement PENDING_RECEIVED (Alice avait déjà envoyé une
demande à Bob juste avant dans le même test).

### Vérifications effectuées

Frontend : `tsc --noEmit`, `next build` (routes `/profile/[userId]`
dynamique et `/scan` statique compilent, `useSearchParams` dans
`/chat` correctement encapsulé dans un `<Suspense>`), `eslint` (0
erreur), 237 tests unitaires et 52 tests e2e backend toujours verts
(aucun changement backend). Vérification en direct par navigateur piloté
par script, y compris le chemin caméra réel via capture vidéo simulée de
Chrome — pas seulement des captures statiques ni le repli sans caméra.

## Spécification NEXORA : logique de notifications (4/8)

### Suppression des notifications redondantes pour une conversation déjà ouverte

Bug réel confirmé en testant plus tôt dans cette spécification :
`NotificationsService.create()` ne vérifiait que
`Profile.notificationsEnabled`, jamais si le destinataire avait déjà la
conversation concernée ouverte à l'écran — un message envoyé pendant que
le destinataire regarde activement la conversation créait quand même une
notification (badge + entrée dans le centre de notifications), contraire
à la section 14-18 du cahier des charges.

- **`PresenceService`** (déjà le point unique de vérité pour "qui est
  connecté", en mémoire par instance de serveur) étendu avec une seconde
  table `socketId -> conversationId` : `setOpenConversation(socketId,
  conversationId | null)` et `isViewingConversation(userId,
  conversationId)`, cette dernière vraie dès qu'AU MOINS un appareil
  connecté de l'utilisateur a cette conversation précise ouverte — jamais
  un seul état par utilisateur, pour rester correct avec plusieurs
  appareils (section 21-22, plusieurs onglets/téléphone+ordinateur).
  Nettoyée automatiquement à la déconnexion du socket.
- **`EventsGateway`** gagne deux événements entrants, `conversation:opened`
  `{conversationId}` et `conversation:closed`, qui ne font que déclarer
  l'état d'affichage du socket appelant (rien à exploiter en prétendant
  regarder une conversation dont on n'est pas membre : jamais consulté
  pour un autre id que celui du socket lui-même).
- **`NotificationsService.create()`** : pour les types "message"
  (`NEW_MESSAGE`, `NEW_VOICE_MESSAGE`, `REACTION` — jamais les appels,
  qui sonnent indépendamment de l'écran affiché via le namespace `/calls`,
  ni `CONTACT_REQUEST`/`CONTACT_ACCEPTED`, jamais liés à une conversation
  ouverte), ne crée rien si `presence.isViewingConversation(userId,
  payload.conversationId)` est vrai. `message:new` continue d'être
  diffusé sans condition (le fil de la conversation ouverte doit quand
  même se mettre à jour) — seule la notification "en plus" disparaît.
  Ceci satisfait aussi "jamais de notification pour un message déjà lu" :
  le frontend appelle déjà `markRead` dès qu'une conversation ouverte
  reçoit un message, donc un message qui n'a jamais généré de
  notification n'a jamais besoin d'en supprimer une a posteriori.
- **Frontend** — `chat/page.tsx` émet `conversation:opened`/`closed`
  selon `!showSettings && selected` (pas seulement `activeView ===
  "conversations"` : `ChatWindow` reste monté quand le rail affiche un
  autre panneau à côté, la conversation reste donc "ouverte").

Vérifié en direct : 6 nouveaux tests unitaires (suppression pour les
trois types "message", jamais pour les appels/contacts, jamais si un
AUTRE appareil regarde une autre conversation), 2 nouveaux tests e2e par
vrais sockets (message reçu conversation ouverte → aucune notification
mais `message:new` bien reçu ; conversation refermée → notification à
nouveau créée). Puis bout en bout via un vrai navigateur connecté en
tant que Bob avec la conversation d'Alice réellement ouverte : message
REST envoyé par Alice pendant que Bob regarde → visible immédiatement
dans son fil, confirmé côté serveur qu'aucune notification n'a été créée
pour ce message ; Bob quitte vers Paramètres (conversation fermée) →
nouveau message d'Alice → notification bien créée cette fois. 242 tests
unitaires et 54 tests e2e au total, tous verts.

### Vérifications effectuées

Backend : `tsc`, `eslint` (0 erreur), 242 tests unitaires, 54 tests e2e.
Frontend : `tsc --noEmit`, `next build`, `eslint` (0 erreur), vérification
en direct par navigateur piloté par script combinée à de vraies requêtes
REST côté émetteur, jamais une simulation des deux côtés.

## Spécification NEXORA : appels vocaux et vidéo (5-6/8)

### Recomparaison précise au cahier des charges — deux sonneries distinctes et rappel

Les appels (audio et vidéo) étaient déjà construits avant cette
spécification (signalisation WebRTC via le namespace `/calls`, jamais de
média relayé par le serveur ; état RINGING/ACTIVE/DECLINED/MISSED/ENDED
en base ; caméra activable à tout moment pendant l'appel ; mute/caméra/
raccrocher). La recomparaison précise avec le cahier des charges a
trouvé deux écarts réels, corrigés ici :

- **Aucune sonnerie n'était jouée** (ni côté appelant qui attend, ni côté
  appelé qui sonne) — vérifié en lisant le code (`use-call.ts`,
  `CallOverlay.tsx`) : aucun `Audio`/`AudioContext` nulle part. Corrigé
  par `useRingTone` (nouveau, `lib/use-ring-tone.ts`) : deux motifs
  distincts, "ringback" (cadence lente, deux tonalités graves, pendant
  la phase `outgoing`) et "ringtone" (motif plus rapproché et plus aigu,
  pendant la phase `incoming`) — jamais les deux en même temps (une
  seule phase active à la fois). **Sons entièrement synthétisés par
  oscillateurs Web Audio, aucun fichier audio existant** : reproduit le
  comportement (deux sonneries distinctes) sans jamais copier une
  ressource protégée, conformément à la contrainte explicite du cahier
  des charges. Le contexte audio est débloqué dès la première
  interaction sur `/chat` (`unlockAudioOnFirstInteraction`), pour ne pas
  dépendre d'un geste utilisateur précis au moment où un appel arrive
  (un appel entrant n'est précédé d'aucun clic de notre part).
- **Aucun bouton "rappeler" sur un appel manqué** — ajouté dans
  `MessageBubble` : une bulle CALL avec `status === "MISSED"` affiche un
  petit bouton qui relance directement un appel du même type (audio/
  vidéo) vers le même correspondant, câblé jusqu'à `ChatWindow.onStartCall`
  (déjà existant).

Vérifié en direct par navigateur piloté par script, combiné à un vrai
client socket Node (rôle "appelant", sans navigateur) pour isoler
précisément ce qui se passe côté appelé : instrumentation de
`AudioContext.prototype.createOscillator` pour compter les oscillateurs
RÉELLEMENT créés (pas une supposition sur le code) — 8 oscillateurs
créés pendant ~2,5s de sonnerie entrante (2 cycles de motif "ringtone"),
confirmant que la sonnerie joue réellement ; annulation par l'appelant
avant décroché → "Appel manqué" affiché puis fil de conversation ;
bouton "Rappeler" trouvé sur la bulle et cliqué → nouvel appel sortant
démarré, 2 nouveaux oscillateurs créés en ~2,5s (1 cycle de motif
"ringback", cadence plus lente — cohérent avec le motif implémenté).
Aucune régression : 242 tests unitaires backend toujours verts (item
purement frontend, aucun changement backend nécessaire).

### Vérifications effectuées

Frontend : `tsc --noEmit`, `next build`, `eslint` (0 erreur), vérification
en direct combinant navigateur piloté par script + client socket Node
dédié, avec comptage réel des oscillateurs Web Audio créés — jamais une
simple supposition que le code "devrait" jouer un son.

## Spécification NEXORA : synchronisation multi-appareils (7/8)

### Interruption d'appel et propagation de la lecture entre les appareils d'un même compte

Deux écarts réels trouvés en relisant précisément le code à la lumière
de la section 21-22 du cahier des charges (jamais construits jusqu'ici) :

- **Appel accepté/refusé sur un appareil, les autres continuent de
  sonner indéfiniment.** Un appel entrant sonne déjà sur tous les
  appareils connectés de l'appelé (`CallsGateway.handleInvite` diffuse à
  toute sa room `user:<id>`), mais accepter/refuser depuis l'un d'eux ne
  prévenait jusqu'ici QUE l'appelant — jamais les autres appareils de
  l'appelé lui-même. Corrigé : `handleAccept`/`handleReject` émettent
  désormais aussi `call:resolved-elsewhere` vers les autres appareils de
  l'appelé (`client.to(...)`, qui exclut nativement l'émetteur — jamais
  besoin d'un `except()` explicite). Côté frontend, `use-call.ts` écoute
  cet événement et referme l'appel entrant avec un message distinct
  ("Répondu sur un autre appareil." / "Refusé sur un autre appareil.")
  plutôt que "Appel refusé"/"Appel manqué", qui laisseraient croire à
  une vraie erreur.
- **Lire une conversation sur un appareil ne remettait jamais à zéro le
  badge non-lu sur les AUTRES appareils du même compte.**
  `MessagesService.markConversationRead` ne diffusait `message:read`
  qu'aux AUTRES participants (pour leurs accusés ✓✓), jamais au lecteur
  lui-même. Corrigé : le lecteur est désormais inclus dans la diffusion ;
  le frontend distingue déjà ce cas (`readerId === user.id`, présent
  depuis l'origine pour ne jamais réappliquer les coches sur ses propres
  messages) — étendu pour remettre à zéro `unreadCount` dans ce cas au
  lieu de ne rien faire.

Vérifié : 2 nouveaux tests e2e pour l'interruption d'appel multi-appareil
(deux vraies connexions socket pour le même compte B — acceptation
depuis l'un interrompt bien l'autre, jamais l'inverse ; même chose pour
un refus), 1 nouveau test e2e pour la propagation de lecture (deux vraies
connexions socket pour le même compte A — `message:read` bien reçu par
l'appareil qui n'a rien fait, avec le bon `readerId`). Puis en direct par
navigateur, deux vrais onglets pour le même compte Bob : l'appel entrant
sonne bien sur les deux, l'acceptation depuis l'onglet 1 fait apparaître
"Répondu sur un autre appareil." sur l'onglet 2 dans la foulée — capture
d'écran à l'appui. La propagation de lecture multi-appareils, elle, n'a
pu être confirmée en direct que côté serveur (tests e2e par sockets bruts,
concluants) : les tentatives de vérification par navigateur pour cette
partie précise se sont heurtées à une instabilité de l'environnement de
test (deux onglets Chrome simultanés, déjà rencontrée ailleurs dans cette
session) sans qu'aucun résultat contradictoire n'apparaisse — la relecture
du code côté frontend (`onMessageRead`, un seul changement, calqué sur un
schéma déjà éprouvé ailleurs dans le même fichier) reste jugée fiable,
mais il s'agit d'une confiance moindre que la vérification en direct
habituelle de cette session, à garder à l'esprit. 242 tests unitaires
(inchangé, aucune logique de service modifiée) et 57 tests e2e au total,
tous verts.

### Vérifications effectuées

Backend : `tsc`, `eslint` (0 erreur), 242 tests unitaires, 57 tests e2e.
Frontend : `tsc --noEmit`, `next build`, `eslint` (0 erreur) ; vérification
en direct par deux vrais onglets de navigateur pour l'interruption
d'appel multi-appareil, revue de code seule (pas de vérification live
concluante) pour la propagation de lecture multi-appareil.

## Spécification NEXORA : tests et sécurité (8/8)

### Deux réglages de confidentialité enfin réellement appliqués

Passe de revue dédiée sur l'ensemble de la spécification (section 28 :
jamais lire une conversation dont on n'est pas membre, jamais télécharger
un média privé sans autorisation, jamais accéder à un appel qui ne nous
appartient pas, jamais usurper un autre utilisateur ou son QR). La
plupart de ces règles étaient déjà couvertes au fil de l'eau par chaque
item précédent (accès aux conversations/messages/vocaux/pièces jointes :
`access-isolation.e2e-spec.ts` ; appels : vérifications d'appartenance
dans `CallsService` + test e2e dédié ; QR : n'authentifie jamais personne
par construction, voir item 3). La revue a trouvé un vrai écart resté de
la Phase 14 : `Profile.whoCanMessageMe` et `Profile.whoCanSeeMyStatus`
existaient dans le schéma, l'API et même l'écran Confidentialité du
frontend depuis le début, mais n'étaient **jamais réellement appliqués**
nulle part côté serveur — les modifier n'avait aucun effet concret,
un faux sentiment de contrôle pour l'utilisateur.

- **`whoCanSeeMyStatus`** : `StatusesService` définissait déjà "contact"
  comme repli honnête ("quelqu'un avec qui je partage une conversation
  active"), documenté comme provisoire en attendant un vrai carnet de
  contacts (Phase 14). Ce carnet existe maintenant (item 2) :
  `getContactIds()` délègue désormais à
  `ContactsService.listContactIds()` (nouvelle méthode, réutilisée aussi
  par `areContacts()` ci-dessous) — un statut `CONTACTS` n'est visible
  qu'aux contacts réellement acceptés, plus à quiconque a simplement déjà
  échangé un message.
- **`whoCanMessageMe`** (EVERYONE/CONTACTS/NOBODY) : jamais consulté nulle
  part jusqu'ici. `ConversationsService.createDirect` l'applique
  désormais — mais seulement avant de créer une TOUTE NOUVELLE
  conversation, jamais pour une conversation déjà établie (un changement
  de réglage ultérieur ne rend jamais une conversation existante
  inutilisable).
- Aucun nouveau cycle de modules : `ContactsModule` importé par
  `StatusesModule` et `ConversationsModule` (aucun des deux n'est
  lui-même importé par `ContactsModule`, le graphe reste un DAG).

Vérifié : 4 nouveaux tests unitaires (`ConversationsService` —
NOBODY/CONTACTS refusés puis autorisés selon la vraie relation, jamais
reconsultés pour une conversation existante), 2 tests unitaires
`StatusesService` adaptés pour consulter `ContactsService` plutôt que la
table de conversations directement, et un nouveau fichier e2e
`privacy-enforcement.e2e-spec.ts` (5 tests, vraies requêtes REST) :
`whoCanMessageMe=NOBODY` bloque un inconnu, `CONTACTS` refuse un
non-contact puis autorise après acceptation réciproque d'une demande de
contact, une conversation déjà créée reste utilisable même si le réglage
change ensuite ; un statut `CONTACTS` est invisible à un non-contact et
visible à un contact accepté — cette dernière assertion a d'abord été
écrite avec le mauvais nom de champ (`s.userId` au lieu de
`s.author.id`), un bug corrigé une fois repéré par un premier échec réel
du test plutôt qu'un faux vert. 246 tests unitaires et 62 tests e2e au
total, tous verts — dernier item de la spécification NEXORA.

### Vérifications effectuées

Backend : `tsc`, `eslint` (0 erreur), 246 tests unitaires, 62 tests e2e.
Aucun changement frontend nécessaire (l'écran Confidentialité envoyait
déjà ces réglages, ils n'étaient simplement jamais lus côté serveur).

## Après la spécification NEXORA : corrections et finitions

Passe de stabilisation demandée après un usage réel de l'application (pas
un nouvel item de la spécification), déclenchée par plusieurs bugs et
manques constatés en conditions réelles.

- **Limite de débit trop basse** : la limite globale par défaut
  (60 requêtes/min, voir `app.module.ts`) provoquait de vraies erreurs
  429 sur des pages qui déclenchent légitimement plusieurs requêtes en
  parallèle (galerie de médias, avatars, hydratation des appels/vocaux/
  partages de contact). Corrigé par un `@Throttle` par route (300/min,
  120/min pour la recherche) sur les 9 endpoints concernés, jamais un
  relèvement de la limite globale elle-même.
- **"Médias partagés" affichait du contenu factice** : le panneau Infos
  montrait 4 vignettes à dégradé fixe, un reliquat de maquette jamais
  fini plutôt qu'un vrai bug d'affichage. Remplacé par une vraie galerie
  paginée par curseur (`MessagesService.listMedia`, 8 éléments par page,
  bouton "Charger plus") — un premier passage sans pagination avait été
  jugé inadapté ("si on a 1000 images ça sera n'importe quoi") et corrigé
  avant validation.
- **Thème clair** : l'application n'existait qu'en thème sombre. Ajout
  d'un thème clair complet et d'un mode "Système", bascule immédiate
  depuis Paramètres → Apparence, persistant (localStorage) et sans
  flash au chargement (script inline dans `<head>`, même technique que
  `next-themes`).
- **Appel vidéo : pas d'aperçu de soi-même** : un vrai bug de course
  entre React et les refs — le `<video>` d'aperçu local n'existait pas
  encore dans le DOM au moment où le flux caméra lui était assigné
  directement (rendu conditionnel selon une phase qui changeait dans le
  même appel). Corrigé en faisant transiter le flux local par un vrai
  état React plutôt qu'une ref seule, rattaché via un effet dédié.
- **Recherche dans une conversation** : bouton présent depuis le début
  mais désactivé ("bientôt disponible"). Rendu réellement fonctionnel :
  `MessagesService.search` (texte, insensible à la casse, jamais un
  message supprimé) et `MessagesService.listAroundMessage` (contexte
  chronologique autour d'un résultat) côté backend ; panneau déroulant
  `MessageSearchPanel` (recherche différée de 300ms) et saut avec
  surlignage temporaire côté frontend (`ChatWindow`/`chat/page.tsx`) —
  le saut recharge le fil autour du message ciblé et recalcule le
  curseur "plus ancien" pour que la pagination reste correcte depuis ce
  nouvel ancrage.

Vérifié : pour la limite de débit, script de reproduction Puppeteer
confirmant zéro échec après coup. Pour la galerie, tests unitaires
(refus non-membre, URL authentifiée, jamais une pièce jointe supprimée)
et un test e2e d'isolation, plus vérification visuelle en direct. Pour
le thème, bascule en direct sur les écrans discussion/paramètres/statuts,
persistance après rechargement complet, aucun avertissement d'hydratation
sur un chargement propre. Pour l'appel vidéo, inspection directe du DOM
(`hasSrcObject`, `videoWidth`, `readyState`) sur deux vrais onglets avant/
après correction — pas seulement une relecture du code. Pour la
recherche : 6 nouveaux tests unitaires et 4 nouveaux tests e2e (recherche
insensible à la casse, requête vide sans erreur, contexte incluant bien
le message ciblé, isolation pour un non-membre), puis vérification de
bout en bout en direct par navigateur — recherche d'un message ancien
(hors de la page initiale de 30 messages), clic sur le résultat exact,
confirmation du saut, du surlignage, de la fermeture du panneau, et que
"Charger les messages précédents" reste cohérent depuis le nouvel
ancrage. 257 tests unitaires et 68 tests e2e au total, tous verts.

### Vérifications effectuées

Backend : `tsc`, `eslint` (0 erreur), 257 tests unitaires, 68 tests e2e.
Frontend : `tsc --noEmit`, `next build`, `eslint` (0 erreur) ; vérification
en direct par navigateur (Puppeteer) pour la limite de débit, la galerie
de médias, le thème, l'appel vidéo et la recherche dans une conversation.

## Prochaine étape

Les 8 items de la spécification NEXORA sont posés et vérifiés, ainsi
qu'une passe de stabilisation post-spécification (ci-dessus). Hors
périmètre, resté noté au fil de l'eau : mise à niveau ElevenLabs pour
activer réellement la synthèse vocale traduite ; nouvelle tentative de
vérification live par navigateur pour la propagation de lecture
multi-appareils (item 7) si l'environnement de test se stabilise (la
logique serveur, elle, est prouvée par de vrais tests e2e par sockets) ;
périmètre de "Discussions vocales" (rooms vocales) jamais défini, resté
hors de "l'essentiel" pour cette passe.
