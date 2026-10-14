# The server is small: one route that calls an LLM. The image is mostly node_modules, so the
# install layer is kept separate from the source to stay cacheable across code changes.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
# The web workspace is not needed to run the API, and skipping it avoids downloading ffmpeg.wasm
# and the fonts into a server image.
RUN npm ci --omit-workspace-root --workspace @mini-cut/server --include-workspace-root

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
# Run as a non-root user: the container only needs to read its own source.
USER node
CMD ["npm", "start", "-w", "@mini-cut/server"]
