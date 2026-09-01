# Worker permanent de Jay Reach.
#
# Le mode éphémère (une fonction Vercel par tour) fait tourner le même code,
# mais se fait couper à soixante secondes : un enrichissement qui demande deux
# minutes est tué en pleine attente. La maintenance de pg-boss rattrape ces
# jobs au tour suivant depuis le 01/09/2026, donc plus rien n'est perdu — mais
# rien ne remplace un processus qui va au bout.
#
# Cette image ne suppose aucun hébergeur : elle tourne partout où l'on sait
# lancer un conteneur avec un accès à Postgres.
#
#   docker build -f apps/worker/Dockerfile -t jay-reach-worker .
#   docker run --env-file .env jay-reach-worker
#
# Variables attendues : DATABASE_URL, ENCRYPTION_KEY, APP_URL. Les clés des
# fournisseurs vivent en base, chiffrées, pas ici.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable

# Les manifestes d'abord : ils changent moins souvent que le code, donc cette
# couche se réutilise entre deux constructions.
# `tsconfig.base.json` est référencé par chaque paquet : sans lui, la
# compilation échoue sur un TS5083 qui ne dit pas d'où vient le manque.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/providers/package.json packages/providers/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @jay-reach/worker...

# Seuls les trois paquets dont le worker dépend. `ui` et `i18n` servent au
# front : les construire ici allongerait l'image et la ferait échouer sur des
# outils qu'elle n'a aucune raison d'embarquer.
COPY packages/core packages/core
COPY packages/db packages/db
COPY packages/providers packages/providers
COPY apps/worker apps/worker
RUN pnpm --filter @jay-reach/core --filter @jay-reach/db --filter @jay-reach/providers build \
 && pnpm --filter @jay-reach/worker build

FROM node:22-bookworm-slim AS run
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/core packages/core
COPY --from=build /app/packages/db packages/db
COPY --from=build /app/packages/providers packages/providers
COPY --from=build /app/apps/worker apps/worker
RUN pnpm install --frozen-lockfile --prod --filter @jay-reach/worker...

# Utilisateur non privilégié : le worker n'écrit rien sur le disque, il n'a
# aucune raison d'être root.
USER node

CMD ["node", "apps/worker/dist/index.js"]
