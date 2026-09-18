# Déploiement de Glotta

Trois applications à déployer séparément :

| App        | Cible recommandée      | Port en dev |
| ---------- | ----------------------- | ----------- |
| `backend/` | Render (Node, sans Docker) | 4000        |
| `frontend/`| Vercel                   | 3000        |
| `admin/`   | Vercel (projet séparé)  | 3001        |

Postgres et Redis : services managés de la même plateforme que le backend
(Railway/Render proposent les deux), plutôt que `docker-compose.yml`
(dev local uniquement).

## 1. Base de données et Redis managés

Créez une base Postgres et une instance Redis sur Railway ou Render. Notez
les deux URLs de connexion fournies — utilisez-les **telles quelles**,
paramètres `?sslmode=...` inclus.

> **Certificat auto-signé (fréquent sur Render Postgres)** : si
> `prisma migrate deploy` échoue avec une erreur de certificat SSL,
> ajoutez `?sslmode=no-verify` à `DATABASE_URL` plutôt que de modifier le
> code (`pg`, utilisé par l'adaptateur Prisma, gère nativement cette
> valeur).

## 2. Backend (Render, sans Docker)

Un `Dockerfile` existe à la racine de `backend/` (vérifié, voir plus bas)
mais **le choix retenu est un déploiement buildpack Render, sans Docker** —
sur Render, créez un **Web Service** avec Runtime **Node**, Root Directory
`backend`, et :

| Champ Render | Valeur |
| --- | --- |
| Build Command | `npm ci && npx prisma generate && npm run build` |
| Start Command | `npx prisma migrate deploy && npm run start:prod` |

- `npm ci` déclenche normalement aussi `prisma generate` via le hook
  `postinstall` du `package.json` (utile en local/CI), mais **ne comptez
  jamais dessus seul** : certaines plateformes (Render notamment, constaté
  en déploiement réel) n'exécutent pas ce hook de façon fiable — d'où le
  `npx prisma generate` explicite dans la Build Command ci-dessus, qui ne
  dépend d'aucun comportement implicite.
- `prisma` et `dotenv` sont dans `dependencies` (pas `devDependencies`) :
  Render peut élaguer les devDependencies avant le runtime, ce qui
  casserait sinon `migrate deploy` et le chargement de `prisma.config.ts`
  au démarrage.
- `prisma migrate deploy` est idempotent, donc sûr à rejouer à chaque
  démarrage plutôt qu'une seule fois manuellement.
- `$PORT` est fourni automatiquement par Render — **ne définissez pas de
  variable `PORT` vous-même**, `main.ts` lit déjà `process.env.PORT`.
- Expose `GET /api/health` (aucune dépendance base/Redis — un check de vie
  fiable même si la base est temporairement indisponible).

