import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

console.log(`${colors.bright}${colors.cyan}
==============================================================
   INOVAR ASSISTÊNCIA TÉCNICA — ASSISTENTE DE VOZ DO ERP
==============================================================${colors.reset}`);
console.log(`${colors.gray}Iniciando todos os serviços da bancada simultaneamente...${colors.reset}\n`);

const services = [
  {
    name: 'API',
    color: colors.cyan,
    command: 'npx',
    args: ['tsx', 'apps/agent/src/server.ts'],
    cwd: rootDir,
  },
  {
    name: 'AGENTE',
    color: colors.green,
    command: 'npx',
    args: ['tsx', 'apps/agent/src/main.ts', 'dev'],
    cwd: rootDir,
  },
  {
    name: 'WEB',
    color: colors.magenta,
    command: 'npm',
    args: ['--workspace=@inovar/voice-erp-web', 'run', 'dev'],
    cwd: rootDir,
  },
];

const processes = [];

for (const s of services) {
  const p = spawn(s.command, s.args, {
    cwd: s.cwd,
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  const prefix = `${s.color}[${s.name}]${colors.reset} `;

  p.stdout?.on('data', (data) => {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) {
        console.log(`${prefix}${line}`);
      }
    }
  });

  p.stderr?.on('data', (data) => {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) {
        console.error(`${prefix}${line}`);
      }
    }
  });

  p.on('error', (err) => {
    console.error(`${prefix}${colors.red}Erro ao iniciar processo:${colors.reset}`, err);
  });

  p.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`${prefix}${colors.yellow}Processo encerrou com código ${code}${colors.reset}`);
    }
  });

  processes.push(p);
}

function shutdown() {
  console.log(`\n${colors.yellow}[Sistema] Encerrando todos os servidores...${colors.reset}`);
  for (const p of processes) {
    try {
      if (process.platform === 'win32' && p.pid) {
        spawn('taskkill', ['/pid', p.pid.toString(), '/f', '/t'], { stdio: 'ignore' });
      } else {
        p.kill('SIGTERM');
      }
    } catch {
      // Ignora erros ao matar processo
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', shutdown);
