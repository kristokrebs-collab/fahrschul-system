# Fahrschule Krebs Social Autopilot
#
# Zwei Stufen: bauen mit vollen Abhaengigkeiten, ausliefern nur mit
# Produktionsabhaengigkeiten. Laeuft als unprivilegierter Nutzer.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


FROM node:22-bookworm-slim AS runtime

# Fuer Health-Checks und TLS-Wurzelzertifikate
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY web ./web
COPY data/seed ./data/seed

# Datenverzeichnis gehoert dem Laufzeitnutzer; als Volume einhaengen.
RUN mkdir -p /app/data/backups /app/data/sandbox-posts \
 && chown -R node:node /app/data

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

CMD ["node", "--experimental-sqlite", "dist/server.js"]