Vérifié ici par une simulation d'installation complète (`rm -rf
node_modules dist && npm ci && npm run build` puis `prisma migrate deploy`
+ `start:prod` contre une vraie base) — pas seulement en relisant la
configuration.

<details>
<summary>Alternative Docker (si vous préférez malgré tout)</summary>

Le `Dockerfile` à la racine de `backend/` reste à jour et vérifié (build +
démarrage réel testés) : `docker-entrypoint.sh` applique les migrations au
démarrage puis lance le serveur, `node_modules` n'est volontairement pas
élagué des devDependencies entre les étages. Sur Render/Railway, il suffit
de choisir Runtime **Docker** au lieu de Node — les variables
d'environnement ci-dessous restent identiques dans les deux cas.
</details>

### ⚠️ Stockage des fichiers : disque éphémère si Cloudinary n'est pas configuré

`STORAGE_DRIVER=local` écrit sur le disque du conteneur. **Le système de
fichiers d'un service Railway/Render standard est éphémère** : tout est
perdu à chaque redéploiement ou redémarrage, sans avertissement.

Depuis l'intégration Cloudinary (voir `CloudinaryProvider`), **tous les
médias sont concernés** : images, vidéos, avatars, photos de groupe, messages
vocaux et audio traduit (TTS) basculent automatiquement sur Cloudinary dès
que les 3 variables `CLOUDINARY_*` de `backend/.env.example` sont
renseignées — sans volume persistant à prévoir pour aucun d'entre eux.

Sans ces variables (mode dégradé, comme les fournisseurs IA), tout continue
sur le disque local exactement comme avant. Deux options, à choisir avant le
premier déploiement réel si vous ne configurez pas Cloudinary :
1. **Volume/disque persistant** (le plus rapide à mettre en place, zéro
   changement de code) : Railway propose des *Volumes*, Render des
   *Persistent Disks* — montez-le au chemin de `STORAGE_LOCAL_PATH`
   (`./uploads` par défaut, donc `/app/uploads` dans le conteneur).
2. **Stockage S3-compatible** (plus robuste à long terme, ex. Cloudflare
   R2, Backblaze B2) : nécessite d'implémenter un nouveau driver dans
   `StorageService` (`STORAGE_DRIVER=local` est aujourd'hui la seule
   valeur acceptée, voir `storage.service.ts`) — hors du périmètre de
   cette passe, à traiter comme une tâche à part si vous partez sur cette
   option.

### Variables d'environnement à configurer

Reprenez `backend/.env.example` et changez impérativement :

| Variable | Valeur en production |
| --- | --- |
| `NODE_ENV` | `production` — **vérifiez explicitement** que la plateforme la définit (Render le fait par défaut pour un Web Service Node, mais ne vous y fiez pas sans vérifier) : sans elle, Swagger reste exposé publiquement et le serveur ne refuse plus de démarrer avec l'OTP d'inscription désactivé (voir `src/config/startup-validation.ts` et `main.ts`) |
| `DATABASE_URL` | Fournie par le Postgres managé |
| `REDIS_URL` | Fournie par le Redis managé |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Deux secrets forts générés (`openssl rand -hex 32`, au moins 32 caractères) — **jamais** les valeurs `change-me-*`/celles de l'exemple : le serveur refuse maintenant de démarrer si l'un des trois secrets JWT ci-dessous est absent, trop court, une valeur d'exemple connue, ou identique à un autre (voir `src/config/startup-validation.ts`) |
| `CALL_ACTION_JWT_SECRET` | Un troisième secret fort (`openssl rand -hex 32`), **distinct** des deux ci-dessus — jeton du bouton "Refuser" d'une notification push d'appel entrant (voir `CallsService.quickReject`) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Générées une fois avec `npx web-push generate-vapid-keys` (`VAPID_SUBJECT` = `mailto:<votre email>`) — **sans ces 3 variables, aucune notification push (message, appel manqué, appel entrant...) n'est envoyée**, même si tout le reste fonctionne : `PushProvider` retombe silencieusement sur "rien n'est envoyé" plutôt que d'échouer, donc l'oubli ne se voit dans aucun log d'erreur |
| `CORS_ORIGIN` | Domaines Vercel de `frontend/` **et** `admin/`, séparés par une virgule (ex. `https://glotta.vercel.app,https://admin-glotta.vercel.app`) — sert aussi au nouveau namespace WebSocket `/device-link` (liaison Web par QR), rien de plus à configurer pour lui |
| `SMS_PROVIDER` | `"zavu"` **avant tout lancement réel** — voir ⚠️ ci-dessous, `"none"` ne fait que journaliser le code OTP côté serveur |
| `ZAVUDEV_API_KEY` | Clé API du Dashboard Zavu (dashboard.zavu.dev) — requise si `SMS_PROVIDER="zavu"` |
| `ZAVU_SENDER` | Sender Zavu optionnel — doit être un numéro de téléphone associé au SMS, pas un identifiant de sender sans numéro |
| `STORAGE_LOCAL_PATH` | Chemin du volume persistant monté (messages vocaux uniquement, voir ci-dessus) |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Identifiants du Dashboard Cloudinary — active le stockage de tous les médias (images, vidéos, avatars, photos de groupe, messages vocaux, audio traduit) |
| `ADMIN_BOOTSTRAP_EMAIL` | Email d'un compte déjà inscrit, pour la toute première promotion admin — voir §4, à retirer une fois utilisé |

Les fournisseurs IA (`STT_PROVIDER`, `TRANSLATION_PROVIDER`,
`TTS_PROVIDER` + leurs clés) restent optionnels (`"none"` par défaut) —
activez-les seulement une fois prêt, aucun changement de code nécessaire.

### ⚠️ Inscription/connexion par téléphone : sans Zavu, aucun SMS réel n'est envoyé

Depuis l'authentification par téléphone + OTP (`AuthService.requestOtp` et
consorts), **tant que `SMS_PROVIDER="none"`** (valeur par défaut), le code à
6 chiffres est uniquement écrit dans les logs serveur (`SmsService`,
comportement volontaire pour le développement — voir le commentaire dans le
fichier) — **jamais envoyé par SMS**. En production, ça revient à rendre
l'inscription/la connexion mobile inutilisables pour un vrai utilisateur (il
n'a aucun moyen de lire les logs Render).

