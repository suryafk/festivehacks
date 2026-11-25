# One image, two entrypoints: the API (also serves the web app) and the pool watcher.
FROM node:24-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY --from=web /web/dist /app/web/dist
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data/ WEB_DIST=/app/web/dist/
EXPOSE 8080
USER node
CMD ["node", "src/server.ts"]
