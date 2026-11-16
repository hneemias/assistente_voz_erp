import pino, { type Logger } from 'pino';
import { env } from '../config/env.ts';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'headers.authorization',
  'headers.Authorization',
  'headers["X-API-Key"]',
  'headers["x-api-key"]',
  'token',
  'apiKey',
  'apiSecret',
  'password',
  'secret',
  'ERP_API_TOKEN',
  'LIVEKIT_API_SECRET',
  'LLM_API_KEY',
  'STT_API_KEY',
  'TTS_API_KEY',
  '*.token',
  '*.apiKey',
  '*.apiSecret',
  '*.password',
  '*.secret',
];

export const logger: Logger = pino({
  name: 'erp-voice-assistant',
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export interface AuditLogPayload {
  sessionId: string;
  userId: string;
  intent: string;
  toolName: string;
  durationMs: number;
  httpStatus?: number | null;
  operationResult: 'SUCCESS' | 'ERROR' | 'CONFIRMATION_REQUIRED' | 'AMBIGUOUS' | 'CANCELLED' | 'TIMEOUT';
  osNumber?: string | number | null;
  isMutation?: boolean;
  erpMode: 'mock' | 'live';
  errorCode?: string;
  errorMessage?: string;
}

export function createSessionLogger(sessionId: string, userId: string): Logger {
  return logger.child({
    sessionId,
    userId,
  });
}

export function logToolAudit(payload: AuditLogPayload): void {
  const logFn =
    payload.operationResult === 'ERROR' || payload.operationResult === 'TIMEOUT'
      ? logger.error.bind(logger)
      : logger.info.bind(logger);

  logFn(
    {
      event: 'tool_execution_audit',
      sessionId: payload.sessionId,
      userId: payload.userId,
      intent: payload.intent,
      toolName: payload.toolName,
      durationMs: payload.durationMs,
      httpStatus: payload.httpStatus ?? null,
      operationResult: payload.operationResult,
      osNumber: payload.osNumber ?? null,
      isMutation: payload.isMutation ?? false,
      erpMode: payload.erpMode,
      errorCode: payload.errorCode ?? null,
      errorMessage: payload.errorMessage ?? null,
    },
    `[AUDIT] tool=${payload.toolName} result=${payload.operationResult} duration=${payload.durationMs}ms`,
  );
}
