import { llm } from '@livekit/agents';
import { z } from 'zod';
import { ErpError } from '../integrations/erp/erp-errors.ts';
import type { StatusOS } from '../integrations/erp/erp-types.ts';
import {
  resolveTargetOsNumber,
  setActiveOsContext,
} from '../services/context-manager.ts';
import type { SessionUserData } from '../types/session-types.ts';
import { logToolAudit } from '../utils/logger.ts';
import { metrics } from '../utils/metrics.ts';

const statusOsEnum = z.enum([
  'aberta',
  'em_andamento',
  'aguardando_pecas',
  'aguardando_aprovacao',
  'concluida',
  'cancelada',
]);

export interface ToolResponse<T = unknown> {
  status: 'SUCCESS' | 'AMBIGUOUS' | 'NOT_FOUND' | 'ERROR';
  messageForSpeech: string;
  data?: T;
  erpMode: 'mock' | 'live';
  activeOsNumber: string | null;
}

function handleQueryError(
  error: unknown,
  toolName: string,
  intent: string,
  userData: SessionUserData,
  startTime: number,
  osNumber?: string | null,
): never {
  const durationMs = Math.max(1, Date.now() - startTime);
  const isTimeout = error instanceof ErpError && error.code === 'ERP_TIMEOUT';
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
    isMutation: false,
    erpMode: userData.erpClient.mode,
    errorCode,
    errorMessage,
  });

  throw new llm.ToolError(errorMessage);
}

// ============================================================================
// 1. consultar_os(numero_os)
// ============================================================================
export const consultarOsSchema = z.object({
  numero_os: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Número da Ordem de Serviço (ex: "3030"). Se omitido ou nulo, utiliza a OS ativa no contexto da conversa.',
    ),
});

