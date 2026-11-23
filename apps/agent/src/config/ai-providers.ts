import { inference, llm, stt, tts } from '@livekit/agents';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as google from '@livekit/agents-plugin-google';
import * as openai from '@livekit/agents-plugin-openai';
import OpenAI from 'openai';
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
    case 'google': {
      let model = (config.LLM_MODEL || 'gemini-3.5-flash-lite').replace(/^google\//, '');
      if (model.includes('2.5-flash') || model === 'gemini-3.5-flash') {
        model = 'gemini-3.5-flash-lite';
      }
      return new google.LLM({
        model,
        apiKey: apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY,
        temperature: 0.2,
      });
    }

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
  const deepgramKey =
    config.DEEPGRAM_API_KEY ||
    (config.STT_PROVIDER === 'deepgram' ? config.STT_API_KEY : '') ||
    process.env.DEEPGRAM_API_KEY;
  const groqKey = config.GROQ_API_KEY || process.env.GROQ_API_KEY;
  const language = config.STT_LANGUAGE || 'pt-BR';

  const sttInstances: stt.STT[] = [];

  // 1. Deepgram STT (Principal de ultrabaixa latência)
  if (deepgramKey) {
    const model = (config.STT_MODEL.replace(/^deepgram\//, '') || 'nova-3') as any;
    sttInstances.push(
      new deepgram.STT({
        model,
        language: language as any,
        apiKey: deepgramKey,
        smartFormat: true,
        punctuate: true,
        numerals: true,
        keyterm: ['OS', '5W30', 'Tecfil', 'Mann', 'Cobreq', 'DOT 4', 'alinhamento', 'balanceamento'],
      }),
    );
  }

  // 2. Groq Whisper (Fallback gratuito perpétuo)
  if (groqKey) {
    const groqClient = new OpenAI({
      apiKey: groqKey,
      baseURL: 'https://api.groq.com/openai/v1',
    });
    sttInstances.push(
      new openai.STT({
        model: 'whisper-large-v3',
        language: 'pt',
        apiKey: groqKey,
        client: groqClient,
      }),
    );
  }

  // Se houver múltiplas instâncias configuradas, utiliza o FallbackAdapter oficial do LiveKit
  if (sttInstances.length > 1) {
    return new stt.FallbackAdapter({ sttInstances });
  }

  if (sttInstances.length === 1) {
    return sttInstances[0]!;
  }

  // Fallback para provedores individuais se configurados explicitamente
  if (config.STT_PROVIDER === 'openai') {
    return new openai.STT({
      model: config.STT_MODEL || 'gpt-4o-transcribe',
      language: 'pt',
      apiKey: config.STT_API_KEY || process.env.OPENAI_API_KEY,
    });
  }

  // Fallback padrão se nenhuma chave for passada
  const modelName = config.STT_MODEL.includes('/') ? config.STT_MODEL : 'deepgram/nova-3';
  return new inference.STT({
    model: modelName as any,
    language: language as any,
  });
}

export function createTtsProvider(config: AppEnv = env): tts.TTS {
  const cartesiaKey =
    config.CARTESIA_API_KEY ||
    (config.TTS_PROVIDER === 'cartesia' ? config.TTS_API_KEY : '') ||
    process.env.CARTESIA_API_KEY;
  const elevenKey =
    config.ELEVEN_API_KEY ||
    config.ELEVENLABS_API_KEY ||
    (config.TTS_PROVIDER === 'elevenlabs' ? config.TTS_API_KEY : '') ||
    process.env.ELEVEN_API_KEY;
  const googleKey = config.LLM_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

  const ttsInstances: tts.TTS[] = [];

  // 1. Cartesia (Principal - Voz do Heitor b0f46533... ou configurada)
  if (cartesiaKey) {
    const voice =
      config.TTS_VOICE && config.TTS_VOICE !== 'Heitor'
        ? config.TTS_VOICE
        : 'b0f46533-d4bb-493f-a26f-a99e1f2e86e3'; // Heitor pt-BR no Cartesia
    ttsInstances.push(
      new cartesia.TTS({
        model: config.TTS_MODEL || 'sonic-3',
        voice,
        language: config.TTS_LANGUAGE || 'pt-BR',
        apiKey: cartesiaKey,
      }),
    );
  }

  // 2. ElevenLabs (Fallback se a chave secreta sk_ for informada)
  if (elevenKey && elevenKey.startsWith('sk_')) {
    ttsInstances.push(
      new elevenlabs.TTS({
        model: config.TTS_MODEL || 'eleven_turbo_v2_5',
        voiceId: config.TTS_VOICE !== 'Heitor' ? config.TTS_VOICE : undefined,
        language: 'pt',
        apiKey: elevenKey,
      }),
    );
  }

  // 3. Google Gemini TTS (Fallback adicional)
  if (googleKey) {
    ttsInstances.push(
      new google.beta.TTS({
        model: 'gemini-2.5-flash-preview-tts',
        voiceName: 'Kore',
        apiKey: googleKey,
      }),
    );
  }

  // Se houver múltiplas instâncias, utiliza FallbackAdapter oficial do LiveKit
  if (ttsInstances.length > 1) {
    return new tts.FallbackAdapter({ ttsInstances });
  }

  if (ttsInstances.length === 1) {
    return ttsInstances[0]!;
  }

  // Fallback padrão
  const modelName = config.TTS_MODEL || 'inworld/inworld-tts-2';
  return new inference.TTS({
    model: modelName as any,
    voice: config.TTS_VOICE || 'Heitor',
    language: (config.TTS_LANGUAGE || 'pt-BR') as any,
  });
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
