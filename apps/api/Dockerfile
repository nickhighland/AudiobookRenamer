FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/core/package.json ./packages/core/package.json

RUN npm install

COPY apps/api ./apps/api
COPY packages/core ./packages/core

RUN npm run build -w @aon/core && npm run build -w @aon/api

FROM node:22-alpine AS runner
WORKDIR /app
ARG APP_BUILD=0.1.0
ENV NODE_ENV=production
ENV APP_BUILD=${APP_BUILD}

COPY package.json ./package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/public ./apps/api/public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/package.json

EXPOSE 4033
WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]