Avec `NODE_ENV=production`, le serveur refuse maintenant de démarrer tant
que `REGISTRATION_OTP_ENABLED` ne vaut pas `"true"` **et** que
`SMS_PROVIDER` ne pointe pas vers un vrai fournisseur configuré (voir
`src/config/startup-validation.ts`) — impossible d'oublier cette étape et
de déployer en laissant un numéro de téléphone se faire marquer "vérifié"
sans jamais avoir prouvé la possession du téléphone. Avant tout lancement
réel :
1. Créez un compte sur https://zavu.dev et ouvrez le dashboard Zavu.
2. Générez une clé API depuis le dashboard (dashboard.zavu.dev).
3. Renseignez `ZAVUDEV_API_KEY` et `SMS_PROVIDER="zavu"`. Ne renseignez
   `ZAVU_SENDER` que si un numéro de téléphone SMS est bien associé à ce sender;
   sinon laissez-le vide pour utiliser le sender SMS par défaut du projet.
4. Testez un vrai envoi (`POST /auth/otp/request` avec un numéro réel) avant
   d'annoncer la fonctionnalité aux utilisateurs.

Le mot de passe classique (`/auth/login`, `/auth/register`) reste
fonctionnel en parallèle (conservé pour l'accès admin/outillage) — seul le
nouveau parcours téléphone dépend de Zavu.

### Health check

Configurez le health check de la plateforme sur `GET /api/health`.

## 3. Frontend (Vercel)

Projet Vercel standard pointant sur `frontend/` (Root Directory). Deux
variables à définir dans les réglages du projet Vercel (Settings →
Environment Variables) :

```
NEXT_PUBLIC_API_URL=https://<votre-backend>.onrender.com/api
NEXT_PUBLIC_WS_URL=https://<votre-backend>.onrender.com
```

**Les deux sont requises** — `NEXT_PUBLIC_WS_URL` n'a pas besoin d'un hôte
*différent* de `NEXT_PUBLIC_API_URL` (Socket.IO et les appels WebRTC se
connectent à la même origine que l'API, seulement sans son suffixe `/api`),
mais si elle est absente, le code retombe sur `http://localhost:4000` même
en production (voir `lib/socket.ts`/`lib/use-call.ts`) — messagerie
temps réel et appels resteraient silencieusement cassés.

Optionnelle, propre à l'écran "disponible uniquement sur ordinateur" (§5) :

```
NEXT_PUBLIC_ANDROID_APK_URL=https://github.com/<vous>/chat/releases/download/<tag>/app-arm64-v8a-release.apk
```

Absente, le bouton "Télécharger l'app Android" reste simplement caché
(jamais de lien mort) — voir §5 pour comment obtenir cette URL.

> **Déploiements de preview** : chaque PR Vercel obtient une URL aléatoire,
> qui ne sera jamais dans `CORS_ORIGIN` — les previews ne pourront donc pas
> appeler le backend de production tant que vous n'ajoutez pas leur domaine
> explicitement (ou un backend de staging séparé). Limitation connue, pas
> un bug.

## 4. Admin (Vercel, second projet séparé)

Même procédure que le frontend, sur un **second projet Vercel** distinct
pointant sur `admin/` (Root Directory) — une seule variable ici, `admin/`
n'utilise pas Socket.IO/WebRTC :

```
NEXT_PUBLIC_API_URL=https://<votre-backend>.onrender.com/api
```

**Avant le premier déploiement**, ajoutez l'URL Vercel de ce projet admin à
`CORS_ORIGIN` côté backend (voir §2).

**Premier compte admin** : aucun endpoint ne permet de s'auto-promouvoir
(volontaire, voir `AdminGuard`). Une fois un compte inscrit normalement
depuis `frontend/` :
1. Définissez `ADMIN_BOOTSTRAP_EMAIL=<email de ce compte>` dans les
   variables d'environnement du backend.
2. Lancez `npx prisma db seed` une fois (manuellement, ou via une console
   Railway/Render) — promeut ce compte en `ADMIN`.
3. Retirez `ADMIN_BOOTSTRAP_EMAIL` de l'environnement (variable à usage
   unique, jamais un réglage permanent).

Les admins suivants sont promus depuis `admin/` → Utilisateurs (aucun
compte ne peut se promouvoir lui-même, y compris un autre admin qui
tenterait de le faire depuis cette page — `PATCH /admin/users/:id` ne
modifie que `isActive`, jamais `role`, par design).

## Checklist avant mise en production

- [ ] `NODE_ENV=production` défini et vérifié (active Swagger désactivé, secrets/OTP validés au démarrage — voir tableau des variables ci-dessus)
- [ ] `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`/`CALL_ACTION_JWT_SECRET` régénérés (jamais les valeurs d'exemple, jamais la même valeur pour les trois, au moins 32 caractères — le serveur refuse sinon de démarrer)
- [ ] `REGISTRATION_OTP_ENABLED="true"` et `SMS_PROVIDER="zavu"` + `ZAVUDEV_API_KEY` renseignés (le serveur refuse sinon de démarrer en production, voir ⚠️ ci-dessus)
- [ ] `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` renseignés (sans quoi aucune notification push n'est envoyée, y compris les appels entrants hors de l'app)
- [ ] `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` renseignés (images/vidéos/avatars/vocaux)
- [ ] Volume persistant monté pour `STORAGE_LOCAL_PATH` (messages vocaux uniquement), ou driver S3 implémenté
- [ ] `CORS_ORIGIN` inclut les deux domaines Vercel (frontend + admin)
- [ ] `ADMIN_BOOTSTRAP_EMAIL` utilisé puis retiré
- [ ] Health check backend configuré sur `/api/health`
- [ ] `DISABLE_RATE_LIMITING` absent de l'environnement de production (réservé à `.env.test`)
- [ ] `SMS_PROVIDER="zavu"` + `ZAVUDEV_API_KEY` renseigné (sans quoi l'inscription/connexion par téléphone ne fonctionne pour aucun utilisateur réel — voir §2)
- [ ] Un vrai SMS de test reçu sur un téléphone avant d'annoncer la fonctionnalité

## 5. Application mobile (Flutter)

Ne se déploie pas sur Render/Vercel — distribution séparée (APK signé pour
Android, TestFlight/App Store pour iOS — l'app iOS ne peut pas être compilée
depuis un environnement Linux, macOS + Xcode requis), hors périmètre
Render/Vercel de ce document. Point d'attention pour le build : les URLs
backend sont injectées au build (`--dart-define=API_BASE_URL=...`, voir
`core/config.dart`), jamais lues depuis l'environnement à l'exécution — un
APK de production doit être recompilé avec l'URL Render réelle.

### Signature (une seule fois)

Un keystore de production existe déjà (`mobile/android/glotta-release.jks`
+ `mobile/android/key.properties`, générés localement) — **ni l'un ni
l'autre n'est commité** (voir `mobile/android/.gitignore` :
`key.properties`, `**/*.jks`), volontairement : c'est la seule clé qui
signe l'app, une fuite permettrait à quiconque de publier une mise à jour
qui se ferait passer pour la vôtre. **Sauvegardez ces deux fichiers
ailleurs qu'ici** (perdre le keystore signifie ne plus jamais pouvoir
publier de mise à jour sous la même identité d'app). Tant qu'ils sont
présents, `android/app/build.gradle.kts` signe automatiquement tout
`flutter build apk --release` avec — absents (ex. sur un autre poste/CI),
le build retombe silencieusement sur la signature de debug.

### Build + distribution directe (sans store)

```bash
flutter build apk --release --split-per-abi \
  --dart-define=API_BASE_URL=https://<votre-backend>.onrender.com/api \
  --dart-define=WS_BASE_URL=https://<votre-backend>.onrender.com
```

`--split-per-abi` produit 3 APK bien plus légers qu'un seul APK universel
(~110 Mo) : `app-arm64-v8a-release.apk` (~40 Mo, couvre la quasi-totalité
des téléphones Android récents — c'est celui à partager en priorité),
`app-armeabi-v7a-release.apk` (32 bits, anciens appareils),
`app-x86_64-release.apk` (émulateurs/quelques tablettes).

**Hébergement** : ces fichiers sont trop volumineux pour être commités
dans le dépôt (au-delà de la limite de 100 Mo de GitHub pour l'universel,
et une mauvaise pratique même sous cette limite pour les autres — ça
gonfle l'historique git pour toujours) et le plan Cloudinary gratuit de ce
projet plafonne les fichiers "raw" à 10 Mo (vérifié : un envoi de 20 Mo est
rejeté). La solution recommandée est une **Release GitHub** (gratuite,
jusqu'à 2 Go par fichier, ne touche jamais à l'historique git) :

1. Sur GitHub → `Releases` → `Draft a new release`.
2. Créez un tag (ex. `mobile-v1.0.0`), glissez `app-arm64-v8a-release.apk`
   (et les deux autres si vous voulez couvrir tous les appareils) dans les
   assets, publiez.
3. Copiez l'URL de téléchargement directe de l'asset (clic droit dessus →
   copier le lien, ou l'URL affichée sur la page de la release).
4. Renseignez-la dans `NEXT_PUBLIC_ANDROID_APK_URL` (§3) — le bouton
   "Télécharger l'app Android" de `/login` (visité depuis un téléphone
   Android) s'active automatiquement.

Alternative : n'importe quel autre hébergeur de fichiers statiques (S3,
Cloudflare R2, Backblaze B2...) fonctionne aussi tant que l'URL finale sert
directement le fichier `.apk` (pas une page HTML intermédiaire).
