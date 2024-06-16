FROM node:20.11 AS base
WORKDIR /app

COPY package.json package-lock.json /app/

RUN npm install

ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321
CMD ["npm","run","dev","--","--host"]
