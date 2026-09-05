#!/bin/sh
# Applique les migrations en attente avant de démarrer le serveur —
# `migrate deploy` est idempotent (ne fait rien si la base est déjà à
# jour), donc sûr à rejouer à chaque démarrage du conteneur, y compris un
# simple redémarrage sans nouveau déploiement.
set -e

echo "Glotta : application des migrations Prisma..."
npx prisma migrate deploy

echo "Glotta : démarrage du serveur..."
exec node dist/src/main.js
