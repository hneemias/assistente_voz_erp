import type { voice } from '@livekit/agents';
import { logger } from '../utils/logger.ts';

const announcementsQueue: string[] = [];
let activeSession: voice.AgentSession<any> | null = null;
let idleCheckInterval: NodeJS.Timeout | null = null;
let idleSinceTimestamp: number | null = null;

const IDLE_DEBOUNCE_MS = 2500; // 2.5 segundos de silêncio e ociosidade contínuos

export function queueIdleAnnouncement(message: string): void {
  logger.info({ message }, '[IdleNotifier] Mensagem adicionada à fila de avisos IDLE');
  announcementsQueue.push(message);
  triggerIdleCheck();
}

export function attachSessionToIdleNotifier(session: voice.AgentSession<any>): () => void {
  activeSession = session;
  logger.info('[IdleNotifier] Sessão de voz vinculada ao notificador de ociosidade');

  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
  }

  idleCheckInterval = setInterval(() => {
    triggerIdleCheck();
  }, 1000);

  return () => {
    if (idleCheckInterval) {
      clearInterval(idleCheckInterval);
      idleCheckInterval = null;
    }
    if (activeSession === session) {
      activeSession = null;
    }
  };
}

function triggerIdleCheck(): void {
  if (!activeSession || announcementsQueue.length === 0) {
    idleSinceTimestamp = null;
    return;
  }

  const isAgentIdle = activeSession.agentState === 'idle';
  const isUserSilent = activeSession.userState !== 'speaking';

  if (!isAgentIdle || !isUserSilent) {
    // Conversa ativa (ou técnico falando ou assistente respondendo)
    idleSinceTimestamp = null;
    return;
  }

  const now = Date.now();
  if (!idleSinceTimestamp) {
    idleSinceTimestamp = now;
    return;
  }

  // Se já estamos em silêncio contínuo há pelo menos IDLE_DEBOUNCE_MS
  if (now - idleSinceTimestamp >= IDLE_DEBOUNCE_MS) {
    const nextMessage = announcementsQueue.shift();
    idleSinceTimestamp = null;

    if (nextMessage && activeSession) {
      logger.info({ message: nextMessage }, '[IdleNotifier] Disparando aviso proativo em momento IDLE');
      try {
        activeSession.generateReply({
          instructions: `Diga de forma espontânea, amigável e concisa em português brasileiro (máximo 1 frase): "${nextMessage}"`,
          allowInterruptions: true,
        });
      } catch (err) {
        logger.warn({ err }, '[IdleNotifier] Falha ao disparar generateReply');
      }
    }
  }
}
