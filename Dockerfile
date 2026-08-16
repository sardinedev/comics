FROM node:24.19-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS base
WORKDIR /app

COPY . .

RUN npm install

RUN npm run build

# Remove dev dependencies after build
RUN npm prune --omit=dev

ENV HOST=0.0.0.0
ENV PORT=4321
ENV NODE_ENV=production
ENV COVERS_DIR=/app/data/covers
EXPOSE 4321

# Create covers directory for persistent storage
RUN mkdir -p /data/covers

COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
