FROM node:22-bookworm-slim

WORKDIR /app

# Instala ferramentas essenciais do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copia manifests para aproveitar cache das camadas
COPY package.json package-lock.json ./
COPY apps/agent/package.json ./apps/agent/
COPY apps/web/package.json ./apps/web/

# Instala dependências do monorepo
RUN npm ci

# Copia o código-fonte
COPY apps ./apps
COPY scripts ./scripts

# Compila o frontend React (apps/web/dist) e o backend/agente (apps/agent/dist)
RUN npm run build

# Expõe a porta HTTP configurada
EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

# Healthcheck interno do container
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3001/healthz || exit 1

# Inicia o servidor unificado (Express + Frontend estático + LiveKit Worker)
CMD ["node", "apps/agent/dist/start-production.js"]
