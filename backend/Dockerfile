# Image de production pour un déploiement PaaS (Railway, Render...) —
# construction en deux étapes : la première compile, la seconde ne garde
# que ce qu'il faut pour tourner. `node_modules` n'est PAS élagué
# (--omit=dev) entre les deux : `prisma` (migrate deploy, voir
# docker-entrypoint.sh) et `dotenv` (chargé par prisma.config.ts) sont des
# devDependencies mais restent nécessaires au démarrage du conteneur, pas
# seulement en développement — les élaguer casserait les migrations au
# premier déploiement.

FROM node:20-slim AS builder
WORKDIR /app

# python3/make/g++ : bcrypt (dépendance native) télécharge un binaire
# précompilé pour la plupart des plateformes, mais recompile depuis les
# sources si aucun ne correspond exactement à l'image — sans ce toolchain,
# `npm ci` échouerait silencieusement selon la plateforme cible.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
# `prisma generate` ne se connecte jamais à la base (seul `migrate deploy`,
# au démarrage du conteneur, en a besoin) mais prisma.config.ts résout
# DATABASE_URL au chargement même pour cette commande — une valeur factice
# suffit ici, jamais utilisée pour une vraie connexion. La vraie valeur de
# production est injectée par la plateforme au runtime (voir
# docker-entrypoint.sh), jamais au moment du build.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npx prisma generate
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# openssl : requis par les moteurs Prisma au runtime (migrate deploy).
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
# La CLI Prisma cherche prisma.config.ts à la racine du projet par défaut
# (jamais dans dist/, où tsc le compile aussi mais où la CLI ne va pas le
# chercher sans --config) — sans ce fichier, `migrate deploy` échoue au
# démarrage avec "datasource.url property is required" (DATABASE_URL
# pourtant bien présente en env, mais jamais lue faute de config trouvée).
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

# Railway/Render injectent leur propre $PORT au démarrage (voir main.ts,
# qui le lit déjà) — cette valeur ne sert que si la plateforme n'en fournit
# aucune (exécution locale de l'image).
ENV PORT=4000
EXPOSE 4000

ENTRYPOINT ["./docker-entrypoint.sh"]
