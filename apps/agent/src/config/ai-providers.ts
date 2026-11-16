import { inference, llm, stt, tts } from '@livekit/agents';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as google from '@livekit/agents-plugin-google';
import * as openai from '@livekit/agents-plugin-openai';
import { env, type AppEnv } from './env.ts';

export interface ConfiguredAiProviders {
  llmInstance: llm.LLM;
  sttInstance: stt.STT;
  ttsInstance: tts.TTS;
  summary: {
    llmProvider: string;
    llmModel: string;
    sttProvider: string;
    sttModel: string;
    sttLanguage: string;
    ttsProvider: string;
    ttsModel: string;
  };
}

export function createLlmProvider(config: AppEnv = env): llm.LLM {
  const apiKey = config.LLM_API_KEY || undefined;

  switch (config.LLM_PROVIDER) {
    case 'google':
      return new google.LLM({
        model: config.LLM_MODEL || 'gemini-2.5-flash',
        apiKey: apiKey ?? process.env.GOOGLE_API_KEY,
        temperature: 0.2,
      });

    case 'openai':
      return new openai.LLM({
        model: config.LLM_MODEL || 'gpt-4.1-mini',
        apiKey: apiKey ?? process.env.OPENAI_API_KEY,
        temperature: 0.2,
        parallelToolCalls: false,
      });

    case 'livekit-inference':
    default: {
      const modelName = config.LLM_MODEL.includes('/')
        ? config.LLM_MODEL
        : `google/${config.LLM_MODEL || 'gemini-3.8-flash'}`;
      return new inference.LLM({
        model: modelName as any,
      });
    }
  }
}

export function createSttProvider(config: AppEnv = env): stt.STT {
  const apiKey = config.STT_API_KEY || undefined;
  const language = config.STT_LANGUAGE || 'pt-BR';

  switch (config.STT_PROVIDER) {
    case 'deepgram':
      return new deepgram.STT({
        model: (config.STT_MODEL || 'nova-3') as any,
        language: language as any,
        apiKey: apiKey ?? process.env.DEEPGRAM_API_KEY,
        smartFormat: true,
        punctuate: true,
        numerals: true,
        keyterm: ['OS', '5W30', 'Tecfil', 'Mann', 'Cobreq', 'DOT 4', 'alinhamento', 'balanceamento'],
      });

    case 'openai':
      return new openai.STT({
        model: config.STT_MODEL || 'gpt-4o-transcribe',
        language: 'pt',
        apiKey: apiKey ?? process.env.OPENAI_API_KEY,
      });

    case 'livekit-inference':
    default: {
      const modelName = config.STT_MODEL.includes('/')
        ? config.STT_MODEL
        : 'deepgram/nova-3';
      return new inference.STT({
        model: modelName as any,
        language: (config.STT_LANGUAGE || 'pt-BR') as any,
      });
    }
  }
}

export function createTtsProvider(config: AppEnv = env): tts.TTS {
  const apiKey = config.TTS_API_KEY || undefined;

  switch (config.TTS_PROVIDER) {
    case 'cartesia':
      return new cartesia.TTS({
        model: config.TTS_MODEL || 'sonic-3',
        voice: config.TTS_VOICE || 'a37639f0-2f0a-4de4-9942-875a187af878',
        language: config.TTS_LANGUAGE || 'pt-BR',
        apiKey: apiKey ?? process.env.CARTESIA_API_KEY,
      });

    case 'elevenlabs':
      return new elevenlabs.TTS({
        model: config.TTS_MODEL || 'eleven_turbo_v2_5',
        voiceId: config.TTS_VOICE || undefined,
        language: config.TTS_LANGUAGE || 'pt-BR',
        apiKey: apiKey ?? process.env.ELEVEN_API_KEY,
      });

    case 'google':
      return new google.beta.TTS({
        model: config.TTS_MODEL || 'gemini-2.5-flash-preview-tts',
        voiceName: config.TTS_VOICE || 'Kore',
        apiKey: apiKey ?? process.env.GOOGLE_API_KEY,
      });

    case 'openai':
      return new openai.TTS({
        model: config.TTS_MODEL || 'gpt-4o-mini-tts',
        voice: (config.TTS_VOICE || 'alloy') as any,
        apiKey: apiKey ?? process.env.OPENAI_API_KEY,
      });

    case 'livekit-inference':
    default: {
      const modelName = config.TTS_MODEL || 'inworld/inworld-tts-2';
      return new inference.TTS({
        model: modelName as any,
        voice: config.TTS_VOICE || 'Heitor',
        language: (config.TTS_LANGUAGE || 'pt-BR') as any,
      });
    }
  }
}

export function createAiProviders(config: AppEnv = env): ConfiguredAiProviders {
  return {
    llmInstance: createLlmProvider(config),
    sttInstance: createSttProvider(config),
    ttsInstance: createTtsProvider(config),
    summary: {
      llmProvider: config.LLM_PROVIDER,
      llmModel: config.LLM_MODEL,
      sttProvider: config.STT_PROVIDER,
      sttModel: config.STT_MODEL,
      sttLanguage: config.STT_LANGUAGE,
      ttsProvider: config.TTS_PROVIDER,
      ttsModel: config.TTS_MODEL,
    },
  };
}
