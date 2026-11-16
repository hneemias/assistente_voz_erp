import {
  type JobContext,
  type JobProcess,
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
import type { SessionUserData } from './types/session-types.ts';
import { createSessionLogger, logger } from './utils/logger.ts';

export default defineAgent({
  // Prewarm carrega o modelo VAD uma única vez no processo pai para reduzir latência da primeira chamada
  prewarm: async (proc: JobProcess) => {
    logger.info('Prewarming Silero VAD model in worker parent process...');
    proc.userData.vad = await silero.VAD.load();
  },

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
          enabled: false, // Evita que o eco acústico do alto-falante do celular cancele a fala
        },
        preemptiveGeneration: { enabled: false },
      },
      voiceOptions: {
        allowInterruptions: false,
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

if (process.env.VITEST === undefined) {
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
    }),
  );
}
