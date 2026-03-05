FROM node:20-alpine AS build
WORKDIR /app

ENV CI=true
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# ── test ───────────────────────────────────────────────────────────────────────
# Pure unit tests — no external services needed.
# Build this target explicitly to verify: docker build --target test .
FROM build AS test
RUN pnpm test:unit

# ── runner ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main/api.js"]