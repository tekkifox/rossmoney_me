# To use this Dockerfile, you have to set `output: 'standalone'` in your next.config.js file.
# From https://github.com/vercel/next.js/blob/canary/examples/with-docker/Dockerfile
#
# Build from the repository root, not from payload-cms: the lockfile and the
# pnpm workspace settings live there now.
#   docker build -f payload-cms/Dockerfile .

FROM node:26.13.0-alpine AS base

# Node 26 no longer bundles corepack, so install it from npm at a pinned version
# before it is used. The pnpm version itself comes from `packageManager` in
# package.json; corepack reads that, so it must not be pinned here.
RUN npm i -g corepack@0.36.0 && corepack enable pnpm

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install the workspace dependencies from the root manifests. pnpm-workspace.yaml
# carries the pnpm 12 supply-chain settings (minimumReleaseAge, allowBuilds);
# .npmrc carries the pre/post-script setting the build relies on. The filter
# installs payload-cms and its workspace dependencies only.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY payload-cms/package.json payload-cms/package.json
RUN corepack enable pnpm && pnpm install --frozen-lockfile --filter payload-cms...


# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
ARG SKIP_DB=false
# The virtual store stays in /app/node_modules; the package links live in
# payload-cms/node_modules.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/payload-cms/node_modules ./payload-cms/node_modules
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
# ENV NEXT_TELEMETRY_DISABLED 1
ENV NODE_OPTIONS=--no-deprecation

ENV SKIP_DB=$SKIP_DB

RUN corepack enable pnpm && pnpm --filter payload-cms run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Remove this line if you do not have this folder
COPY --from=builder /app/payload-cms/public ./payload-cms/public

# Set the correct permission for prerender cache
RUN mkdir -p payload-cms/.next
RUN chown nextjs:nodejs payload-cms/.next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
#
# Next.js traces from the workspace root, so the standalone tree mirrors the
# repository: node_modules at the root and the app under payload-cms/.
COPY --from=builder --chown=nextjs:nodejs /app/payload-cms/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/payload-cms/.next/static ./payload-cms/.next/static

WORKDIR /app/payload-cms

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD ["node", "server.js"]
