# Stage 1: Build Vue.js frontend
# Use latest Alpine (automatically gets most recent with security patches)
# If Alpine 3.22+ not available, falls back to 3.21 with explicit busybox upgrade
FROM node:26-alpine AS frontend-builder

# Update Alpine packages and explicitly upgrade busybox packages to fix CVE-2025-60876
# Forces upgrade to busybox 1.37.0-r21+ which patches the vulnerability
RUN apk update && \
    apk upgrade --no-cache && \
    apk add --no-cache --upgrade busybox busybox-binsh ssl_client

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build Vue.js application
# Note: Entra ID config is injected at runtime via /config.js endpoint
# This allows FluxCD/Kustomize to manage config via ConfigMaps/Secrets
RUN npm run build:client

# Stage 2: Production Node.js server
# Use latest Alpine (automatically gets most recent with security patches)
# If Alpine 3.22+ not available, falls back to 3.21 with explicit busybox upgrade
FROM node:26-alpine AS release

# Update Alpine packages and explicitly upgrade busybox packages to fix CVE-2025-60876
# Forces upgrade to busybox 1.37.0-r21+ which patches the vulnerability
RUN apk update && \
    apk upgrade --no-cache && \
    apk add --no-cache --upgrade busybox busybox-binsh ssl_client

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production --legacy-peer-deps

# secret-self-service: SOPS CLI used by services/secretsService.js for Key Vault encryption.
# Pin the release and verify the published binary checksum before installing it.
ENV SOPS_VERSION=3.9.4
RUN apk add --no-cache curl coreutils && \
  ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') && \
  SOPS_BIN="sops-v${SOPS_VERSION}.linux.${ARCH}" && \
  curl -fsSL -o /usr/local/bin/sops "https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/${SOPS_BIN}" && \
  curl -fsSL -o "/tmp/${SOPS_BIN}.checksums.txt" "https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/sops-v${SOPS_VERSION}.checksums.txt" && \
  EXPECTED=$(grep " ${SOPS_BIN}\$" "/tmp/${SOPS_BIN}.checksums.txt" | awk '{print $1}') && \
  if [ -z "$EXPECTED" ]; then echo "No checksum found for ${SOPS_BIN}" >&2; exit 1; fi && \
  ACTUAL=$(sha256sum /usr/local/bin/sops | awk '{print $1}') && \
  if [ "$ACTUAL" != "$EXPECTED" ]; then echo "sops checksum mismatch: expected $EXPECTED, got $ACTUAL" >&2; exit 1; fi && \
  chmod +x /usr/local/bin/sops && \
  rm -f "/tmp/${SOPS_BIN}.checksums.txt" && \
  apk del curl

# Copy server code
COPY server.js ./
COPY config.js ./
COPY routes/ ./routes/
COPY services/ ./services/
COPY middleware/ ./middleware/
COPY utils/ ./utils/
COPY data/ ./data/

# Copy built Vue.js frontend from builder stage
COPY --from=frontend-builder /app/dist ./dist

# Set environment variables for production
ENV NODE_ENV=production

# Datadog APM — override these at runtime via pod env vars or Kubernetes secrets.
# DD_AGENT_HOST: address of the Datadog DaemonSet agent (injected via Downward API in AKS).
# DD_ENV: logical environment name that scopes traces and dashboard queries (e.g. sand, prod).
# DD_TRACE_ENABLED: set to 'false' to disable tracing without rebuilding the image.
ENV DD_TRACE_ENABLED=true
ENV DD_SERVICE=self-service-infra

# Expose port
EXPOSE 3000

# Run as the unprivileged 'node' user (uid 1000) provided by the base image
USER node

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "server.js"]
