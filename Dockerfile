FROM node:22-bookworm-slim

WORKDIR /app

# Instala ferramentas essenciais do sistema e fuso horário de Brasília
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    curl \
    ca-certificates \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=America/Sao_Paulo
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Garante que durante o build o npm instale todos os devDependencies para compilação
ENV NODE_ENV=development

# Copia manifests para aproveitar cache das camadas
COPY package.json package-lock.json ./
COPY apps/agent/package.json ./apps/agent/
COPY apps/web/package.json ./apps/web/

# Instala dependências completas do monorepo
RUN npm ci --include=dev

# Copia o código-fonte
COPY apps ./apps
COPY scripts ./scripts

# Compila o frontend React (apps/web/dist) e o backend/agente (apps/agent/dist)
RUN npm run build

# Altera para ambiente de produção para execução
ENV NODE_ENV=production
ENV PORT=3001

# Expõe a porta HTTP configurada
EXPOSE 3001

# Healthcheck interno do container
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3001/healthz || exit 1

# Inicia o servidor unificado (Express + Frontend estático + LiveKit Worker)
CMD ["node", "apps/agent/dist/start-production.js"]
