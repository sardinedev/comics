FROM node:24.21-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
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