export async function executeConsultarOs(
  args: z.infer<typeof consultarOsSchema>,
  userData: SessionUserData,
  abortSignal?: AbortSignal,
): Promise<ToolResponse> {
  const startTime = Date.now();
  const targetOs = resolveTargetOsNumber(userData, args.numero_os);
  if (!targetOs) {
    throw new llm.ToolError(
      'Nenhuma Ordem de Serviço foi informada e não há OS ativa no contexto. Pergunte ao operador o número da OS.',
    );
  }

  try {
    const res = await userData.erpClient.consultarOS(targetOs, { signal: abortSignal });
    setActiveOsContext(userData, res.data.numero_os, res.data);
    const durationMs = Math.max(1, Date.now() - startTime);

    metrics.recordToolCall({ toolName: 'consultar_os', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'consultar_status_resumo_os',
      toolName: 'consultar_os',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      osNumber: targetOs,
      erpMode: userData.erpClient.mode,
    });

    const os = res.data;
    const equipInfo =
      os.veiculo_equipamento &&
      os.veiculo_equipamento !== 'Geral' &&
      os.veiculo_equipamento !== 'Equipamento não especificado'
        ? ` referente a ${os.veiculo_equipamento}`
        : '';
    return {
      status: 'SUCCESS',
      messageForSpeech: `A OS ${os.numero_os} do cliente ${os.cliente_nome}${equipInfo} está com status ${os.status.replace(/_/g, ' ')}, possui ${os.quantidade_itens} itens e valor total de ${os.valor_total.toFixed(2)} reais.`,
      data: os,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleQueryError(
      err,
      'consultar_os',
      'consultar_status_resumo_os',
      userData,
      startTime,
      targetOs,
    );
  }
}

// ============================================================================
// 2. listar_os_abertas(filtros)
// ============================================================================
export const listarOsAbertasSchema = z.object({
  status: statusOsEnum
    .nullable()
    .optional()
    .describe('Filtrar por status específico (ex: "em_andamento", "aguardando_pecas").'),
  aberta_ha_mais_de_dias: z
    .number()
    .nullable()
    .optional()
    .describe('Filtrar ordens abertas há mais de X dias (ex: 3 para mais de três dias).'),
  aguardando_produto: z
    .boolean()
    .nullable()
    .optional()
    .describe('Se verdadeiro, retorna apenas ordens que estão aguardando peças/produtos.'),
  cliente: z.string().nullable().optional().describe('Filtro opcional por nome do cliente.'),
});

export async function executeListarOsAbertas(
  args: z.infer<typeof listarOsAbertasSchema>,
  userData: SessionUserData,
  abortSignal?: AbortSignal,
): Promise<ToolResponse> {
  const startTime = Date.now();
  try {
    const filtros = {
      status: (args.status ?? undefined) as StatusOS | undefined,
      aberta_ha_mais_de_dias: args.aberta_ha_mais_de_dias ?? undefined,
      aguardando_produto: args.aguardando_produto ?? undefined,
      cliente: args.cliente ?? undefined,
    };
    const res = await userData.erpClient.listarOSAbertas(filtros, { signal: abortSignal });
    const durationMs = Math.max(1, Date.now() - startTime);

    metrics.recordToolCall({ toolName: 'listar_os_abertas', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'listar_ordens_abertas',
      toolName: 'listar_os_abertas',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      erpMode: userData.erpClient.mode,
    });

    const ordens = res.data;
    const somaTotal = ordens.reduce((acc, o) => acc + o.valor_total, 0);
    let resumoLista = '';
    if (ordens.length === 0) {
      resumoLista = 'Nenhuma ordem de serviço em aberto encontrada com esses critérios.';
    } else if (ordens.length <= 5) {
      resumoLista =
        `Foram encontradas ${ordens.length} ordens em aberto (soma total de ${somaTotal.toFixed(2)} reais): ` +
        ordens
          .map(
            (o) =>
              `OS ${o.numero_os} do cliente ${o.cliente_nome} (${o.status.replace(/_/g, ' ')}, total ${o.valor_total.toFixed(2)} reais)`,
          )
          .join('; ');
    } else {
      const top5 = ordens.slice(0, 5);
      resumoLista =
        `Foram encontradas ${ordens.length} ordens em aberto totalizando ${somaTotal.toFixed(2)} reais. As 5 mais recentes são: ` +
        top5
          .map(
            (o) =>
              `OS ${o.numero_os} do cliente ${o.cliente_nome} (${o.status.replace(/_/g, ' ')}, total ${o.valor_total.toFixed(2)} reais)`,
          )
          .join('; ') +
        `. E mais ${ordens.length - 5} ordens no sistema.`;
    }

    return {
      status: 'SUCCESS',
      messageForSpeech: resumoLista,
      data: {
        quantidade: ordens.length,
        valor_total_acumulado: somaTotal,
        ordens,
      },
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleQueryError(
      err,
      'listar_os_abertas',
      'listar_ordens_abertas',
      userData,
      startTime,
    );
  }
}

// ============================================================================
// 3. listar_todas_os(filtros)
// ============================================================================
export const listarTodasOsSchema = z.object({
  status: statusOsEnum.nullable().optional().describe('Filtro opcional por status da OS.'),
  aberta_ha_mais_de_dias: z
    .number()
    .nullable()
    .optional()
    .describe('Filtro opcional para ordens abertas há mais de X dias.'),
  aguardando_produto: z
    .boolean()
    .nullable()
    .optional()
    .describe('Filtro opcional para ordens aguardando peça/produto.'),
  apenas_nao_concluidas: z
    .boolean()
    .nullable()
    .optional()
    .describe('Se verdadeiro, exclui ordens já concluídas ou canceladas.'),
  cliente: z.string().nullable().optional().describe('Filtro opcional por nome do cliente.'),
});

export async function executeListarTodasOs(
  args: z.infer<typeof listarTodasOsSchema>,
  userData: SessionUserData,
  abortSignal?: AbortSignal,
): Promise<ToolResponse> {
  const startTime = Date.now();
  try {
    const filtros = {
      status: (args.status ?? undefined) as StatusOS | undefined,
      aberta_ha_mais_de_dias: args.aberta_ha_mais_de_dias ?? undefined,
      aguardando_produto: args.aguardando_produto ?? undefined,
      apenas_nao_concluidas: args.apenas_nao_concluidas ?? undefined,
      cliente: args.cliente ?? undefined,
    };
    const res = await userData.erpClient.listarTodasOS(filtros, { signal: abortSignal });
    const durationMs = Math.max(1, Date.now() - startTime);

    metrics.recordToolCall({ toolName: 'listar_todas_os', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'listar_todas_ordens',
      toolName: 'listar_todas_os',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      erpMode: userData.erpClient.mode,
    });

    const ordens = res.data;
    return {
      status: 'SUCCESS',
      messageForSpeech:
        ordens.length === 0
          ? 'Nenhuma ordem de serviço encontrada.'
          : `Total de ${ordens.length} ordens encontradas: ` +
            ordens
              .map(
                (o) =>
                  `OS ${o.numero_os} (${o.status.replace(/_/g, ' ')}, total ${o.valor_total.toFixed(2)} reais)`,
              )
              .join('; '),
      data: { quantidade: ordens.length, ordens },
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleQueryError(err, 'listar_todas_os', 'listar_todas_ordens', userData, startTime);
  }
}

// ============================================================================
// 4. consultar_detalhes_os(numero_os)
// ============================================================================
export const consultarDetalhesOsSchema = z.object({
  numero_os: z
    .string()
    .nullable()
    .optional()
    .describe('Número da OS (ex: "3030"). Se omitido, utiliza a OS em contexto.'),
});

export async function executeConsultarDetalhesOs(
  args: z.infer<typeof consultarDetalhesOsSchema>,
  userData: SessionUserData,
  abortSignal?: AbortSignal,
): Promise<ToolResponse> {
  const startTime = Date.now();
  const targetOs = resolveTargetOsNumber(userData, args.numero_os);
  if (!targetOs) {
    throw new llm.ToolError(
      'Número da OS não informado e não há OS ativa no contexto. Pergunte ao operador qual OS deseja consultar.',
    );
  }

  try {
    const res = await userData.erpClient.consultarDetalhesOS(targetOs, { signal: abortSignal });
    setActiveOsContext(userData, res.data.numero_os, res.data);
    const durationMs = Math.max(1, Date.now() - startTime);

    metrics.recordToolCall({ toolName: 'consultar_detalhes_os', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'consultar_detalhes_os',
      toolName: 'consultar_detalhes_os',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      osNumber: targetOs,
      erpMode: userData.erpClient.mode,
    });

    const d = res.data;
    const equipInfo =
      d.veiculo_equipamento &&
      d.veiculo_equipamento !== 'Geral' &&
      d.veiculo_equipamento !== 'Equipamento não especificado'
        ? `, referente a ${d.veiculo_equipamento}`
        : '';
    const obsSnippet = d.observacoes ? ` Observação: ${d.observacoes.split('\n')[0]}.` : '';
    return {
      status: 'SUCCESS',
      messageForSpeech: `Detalhes da OS ${d.numero_os}: cliente ${d.cliente_nome}${equipInfo}, status ${d.status.replace(/_/g, ' ')}, aberta há ${d.dias_aberta} dias.${obsSnippet} Possui ${d.produtos.length} produtos (${d.totais.total_produtos.toFixed(2)} reais) e ${d.servicos.length} serviços (${d.totais.total_servicos.toFixed(2)} reais), somando ${d.totais.valor_total.toFixed(2)} reais.`,
      data: d,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleQueryError(
      err,
      'consultar_detalhes_os',
      'consultar_detalhes_os',
      userData,
      startTime,
      targetOs,
    );
  }
}

// ============================================================================
// 5. listar_produtos(filtros)
// ============================================================================
export const listarProdutosSchema = z.object({
  categoria: z.string().nullable().optional().describe('Filtrar produtos por categoria.'),
  estoque_abaixo_de: z
    .number()
    .nullable()
    .optional()
    .describe('Filtrar produtos com estoque abaixo de X unidades (ex: 5).'),
  apenas_em_estoque: z
    .boolean()
    .nullable()
    .optional()
    .describe('Se verdadeiro, lista apenas produtos com saldo em estoque maior que zero.'),
  busca: z.string().nullable().optional().describe('Termo opcional de busca no nome do produto.'),
});

export async function executeListarProdutos(
  args: z.infer<typeof listarProdutosSchema>,
  userData: SessionUserData,
  abortSignal?: AbortSignal,
): Promise<ToolResponse> {
  const startTime = Date.now();
  try {
    const filtros = {
      categoria: args.categoria ?? undefined,
      estoque_abaixo_de: args.estoque_abaixo_de ?? undefined,
      apenas_em_estoque: args.apenas_em_estoque ?? undefined,
      busca: args.busca ?? undefined,
    };
    const res = await userData.erpClient.listarProdutos(filtros, { signal: abortSignal });
    userData.lastProductCandidates = res.data;
    const durationMs = Math.max(1, Date.now() - startTime);

    metrics.recordToolCall({ toolName: 'listar_produtos', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'listar_produtos_catalogo',
      toolName: 'listar_produtos',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      erpMode: userData.erpClient.mode,
    });

    const prods = res.data;
    return {
      status: 'SUCCESS',
      messageForSpeech:
        prods.length === 0
          ? 'Nenhum produto encontrado com esses filtros.'
          : `Encontrados ${prods.length} produtos: ` +
            prods
              .map(
                (p) =>
                  `código ${p.codigo} - ${p.nome} (${p.preco_venda.toFixed(2)} reais/${p.unidade}, estoque: ${p.estoque_atual})`,
              )
              .join('; '),
      data: { quantidade: prods.length, produtos: prods },
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleQueryError(
      err,
      'listar_produtos',
      'listar_produtos_catalogo',
      userData,
      startTime,
    );
  }
}

// ============================================================================
// 6. buscar_produto_por_nome(nome)
// ============================================================================
export const buscarProdutoPorNomeSchema = z.object({
  nome: z
    .string()
    .min(1)
    .describe('Nome ou descrição falada do produto (ex: "filtro de óleo", "óleo 5W30").'),
});

export async function executeBuscarProdutoPorNome(
  args: z.infer<typeof buscarProdutoPorNomeSchema>,
  userData: SessionUserData,
  abortSignal?: AbortSignal,
): Promise<ToolResponse> {
  const startTime = Date.now();
  try {
    const res = await userData.erpClient.buscarProdutoPorNome(args.nome, { signal: abortSignal });
    userData.lastProductCandidates = res.data;
    const durationMs = Math.max(1, Date.now() - startTime);

    metrics.recordToolCall({ toolName: 'buscar_produto_por_nome', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'buscar_produto_por_nome',
      toolName: 'buscar_produto_por_nome',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      erpMode: userData.erpClient.mode,
    });

    const prods = res.data;
    if (prods.length === 0) {
      return {
        status: 'NOT_FOUND',
        messageForSpeech: `Nenhum produto encontrado com o nome '${args.nome}'.`,
        data: { quantidade: 0, produtos: [] },
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    }

    return {
      status: prods.length > 1 ? 'AMBIGUOUS' : 'SUCCESS',
      messageForSpeech:
        prods.length === 1
          ? `Produto encontrado: código ${prods[0]!.codigo} - ${prods[0]!.nome}, preço ${prods[0]!.preco_venda.toFixed(2)} reais por ${prods[0]!.unidade}, estoque atual de ${prods[0]!.estoque_atual} ${prods[0]!.unidade}.`
          : `Foram encontrados ${prods.length} produtos compatíveis com '${args.nome}': ` +
            prods
              .map(
                (p) =>
                  `código ${p.codigo} (${p.nome}, ${p.preco_venda.toFixed(2)} reais por ${p.unidade}, estoque: ${p.estoque_atual})`,
              )
              .join('; '),
      data: { quantidade: prods.length, produtos: prods },
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleQueryError(
      err,
      'buscar_produto_por_nome',
      'buscar_produto_por_nome',
      userData,
      startTime,
    );
  }
}

// ============================================================================
// 7. consultar_produto_por_codigo(codigo)
// ============================================================================
export const consultarProdutoPorCodigoSchema = z.object({
  codigo: z
    .string()
    .min(1)
    .describe('Código ou ID do produto no ERP (ex: "125", "101", "PROD-125").'),
});

export async function executeConsultarProdutoPorCodigo(
  args: z.infer<typeof consultarProdutoPorCodigoSchema>,
  userData: SessionUserData,
  abortSignal?: AbortSignal,
): Promise<ToolResponse> {
  const startTime = Date.now();
  try {
    const res = await userData.erpClient.consultarProdutoPorCodigo(args.codigo, {
      signal: abortSignal,
    });
    userData.lastProductCandidates = [res.data];
    const durationMs = Math.max(1, Date.now() - startTime);

    metrics.recordToolCall({
      toolName: 'consultar_produto_por_codigo',
      durationMs,
      outcome: 'SUCCESS',
    });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'consultar_produto_por_codigo',
      toolName: 'consultar_produto_por_codigo',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      erpMode: userData.erpClient.mode,
    });

    const p = res.data;
    return {
      status: 'SUCCESS',
      messageForSpeech: `Produto código ${p.codigo}: ${p.nome}, custa ${p.preco_venda.toFixed(2)} reais por ${p.unidade} e possui ${p.estoque_atual} ${p.unidade} em estoque.`,
      data: p,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleQueryError(
      err,
      'consultar_produto_por_codigo',
      'consultar_produto_por_codigo',
      userData,
      startTime,
    );
  }
}

// ============================================================================
// 8. consultar_estoque(produto_id)
// ============================================================================
export const consultarEstoqueSchema = z.object({
  produto_id: z
    .string()
    .min(1)
    .describe('ID ou código do produto para consultar saldo de estoque (ex: "PROD-201" ou "201").'),
});

export async function executeConsultarEstoque(
  args: z.infer<typeof consultarEstoqueSchema>,
  userData: SessionUserData,
  abortSignal?: AbortSignal,
): Promise<ToolResponse> {
  const startTime = Date.now();
  try {
    const res = await userData.erpClient.consultarEstoque(args.produto_id, {
      signal: abortSignal,
    });
    const durationMs = Math.max(1, Date.now() - startTime);

    metrics.recordToolCall({ toolName: 'consultar_estoque', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'consultar_estoque_produto',
      toolName: 'consultar_estoque',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      erpMode: userData.erpClient.mode,
    });

    const est = res.data;
    return {
      status: 'SUCCESS',
      messageForSpeech: `O produto ${est.nome} (código ${est.codigo}) possui ${est.estoque_disponivel} ${est.unidade} disponíveis em estoque${est.abaixo_do_minimo ? ' (abaixo do estoque mínimo)' : ''}.`,
      data: est,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleQueryError(
      err,
      'consultar_estoque',
      'consultar_estoque_produto',
      userData,
      startTime,
    );
  }
}

// ============================================================================
// 9. consultar_total_os(numero_os)
// ============================================================================
export const consultarTotalOsSchema = z.object({
  numero_os: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Número da OS (ex: "3030"). Se omitido ou nulo, utiliza a OS ativa no contexto conversacional.',
    ),
});

export async function executeConsultarTotalOs(
  args: z.infer<typeof consultarTotalOsSchema>,
  userData: SessionUserData,
  abortSignal?: AbortSignal,
): Promise<ToolResponse> {
  const startTime = Date.now();
  const targetOs = resolveTargetOsNumber(userData, args.numero_os);
  if (!targetOs) {
    throw new llm.ToolError(
      'Número da OS não informado e não há OS ativa no contexto. Pergunte ao operador qual OS deseja consultar.',
    );
  }

  try {
    const res = await userData.erpClient.consultarTotalOS(targetOs, { signal: abortSignal });
    setActiveOsContext(userData, targetOs);
    const durationMs = Math.max(1, Date.now() - startTime);

    metrics.recordToolCall({ toolName: 'consultar_total_os', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'consultar_total_os',
      toolName: 'consultar_total_os',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      osNumber: targetOs,
      erpMode: userData.erpClient.mode,
    });

    const t = res.data;
    return {
      status: 'SUCCESS',
      messageForSpeech: `O valor total da OS ${t.numero_os} é de ${t.valor_total.toFixed(2)} reais, sendo ${t.total_produtos.toFixed(2)} reais em produtos e ${t.total_servicos.toFixed(2)} reais em serviços.`,
      data: t,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleQueryError(
      err,
      'consultar_total_os',
      'consultar_total_os',
      userData,
      startTime,
      targetOs,
    );
  }
}

// ============================================================================
// 10. listar_itens_os(numero_os)
// ============================================================================
export const listarItensOsSchema = z.object({
  numero_os: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Número da OS (ex: "3030"). Se omitido ou nulo, utiliza a OS ativa no contexto conversacional.',
    ),
});

export async function executeListarItensOs(
  args: z.infer<typeof listarItensOsSchema>,
  userData: SessionUserData,
  abortSignal?: AbortSignal,
): Promise<ToolResponse> {
  const startTime = Date.now();
  const targetOs = resolveTargetOsNumber(userData, args.numero_os);
  if (!targetOs) {
    throw new llm.ToolError(
      'Número da OS não informado e não há OS ativa no contexto. Pergunte ao operador qual OS deseja consultar.',
    );
  }

  try {
    const res = await userData.erpClient.listarItensOS(targetOs, { signal: abortSignal });
    setActiveOsContext(userData, targetOs);
    const durationMs = Math.max(1, Date.now() - startTime);

    metrics.recordToolCall({ toolName: 'listar_itens_os', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'listar_itens_os',
      toolName: 'listar_itens_os',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      osNumber: targetOs,
      erpMode: userData.erpClient.mode,
    });

    const { produtos, servicos, totais } = res.data;
    const prodDesc =
      produtos.length === 0
        ? 'nenhum produto'
        : produtos
            .map(
              (p) =>
                `${p.quantidade} ${p.unidade} de ${p.nome} (item ${p.item_id}, subtotal ${p.subtotal.toFixed(2)} reais)`,
            )
            .join(', ');
    const srvDesc =
      servicos.length === 0
        ? 'nenhum serviço'
        : servicos
            .map((s) => `${s.descricao} (item ${s.item_id}, ${s.subtotal.toFixed(2)} reais)`)
            .join(', ');

    return {
      status: 'SUCCESS',
      messageForSpeech: `Na OS ${targetOs} constam: Produtos: ${prodDesc}. Serviços: ${srvDesc}. Total da ordem: ${totais.valor_total.toFixed(2)} reais.`,
      data: res.data,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleQueryError(
      err,
      'listar_itens_os',
      'listar_itens_os',
      userData,
      startTime,
      targetOs,
    );
  }
}

// ============================================================================
// BUILD LIVEKIT FUNCTION TOOLS FOR AGENT
// ============================================================================
export function createQueryTools() {
  return [
    llm.tool({
      name: 'consultar_os',
      description:
        'Consulta o status atual e resumo de uma Ordem de Serviço (OS) pelo número. Se o usuário disser "nela" ou omitir o número após já ter falado de uma OS, passe null para usar a OS em contexto.',
      parameters: consultarOsSchema,
      execute: async (args, { ctx, abortSignal }: llm.ToolOptions<SessionUserData>) =>
        executeConsultarOs(args, ctx.userData, abortSignal),
    }),
    llm.tool({
      name: 'listar_os_abertas',
      description:
        'Lista todas as Ordens de Serviço abertas (não concluídas/canceladas). Permite filtrar por status (em_andamento, aguardando_pecas), ordens abertas há mais de X dias, ou aguardando produto.',
      parameters: listarOsAbertasSchema,
      execute: async (args, { ctx, abortSignal }: llm.ToolOptions<SessionUserData>) =>
        executeListarOsAbertas(args, ctx.userData, abortSignal),
    }),
    llm.tool({
      name: 'listar_todas_os',
      description:
        'Lista todas as Ordens de Serviço do ERP, incluindo concluídas, ou filtra por critérios específicos como apenas_nao_concluidas.',
      parameters: listarTodasOsSchema,
      execute: async (args, { ctx, abortSignal }: llm.ToolOptions<SessionUserData>) =>
        executeListarTodasOs(args, ctx.userData, abortSignal),
    }),
    llm.tool({
      name: 'consultar_detalhes_os',
      description:
        'Consulta os detalhes completos de uma Ordem de Serviço (cliente, veículo/equipamento, observações, itens e totais). Atualiza a OS ativa no contexto da conversa.',
      parameters: consultarDetalhesOsSchema,
      execute: async (args, { ctx, abortSignal }: llm.ToolOptions<SessionUserData>) =>
        executeConsultarDetalhesOs(args, ctx.userData, abortSignal),
    }),
    llm.tool({
      name: 'listar_produtos',
      description:
        'Lista os produtos cadastrados no ERP. Permite filtrar por categoria, apenas produtos em estoque, ou produtos com estoque abaixo de X unidades (ex: estoque_abaixo_de: 5).',
      parameters: listarProdutosSchema,
      execute: async (args, { ctx, abortSignal }: llm.ToolOptions<SessionUserData>) =>
        executeListarProdutos(args, ctx.userData, abortSignal),
    }),
    llm.tool({
      name: 'buscar_produto_por_nome',
      description:
        'Busca produtos no catálogo do ERP pelo nome falado ou especificação (ex: "filtro de óleo", "óleo 5W30"). Retorna preço, unidade, código e saldo de estoque de todas as correspondências.',
      parameters: buscarProdutoPorNomeSchema,
      execute: async (args, { ctx, abortSignal }: llm.ToolOptions<SessionUserData>) =>
        executeBuscarProdutoPorNome(args, ctx.userData, abortSignal),
    }),
    llm.tool({
      name: 'consultar_produto_por_codigo',
      description:
        'Consulta um produto específico pelo código numérico ou alfanumérico (ex: "125", "101", "201").',
      parameters: consultarProdutoPorCodigoSchema,
      execute: async (args, { ctx, abortSignal }: llm.ToolOptions<SessionUserData>) =>
        executeConsultarProdutoPorCodigo(args, ctx.userData, abortSignal),
    }),
    llm.tool({
      name: 'consultar_estoque',
      description:
        'Consulta a quantidade disponível em estoque e localização de bancada de um produto pelo seu produto_id ou código.',
      parameters: consultarEstoqueSchema,
      execute: async (args, { ctx, abortSignal }: llm.ToolOptions<SessionUserData>) =>
        executeConsultarEstoque(args, ctx.userData, abortSignal),
    }),
    llm.tool({
      name: 'consultar_total_os',
      description:
        'Consulta o valor total atualizado de uma Ordem de Serviço (total de produtos, total de serviços e valor líquido). Se numero_os for omitido, usa a OS ativa no contexto.',
      parameters: consultarTotalOsSchema,
      execute: async (args, { ctx, abortSignal }: llm.ToolOptions<SessionUserData>) =>
        executeConsultarTotalOs(args, ctx.userData, abortSignal),
    }),
    llm.tool({
      name: 'listar_itens_os',
      description:
        'Lista todos os produtos e serviços adicionados em uma Ordem de Serviço, incluindo item_id, quantidades e valores. Se numero_os for omitido, usa a OS ativa no contexto.',
      parameters: listarItensOsSchema,
      execute: async (args, { ctx, abortSignal }: llm.ToolOptions<SessionUserData>) =>
        executeListarItensOs(args, ctx.userData, abortSignal),
    }),
  ];
}
