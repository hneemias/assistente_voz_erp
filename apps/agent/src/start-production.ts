import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.ts';

// 1. Inicializa o servidor Express (Web Frontend + APIs) diretamente neste processo principal
// para eliminar um processo Node/tsx inteiro e economizar ~150MB de memória RAM
import './server.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let agentProc: any = null;

// Verifica se há credenciais válidas do LiveKit para inicializar o worker de voz
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
  const mainJsPath = path.join(__dirname, 'main.js');
  const mainTsPath = path.join(__dirname, 'main.ts');
  const hasCompiledJs = fs.existsSync(mainJsPath);

  const mainFile = hasCompiledJs ? mainJsPath : mainTsPath;
  const runnerArgs = hasCompiledJs
    ? [mainFile, 'start']
    : [path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs'), mainFile, 'start'];

  agentProc = spawn(process.execPath, runnerArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=256`,
    },
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
  console.log(`[Production Runner] Recebido sinal ${signal}, finalizando processos...`);
  if (agentProc) {
    agentProc.kill();
  }
  process.exit(0);
};

process.on('SIGTERM', () => handleTermination('SIGTERM'));
process.on('SIGINT', () => handleTermination('SIGINT'));
