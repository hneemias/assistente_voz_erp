import type { ErpClient } from '../integrations/erp/erp-client.ts';
import type {
  ErpOperationName,
  OrdemServicoResumo,
  ProdutoERP,
  StatusOS,
} from '../integrations/erp/erp-types.ts';

export interface PendingMutationPayload {
  numero_os: string;
  status?: StatusOS;
  produto_id?: string;
  produto_nome?: string;
  produto_unidade?: string;
  preco_unitario?: number;
  servico_id?: string;
  servico_descricao?: string;
  valor_unitario?: number;
  item_id?: string;
  item_identificador?: string;
  item_descricao?: string;
  nova_quantidade?: number | null;
  novo_valor_unitario?: number | null;
  quantidade?: number;
  valor_total_operacao?: number;
}

export interface PendingMutation {
  mutationId: string;
  operation: Extract<
    ErpOperationName,
    | 'alterar_status_os'
    | 'adicionar_produto_os'
    | 'remover_produto_os'
    | 'adicionar_servico_os'
    | 'remover_servico_os'
    | 'editar_item_os'
  >;
  osNumber: string;
  payload: PendingMutationPayload;
  summaryForSpeech: string;
  stagedAtUserTurn: number;
  stagedAtIso: string;
  idempotencyKey: string;
}

export interface ExecutedMutationRecord {
  idempotencyKey: string;
  operation: ErpOperationName;
  osNumber: string;
  executedAtIso: string;
  status: 'COMMITTED' | 'INCONCLUSIVE_TIMEOUT';
  resultSummary: string;
}

export interface SessionUserData {
  sessionId: string;
  userId: string;
  activeOsNumber: string | null;
  lastConsultedOsSummary: OrdemServicoResumo | null;
  lastProductCandidates: ProdutoERP[];
  pendingMutation: PendingMutation | null;
  manualUserTurnIndex: number;
  executedMutations: Map<string, ExecutedMutationRecord>;
  erpClient: ErpClient;
}
