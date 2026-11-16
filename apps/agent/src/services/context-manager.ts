import crypto from 'node:crypto';
import { defaultErpClient, type ErpClient } from '../integrations/erp/erp-client.ts';
import type {
  ExecutedMutationRecord,
  PendingMutation,
  PendingMutationPayload,
  SessionUserData,
} from '../types/session-types.ts';

export function createSessionUserData(params?: {
  sessionId?: string;
  userId?: string;
  erpClient?: ErpClient;
}): SessionUserData {
  return {
    sessionId: params?.sessionId ?? `sess-${crypto.randomUUID().slice(0, 8)}`,
    userId: params?.userId ?? 'operador-bancada-01',
    activeOsNumber: null,
    lastConsultedOsSummary: null,
    lastProductCandidates: [],
    pendingMutation: null,
    manualUserTurnIndex: 1,
    executedMutations: new Map<string, ExecutedMutationRecord>(),
    erpClient: params?.erpClient ?? defaultErpClient,
  };
}

/**
 * Obtém o índice do turno atual do usuário.
 * Combina a contagem de mensagens reais do usuário na sessão LiveKit (quando disponível)
 * com o contador manual (para testes unitários diretos de ferramentas).
 */
export function getCurrentUserTurnIndex(
  userData: SessionUserData,
  sessionHistoryItems?: Array<{ type?: string; role?: string }>,
): number {
  if (sessionHistoryItems && Array.isArray(sessionHistoryItems)) {
    const userMsgCount = sessionHistoryItems.filter(
      (item) => item.type === 'message' && item.role === 'user',
    ).length;
    if (userMsgCount > 0) {
      return Math.max(userMsgCount, userData.manualUserTurnIndex);
    }
  }
  return userData.manualUserTurnIndex;
}

/**
 * Avança o turno manual da sessão (utilizado em testes diretos de ferramentas sem AgentSession).
 */
export function advanceUserTurn(userData: SessionUserData): number {
  userData.manualUserTurnIndex += 1;
  return userData.manualUserTurnIndex;
}

/**
 * Resolve o número da OS a partir do parâmetro informado ou do contexto conversacional ativo.
 */
export function resolveTargetOsNumber(
  userData: SessionUserData,
  explicitOsNumber?: string | number | null,
): string | null {
  if (explicitOsNumber !== undefined && explicitOsNumber !== null) {
    const cleaned = String(explicitOsNumber).replace(/\D+/g, '').trim() || String(explicitOsNumber).trim();
    if (
      cleaned !== '' &&
      !['nela', 'dela', 'atual', 'mesma', 'essa', 'esta'].includes(cleaned.toLowerCase())
    ) {
      return cleaned;
    }
  }
  return userData.activeOsNumber;
}

/**
 * Atualiza a OS ativa no contexto conversacional da sessão.
 */
export function setActiveOsContext(
  userData: SessionUserData,
  osNumber: string,
  summary?: SessionUserData['lastConsultedOsSummary'],
): void {
  const cleaned = String(osNumber).trim();
  // Se o operador mudou de OS, qualquer mutação pendente da OS anterior deixa de ser válida
  if (
    userData.pendingMutation &&
    userData.pendingMutation.osNumber !== cleaned
  ) {
    userData.pendingMutation = null;
  }
  userData.activeOsNumber = cleaned;
  if (summary !== undefined) {
    userData.lastConsultedOsSummary = summary;
  }
}

/**
 * Registra uma operação de escrita pendente que exige confirmação explícita do usuário no próximo turno.
 */
export function stagePendingMutation(params: {
  userData: SessionUserData;
  operation: PendingMutation['operation'];
  osNumber: string;
  payload: PendingMutationPayload;
  summaryForSpeech: string;
  currentTurnIndex: number;
}): PendingMutation {
  const canonicalPayload = JSON.stringify({
    op: params.operation,
    os: params.osNumber,
    ...params.payload,
  });
  const hash = crypto.createHash('sha256').update(canonicalPayload).digest('hex').slice(0, 16);
  const idempotencyKey = `idem-${params.userData.sessionId}-${params.operation}-${hash}`;

  const pending: PendingMutation = {
    mutationId: `mut-${crypto.randomUUID().slice(0, 8)}`,
    operation: params.operation,
    osNumber: params.osNumber,
    payload: params.payload,
    summaryForSpeech: params.summaryForSpeech,
    stagedAtUserTurn: params.currentTurnIndex,
    stagedAtIso: new Date().toISOString(),
    idempotencyKey,
  };

  params.userData.pendingMutation = pending;
  return pending;
}

export interface ConfirmationCheckResult {
  allowed: boolean;
  reason?: string;
  pendingMutation?: PendingMutation;
  alreadyExecuted?: ExecutedMutationRecord;
}

/**
 * Verifica se uma mutação pode ser efetivada no ERP:
 * 1. O parâmetro `confirmado_pelo_usuario` deve ser `true`.
 * 2. Deve existir uma `pendingMutation` correspondente para a mesma operação e OS.
 * 3. O turno atual do usuário deve ser estritamente posterior ao turno em que a revisão foi gerada.
 * 4. Se a mesma chave de idempotência já sofreu timeout inconclusivo ou já foi executada, impede duplicação.
 */
export function verifyConfirmationGate(params: {
  userData: SessionUserData;
  operation: PendingMutation['operation'];
  osNumber: string;
  confirmedByUserFlag: boolean;
  currentTurnIndex: number;
}): ConfirmationCheckResult {
  const { userData, operation, osNumber, confirmedByUserFlag, currentTurnIndex } = params;
  const pending = userData.pendingMutation;

  if (!confirmedByUserFlag) {
    return {
      allowed: false,
      reason: 'NOT_CONFIRMED_FLAG',
    };
  }

  if (!pending) {
    return {
      allowed: false,
      reason: 'NO_PENDING_MUTATION',
    };
  }

  if (pending.operation !== operation || pending.osNumber !== osNumber) {
    return {
      allowed: false,
      reason: 'MISMATCHED_PENDING_MUTATION',
    };
  }

  const prevRecord = userData.executedMutations.get(pending.idempotencyKey);
  if (prevRecord) {
    return {
      allowed: false,
      reason:
        prevRecord.status === 'INCONCLUSIVE_TIMEOUT'
          ? 'PREVIOUS_ATTEMPT_TIMED_OUT'
          : 'ALREADY_COMMITTED',
      alreadyExecuted: prevRecord,
    };
  }

  if (currentTurnIndex <= pending.stagedAtUserTurn) {
    return {
      allowed: false,
      reason: 'SAME_TURN_APPROVAL_FORBIDDEN',
      pendingMutation: pending,
    };
  }

  return {
    allowed: true,
    pendingMutation: pending,
  };
}

export function cancelPendingMutation(userData: SessionUserData): PendingMutation | null {
  const existing = userData.pendingMutation;
  userData.pendingMutation = null;
  return existing;
}
