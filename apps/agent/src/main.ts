import {
  type JobContext,
  type JobProcess,
  InferenceRunner,
  ServerOptions,
  cli,
  defineAgent,
  inference,
  voice,
} from '@livekit/agents';
import * as silero from '@livekit/agents-plugin-silero';
import { fileURLToPath } from 'node:url';
import { createErpVoiceAgent } from './agents/erp-voice-agent.ts';
import { onErpSimulationEnd, setupErpSimulation } from './agents/simulation.ts';
import { createAiProviders } from './config/ai-providers.ts';
import { env } from './config/env.ts';
import { createSessionUserData } from './services/context-manager.ts';
import { attachSessionToIdleNotifier } from './services/idle-notifier.ts';
import type { SessionUserData } from './types/session-types.ts';
import http from 'node:http';
import { createSessionLogger, logger } from './utils/logger.ts';

// 1. Silencia e intercepta a porta 8081 do LiveKit para que o Render nunca veja uma 2ª porta HTTP
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

// 2. Desativa o executor de inferência local para economizar memória (usamos cloud inference)
InferenceRunner.registerRunner = () => {};

export default defineAgent({
  // Em containers com memória restrita (ex: Render 512MB), o VAD é carregado sob demanda
  // no entry() da chamada para manter a inicialização leve e abaixo de 150MB de RAM.
  entry: async (ctx: JobContext) => {
    const sessionId = ctx.room.name || `room-${Date.now()}`;
    const userId = ctx.job.participant?.identity || 'operador-bancada';
    const sessionLog = createSessionLogger(sessionId, userId);

    const userData = createSessionUserData({
      sessionId,
      userId,
    });

    const providers = createAiProviders(env);
    sessionLog.info(
      {
        providers: providers.summary,
        erpMode: userData.erpClient.mode,
      },
      'Inicializando AgentSession para operação do ERP por voz',
    );

    const prewarmedVad = ctx.proc.userData.vad as silero.VAD | undefined;

    const session = new voice.AgentSession<SessionUserData>({
      vad: prewarmedVad ?? (await silero.VAD.load()),
      stt: providers.sttInstance,
      llm: providers.llmInstance,
      tts: providers.ttsInstance,
      userData,
      turnHandling: {
        turnDetection: new inference.TurnDetector(),
        interruption: {
          enabled: true,
        },
        preemptiveGeneration: { enabled: false },
      },
      voiceOptions: {
        allowInterruptions: true,
        maxToolSteps: 5,
      },
    });

    const simulation = ctx.simulationContext();
    if (simulation) {
      setupErpSimulation(simulation, session);
    }

    await session.start({
      agent: createErpVoiceAgent(),
      room: ctx.room,
    });

    // Conecta o notificador proativo para avisos amigáveis em momentos IDLE
    const detachNotifier = attachSessionToIdleNotifier(session);
    ctx.room.on('disconnected', () => detachNotifier());

    await ctx.connect();

    // Publica metadados de contexto inicial da sessão na sala para sincronizar com a UI Web
    try {
      await ctx.room.localParticipant?.setAttributes({
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber ?? '',
        llmProvider: providers.summary.llmProvider,
        llmModel: providers.summary.llmModel,
      });
    } catch (err) {
      sessionLog.warn({ err }, 'Não foi possível publicar atributos iniciais do participante');
    }

    // Saudação operacional curta ao conectar
    session.generateReply({
      instructions:
        'Cumprimente o operador de bancada de forma muito breve em português brasileiro (máximo uma frase curta, como "Olá! Assistente do ERP pronto na bancada, qual OS vamos consultar?").',
    });
  },

  onSimulationEnd: onErpSimulationEnd,
});

// Executa o LiveKit CLI exclusivamente se este for o entrypoint direto do processo
// e NUNCA quando for importado por processos filhos do LiveKit (evitando fork bomb e loop de memória)
const isMainScript =
  typeof process.argv[1] === 'string' &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('main.ts') ||
    process.argv[1].endsWith('main.js'));

if (process.env.VITEST === undefined && isMainScript && !process.send) {
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      // Não pré-aloca processos filhos vazios na inicialização
      numIdleProcesses: 0,
      // Aumenta o tempo limite de inicialização para 60 segundos
      // evitando que a CPU compartilhada do Render mate o runner com timeout
      initializeProcessTimeout: 60 * 1000,
      // Escuta apenas em loopback para não competir com a porta pública 10000 do Render
      host: '127.0.0.1',
      port: 8081,
      jobMemoryWarnMB: 300,
      jobMemoryLimitMB: 450,
    }),
  );
}
