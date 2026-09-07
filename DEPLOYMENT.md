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
| `DATABASE_URL` | Fournie par le Postgres managé |
| `REDIS_URL` | Fournie par le Redis managé |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Deux secrets forts générés (`openssl rand -hex 32`) — **jamais** les valeurs `change-me-*` de l'exemple |
| `CORS_ORIGIN` | Domaines Vercel de `frontend/` **et** `admin/`, séparés par une virgule (ex. `https://glotta.vercel.app,https://admin-glotta.vercel.app`) |
| `STORAGE_LOCAL_PATH` | Chemin du volume persistant monté (messages vocaux uniquement, voir ci-dessus) |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Identifiants du Dashboard Cloudinary — active le stockage de tous les médias (images, vidéos, avatars, photos de groupe, messages vocaux, audio traduit) |
| `ADMIN_BOOTSTRAP_EMAIL` | Email d'un compte déjà inscrit, pour la toute première promotion admin — voir §4, à retirer une fois utilisé |

Les fournisseurs IA (`STT_PROVIDER`, `TRANSLATION_PROVIDER`,
`TTS_PROVIDER` + leurs clés) restent optionnels (`"none"` par défaut) —
activez-les seulement une fois prêt, aucun changement de code nécessaire.

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

- [ ] `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` régénérés (jamais les valeurs d'exemple)
- [ ] `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` renseignés (images/vidéos/avatars/vocaux)
- [ ] Volume persistant monté pour `STORAGE_LOCAL_PATH` (messages vocaux uniquement), ou driver S3 implémenté
- [ ] `CORS_ORIGIN` inclut les deux domaines Vercel (frontend + admin)
- [ ] `ADMIN_BOOTSTRAP_EMAIL` utilisé puis retiré
- [ ] Health check backend configuré sur `/api/health`
- [ ] `DISABLE_RATE_LIMITING` absent de l'environnement de production (réservé à `.env.test`)
