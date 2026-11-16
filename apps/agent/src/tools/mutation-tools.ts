import { llm } from '@livekit/agents';
import { z } from 'zod';
import { ErpError, ErpTimeoutError } from '../integrations/erp/erp-errors.ts';
import type { StatusOS } from '../integrations/erp/erp-types.ts';
import {
  cancelPendingMutation,
  getCurrentUserTurnIndex,
  resolveTargetOsNumber,
  setActiveOsContext,
  stagePendingMutation,
  verifyConfirmationGate,
} from '../services/context-manager.ts';
import { resolveProductForOperation } from '../services/product-resolver.ts';
import type { SessionUserData } from '../types/session-types.ts';
import { logToolAudit } from '../utils/logger.ts';
import { metrics } from '../utils/metrics.ts';

import { formatStatusLabel } from './query-tools.ts';

const statusOsEnum = z.enum([
  'em_aberto',
  'em_processo',
  'em_processo_terceiros',
  'aguardando_autorizacao',
  'aguardando_peca',
  'concluido',
  'finalizado',
  'cancelada',
  'nao_aprovado',
  // Retrocompatibilidade / aliases
  'aberta',
  'em_andamento',
  'aguardando_pecas',
  'aguardando_aprovacao',
  'concluida',
]);

export interface MutationToolResponse<T = unknown> {
  status:
    | 'CONFIRMATION_REQUIRED'
    | 'COMMITTED'
    | 'AMBIGUOUS'
    | 'NOT_FOUND'
    | 'INSUFFICIENT_STOCK'
    | 'CANCELLED'
    | 'INCONCLUSIVE_TIMEOUT'
    | 'ERROR';
  messageForSpeech: string;
  data?: T;
  erpMode: 'mock' | 'live';
  activeOsNumber: string | null;
}

export interface MutationExecutionContext {
  userData: SessionUserData;
  sessionHistoryItems?: Array<{ type?: string; role?: string }>;
  disallowInterruptions?: () => void;
}

