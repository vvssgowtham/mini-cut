# Builds the API. At the repository root on purpose: every path below is relative to the build
# context, and hosts default that context to the directory holding the Dockerfile. Kept in
# apps/server, the default build copied nothing and failed on the first COPY — and remembering to
# override the context per host is a step that only announces itself by breaking.
#
# The server is small: one route that calls an LLM. The image is mostly node_modules, so the
# install layer is kept separate from the source to stay cacheable across code changes.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# A plain install, including dev dependencies: the server runs its TypeScript through tsx, which is
# a dev dependency, so --omit=dev would produce an image that cannot start. The web workspace's
# packages come along too, which makes this larger than it needs to be — worth trading for an
# install that is known to resolve, and worth revisiting with a compile step.
RUN npm ci

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY apps/server ./apps/server
COPY packages/shared ./packages/shared

# Cloud Run supplies PORT; the server reads it and falls back to 3001 locally.
ENV PORT=8080
EXPOSE 8080
# Non-root: the container only needs to read its own source.
USER node
CMD ["npm", "start", "-w", "@mini-cut/server"]
