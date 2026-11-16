import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('[Production Runner] Iniciando Servidor HTTP de Tokens e Métricas...');
const serverProc = spawn('npx', ['tsx', path.join(__dirname, 'server.ts')], {
  stdio: 'inherit',
  shell: true,
});

console.log('[Production Runner] Iniciando Worker do Agente LiveKit em modo produção...');
const agentProc = spawn('npx', ['tsx', path.join(__dirname, 'main.ts'), 'start'], {
  stdio: 'inherit',
  shell: true,
});

serverProc.on('error', (err) => {
  console.error('[Production Runner] Erro no servidor Express:', err);
});

agentProc.on('error', (err) => {
  console.error('[Production Runner] Erro no worker LiveKit:', err);
});

const handleTermination = (signal: string) => {
  console.log(`[Production Runner] Recebido sinal ${signal}, finalizando processos filhos...`);
  serverProc.kill();
  agentProc.kill();
  process.exit(0);
};

process.on('SIGTERM', () => handleTermination('SIGTERM'));
process.on('SIGINT', () => handleTermination('SIGINT'));
