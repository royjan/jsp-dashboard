FROM node:25.2.1-alpine AS base

RUN apk add --no-cache libc6-compat python3 make g++

# --- Build stage ---
FROM base AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
COPY data/ ./data/
RUN npm run build

# --- Production stage ---
FROM base AS runner
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs nextjs

# Copy standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/data ./data

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV HOSTNAME="0.0.0.0"
ENV PORT=3000
ENV NODE_ENV=production
ENV AWS_REGION=eu-central-1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
