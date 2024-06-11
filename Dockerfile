FROM node:lts AS base
WORKDIR /app

COPY package.json package-lock.json

RUN npm install

ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321
CMD ["npm","run","dev","--","--host"]
