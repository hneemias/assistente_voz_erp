export interface TokenResponse {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantIdentity: string;
  token: string;
  erpMode: 'mock' | 'live';
}

export interface HealthStatus {
  status: string;
  service: string;
  timestamp: string;
  erp: {
    mode: 'mock' | 'live';
    baseUrl: string;
    productionReady: boolean;
  };
  aiProviders: {
    llmProvider: string;
    llmModel: string;
    sttProvider: string;
    sttLanguage: string;
    ttsProvider: string;
  };
  livekit: {
    url: string;
    agentName: string;
    configured: boolean;
  };
}

export interface ToolMetricItem {
  toolName: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  confirmationRequiredCount: number;
  avgDurationMs: number;
  lastCalledAt: string | null;
}

export interface MetricsSnapshot {
  uptimeSeconds: number;
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  timeoutOperations: number;
  confirmationsRequested: number;
  confirmationsApproved: number;
  confirmationsCancelled: number;
  averageResponseTimeMs: number;
  tools: Record<string, ToolMetricItem>;
}

export interface ErpOrderSummary {
  numero_os: string;
  cliente_nome: string;
  veiculo_equipamento?: string;
  status: string;
  dias_aberta: number;
  aguardando_produto: boolean;
  valor_total: number;
  quantidade_itens: number;
}

export interface ErpEndpointInfo {
  operation: string;
  method: string;
  pathTemplate: string;
  isMutation: boolean;
  contractStatus: 'PENDING_CONTRACT' | 'CONFIGURED';
  description: string;
}

export interface ErpMappingResponse {
  erpMode: 'mock' | 'live';
  baseUrl: string;
  endpoints: ErpEndpointInfo[];
  sampleOrders: ErpOrderSummary[];
}

export interface TranscriptItem {
  id: string;
  speaker: 'operator' | 'agent';
  text: string;
  timestamp: string;
  isFinal: boolean;
}
