FROM docker.m.daocloud.io/library/node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3088

EXPOSE 3088

CMD ["npm", "start"]
