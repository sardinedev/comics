FROM node:20.11-alpine AS base
WORKDIR /app

COPY . .

RUN npm install --omit=dev

RUN npm run build

ENV HOST=0.0.0.0
ENV PORT=4321
ENV NODE_ENV=production
EXPOSE 4321

ENTRYPOINT ["npm", "run", "start:prod"]
