FROM node:24.16-alpine@sha256:21f403ab171f2dc89bad4dd69d7721bfd15f084ccb46cdd225f31f2bc59b5c9a AS base
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
