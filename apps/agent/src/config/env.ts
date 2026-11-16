import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

// Carrega variáveis de ambiente da raiz do monorepo ou do pacote atual
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  // LiveKit
  LIVEKIT_URL: z.string().default('ws://localhost:7880'),
  LIVEKIT_API_KEY: z.string().default('devkey'),
  LIVEKIT_API_SECRET: z.string().default('secret'),
  LIVEKIT_AGENT_NAME: z.string().default('erp-voice-assistant'),

  // ERP Integration
  ERP_MODE: z.enum(['mock', 'live']).default('mock'),
  ERP_API_BASE_URL: z.string().default('http://localhost:4000/api/v1'),
  ERP_API_TOKEN: z.string().default(''),
  ERP_AUTH_TYPE: z.enum(['bearer', 'api-key', 'basic']).default('bearer'),
  ERP_API_KEY_HEADER: z.string().default('X-API-Key'),
  ERP_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(8000),

  // AI Providers
  LLM_PROVIDER: z.enum(['livekit-inference', 'google', 'openai']).default('livekit-inference'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('google/gemini-2.5-flash'),

  STT_PROVIDER: z.enum(['livekit-inference', 'deepgram', 'openai']).default('livekit-inference'),
  STT_API_KEY: z.string().default(''),
  STT_MODEL: z.string().default('deepgram/nova-3'),
  STT_LANGUAGE: z.string().default('pt-BR'),

  TTS_PROVIDER: z
    .enum(['livekit-inference', 'cartesia', 'elevenlabs', 'google', 'openai'])
    .default('livekit-inference'),
  TTS_API_KEY: z.string().default(''),
  TTS_MODEL: z.string().default('assemblyai/assemblyai-tts-1'),
  TTS_VOICE: z.string().default(''),
  TTS_LANGUAGE: z.string().default('pt'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(overrides?: Partial<Record<keyof AppEnv, unknown>>): AppEnv {
  const raw = {
    ...process.env,
    ...overrides,
  };
  return envSchema.parse(raw);
}

export const env: AppEnv = loadEnv();
