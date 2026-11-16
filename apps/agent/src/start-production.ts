import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 1. Silencia e intercepta a porta 8081 do LiveKit para que o Render nunca veja uma 2ª porta HTTP
// no container (o que causaria 'Detected a new open port HTTP:8081' e reiniciaria o container a cada 30s)
const originalListen = http.Server.prototype.listen;
const originalClose = http.Server.prototype.close;

http.Server.prototype.listen = function (this: any, ...args: any[]) {
  const port = args[0];
  if (port === 8081 || port === '8081') {
    this.__isMock8081 = true;
    this.address = () => ({ port: 8081, address: '127.0.0.1', family: 'IPv4' });
    const cb = args.find((a: any) => typeof a === 'function');
    if (cb) setTimeout(() => cb.call(this), 0);
    return this;
  }
  return originalListen.apply(this, args as any);
};

http.Server.prototype.close = function (this: any, cb?: (err?: Error) => void) {
  if (this.__isMock8081) {
    if (cb) setTimeout(cb, 0);
    return this;
  }
  return originalClose.apply(this, arguments as any);
};

// 2. Desativa o executor de inferência local do LiveKit.
// No Render (512MB RAM), desativar o subprocesso de inferência local economiza ~150MB de RAM.
// Toda a inferência de IA (LLM, STT, TTS) já é realizada via LiveKit Cloud / APIs remotas.
import { AgentServer, InferenceRunner, ServerOptions, initializeLogger } from '@livekit/agents';
InferenceRunner.registerRunner = () => {};

// 3. Inicializa o servidor Express (Web Frontend + APIs de Token e Métricas)
import './server.ts';
import { env } from './config/env.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let livekitServer: AgentServer | null = null;

// 4. Verifica se há credenciais válidas do LiveKit para inicializar o worker de voz
const hasValidLiveKit =
  Boolean(env.LIVEKIT_API_KEY) &&
  env.LIVEKIT_API_KEY !== 'devkey' &&
  env.LIVEKIT_API_KEY !== 'your_livekit_api_key' &&
  env.LIVEKIT_API_KEY !== 'sua_api_key';

if (!hasValidLiveKit) {
  console.warn(
    '\n⚠️  [Production Runner] AVISO: LIVEKIT_API_KEY não foi configurada ou está vazia no ambiente.',
  );
  console.warn(
    '   O Worker do LiveKit não será iniciado até que a chave seja definida.',
  );
  console.warn(
    '   O Servidor HTTP e a Interface Web continuarão ativos normalmente para atender o Render.\n',
  );
} else {
  console.log('[Production Runner] Credenciais do LiveKit detectadas. Iniciando Worker do Agente de Voz...');

  initializeLogger({ pretty: false, level: (env.LOG_LEVEL as any) || 'info' });

  const mainJsPath = path.join(__dirname, 'main.js');
  const mainTsPath = path.join(__dirname, 'main.ts');
  const mainFile = fs.existsSync(mainJsPath) ? mainJsPath : mainTsPath;

  const serverOptions = new ServerOptions({
    agent: mainFile,
    numIdleProcesses: 0,
    initializeProcessTimeout: 60 * 1000,
    host: '127.0.0.1',
    port: 8081,
    production: true,
    wsURL: env.LIVEKIT_URL,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    agentName: env.LIVEKIT_AGENT_NAME,
    jobMemoryWarnMB: 300,
    jobMemoryLimitMB: 450,
  });

  livekitServer = new AgentServer(serverOptions);

  livekitServer.event.on('worker_registered', () => {
    const mem = process.memoryUsage();
    console.log(
      `[Production Runner] ✅ Worker LiveKit registrado com sucesso na Cloud! (Consumo de RAM atual: ${Math.round(mem.rss / 1024 / 1024)}MB)`,
    );
  });

  livekitServer.run().catch((err: any) => {
    console.error('[Production Runner] Erro no worker LiveKit:', err);
  });
}

const handleTermination = async (signal: string) => {
  console.log(`[Production Runner] Recebido sinal ${signal}, finalizando com segurança...`);
  if (livekitServer) {
    try {
      await livekitServer.close();
    } catch (err) {
      console.warn('[Production Runner] Aviso ao fechar LiveKit server:', err);
    }
  }
  process.exit(0);
};

process.on('SIGTERM', () => handleTermination('SIGTERM'));
process.on('SIGINT', () => handleTermination('SIGINT'));
