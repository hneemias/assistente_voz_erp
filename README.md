# Inovar Voice ERP Assistant — Assistente de Voz Inteligente para Bancada Técnica

Assistente de voz profissional *hands-free* integrado ao LiveKit Cloud, projetado especificamente para técnicos e operadores da **Inovar Assistência Técnica** gerenciarem Ordens de Serviço (OS), catálogo de serviços, produtos e estoque diretamente da bancada de manutenção com as mãos ocupadas.

---

## Principais Recursos e Diferenciais

- **LiveKit Agents SDK (Node.js v1.10.0)**: Baixa latência com streaming de áudio WebRTC, VAD (Silero) para detecção de voz e suporte a interrupções imediatas (*barge-in*).
- **Voz Brasileira Autêntica**: Síntese de voz em português do Brasil com Inworld TTS (`inworld-tts-2`, voz `Heitor`), com vocabulário de bancada e pronúncia natural.
- **Regra de Negócio de Valor Total da OS**: O valor total da OS é **sempre calculado automaticamente** a partir da soma dos produtos e serviços inseridos. Não permite alterar totais soltos, orientando o técnico a editar o valor/quantidade dos itens (`editar_item_os`) ou adicionar/remover produtos e serviços.
- **Suporte aos 9 Status Oficiais do ERP**:
  1. `concluido`: Serviço técnico realizado na bancada, aguardando o pagamento pelo cliente.
  2. `finalizado`: Ordem de serviço de fato finalizada, com serviço executado e pagamento quitado.
  3. `cancelada`: Ordem de serviço cancelada.
  4. `nao_aprovado`: Orçamento ou reparo recusado pelo cliente.
  5. *Situações ativas de OS "Em Aberto"*:
     - `em_aberto`: Aberta recentemente, aguardando triagem/início.
     - `em_processo`: Em manutenção na bancada técnica.
     - `em_processo_terceiros`: Encaminhada para laboratório parceiro externo (ex: Goiânia).
     - `aguardando_autorizacao`: Orçamento passado ao cliente, aguardando aprovação.
     - `aguardando_peca`: Aguardando chegada de peças encomendadas.
- **Protocolo de Segurança em Duas Etapas**: Consultas de leitura respondem imediatamente. Qualquer alteração (status, itens, valores) exige revisão e confirmação verbal explícita do operador antes de persistir no ERP.
- **Mock com Dados Reais da Oficina**: Base de dados integrada com 26 Ordens de Serviço reais extraídas do ERP de produção, cobrindo impressoras (Epson L3250, Hayom PR3300), notebooks (Dell), licenças Kaspersky, pen drives, formatação, reset e análise técnica.
- **Interface Web de Bancada**: Desenvolvida com React 19, TypeScript, Vite e Tailwind CSS, com visualizador de áudio, monitoramento de saúde do backend e badges coloridos para cada status de OS.

---

## Estrutura do Monorepo

```
inovar_assistente_voz/
├── .agents/skills/            # Skills do LiveKit Agents (regras, debugging, simulações)
├── apps/
│   ├── agent/                 # Worker do Agente LiveKit + Servidor Express
│   │   ├── src/
│   │   │   ├── agents/        # Definição do ErpVoiceAgent, prompt do sistema e simulações
│   │   │   ├── config/        # Provedores de IA, endpoints do ERP e variáveis de ambiente
│   │   │   ├── integrations/  # Cliente HTTP do ERP e ErpMockStore com os dados reais
│   │   │   ├── mock-data/     # Payload JSON com as 26 OS reais do sistema
│   │   │   ├── services/      # Gerenciador de contexto conversacional e busca de produtos
│   │   │   ├── tools/         # Ferramentas LiveKit de consulta e mutação
│   │   │   ├── types/         # Tipos TypeScript de sessão, OS e produtos
│   │   │   ├── utils/         # Logger estruturado (Pino), métricas e gerador de tokens
│   │   │   ├── main.ts        # Entrypoint do Worker LiveKit
│   │   │   └── server.ts      # Servidor Express de Tokens e Métricas
│   │   └── tests/             # Suíte Vitest com 23 testes automatizados
│   └── web/                   # Interface Web de Bancada (React + Vite + Tailwind CSS)
│       └── src/
│           ├── components/    # Painel de bancada, visualizador de voz e ModalConfirm
│           ├── hooks/         # Hook de polling do status do backend
│           └── services/      # Cliente da API de emissão de tokens LiveKit
├── docs/                      # Documentação de Arquitetura e Mapeamento de Endpoints
├── .env.example               # Exemplo de configuração das chaves de API
└── package.json               # Gerenciador de workspaces npm
```

