FROM node:22.12-alpine AS base
WORKDIR /app

COPY . .

RUN npm install --omit=dev

RUN npm run build

ENV HOST=0.0.0.0
ENV PORT=4321
ENV NODE_ENV=production
ENV COVERS_DIR=/app/data/covers
EXPOSE 4321

# Create covers directory for persistent storage
RUN mkdir -p /data/covers

ENTRYPOINT ["npm", "run", "start:prod"]
