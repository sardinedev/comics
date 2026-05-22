FROM node:24.16-alpine@sha256:2bdb65ed1dab192432bc31c95f94155ca5ad7fc1392fb7eb7526ab682fa5bf14 AS base
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
