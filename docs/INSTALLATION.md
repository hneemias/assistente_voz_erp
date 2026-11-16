# GUIA DE INSTALAÇÃO E EXECUÇÃO DO PROJETO

## 1. Pré-requisitos

- **Node.js**: Versão `>= 22.0.0` instalada.
- **npm**: Versão `>= 10.0.0`.
- **LiveKit CLI (`lk`)**: Instalado via winget (`winget install LiveKit.LiveKitCLI`) ou binário oficial.
- **Conta LiveKit Cloud** (ou servidor LiveKit local para desenvolvimento offline).
- **Chave de API do provedor LLM**: Chave da API Google Gemini (`GOOGLE_API_KEY` ou `LLM_API_KEY`) ou OpenAI.

---

## 2. Configuração das Variáveis de Ambiente

Copie o arquivo `.env.example` da raiz para `.env.local`:

```bash
cp .env.example .env.local
```

Preencha suas credenciais no `.env.local`:

```env
# LiveKit Cloud
LIVEKIT_URL=wss://seu-projeto.livekit.cloud
LIVEKIT_API_KEY=sua_api_key
LIVEKIT_API_SECRET=seu_api_secret

# LLM (Google Gemini ou outro)
LLM_PROVIDER=google
LLM_API_KEY=sua_chave_gemini_aqui
LLM_MODEL=gemini-2.5-flash

# STT & TTS
STT_PROVIDER=deepgram
STT_API_KEY=sua_chave_deepgram
TTS_PROVIDER=cartesia
TTS_API_KEY=sua_chave_cartesia

# Modo do ERP (inicie com mock para testar com dados simulados)
ERP_MODE=mock
ERP_API_BASE_URL=http://localhost:4000/api/v1
ERP_API_TOKEN=seu_token_se_live
```

---

## 3. Instalação das Dependências

Instale todas as dependências do monorepo:

```bash
npm install
```

---

## 4. Como Executar os Serviços

O projeto possui três processos:

### 4.1. Iniciar o Servidor de Tokens e APIs Auxiliares (Porta 3001)
Em um terminal:
```bash
npm run dev:api
```

### 4.2. Iniciar o Worker do Agente de Voz LiveKit
Em um segundo terminal:
```bash
npm run dev:agent
```
> O comando iniciará em modo de desenvolvimento conectando à sua sala LiveKit.

### 4.3. Iniciar a Interface Web de Bancada (Porta 5173)
Em um terceiro terminal:
```bash
npm run dev:web
```

Abra seu navegador em [http://localhost:5173](http://localhost:5173), clique em **"Iniciar Atendimento por Voz"** e autorize o microfone para conversar com o assistente.

---

## 5. Como Executar a Suíte de Testes

Para rodar os testes unitários cobrindo todos os 10 cenários obrigatórios (consultas, alterações, confirmações, ambiguidades e timeouts):

```bash
npm run test
```
