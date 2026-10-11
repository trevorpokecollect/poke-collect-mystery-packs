FROM node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

COPY package.json package-lock.json* ./

# Dev dependencies are needed for the build, then pruned.
RUN npm ci && npm cache clean --force

COPY . .

RUN npx prisma generate && npm run build && npm prune --omit=dev

ENV NODE_ENV=production

# Applies pending migrations, then starts the server.
CMD ["npm", "run", "docker-start"]
