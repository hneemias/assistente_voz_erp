import type {
  ErpMappingResponse,
  HealthStatus,
  MetricsSnapshot,
  TokenResponse,
} from '../types/assistant.ts';

const rawApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') || '';

// Se estiver no navegador fora do localhost (ex: no Render) e a variável apontar para localhost,
// usa caminho relativo "" para bater diretamente no mesmo servidor que entregou o frontend.
const API_BASE =
  typeof window !== 'undefined' &&
  window.location.hostname !== 'localhost' &&
  window.location.hostname !== '127.0.0.1' &&
  rawApiBase.includes('localhost')
    ? ''
    : rawApiBase;

export async function fetchHealthStatus(): Promise<HealthStatus> {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) {
    throw new Error(`Falha ao consultar status do servidor (${res.status})`);
  }
  return res.json() as Promise<HealthStatus>;
}

export async function requestLiveKitToken(params: {
  participantName: string;
  roomName?: string;
}): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      (errBody as { error?: string }).error || `Erro HTTP ${res.status} ao solicitar token LiveKit`,
    );
  }

  return res.json() as Promise<TokenResponse>;
}

export async function fetchMetricsSnapshot(): Promise<MetricsSnapshot> {
  const res = await fetch(`${API_BASE}/api/metrics`);
  if (!res.ok) {
    throw new Error(`Erro ao carregar métricas (${res.status})`);
  }
  return res.json() as Promise<MetricsSnapshot>;
}

export async function fetchErpMapping(): Promise<ErpMappingResponse> {
  const res = await fetch(`${API_BASE}/api/erp/mapping`);
  if (!res.ok) {
    throw new Error(`Erro ao carregar mapeamento do ERP (${res.status})`);
  }
  return res.json() as Promise<ErpMappingResponse>;
}
