import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentDispatchClient } from 'livekit-server-sdk';
import { generateSkewCompensatedLiveKitToken, syncClockSkew } from './utils/livekit-token.ts';
import { z } from 'zod';
import { ERP_ENDPOINTS_CONFIG } from './config/erp-endpoints.ts';
import { env } from './config/env.ts';
import { defaultErpClient } from './integrations/erp/erp-client.ts';
import { logger } from './utils/logger.ts';
import { metrics } from './utils/metrics.ts';

const tokenRequestSchema = z.object({
  participantName: z.string().min(1).max(80).default('Operador Bancada 01'),
  participantIdentity: z
    .string()
    .min(1)
    .max(80)
    .optional(),
  roomName: z.string().min(1).max(100).optional(),
});

export function createApiServer(): Express {
  const app = express();

  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    }),
  );
  app.use(express.json());

  // 1. Healthcheck e status da configuração (sem expor segredos!)
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'erp-voice-assistant-api',
      timestamp: new Date().toISOString(),
      erp: {
        mode: env.ERP_MODE,
        baseUrl: env.ERP_API_BASE_URL,
        productionReady:
          env.ERP_MODE === 'live' &&
          Object.values(ERP_ENDPOINTS_CONFIG).every((e) => e.contractStatus === 'CONFIGURED'),
      },
      aiProviders: {
        llmProvider: env.LLM_PROVIDER,
        llmModel: env.LLM_MODEL,
        sttProvider: env.STT_PROVIDER,
        sttLanguage: env.STT_LANGUAGE,
        ttsProvider: env.TTS_PROVIDER,
      },
      livekit: {
        url: env.LIVEKIT_URL,
        agentName: env.LIVEKIT_AGENT_NAME,
        configured:
          Boolean(env.LIVEKIT_API_KEY) &&
          Boolean(env.LIVEKIT_API_SECRET) &&
          env.LIVEKIT_API_KEY !== 'your_livekit_api_key',
      },
    });
  });

  // 2. Geração segura de Token LiveKit para a Interface Web de Bancada
  app.post('/api/token', async (req: Request, res: Response) => {
    const parsed = tokenRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: 'Parâmetros inválidos para geração de token.',
        details: parsed.error.flatten(),
      });
      return;
    }

    const { participantName, participantIdentity, roomName } = parsed.data;
    const resolvedIdentity =
      participantIdentity ??
      `op-${participantName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    const resolvedRoom = roomName ?? `bancada-erp-${Date.now().toString(36)}`;

    try {
      const token = await generateSkewCompensatedLiveKitToken({
        apiKey: env.LIVEKIT_API_KEY,
        apiSecret: env.LIVEKIT_API_SECRET,
        identity: resolvedIdentity,
        name: participantName,
        roomName: resolvedRoom,
        ttlSeconds: 14400,
        metadata: JSON.stringify({
          role: 'erp_operator',
          workstation: 'bancada',
          erpMode: env.ERP_MODE,
        }),
      });

      logger.info(
        {
          event: 'livekit_token_issued',
          roomName: resolvedRoom,
          participantIdentity: resolvedIdentity,
        },
        'Token de acesso à sala LiveKit gerado com sucesso',
      );

      // Despacha o agente de voz imediatamente para esta nova sala isolada
      try {
        const livekitHost = env.LIVEKIT_URL.replace('wss://', 'https://');
        const dispatchClient = new AgentDispatchClient(
          livekitHost,
          env.LIVEKIT_API_KEY,
          env.LIVEKIT_API_SECRET,
        );
        await dispatchClient.createDispatch(resolvedRoom, env.LIVEKIT_AGENT_NAME);
        logger.info(
          { agentName: env.LIVEKIT_AGENT_NAME, room: resolvedRoom },
          'Agente de voz despachado com sucesso para a sala',
        );
      } catch (dispatchErr: any) {
        logger.warn({ err: dispatchErr?.message ?? dispatchErr }, 'Aviso ao despachar agente');
      }

      res.json({
        serverUrl: env.LIVEKIT_URL,
        roomName: resolvedRoom,
        participantName,
        participantIdentity: resolvedIdentity,
        token,
        erpMode: env.ERP_MODE,
      });
    } catch (error) {
      logger.error({ err: error }, 'Erro ao gerar token LiveKit');
      res.status(500).json({
        error: 'Não foi possível gerar o token de acesso ao LiveKit. Verifique LIVEKIT_API_KEY e LIVEKIT_API_SECRET.',
      });
    }
  });

  // 3. Métricas de observabilidade e auditoria operacional
  app.get('/api/metrics', (_req: Request, res: Response) => {
    res.json(metrics.getSnapshot());
  });

  // 4. Status do mapeamento de endpoints do ERP e resumo das OS em modo demonstração
  app.get('/api/erp/mapping', (_req: Request, res: Response) => {
    const endpoints = Object.values(ERP_ENDPOINTS_CONFIG).map((ep) => ({
      operation: ep.operation,
      method: ep.method,
      pathTemplate: ep.pathTemplate,
      isMutation: ep.isMutation,
      contractStatus: ep.contractStatus,
      description: ep.description,
    }));

    const sampleOrders =
      defaultErpClient.mode === 'mock' ? defaultErpClient.mockStore.listarTodasOS() : [];

    res.json({
      erpMode: env.ERP_MODE,
      baseUrl: env.ERP_API_BASE_URL,
      endpoints,
      sampleOrders,
    });
  });

  // 5. Healthcheck simples para proxies e monitoramento de deploy (Render, AWS, GCP)
  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).send('OK');
  });

  // 6. Servir a interface Web compilada do Vite (React) em produção
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidateDistPaths = [
    path.resolve(process.cwd(), 'apps/web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(__dirname, '../../web/dist'),
  ];
  const webDistPath = candidateDistPaths.find((p) => fs.existsSync(p));

  if (webDistPath) {
    logger.info({ webDistPath }, 'Interface Web localizada: servindo arquivos estáticos');
    app.use(express.static(webDistPath));
    app.get('*', (req: Request, res: Response, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(webDistPath, 'index.html'));
    });
  } else {
    // Fallback amigável caso o build do frontend ainda não tenha sido executado
    app.get('/', (_req: Request, res: Response) => {
      res.status(200).json({
        service: 'Inovar Voice ERP Assistant API',
        status: 'online',
        message: 'API ativa. Para a interface gráfica, execute npm run build no workspace web.',
        endpoints: {
          health: '/api/health',
          metrics: '/api/metrics',
          erpMapping: '/api/erp/mapping',
        },
      });
    });
  }

  return app;
}

if (!process.env.VITEST) {
  const app = createApiServer();
  const host = '0.0.0.0';
  const port = Number(process.env.PORT) || env.PORT;
  app.listen(port, host, () => {
    logger.info(
      { port, host, erpMode: env.ERP_MODE },
      `Servidor auxiliar de Tokens, Interface Web e Observabilidade rodando em http://${host}:${port}`,
    );
  });
}
