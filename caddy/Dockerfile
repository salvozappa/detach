# Production Caddy image with built webview
# Multi-stage build: compile TypeScript, then serve with Caddy

# Stage 1: Build webview
FROM node:20-alpine AS builder
WORKDIR /app
COPY webview/package*.json ./
RUN npm ci
COPY webview/ ./
RUN npm run build

# Stage 2: Serve with Caddy
FROM caddy:2-alpine

# Copy built webview files
COPY --from=builder /app/dist /srv/dist
COPY --from=builder /app/index.html /srv/index.html
COPY --from=builder /app/styles.css /srv/styles.css
COPY --from=builder /app/manifest.json /srv/manifest.json
COPY --from=builder /app/service-worker.js /srv/service-worker.js
COPY --from=builder /app/icons /srv/icons
