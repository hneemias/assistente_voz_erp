import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('[Production Runner] Iniciando Servidor HTTP de Tokens, Frontend e Métricas...');
const serverProc = spawn('npx', ['tsx', path.join(__dirname, 'server.ts')], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

serverProc.on('error', (err) => {
  console.error('[Production Runner] Erro crítico no servidor Express:', err);
});

serverProc.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`[Production Runner] Servidor Express finalizou inesperadamente com código ${code}`);
  }
});

let agentProc: any = null;

// Verifica se há credenciais válidas do LiveKit para inicializar o worker
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
  console.log('[Production Runner] Credenciais do LiveKit detectadas. Iniciando Worker do Agente...');
  agentProc = spawn('npx', ['tsx', path.join(__dirname, 'main.ts'), 'start'], {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  agentProc.on('error', (err: any) => {
    console.error('[Production Runner] Erro no worker LiveKit:', err);
  });

  agentProc.on('exit', (code: number | null) => {
    if (code !== 0 && code !== null) {
      console.warn(`[Production Runner] Worker LiveKit finalizou com código ${code}. O servidor HTTP segue ativo.`);
    }
  });
}

const handleTermination = (signal: string) => {
  console.log(`[Production Runner] Recebido sinal ${signal}, finalizando processos filhos...`);
  serverProc.kill();
  if (agentProc) {
    agentProc.kill();
  }
  process.exit(0);
};

process.on('SIGTERM', () => handleTermination('SIGTERM'));
process.on('SIGINT', () => handleTermination('SIGINT'));
