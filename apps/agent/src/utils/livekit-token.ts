import jwt from 'jsonwebtoken';
import https from 'node:https';

let cachedOffsetSeconds = 0;
let lastSyncedAt = 0;

/**
 * Consulta a data GMT real via cabeçalho HTTP para calcular o desvio do relógio local (Clock Skew).
 */
export async function syncClockSkew(): Promise<number> {
  const now = Date.now();
  // Atualiza no máximo a cada 10 minutos
  if (now - lastSyncedAt < 600000 && lastSyncedAt !== 0) {
    return cachedOffsetSeconds;
  }

  return new Promise((resolve) => {
    try {
      const req = https.get('https://google.com', { timeout: 3000 }, (res) => {
        const serverDateHeader = res.headers.date;
        if (serverDateHeader) {
          const serverUnix = Math.floor(new Date(serverDateHeader).getTime() / 1000);
          const localUnix = Math.floor(Date.now() / 1000);
          // offset = tempo_real - tempo_local (se relógio local estiver adiantado em 140s, offset será -140s)
          cachedOffsetSeconds = serverUnix - localUnix;
          lastSyncedAt = Date.now();
        }
        resolve(cachedOffsetSeconds);
      });
      req.on('error', () => resolve(cachedOffsetSeconds));
      req.on('timeout', () => {
        req.destroy();
        resolve(cachedOffsetSeconds);
      });
    } catch {
      resolve(cachedOffsetSeconds);
    }
  });
}

export function getAccurateUnixTimestamp(): number {
  return Math.floor(Date.now() / 1000) + cachedOffsetSeconds;
}

/**
 * Cria um JWT LiveKit com compensação de relógio para evitar rejeição por nbf/iat adiantado.
 */
export async function generateSkewCompensatedLiveKitToken(params: {
  apiKey: string;
  apiSecret: string;
  identity: string;
  name?: string;
  roomName: string;
  ttlSeconds?: number;
  metadata?: string;
}): Promise<string> {
  await syncClockSkew();
  const now = getAccurateUnixTimestamp();
  const ttl = params.ttlSeconds ?? 14400; // 4 horas

  const payload = {
    iss: params.apiKey,
    sub: params.identity,
    name: params.name ?? params.identity,
    iat: now,
    nbf: now - 30, // 30 segundos de tolerância para o passado
    exp: now + ttl,
    metadata: params.metadata,
    video: {
      roomJoin: true,
      room: params.roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };

  return jwt.sign(payload, params.apiSecret, {
    algorithm: 'HS256',
    header: { alg: 'HS256', typ: 'JWT' },
  });
}