---

## Pré-requisitos

- **Node.js**: Versão 22 ou superior recomendada.
- **LiveKit Cloud**: Projeto configurado no [LiveKit Cloud](https://cloud.livekit.io/) (com servidor na região Brasil / São Paulo).
- **Provedores de IA**:
  - **Inworld AI**: Chaves para TTS (`inworld-tts-2` / voz `Heitor`).
  - **LLM**: Chave da API do Google Gemini, Groq ou OpenAI.

---

## Configuração do Ambiente

1. Clone o repositório:
   ```bash
   git clone <URL_DO_REPOSITORIO>
   cd inovar_assistente_voz
   ```

2. Instale as dependências:
   ```bash
   npm install
   ```

3. Crie o arquivo `.env` na raiz baseado no `.env.example`:
   ```bash
   cp .env.example .env
   ```

4. Preencha as variáveis de ambiente essenciais:
   ```env
   # LiveKit Cloud
   LIVEKIT_URL=wss://seu-projeto.livekit.cloud
   LIVEKIT_API_KEY=sua_api_key
   LIVEKIT_API_SECRET=seu_api_secret
   LIVEKIT_AGENT_NAME=erp-voice-assistant

   # Provedor de Voz (TTS)
   TTS_PROVIDER=inworld
   INWORLD_API_KEY=sua_inworld_key
   INWORLD_API_SECRET=sua_inworld_secret
   INWORLD_VOICE=Heitor
   INWORLD_MODEL=inworld-tts-2

   # Provedor de Inteligência (LLM)
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=sua_gemini_key
   LLM_MODEL=gemini-2.5-flash

   # Provedor de Transcrição (STT)
   STT_PROVIDER=deepgram
   DEEPGRAM_API_KEY=sua_deepgram_key
   STT_LANGUAGE=pt-BR

   # Modo ERP
   ERP_MODE=mock
   ```

---

## Como Executar Localmente

### Opção 1: Iniciar Tudo com 1 Único Comando (Recomendado)

Você pode iniciar a API, o Agente de Voz e a Interface Web juntos de forma simultânea:

- **No Windows**: Dê um duplo-clique no arquivo **`iniciar.bat`** na raiz do projeto;
- **Ou via Terminal**:
  ```bash
  npm run dev
  ```
  *Esse comando inicializa a API (3001), o Worker do LiveKit Cloud e a Interface Web (5173) no mesmo console com logs coloridos e organizados.*

---

### Opção 2: Iniciar os Processos Individualmente

Se preferir rodar cada serviço em um terminal separado:

1. **Iniciar o Worker do Agente LiveKit**:
   ```bash
   npm run dev:agent
   ```

2. **Iniciar o Servidor de Tokens e Métricas**:
   ```bash
   npm run dev:api
   ```

3. **Iniciar a Interface Web de Bancada**:
   ```bash
   npm run dev:web
   ```
   *Acesse `https://localhost:5173` no seu navegador.*

---

## Testes Automatizados

O projeto possui uma suíte completa com **23 testes** automatizados cobrindo os cenários operacionais, regras de segurança, cálculo de total e os 9 status do ERP:

```bash
npm test
```

---

## Estratégia de Deploy em Produção

Como o LiveKit Agent Worker mantém uma conexão contínua via WebSocket, a arquitetura recomendada para hospedagem é:

### 1. Frontend Web (`apps/web`) ➔ **Vercel**
- Suba a pasta `apps/web` na Vercel com build command `npm run build`.
- Defina a variável de ambiente:
  ```env
  VITE_AGENT_API_URL=https://seu-backend-no-render.onrender.com
  ```

### 2. Agente de Voz & API (`apps/agent`) ➔ **Render** (ou Railway)
- O worker do LiveKit **não deve ser hospedado em plataformas Serverless** (como Vercel/Netlify), pois exige um processo contínuo (daemon) ativo 24/7.
- No Render, crie um **Web Service** com ambiente **Node**:
  - **Build Command**: `npm install && npm run build`
  - **Start Command**:
    ```bash
    npx tsx apps/agent/src/server.ts & npx tsx apps/agent/src/main.ts start
    ```
  - Configure as variáveis de ambiente do seu `.env` diretamente no painel do Render.

---

## Licença

Desenvolvido para **Inovar Assistência Técnica**. Todos os direitos reservados.