function handleMutationError(
  error: unknown,
  toolName: string,
  intent: string,
  userData: SessionUserData,
  startTime: number,
  osNumber: string,
  idempotencyKey?: string,
): MutationToolResponse {
  const durationMs = Math.max(1, Date.now() - startTime);
  const isTimeout = error instanceof ErpTimeoutError || (error instanceof ErpError && error.code === 'ERP_TIMEOUT');
  const httpStatus = error instanceof ErpError ? error.httpStatus : null;
  const errorCode = error instanceof ErpError ? error.code : 'UNEXPECTED_ERROR';
  const errorMessage = error instanceof Error ? error.message : String(error);

  metrics.recordToolCall({
    toolName,
    durationMs,
    outcome: isTimeout ? 'TIMEOUT' : 'ERROR',
  });

  logToolAudit({
    sessionId: userData.sessionId,
    userId: userData.userId,
    intent,
    toolName,
    durationMs,
    httpStatus,
    operationResult: isTimeout ? 'TIMEOUT' : 'ERROR',
    osNumber,
    isMutation: true,
    erpMode: userData.erpClient.mode,
    errorCode,
    errorMessage,
  });

  if (isTimeout) {
    if (idempotencyKey) {
      userData.executedMutations.set(idempotencyKey, {
        idempotencyKey,
        operation: toolName as any,
        osNumber,
        executedAtIso: new Date().toISOString(),
        status: 'INCONCLUSIVE_TIMEOUT',
        resultSummary: errorMessage,
      });
    }
    userData.pendingMutation = null;
    return {
      status: 'INCONCLUSIVE_TIMEOUT',
      messageForSpeech:
        `A comunicação com o ERP excedeu o tempo limite durante a alteração na OS ${osNumber}. ` +
        `Por segurança, a operação não foi repetida automaticamente e não é possível confirmar se foi concluída. Recomende consultar a OS antes de tentar novamente.`,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  }

  return {
    status: 'ERROR',
    messageForSpeech: `Não foi possível concluir a operação na OS ${osNumber}: ${errorMessage}`,
    erpMode: userData.erpClient.mode,
    activeOsNumber: userData.activeOsNumber,
  };
}

// ============================================================================
// 11. alterar_status_os(numero_os, status, confirmado_pelo_usuario)
// ============================================================================
export const alterarStatusOsSchema = z.object({
  numero_os: z
    .string()
    .nullable()
    .optional()
    .describe('Número da OS (ex: "3030"). Se omitido ou nulo, usa a OS ativa no contexto.'),
  status: statusOsEnum.describe(
    'Novo status desejado para a OS: "em_aberto", "em_processo", "em_processo_terceiros", "aguardando_autorizacao", "aguardando_peca", "concluido" (serviço pronto aguardando pagamento), "finalizado" (serviço finalizado e pago), "cancelada" ou "nao_aprovado".',
  ),
  confirmado_pelo_usuario: z
    .boolean()
    .default(false)
    .describe(
      'Passe false na primeira chamada para registrar a revisão e pedir confirmação ao operador. Passe true SOMENTE no turno seguinte após o operador confirmar explicitamente.',
    ),
});

export async function executeAlterarStatusOs(
  args: z.infer<typeof alterarStatusOsSchema>,
  execCtx: MutationExecutionContext,
): Promise<MutationToolResponse> {
  const startTime = Date.now();
  const { userData } = execCtx;
  const targetOs = resolveTargetOsNumber(userData, args.numero_os);

  if (!targetOs) {
    throw new llm.ToolError(
      'Número da OS não informado e não há OS ativa no contexto. Pergunte ao operador qual OS deseja alterar.',
    );
  }

  const currentTurn = getCurrentUserTurnIndex(userData, execCtx.sessionHistoryItems);
  const gate = verifyConfirmationGate({
    userData,
    operation: 'alterar_status_os',
    osNumber: targetOs,
    confirmedByUserFlag: Boolean(args.confirmado_pelo_usuario),
    currentTurnIndex: currentTurn,
  });

  if (gate.alreadyExecuted) {
    return {
      status:
        gate.alreadyExecuted.status === 'INCONCLUSIVE_TIMEOUT'
          ? 'INCONCLUSIVE_TIMEOUT'
          : 'COMMITTED',
      messageForSpeech: gate.alreadyExecuted.resultSummary,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  }

  if (!gate.allowed) {
    try {
      const osAtual = await userData.erpClient.consultarOS(targetOs);
      setActiveOsContext(userData, targetOs, osAtual.data);

      const summary = `Confirma a alteração do status da OS ${targetOs} (cliente ${osAtual.data.cliente_nome}) de ${formatStatusLabel(osAtual.data.status)} para ${formatStatusLabel(args.status)}?`;
      const pending =
        gate.reason === 'SAME_TURN_APPROVAL_FORBIDDEN' && gate.pendingMutation
          ? gate.pendingMutation
          : stagePendingMutation({
              userData,
              operation: 'alterar_status_os',
              osNumber: targetOs,
              payload: {
                numero_os: targetOs,
                status: args.status as StatusOS,
              },
              summaryForSpeech: summary,
              currentTurnIndex: currentTurn,
            });

      const durationMs = Math.max(1, Date.now() - startTime);
      metrics.recordToolCall({
        toolName: 'alterar_status_os',
        durationMs,
        outcome: 'CONFIRMATION_REQUIRED',
      });
      logToolAudit({
        sessionId: userData.sessionId,
        userId: userData.userId,
        intent: 'solicitar_confirmacao_alterar_status_os',
        toolName: 'alterar_status_os',
        durationMs,
        operationResult: 'CONFIRMATION_REQUIRED',
        osNumber: targetOs,
        isMutation: true,
        erpMode: userData.erpClient.mode,
      });

      return {
        status: 'CONFIRMATION_REQUIRED',
        messageForSpeech: `CONFIRMAÇÃO OBRIGATÓRIA: Pergunte ao operador: "${pending.summaryForSpeech}" e aguarde a resposta dele antes de confirmar.`,
        data: { pendingMutationId: pending.mutationId, numero_os: targetOs, novo_status: args.status },
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    } catch (err) {
      return handleMutationError(
        err,
        'alterar_status_os',
        'alterar_status_os',
        userData,
        startTime,
        targetOs,
      );
    }
  }

  // Confirmação válida em turno posterior -> Executa no ERP!
  const pending = gate.pendingMutation!;
  execCtx.disallowInterruptions?.();

  try {
    const res = await userData.erpClient.alterarStatusOS(targetOs, args.status as StatusOS, {
      idempotencyKey: pending.idempotencyKey,
    });
    userData.pendingMutation = null;
    setActiveOsContext(userData, targetOs, res.data);
    metrics.recordConfirmationApproved();

    const durationMs = Math.max(1, Date.now() - startTime);
    metrics.recordToolCall({ toolName: 'alterar_status_os', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'executar_alterar_status_os',
      toolName: 'alterar_status_os',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      osNumber: targetOs,
      isMutation: true,
      erpMode: userData.erpClient.mode,
    });

    const modeSuffix =
      userData.erpClient.mode === 'mock' ? ' (registrado em modo de demonstração/mock).' : '.';
    const speech = `Status da OS ${targetOs} atualizado com sucesso para ${formatStatusLabel(res.data.status)}${modeSuffix}`;

    userData.executedMutations.set(pending.idempotencyKey, {
      idempotencyKey: pending.idempotencyKey,
      operation: 'alterar_status_os',
      osNumber: targetOs,
      executedAtIso: new Date().toISOString(),
      status: 'COMMITTED',
      resultSummary: speech,
    });

    return {
      status: 'COMMITTED',
      messageForSpeech: speech,
      data: res.data,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleMutationError(
      err,
      'alterar_status_os',
      'executar_alterar_status_os',
      userData,
      startTime,
      targetOs,
      pending.idempotencyKey,
    );
  }
}

// ============================================================================
// 12. adicionar_produto_os(numero_os, produto_id, quantidade, confirmado_pelo_usuario)
// ============================================================================
export const adicionarProdutoOsSchema = z.object({
  numero_os: z
    .string()
    .nullable()
    .optional()
    .describe('Número da OS (ex: "3030"). Se omitido ou nulo, utiliza a OS ativa no contexto.'),
  produto_id: z
    .string()
    .min(1)
    .describe(
      'Código, ID ou nome do produto solicitado (ex: "125", "PROD-201", "filtro de óleo", "óleo 5W30").',
    ),
  quantidade: z
    .number()
    .min(0.01)
    .describe('Quantidade do produto a ser adicionada (maior que zero).'),
  preco_unitario: z
    .number()
    .min(0)
    .nullable()
    .optional()
    .describe('Preço unitário personalizado em reais. Se omitido, utiliza o preço padrão de tabela cadastrado.'),
  confirmado_pelo_usuario: z
    .boolean()
    .default(false)
    .describe(
      'Passe false na primeira chamada para validar estoque/preço e pedir confirmação ao operador. Passe true SOMENTE no turno seguinte após confirmação explícita.',
    ),
});

export async function executeAdicionarProdutoOs(
  args: z.infer<typeof adicionarProdutoOsSchema>,
  execCtx: MutationExecutionContext,
): Promise<MutationToolResponse> {
  const startTime = Date.now();
  const { userData } = execCtx;
  const targetOs = resolveTargetOsNumber(userData, args.numero_os);

  if (!targetOs) {
    throw new llm.ToolError(
      'Número da OS não informado e não há OS ativa no contexto. Pergunte ao operador em qual OS deseja adicionar o produto.',
    );
  }

  // 1. Verifica se a OS existe
  try {
    const osCheck = await userData.erpClient.consultarOS(targetOs);
    setActiveOsContext(userData, targetOs, osCheck.data);
  } catch (err) {
    return handleMutationError(
      err,
      'adicionar_produto_os',
      'validar_os_para_adicao_produto',
      userData,
      startTime,
      targetOs,
    );
  }

  // 2. Resolve o produto (código exato ou nome falado), checando ambiguidades e estoque
  const resolution = await resolveProductForOperation({
    erpClient: userData.erpClient,
    produtoIdentificador: args.produto_id,
    quantidade: args.quantidade,
  });

  if (resolution.status === 'NOT_FOUND') {
    const durationMs = Math.max(1, Date.now() - startTime);
    metrics.recordToolCall({ toolName: 'adicionar_produto_os', durationMs, outcome: 'ERROR' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'produto_inexistente_adicao_os',
      toolName: 'adicionar_produto_os',
      durationMs,
      operationResult: 'ERROR',
      osNumber: targetOs,
      isMutation: true,
      erpMode: userData.erpClient.mode,
      errorCode: 'PRODUCT_NOT_FOUND',
      errorMessage: resolution.messageForAgent,
    });
    return {
      status: 'NOT_FOUND',
      messageForSpeech: resolution.messageForAgent,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  }

  if (resolution.status === 'AMBIGUOUS') {
    userData.lastProductCandidates = resolution.candidates;
    const durationMs = Math.max(1, Date.now() - startTime);
    metrics.recordToolCall({ toolName: 'adicionar_produto_os', durationMs, outcome: 'AMBIGUOUS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'produto_ambiguo_adicao_os',
      toolName: 'adicionar_produto_os',
      durationMs,
      operationResult: 'AMBIGUOUS',
      osNumber: targetOs,
      isMutation: true,
      erpMode: userData.erpClient.mode,
    });
    return {
      status: 'AMBIGUOUS',
      messageForSpeech: resolution.messageForAgent,
      data: { candidatos: resolution.candidates },
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  }

  if (resolution.status === 'INSUFFICIENT_STOCK') {
    const durationMs = Math.max(1, Date.now() - startTime);
    metrics.recordToolCall({ toolName: 'adicionar_produto_os', durationMs, outcome: 'ERROR' });
    return {
      status: 'INSUFFICIENT_STOCK',
      messageForSpeech: resolution.messageForAgent,
      data: { produto: resolution.product },
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  }

  const product = resolution.product;
  const precoFinal =
    args.preco_unitario !== undefined && args.preco_unitario !== null ? args.preco_unitario : product.preco_venda;
  const subtotal = Math.round(precoFinal * args.quantidade * 100) / 100;
  const currentTurn = getCurrentUserTurnIndex(userData, execCtx.sessionHistoryItems);

  const gate = verifyConfirmationGate({
    userData,
    operation: 'adicionar_produto_os',
    osNumber: targetOs,
    confirmedByUserFlag: Boolean(args.confirmado_pelo_usuario),
    currentTurnIndex: currentTurn,
  });

  if (gate.alreadyExecuted) {
    return {
      status:
        gate.alreadyExecuted.status === 'INCONCLUSIVE_TIMEOUT'
          ? 'INCONCLUSIVE_TIMEOUT'
          : 'COMMITTED',
      messageForSpeech: gate.alreadyExecuted.resultSummary,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  }

  if (!gate.allowed) {
    const summary = `Confirma adicionar ${args.quantidade} ${product.unidade} de ${product.nome} (código ${product.codigo}, ${precoFinal.toFixed(2)} reais cada, subtotal ${subtotal.toFixed(2)} reais) na OS ${targetOs}?`;
    const pending =
      gate.reason === 'SAME_TURN_APPROVAL_FORBIDDEN' && gate.pendingMutation
        ? gate.pendingMutation
        : stagePendingMutation({
            userData,
            operation: 'adicionar_produto_os',
            osNumber: targetOs,
            payload: {
              numero_os: targetOs,
              produto_id: product.produto_id,
              produto_nome: product.nome,
              produto_unidade: product.unidade,
              preco_unitario: precoFinal,
              quantidade: args.quantidade,
              valor_total_operacao: subtotal,
            },
            summaryForSpeech: summary,
            currentTurnIndex: currentTurn,
          });

    const durationMs = Math.max(1, Date.now() - startTime);
    metrics.recordToolCall({
      toolName: 'adicionar_produto_os',
      durationMs,
      outcome: 'CONFIRMATION_REQUIRED',
    });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'solicitar_confirmacao_adicionar_produto_os',
      toolName: 'adicionar_produto_os',
      durationMs,
      operationResult: 'CONFIRMATION_REQUIRED',
      osNumber: targetOs,
      isMutation: true,
      erpMode: userData.erpClient.mode,
    });

    return {
      status: 'CONFIRMATION_REQUIRED',
      messageForSpeech: `CONFIRMAÇÃO OBRIGATÓRIA: Informe o produto, quantidade e valor ao operador e pergunte: "${pending.summaryForSpeech}"`,
      data: {
        pendingMutationId: pending.mutationId,
        produto: product,
        quantidade: args.quantidade,
        subtotal,
      },
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  }

  // Confirmação válida em turno posterior -> Executa a adição no ERP!
  const pending = gate.pendingMutation!;
  execCtx.disallowInterruptions?.();

  try {
    const res = await userData.erpClient.adicionarProdutoOS(
      targetOs,
      product.produto_id,
      args.quantidade,
      precoFinal,
      { idempotencyKey: pending.idempotencyKey },
    );
    userData.pendingMutation = null;
    metrics.recordConfirmationApproved();

    const durationMs = Math.max(1, Date.now() - startTime);
    metrics.recordToolCall({ toolName: 'adicionar_produto_os', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'executar_adicionar_produto_os',
      toolName: 'adicionar_produto_os',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      osNumber: targetOs,
      isMutation: true,
      erpMode: userData.erpClient.mode,
    });

    const { item_adicionado, totais } = res.data;
    const speech = `Adicionado com sucesso: ${item_adicionado.quantidade} ${item_adicionado.unidade} de ${item_adicionado.nome} na OS ${targetOs}. O novo total da OS é de ${totais.valor_total.toFixed(2)} reais.`;

    userData.executedMutations.set(pending.idempotencyKey, {
      idempotencyKey: pending.idempotencyKey,
      operation: 'adicionar_produto_os',
      osNumber: targetOs,
      executedAtIso: new Date().toISOString(),
      status: 'COMMITTED',
      resultSummary: speech,
    });

    return {
      status: 'COMMITTED',
      messageForSpeech: speech,
      data: res.data,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleMutationError(
      err,
      'adicionar_produto_os',
      'executar_adicionar_produto_os',
      userData,
      startTime,
      targetOs,
      pending.idempotencyKey,
    );
  }
}

// ============================================================================
// 13. remover_produto_os(numero_os, item_id, confirmado_pelo_usuario)
// ============================================================================
export const removerProdutoOsSchema = z.object({
  numero_os: z
    .string()
    .nullable()
    .optional()
    .describe('Número da OS (ex: "3030"). Se omitido ou nulo, usa a OS ativa no contexto.'),
  item_id: z
    .string()
    .min(1)
    .describe(
      'ID do item na OS (ex: "ITEM-P-301"), código do produto (ex: "101") ou nome do produto a remover da OS.',
    ),
  confirmado_pelo_usuario: z
    .boolean()
    .default(false)
    .describe(
      'Passe false na primeira chamada para identificar o item exato e solicitar confirmação. Passe true SOMENTE no turno seguinte após confirmação do operador.',
    ),
});

export async function executeRemoverProdutoOs(
  args: z.infer<typeof removerProdutoOsSchema>,
  execCtx: MutationExecutionContext,
): Promise<MutationToolResponse> {
  const startTime = Date.now();
  const { userData } = execCtx;
  const targetOs = resolveTargetOsNumber(userData, args.numero_os);

  if (!targetOs) {
    throw new llm.ToolError(
      'Número da OS não informado e não há OS ativa no contexto. Pergunte ao operador de qual OS deseja remover o produto.',
    );
  }

  try {
    const itensRes = await userData.erpClient.listarItensOS(targetOs);
    setActiveOsContext(userData, targetOs);

    const search = args.item_id.trim().toLowerCase();
    const matchedItems = itensRes.data.produtos.filter(
      (p) =>
        p.item_id.toLowerCase() === search ||
        p.produto_id.toLowerCase() === search ||
        p.codigo.toLowerCase() === search ||
        p.nome.toLowerCase().includes(search),
    );

    if (matchedItems.length === 0) {
      return {
        status: 'NOT_FOUND',
        messageForSpeech: `Não foi encontrado nenhum produto correspondente a '${args.item_id}' na OS ${targetOs}.`,
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    }

    if (matchedItems.length > 1) {
      return {
        status: 'AMBIGUOUS',
        messageForSpeech:
          `Há mais de um item compatível com '${args.item_id}' na OS ${targetOs}: ` +
          matchedItems
            .map((i) => `${i.item_id} (${i.quantidade} ${i.unidade} de ${i.nome})`)
            .join('; ') +
          '. Pergunte ao operador qual deles deseja remover.',
        data: { candidatos: matchedItems },
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    }

    const itemAlvo = matchedItems[0]!;
    const currentTurn = getCurrentUserTurnIndex(userData, execCtx.sessionHistoryItems);
    const gate = verifyConfirmationGate({
      userData,
      operation: 'remover_produto_os',
      osNumber: targetOs,
      confirmedByUserFlag: Boolean(args.confirmado_pelo_usuario),
      currentTurnIndex: currentTurn,
    });

    if (gate.alreadyExecuted) {
      return {
        status:
          gate.alreadyExecuted.status === 'INCONCLUSIVE_TIMEOUT'
            ? 'INCONCLUSIVE_TIMEOUT'
            : 'COMMITTED',
        messageForSpeech: gate.alreadyExecuted.resultSummary,
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    }

    if (!gate.allowed) {
      const summary = `Confirma remover o item ${itemAlvo.quantidade} ${itemAlvo.unidade} de ${itemAlvo.nome} (subtotal ${itemAlvo.subtotal.toFixed(2)} reais) da OS ${targetOs}?`;
      const pending =
        gate.reason === 'SAME_TURN_APPROVAL_FORBIDDEN' && gate.pendingMutation
          ? gate.pendingMutation
          : stagePendingMutation({
              userData,
              operation: 'remover_produto_os',
              osNumber: targetOs,
              payload: {
                numero_os: targetOs,
                item_id: itemAlvo.item_id,
                item_descricao: itemAlvo.nome,
                quantidade: itemAlvo.quantidade,
                valor_total_operacao: itemAlvo.subtotal,
              },
              summaryForSpeech: summary,
              currentTurnIndex: currentTurn,
            });

      const durationMs = Math.max(1, Date.now() - startTime);
      metrics.recordToolCall({
        toolName: 'remover_produto_os',
        durationMs,
        outcome: 'CONFIRMATION_REQUIRED',
      });
      logToolAudit({
        sessionId: userData.sessionId,
        userId: userData.userId,
        intent: 'solicitar_confirmacao_remover_produto_os',
        toolName: 'remover_produto_os',
        durationMs,
        operationResult: 'CONFIRMATION_REQUIRED',
        osNumber: targetOs,
        isMutation: true,
        erpMode: userData.erpClient.mode,
      });

      return {
        status: 'CONFIRMATION_REQUIRED',
        messageForSpeech: `CONFIRMAÇÃO OBRIGATÓRIA: Pergunte ao operador: "${pending.summaryForSpeech}"`,
        data: { pendingMutationId: pending.mutationId, item: itemAlvo },
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    }

    const pending = gate.pendingMutation!;
    execCtx.disallowInterruptions?.();

    const res = await userData.erpClient.removerProdutoOS(targetOs, itemAlvo.item_id, {
      idempotencyKey: pending.idempotencyKey,
    });
    userData.pendingMutation = null;
    metrics.recordConfirmationApproved();

    const durationMs = Math.max(1, Date.now() - startTime);
    metrics.recordToolCall({ toolName: 'remover_produto_os', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'executar_remover_produto_os',
      toolName: 'remover_produto_os',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      osNumber: targetOs,
      isMutation: true,
      erpMode: userData.erpClient.mode,
    });

    const speech = `Produto ${res.data.item_removido.nome} removido com sucesso da OS ${targetOs}. Novo total da OS: ${res.data.totais.valor_total.toFixed(2)} reais.`;
    userData.executedMutations.set(pending.idempotencyKey, {
      idempotencyKey: pending.idempotencyKey,
      operation: 'remover_produto_os',
      osNumber: targetOs,
      executedAtIso: new Date().toISOString(),
      status: 'COMMITTED',
      resultSummary: speech,
    });

    return {
      status: 'COMMITTED',
      messageForSpeech: speech,
      data: res.data,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleMutationError(
      err,
      'remover_produto_os',
      'remover_produto_os',
      userData,
      startTime,
      targetOs,
      userData.pendingMutation?.idempotencyKey,
    );
  }
}

// ============================================================================
// 14. adicionar_servico_os(numero_os, servico_id, quantidade, confirmado_pelo_usuario)
// ============================================================================
export const adicionarServicoOsSchema = z.object({
  numero_os: z
    .string()
    .nullable()
    .optional()
    .describe('Número da OS (ex: "3030"). Se omitido ou nulo, usa a OS ativa no contexto.'),
  servico_id: z
    .string()
    .min(1)
    .describe('ID, código ou descrição do serviço (ex: "SRV-01", "S01", "troca de óleo").'),
  quantidade: z
    .number()
    .min(0.01)
    .default(1)
    .describe('Quantidade do serviço a adicionar (padrão: 1).'),
  valor_unitario: z
    .number()
    .min(0)
    .nullable()
    .optional()
    .describe('Valor unitário personalizado em reais para o serviço. Se omitido, usa o valor padrão cadastrado.'),
  confirmado_pelo_usuario: z
    .boolean()
    .default(false)
    .describe(
      'Passe false na primeira chamada para identificar o serviço e pedir confirmação ao operador. Passe true SOMENTE no turno seguinte após confirmação.',
    ),
});

export async function executeAdicionarServicoOs(
  args: z.infer<typeof adicionarServicoOsSchema>,
  execCtx: MutationExecutionContext,
): Promise<MutationToolResponse> {
  const startTime = Date.now();
  const { userData } = execCtx;
  const targetOs = resolveTargetOsNumber(userData, args.numero_os);

  if (!targetOs) {
    throw new llm.ToolError(
      'Número da OS não informado e não há OS ativa no contexto. Pergunte ao operador em qual OS deseja adicionar o serviço.',
    );
  }

  try {
    const osCheck = await userData.erpClient.consultarOS(targetOs);
    setActiveOsContext(userData, targetOs, osCheck.data);

    const catalogMatches = await userData.erpClient.buscarServicosCatalogo(args.servico_id);
    if (userData.erpClient.mode === 'mock' && catalogMatches.length === 0) {
      return {
        status: 'NOT_FOUND',
        messageForSpeech: `Nenhum serviço encontrado no catálogo para '${args.servico_id}'.`,
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    }

    if (catalogMatches.length > 1) {
      return {
        status: 'AMBIGUOUS',
        messageForSpeech:
          `Foram encontrados ${catalogMatches.length} serviços semelhantes: ` +
          catalogMatches
            .map((s) => `código ${s.codigo} (${s.descricao}, ${s.valor_padrao.toFixed(2)} reais)`)
            .join('; ') +
          '. Pergunte ao operador qual deles deseja adicionar.',
        data: { candidatos: catalogMatches },
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    }

    const resolvedSrv = catalogMatches[0];
    const srvId = resolvedSrv ? resolvedSrv.servico_id : args.servico_id;
    const srvDesc = resolvedSrv ? resolvedSrv.descricao : args.servico_id;
    const valorPadrao = resolvedSrv ? resolvedSrv.valor_padrao : 0;
    const valorUnitario =
      args.valor_unitario !== undefined && args.valor_unitario !== null ? args.valor_unitario : valorPadrao;
    const subtotal = Math.round(valorUnitario * args.quantidade * 100) / 100;

    const currentTurn = getCurrentUserTurnIndex(userData, execCtx.sessionHistoryItems);
    const gate = verifyConfirmationGate({
      userData,
      operation: 'adicionar_servico_os',
      osNumber: targetOs,
      confirmedByUserFlag: Boolean(args.confirmado_pelo_usuario),
      currentTurnIndex: currentTurn,
    });

    if (gate.alreadyExecuted) {
      return {
        status:
          gate.alreadyExecuted.status === 'INCONCLUSIVE_TIMEOUT'
            ? 'INCONCLUSIVE_TIMEOUT'
            : 'COMMITTED',
        messageForSpeech: gate.alreadyExecuted.resultSummary,
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    }

    if (!gate.allowed) {
      const summary =
        valorUnitario > 0
          ? `Confirma adicionar o serviço '${srvDesc}' (quantidade ${args.quantidade}, subtotal ${subtotal.toFixed(2)} reais) na OS ${targetOs}?`
          : `Confirma adicionar o serviço '${srvDesc}' (quantidade ${args.quantidade}) na OS ${targetOs}?`;

      const pending =
        gate.reason === 'SAME_TURN_APPROVAL_FORBIDDEN' && gate.pendingMutation
          ? gate.pendingMutation
          : stagePendingMutation({
              userData,
              operation: 'adicionar_servico_os',
              osNumber: targetOs,
              payload: {
                numero_os: targetOs,
                servico_id: srvId,
                servico_descricao: srvDesc,
                valor_unitario: valorUnitario,
                quantidade: args.quantidade,
                valor_total_operacao: subtotal,
              },
              summaryForSpeech: summary,
              currentTurnIndex: currentTurn,
            });

      const durationMs = Math.max(1, Date.now() - startTime);
      metrics.recordToolCall({
        toolName: 'adicionar_servico_os',
        durationMs,
        outcome: 'CONFIRMATION_REQUIRED',
      });
      logToolAudit({
        sessionId: userData.sessionId,
        userId: userData.userId,
        intent: 'solicitar_confirmacao_adicionar_servico_os',
        toolName: 'adicionar_servico_os',
        durationMs,
        operationResult: 'CONFIRMATION_REQUIRED',
        osNumber: targetOs,
        isMutation: true,
        erpMode: userData.erpClient.mode,
      });

      return {
        status: 'CONFIRMATION_REQUIRED',
        messageForSpeech: `CONFIRMAÇÃO OBRIGATÓRIA: Pergunte ao operador: "${pending.summaryForSpeech}"`,
        data: { pendingMutationId: pending.mutationId, servico_id: srvId, descricao: srvDesc, subtotal },
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    }

    const pending = gate.pendingMutation!;
    execCtx.disallowInterruptions?.();

    const res = await userData.erpClient.adicionarServicoOS(targetOs, srvId, args.quantidade, valorUnitario, {
      idempotencyKey: pending.idempotencyKey,
    });
    userData.pendingMutation = null;
    metrics.recordConfirmationApproved();

    const durationMs = Math.max(1, Date.now() - startTime);
    metrics.recordToolCall({ toolName: 'adicionar_servico_os', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'executar_adicionar_servico_os',
      toolName: 'adicionar_servico_os',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      osNumber: targetOs,
      isMutation: true,
      erpMode: userData.erpClient.mode,
    });

    const speech = `Serviço '${res.data.item_adicionado.descricao}' adicionado com sucesso na OS ${targetOs}. Novo total da OS: ${res.data.totais.valor_total.toFixed(2)} reais.`;
    userData.executedMutations.set(pending.idempotencyKey, {
      idempotencyKey: pending.idempotencyKey,
      operation: 'adicionar_servico_os',
      osNumber: targetOs,
      executedAtIso: new Date().toISOString(),
      status: 'COMMITTED',
      resultSummary: speech,
    });

    return {
      status: 'COMMITTED',
      messageForSpeech: speech,
      data: res.data,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleMutationError(
      err,
      'adicionar_servico_os',
      'adicionar_servico_os',
      userData,
      startTime,
      targetOs,
      userData.pendingMutation?.idempotencyKey,
    );
  }
}

// ============================================================================
// 15. remover_servico_os(numero_os, item_id, confirmado_pelo_usuario)
// ============================================================================
export const removerServicoOsSchema = z.object({
  numero_os: z
    .string()
    .nullable()
    .optional()
    .describe('Número da OS (ex: "3030"). Se omitido ou nulo, usa a OS ativa no contexto.'),
  item_id: z
    .string()
    .min(1)
    .describe(
      'ID do item de serviço na OS (ex: "ITEM-S-302"), código (ex: "S02") ou descrição falada do serviço a remover (ex: "alinhamento").',
    ),
  confirmado_pelo_usuario: z
    .boolean()
    .default(false)
    .describe(
      'Passe false na primeira chamada para identificar exatamente o serviço que será removido e pedir confirmação. Passe true SOMENTE no turno seguinte após confirmação.',
    ),
});

export async function executeRemoverServicoOs(
  args: z.infer<typeof removerServicoOsSchema>,
  execCtx: MutationExecutionContext,
): Promise<MutationToolResponse> {
  const startTime = Date.now();
  const { userData } = execCtx;
  const targetOs = resolveTargetOsNumber(userData, args.numero_os);

  if (!targetOs) {
    throw new llm.ToolError(
      'Número da OS não informado e não há OS ativa no contexto. Pergunte ao operador de qual OS deseja remover o serviço.',
    );
  }

  try {
    const itensRes = await userData.erpClient.listarItensOS(targetOs);
    setActiveOsContext(userData, targetOs);

    const search = args.item_id.trim().toLowerCase();
    const matchedServices = itensRes.data.servicos.filter(
      (s) =>
        s.item_id.toLowerCase() === search ||
        s.servico_id.toLowerCase() === search ||
        s.codigo.toLowerCase() === search ||
        s.descricao.toLowerCase().includes(search),
    );

    if (matchedServices.length === 0) {
      return {
        status: 'NOT_FOUND',
        messageForSpeech: `Nenhum serviço correspondente a '${args.item_id}' foi encontrado na OS ${targetOs}.`,
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    }

    if (matchedServices.length > 1) {
      return {
        status: 'AMBIGUOUS',
        messageForSpeech:
          `Há mais de um serviço compatível com '${args.item_id}' na OS ${targetOs}: ` +
          matchedServices.map((s) => `${s.item_id} (${s.descricao})`).join('; ') +
          '. Pergunte ao operador qual deles deseja remover.',
        data: { candidatos: matchedServices },
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    }

    const itemAlvo = matchedServices[0]!;
    const currentTurn = getCurrentUserTurnIndex(userData, execCtx.sessionHistoryItems);
    const gate = verifyConfirmationGate({
      userData,
      operation: 'remover_servico_os',
      osNumber: targetOs,
      confirmedByUserFlag: Boolean(args.confirmado_pelo_usuario),
      currentTurnIndex: currentTurn,
    });

    if (gate.alreadyExecuted) {
      return {
        status:
          gate.alreadyExecuted.status === 'INCONCLUSIVE_TIMEOUT'
            ? 'INCONCLUSIVE_TIMEOUT'
            : 'COMMITTED',
        messageForSpeech: gate.alreadyExecuted.resultSummary,
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    }

    if (!gate.allowed) {
      const summary = `Confirma remover o serviço '${itemAlvo.descricao}' (item ${itemAlvo.item_id}, valor ${itemAlvo.subtotal.toFixed(2)} reais) da OS ${targetOs}?`;
      const pending =
        gate.reason === 'SAME_TURN_APPROVAL_FORBIDDEN' && gate.pendingMutation
          ? gate.pendingMutation
          : stagePendingMutation({
              userData,
              operation: 'remover_servico_os',
              osNumber: targetOs,
              payload: {
                numero_os: targetOs,
                item_id: itemAlvo.item_id,
                item_descricao: itemAlvo.descricao,
                quantidade: itemAlvo.quantidade,
                valor_total_operacao: itemAlvo.subtotal,
              },
              summaryForSpeech: summary,
              currentTurnIndex: currentTurn,
            });

      const durationMs = Math.max(1, Date.now() - startTime);
      metrics.recordToolCall({
        toolName: 'remover_servico_os',
        durationMs,
        outcome: 'CONFIRMATION_REQUIRED',
      });
      logToolAudit({
        sessionId: userData.sessionId,
        userId: userData.userId,
        intent: 'solicitar_confirmacao_remover_servico_os',
        toolName: 'remover_servico_os',
        durationMs,
        operationResult: 'CONFIRMATION_REQUIRED',
        osNumber: targetOs,
        isMutation: true,
        erpMode: userData.erpClient.mode,
      });

      return {
        status: 'CONFIRMATION_REQUIRED',
        messageForSpeech: `CONFIRMAÇÃO OBRIGATÓRIA: Pergunte ao operador: "${pending.summaryForSpeech}"`,
        data: { pendingMutationId: pending.mutationId, item: itemAlvo },
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    }

    const pending = gate.pendingMutation!;
    execCtx.disallowInterruptions?.();

    const res = await userData.erpClient.removerServicoOS(targetOs, itemAlvo.item_id, {
      idempotencyKey: pending.idempotencyKey,
    });
    userData.pendingMutation = null;
    metrics.recordConfirmationApproved();

    const durationMs = Math.max(1, Date.now() - startTime);
    metrics.recordToolCall({ toolName: 'remover_servico_os', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'executar_remover_servico_os',
      toolName: 'remover_servico_os',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      osNumber: targetOs,
      isMutation: true,
      erpMode: userData.erpClient.mode,
    });

    const speech = `Serviço '${res.data.item_removido.descricao}' removido com sucesso da OS ${targetOs}. Novo total da OS: ${res.data.totais.valor_total.toFixed(2)} reais.`;
    userData.executedMutations.set(pending.idempotencyKey, {
      idempotencyKey: pending.idempotencyKey,
      operation: 'remover_servico_os',
      osNumber: targetOs,
      executedAtIso: new Date().toISOString(),
      status: 'COMMITTED',
      resultSummary: speech,
    });

    return {
      status: 'COMMITTED',
      messageForSpeech: speech,
      data: res.data,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleMutationError(
      err,
      'remover_servico_os',
      'remover_servico_os',
      userData,
      startTime,
      targetOs,
      userData.pendingMutation?.idempotencyKey,
    );
  }
}

// ============================================================================
// 15. editar_item_os(numero_os, item_identificador, nova_quantidade, novo_valor_unitario, confirmado_pelo_usuario)
// ============================================================================
export const editarItemOsSchema = z.object({
  numero_os: z
    .string()
    .nullable()
    .optional()
    .describe('Número da OS (ex: "4345"). Se omitido ou nulo, usa a OS ativa no contexto.'),
  item_identificador: z
    .string()
    .min(1)
    .describe(
      'Identificador do item que já está na OS: código (ex: "663", "1091"), ID do item (ex: "ITEM-P-1"), ou nome/descrição (ex: "formatação", "antivirus", "cabo").',
    ),
  nova_quantidade: z
    .number()
    .min(0.01)
    .nullable()
    .optional()
    .describe('Nova quantidade para o item (se desejar alterar a quantidade).'),
  novo_valor_unitario: z
    .number()
    .min(0)
    .nullable()
    .optional()
    .describe('Novo valor unitário em reais para o item (se desejar alterar o valor/preço).'),
  confirmado_pelo_usuario: z
    .boolean()
    .default(false)
    .describe(
      'Passe false na primeira chamada para identificar o item e pedir confirmação ao operador. Passe true SOMENTE após confirmação no turno seguinte.',
    ),
});

export async function executeEditarItemOs(
  args: z.infer<typeof editarItemOsSchema>,
  execCtx: MutationExecutionContext,
): Promise<MutationToolResponse> {
  const startTime = Date.now();
  const { userData } = execCtx;
  const targetOs = resolveTargetOsNumber(userData, args.numero_os);

  if (!targetOs) {
    throw new llm.ToolError(
      'Número da OS não informado e não há OS ativa no contexto. Pergunte ao operador qual OS deseja editar.',
    );
  }

  if (args.nova_quantidade === undefined && args.novo_valor_unitario === undefined) {
    throw new llm.ToolError(
      'Você deve informar a nova quantidade ou o novo valor unitário para editar o item.',
    );
  }

  try {
    const osDetalhes = await userData.erpClient.consultarDetalhesOS(targetOs);
    setActiveOsContext(userData, targetOs, osDetalhes.data);

    const currentTurn = getCurrentUserTurnIndex(userData, execCtx.sessionHistoryItems);
    const gate = verifyConfirmationGate({
      userData,
      operation: 'editar_item_os' as any,
      osNumber: targetOs,
      confirmedByUserFlag: Boolean(args.confirmado_pelo_usuario),
      currentTurnIndex: currentTurn,
    });

    if (gate.alreadyExecuted) {
      return {
        status:
          gate.alreadyExecuted.status === 'INCONCLUSIVE_TIMEOUT'
            ? 'INCONCLUSIVE_TIMEOUT'
            : 'COMMITTED',
        messageForSpeech: gate.alreadyExecuted.resultSummary,
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    }

    if (!gate.allowed) {
      const mudancas: string[] = [];
      if (args.novo_valor_unitario !== undefined && args.novo_valor_unitario !== null) {
        mudancas.push(`valor de ${args.novo_valor_unitario.toFixed(2)} reais`);
      }
      if (args.nova_quantidade !== undefined && args.nova_quantidade !== null) {
        mudancas.push(`quantidade ${args.nova_quantidade}`);
      }

      const summary = `Confirma alterar o item '${args.item_identificador}' na OS ${targetOs} para ${mudancas.join(' e ')}?`;
      const pending =
        gate.reason === 'SAME_TURN_APPROVAL_FORBIDDEN' && gate.pendingMutation
          ? gate.pendingMutation
          : stagePendingMutation({
              userData,
              operation: 'editar_item_os' as any,
              osNumber: targetOs,
              payload: {
                numero_os: targetOs,
                item_identificador: args.item_identificador,
                nova_quantidade: args.nova_quantidade,
                novo_valor_unitario: args.novo_valor_unitario,
              },
              summaryForSpeech: summary,
              currentTurnIndex: currentTurn,
            });

      const durationMs = Math.max(1, Date.now() - startTime);
      metrics.recordToolCall({
        toolName: 'editar_item_os',
        durationMs,
        outcome: 'CONFIRMATION_REQUIRED',
      });

      return {
        status: 'CONFIRMATION_REQUIRED',
        messageForSpeech: `CONFIRMAÇÃO OBRIGATÓRIA: Pergunte ao operador: "${pending.summaryForSpeech}"`,
        data: {
          pendingMutationId: pending.mutationId,
          item: args.item_identificador,
          novaQuantidade: args.nova_quantidade,
          novoValorUnitario: args.novo_valor_unitario,
        },
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    }

    const pending = gate.pendingMutation!;
    execCtx.disallowInterruptions?.();

    const res = await userData.erpClient.editarItemOS(
      targetOs,
      args.item_identificador,
      {
        novaQuantidade: args.nova_quantidade ?? undefined,
        novoValorUnitario: args.novo_valor_unitario ?? undefined,
      },
      { idempotencyKey: pending.idempotencyKey },
    );

    userData.pendingMutation = null;
    metrics.recordConfirmationApproved();

    const speech = `Item '${args.item_identificador}' alterado com sucesso na OS ${targetOs}. Novo total da ordem: ${res.data.totais.valor_total.toFixed(2)} reais.`;

    userData.executedMutations.set(pending.idempotencyKey, {
      idempotencyKey: pending.idempotencyKey,
      operation: 'editar_item_os' as any,
      osNumber: targetOs,
      executedAtIso: new Date().toISOString(),
      status: 'COMMITTED',
      resultSummary: speech,
    });

    return {
      status: 'COMMITTED',
      messageForSpeech: speech,
      data: res.data,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleMutationError(
      err,
      'editar_item_os',
      'executar_editar_item_os',
      userData,
      startTime,
      targetOs,
    );
  }
}

// ============================================================================
// 16. cancelar_operacao_pendente()
// ============================================================================
export const cancelarOperacaoPendenteSchema = z.object({
  motivo: z.string().nullable().optional().describe('Motivo opcional do cancelamento.'),
});

export async function executeCancelarOperacaoPendente(
  _args: z.infer<typeof cancelarOperacaoPendenteSchema>,
  userData: SessionUserData,
): Promise<MutationToolResponse> {
  const startTime = Date.now();
  const cancelled = cancelPendingMutation(userData);
  const durationMs = Math.max(1, Date.now() - startTime);

  metrics.recordConfirmationCancelled();
  metrics.recordToolCall({
    toolName: 'cancelar_operacao_pendente',
    durationMs,
    outcome: 'CANCELLED',
  });
  logToolAudit({
    sessionId: userData.sessionId,
    userId: userData.userId,
    intent: 'cancelar_operacao_pendente',
    toolName: 'cancelar_operacao_pendente',
    durationMs,
    operationResult: 'CANCELLED',
    osNumber: cancelled?.osNumber ?? userData.activeOsNumber,
    isMutation: false,
    erpMode: userData.erpClient.mode,
  });

  return {
    status: 'CANCELLED',
    messageForSpeech: cancelled
      ? `Operação pendente (${cancelled.operation.replace(/_/g, ' ')} na OS ${cancelled.osNumber}) foi cancelada. Nenhuma alteração foi realizada no ERP.`
      : 'Nenhuma operação pendente estava ativa. Nada foi alterado no ERP.',
    erpMode: userData.erpClient.mode,
    activeOsNumber: userData.activeOsNumber,
  };
}

// ============================================================================
// BUILD LIVEKIT MUTATION TOOLS FOR AGENT
// ============================================================================
export function createMutationTools() {
  return [
    llm.tool({
      name: 'alterar_status_os',
      description:
        'Altera o status de uma Ordem de Serviço (ex: "em_andamento", "aguardando_pecas", "concluida"). ' +
        'REGRA DE SEGURANÇA: Na primeira vez que o operador pedir a alteração, chame com confirmado_pelo_usuario=false para registrar a revisão e ler a confirmação para o operador. ' +
        'Somente no turno seguinte, após o operador responder confirmando explicitamente, chame novamente com confirmado_pelo_usuario=true.',
      parameters: alterarStatusOsSchema,
      execute: async (args, { ctx }: llm.ToolOptions<SessionUserData>) =>
        executeAlterarStatusOs(args, {
          userData: ctx.userData,
          sessionHistoryItems: ctx.session?.history?.items as any,
          disallowInterruptions: () => ctx.disallowInterruptions(),
        }),
    }),
    llm.tool({
      name: 'adicionar_produto_os',
      description:
        'Adiciona um produto e quantidade a uma Ordem de Serviço. ' +
        'REGRA DE SEGURANÇA: Na primeira chamada, passe confirmado_pelo_usuario=false. A ferramenta irá localizar o produto, verificar ambiguidades, checar saldo em estoque, calcular o subtotal e preparar a pergunta de confirmação. ' +
        'Se retornar AMBIGUOUS, pergunte ao operador qual dos produtos ele deseja. ' +
        'Se retornar CONFIRMATION_REQUIRED, diga o nome do produto, quantidade e valor e peça confirmação. ' +
        'Somente no turno seguinte após o operador confirmar, chame com confirmado_pelo_usuario=true.',
      parameters: adicionarProdutoOsSchema,
      execute: async (args, { ctx }: llm.ToolOptions<SessionUserData>) =>
        executeAdicionarProdutoOs(args, {
          userData: ctx.userData,
          sessionHistoryItems: ctx.session?.history?.items as any,
          disallowInterruptions: () => ctx.disallowInterruptions(),
        }),
    }),
    llm.tool({
      name: 'remover_produto_os',
      description:
        'Remove um produto de uma Ordem de Serviço. ' +
        'REGRA DE SEGURANÇA: Passe confirmado_pelo_usuario=false primeiro para identificar o item exato e solicitar confirmação ao operador. ' +
        'Somente após o operador confirmar no turno seguinte, chame com confirmado_pelo_usuario=true.',
      parameters: removerProdutoOsSchema,
      execute: async (args, { ctx }: llm.ToolOptions<SessionUserData>) =>
        executeRemoverProdutoOs(args, {
          userData: ctx.userData,
          sessionHistoryItems: ctx.session?.history?.items as any,
          disallowInterruptions: () => ctx.disallowInterruptions(),
        }),
    }),
    llm.tool({
      name: 'adicionar_servico_os',
      description:
        'Adiciona um serviço a uma Ordem de Serviço. ' +
        'REGRA DE SEGURANÇA: Passe confirmado_pelo_usuario=false primeiro para identificar o serviço, seu valor e solicitar confirmação ao operador. ' +
        'Somente após o operador confirmar no turno seguinte, chame com confirmado_pelo_usuario=true.',
      parameters: adicionarServicoOsSchema,
      execute: async (args, { ctx }: llm.ToolOptions<SessionUserData>) =>
        executeAdicionarServicoOs(args, {
          userData: ctx.userData,
          sessionHistoryItems: ctx.session?.history?.items as any,
          disallowInterruptions: () => ctx.disallowInterruptions(),
        }),
    }),
    llm.tool({
      name: 'remover_servico_os',
      description:
        'Remove um serviço de uma Ordem de Serviço. ' +
        'REGRA DE SEGURANÇA: Passe confirmado_pelo_usuario=false primeiro para identificar exatamente qual serviço será removido e solicitar confirmação ao operador. ' +
        'Somente após o operador confirmar no turno seguinte, chame com confirmado_pelo_usuario=true.',
      parameters: removerServicoOsSchema,
      execute: async (args, { ctx }: llm.ToolOptions<SessionUserData>) =>
        executeRemoverServicoOs(args, {
          userData: ctx.userData,
          sessionHistoryItems: ctx.session?.history?.items as any,
          disallowInterruptions: () => ctx.disallowInterruptions(),
        }),
    }),
    llm.tool({
      name: 'editar_item_os',
      description:
        'Edita a quantidade e/ou o valor unitário de um produto ou serviço já existente em uma Ordem de Serviço. ' +
        'Use quando o operador pedir para alterar o valor de um item, mudar o preço ou alterar a quantidade. ' +
        'REGRA DE SEGURANÇA: Passe confirmado_pelo_usuario=false na primeira chamada para identificar o item e pedir confirmação. ' +
        'Somente no turno seguinte após confirmação do operador, passe confirmado_pelo_usuario=true.',
      parameters: editarItemOsSchema,
      execute: async (args, { ctx }: llm.ToolOptions<SessionUserData>) =>
        executeEditarItemOs(args, {
          userData: ctx.userData,
          sessionHistoryItems: ctx.session?.history?.items as any,
          disallowInterruptions: () => ctx.disallowInterruptions(),
        }),
    }),
    llm.tool({
      name: 'cancelar_operacao_pendente',
      description:
        'Cancela imediatamente qualquer alteração pendente de confirmação quando o operador disser "não", "cancele", "deixa pra lá" ou desistir da alteração.',
      parameters: cancelarOperacaoPendenteSchema,
      execute: async (args, { ctx }: llm.ToolOptions<SessionUserData>) =>
        executeCancelarOperacaoPendente(args, ctx.userData),
    }),
  ];
}
