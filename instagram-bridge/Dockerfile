FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
RUN mkdir -p sessions
ENV NODE_ENV=production
EXPOSE 8091
CMD ["node", "server.js"]
