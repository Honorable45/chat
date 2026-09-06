# Déploiement de Glotta

Trois applications à déployer séparément :

| App        | Cible recommandée      | Port en dev |
| ---------- | ----------------------- | ----------- |
| `backend/` | Railway ou Render (Docker) | 4000        |
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

## 2. Backend (Railway / Render, déploiement Docker)

Le `Dockerfile` à la racine de `backend/` est prêt à l'emploi et vérifié
(build + démarrage réel testés) :
- Applique automatiquement les migrations en attente à chaque démarrage du
  conteneur (`docker-entrypoint.sh` → `prisma migrate deploy`, idempotent).
- Lit `$PORT` fourni par la plateforme (`main.ts` le fait déjà).
- Expose `GET /api/health` (aucune dépendance base/Redis — un check de vie
  fiable même si la base est temporairement indisponible).

### ⚠️ Stockage des fichiers : action requise pour les messages vocaux

`STORAGE_DRIVER=local` écrit sur le disque du conteneur. **Le système de
fichiers d'un service Railway/Render standard est éphémère** : tout est
perdu à chaque redéploiement ou redémarrage, sans avertissement.

Depuis l'intégration Cloudinary (voir `CloudinaryProvider`), **cette alerte
ne concerne plus que les messages vocaux**, qui restent toujours sur le
disque local quel que soit l'état de Cloudinary — c'est le seul type de
média encore concerné. Renseignez les variables `CLOUDINARY_*` de
`backend/.env.example` et les images, vidéos et avatars basculent
automatiquement sur Cloudinary, sans volume persistant à prévoir pour eux.

Pour les messages vocaux, deux options, à choisir avant le premier
déploiement réel :
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
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Identifiants du Dashboard Cloudinary — active le stockage images/vidéos/avatars |
| `CLOUDINARY_AUTH_TOKEN_KEY` | Cloudinary → Settings → Security → "Token-based authentication" — requis pour les images/vidéos de messages/statuts (pas les avatars) |
| `ADMIN_BOOTSTRAP_EMAIL` | Email d'un compte déjà inscrit, pour la toute première promotion admin — voir §4, à retirer une fois utilisé |

Les fournisseurs IA (`STT_PROVIDER`, `TRANSLATION_PROVIDER`,
`TTS_PROVIDER` + leurs clés) restent optionnels (`"none"` par défaut) —
activez-les seulement une fois prêt, aucun changement de code nécessaire.

### Health check

Configurez le health check de la plateforme sur `GET /api/health`.

## 3. Frontend (Vercel)

Projet Vercel standard pointant sur `frontend/` (Root Directory). Variable
à définir dans les réglages du projet Vercel :

```
NEXT_PUBLIC_API_URL=https://<votre-backend>.up.railway.app/api
```

(ou l'équivalent Render). Aucun `NEXT_PUBLIC_WS_URL` distinct n'est
nécessaire : Socket.IO se connecte à la même origine que
`NEXT_PUBLIC_API_URL` sans son suffixe `/api`.

> **Déploiements de preview** : chaque PR Vercel obtient une URL aléatoire,
> qui ne sera jamais dans `CORS_ORIGIN` — les previews ne pourront donc pas
> appeler le backend de production tant que vous n'ajoutez pas leur domaine
> explicitement (ou un backend de staging séparé). Limitation connue, pas
> un bug.

## 4. Admin (Vercel, second projet séparé)

Même procédure que le frontend, sur un **second projet Vercel** distinct
pointant sur `admin/` (Root Directory) :

```
NEXT_PUBLIC_API_URL=https://<votre-backend>.up.railway.app/api
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
- [ ] `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`/`CLOUDINARY_AUTH_TOKEN_KEY` renseignés (images/vidéos/avatars)
- [ ] Volume persistant monté pour `STORAGE_LOCAL_PATH` (messages vocaux uniquement), ou driver S3 implémenté
- [ ] `CORS_ORIGIN` inclut les deux domaines Vercel (frontend + admin)
- [ ] `ADMIN_BOOTSTRAP_EMAIL` utilisé puis retiré
- [ ] Health check backend configuré sur `/api/health`
- [ ] `DISABLE_RATE_LIMITING` absent de l'environnement de production (réservé à `.env.test`)
