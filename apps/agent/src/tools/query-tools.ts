import { llm } from '@livekit/agents';
import { z } from 'zod';
import { ErpError } from '../integrations/erp/erp-errors.ts';
import type { StatusOS } from '../integrations/erp/erp-types.ts';
import {
  resolveTargetOsNumber,
  setActiveOsContext,
} from '../services/context-manager.ts';
import type { SessionUserData } from '../types/session-types.ts';
import { inovarFiscalSyncService } from '../services/inovar-fiscal-sync.ts';
import { logToolAudit } from '../utils/logger.ts';
import { metrics } from '../utils/metrics.ts';

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

export function formatStatusLabel(status: string): string {
  switch (status) {
    case 'concluido':
    case 'concluida':
      return 'concluído (aguardando pagamento)';
    case 'finalizado':
      return 'finalizado';
    case 'em_processo':
    case 'em_andamento':
      return 'em processo';
    case 'em_processo_terceiros':
      return 'em processo de terceiros';
    case 'aguardando_autorizacao':
    case 'aguardando_aprovacao':
      return 'aguardando autorização';
    case 'aguardando_peca':
    case 'aguardando_pecas':
      return 'aguardando peça';
    case 'nao_aprovado':
      return 'não aprovado';
    case 'cancelada':
      return 'cancelada';
    case 'em_aberto':
    case 'aberta':
    default:
      return status ? status.replace(/_/g, ' ') : 'em aberto';
  }
}

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
      messageForSpeech: `A OS ${os.numero_os} do cliente ${os.cliente_nome}${equipInfo} está com status ${formatStatusLabel(os.status)}, possui ${os.quantidade_itens} itens e valor total de ${os.valor_total.toFixed(2)} reais.`,
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
  apenas_hoje: z
    .boolean()
    .nullable()
    .optional()
    .describe('Se verdadeiro, lista apenas ordens abertas na data de hoje.'),
  data: z
    .string()
    .nullable()
    .optional()
    .describe('Data específica para filtrar as ordens (ex: "hoje", "16/11/2026", "10/11/2026").'),
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
      apenas_hoje: args.apenas_hoje ?? undefined,
      data: args.data ?? undefined,
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
    const isToday = args.apenas_hoje || (args.data && args.data.toLowerCase().includes('hoje'));
    let resumoLista = '';

    if (ordens.length === 0) {
      resumoLista = isToday
        ? 'Nenhuma ordem de serviço em aberto foi encontrada para a data de hoje.'
        : 'Nenhuma ordem de serviço em aberto encontrada com esses critérios.';
    } else if (ordens.length <= 8) {
      const prefix = isToday
        ? `Hoje temos ${ordens.length} ordens de serviço em aberto: `
        : `Foram encontradas ${ordens.length} ordens em aberto (soma de ${somaTotal.toFixed(2)} reais): `;
      resumoLista =
        prefix +
        ordens
          .map((o) => {
            const equip =
              o.veiculo_equipamento &&
              o.veiculo_equipamento !== 'Geral' &&
              o.veiculo_equipamento !== 'Equipamento não especificado'
                ? ` (${o.veiculo_equipamento})`
                : '';
            return `OS ${o.numero_os} de ${o.cliente_nome}${equip}, total ${o.valor_total.toFixed(2)} reais`;
          })
          .join('; ') +
        '.';
    } else {
      const top6 = ordens.slice(0, 6);
      const prefix = isToday
        ? `Hoje temos ${ordens.length} ordens em aberto totalizando ${somaTotal.toFixed(2)} reais. As 6 primeiras são: `
        : `Foram encontradas ${ordens.length} ordens em aberto totalizando ${somaTotal.toFixed(2)} reais. As 6 mais recentes são: `;
      resumoLista =
        prefix +
        top6
          .map(
            (o) =>
              `OS ${o.numero_os} do cliente ${o.cliente_nome} (${formatStatusLabel(o.status)}, total ${o.valor_total.toFixed(2)} reais)`,
          )
          .join('; ') +
        `. E mais ${ordens.length - 6} ordens no sistema.`;
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
  apenas_hoje: z
    .boolean()
    .nullable()
    .optional()
    .describe('Se verdadeiro, filtra apenas ordens com data de hoje.'),
  data: z
    .string()
    .nullable()
    .optional()
    .describe('Data específica para filtrar as ordens (ex: "hoje", "16/11/2026", "10/11/2026").'),
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
      apenas_hoje: args.apenas_hoje ?? undefined,
      data: args.data ?? undefined,
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
    const somaTotal = ordens.reduce((acc, o) => acc + o.valor_total, 0);
    const isToday = args.apenas_hoje || (args.data && args.data.toLowerCase().includes('hoje'));
    let resumoLista = '';

    if (ordens.length === 0) {
      resumoLista = isToday
        ? 'Nenhuma ordem de serviço foi encontrada para a data de hoje.'
        : 'Nenhuma ordem de serviço encontrada.';
    } else if (ordens.length <= 8) {
      const prefix = isToday ? `Hoje temos ${ordens.length} ordens de serviço: ` : `Total de ${ordens.length} ordens encontradas: `;
      resumoLista =
        prefix +
        ordens
          .map((o) => {
            const equip =
              o.veiculo_equipamento &&
              o.veiculo_equipamento !== 'Geral' &&
              o.veiculo_equipamento !== 'Equipamento não especificado'
                ? ` (${o.veiculo_equipamento})`
                : '';
            return `OS ${o.numero_os} de ${o.cliente_nome}${equip}, status ${formatStatusLabel(o.status)}, total ${o.valor_total.toFixed(2)} reais`;
          })
          .join('; ') +
        '.';
    } else {
      const top6 = ordens.slice(0, 6);
      const prefix = isToday
        ? `Hoje temos ${ordens.length} ordens somando ${somaTotal.toFixed(2)} reais. As 6 primeiras são: `
        : `Total de ${ordens.length} ordens encontradas somando ${somaTotal.toFixed(2)} reais. As 6 mais recentes são: `;
      resumoLista =
        prefix +
        top6
          .map(
            (o) =>
              `OS ${o.numero_os} (${formatStatusLabel(o.status)}, total ${o.valor_total.toFixed(2)} reais)`,
          )
          .join('; ') +
        `. E mais ${ordens.length - 6} ordens.`;
    }

    return {
      status: 'SUCCESS',
      messageForSpeech: resumoLista,
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
      messageForSpeech: `Detalhes da OS ${d.numero_os}: cliente ${d.cliente_nome}${equipInfo}, status ${formatStatusLabel(d.status)}, aberta há ${d.dias_aberta} dias.${obsSnippet} Possui ${d.produtos.length} produtos (${d.totais.total_produtos.toFixed(2)} reais) e ${d.servicos.length} serviços (${d.totais.total_servicos.toFixed(2)} reais), somando ${d.totais.valor_total.toFixed(2)} reais.`,
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
    let messageForSpeech = '';
    if (prods.length === 0) {
      messageForSpeech = 'Nenhum produto encontrado com esses filtros.';
    } else if (!args.categoria && !args.busca && prods.length > 8) {
      messageForSpeech =
        `Temos ${prods.length} produtos cadastrados. As principais categorias são: Impressoras (Epson L3250 e Hayom de Etiquetas), Tintas Epson 544, Fontes de notebook Dell, Câmeras e Redes Intelbras, Periféricos (mouses e caixas de som) e Licenças Antivírus Kaspersky. Você pode me pedir detalhes de qualquer item ou consultar o estoque.`;
    } else {
      messageForSpeech =
        `Encontrados ${prods.length} produtos: ` +
        prods
          .map(
            (p) =>
              `código ${p.codigo} - ${p.nome} (${p.preco_venda.toFixed(2)} reais/${p.unidade}, estoque: ${p.estoque_atual})`,
          )
          .join('; ');
    }

    return {
      status: 'SUCCESS',
      messageForSpeech,
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
// 5.1. listar_servicos(busca)
// ============================================================================
export const listarServicosSchema = z.object({
  busca: z.string().nullable().optional().describe('Termo opcional de busca para filtrar serviços.'),
});

export async function executeListarServicos(
  args: z.infer<typeof listarServicosSchema>,
  userData: SessionUserData,
  abortSignal?: AbortSignal,
): Promise<ToolResponse> {
  const startTime = Date.now();
  try {
    const res = args.busca
      ? await userData.erpClient.buscarServicoPorNome(args.busca, { signal: abortSignal })
      : await userData.erpClient.listarServicos({ signal: abortSignal });
    const durationMs = Math.max(1, Date.now() - startTime);

    metrics.recordToolCall({ toolName: 'listar_servicos', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'listar_servicos_catalogo',
      toolName: 'listar_servicos',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      erpMode: userData.erpClient.mode,
    });

    const servicos = res.data.filter((s) => !s.codigo.startsWith('S0'));
    const servicosLista = servicos.length > 0 ? servicos : res.data;
    const resumo =
      servicosLista.length === 0
        ? 'Nenhum serviço encontrado com esse termo.'
        : `Temos ${servicosLista.length} serviços cadastrados na assistência: ` +
          servicosLista
            .map((s) => `código ${s.codigo} - ${s.descricao} (${s.valor_padrao.toFixed(2)} reais)`)
            .join('; ');

    return {
      status: 'SUCCESS',
      messageForSpeech: resumo,
      data: { quantidade: servicosLista.length, servicos: servicosLista },
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleQueryError(err, 'listar_servicos', 'listar_servicos_catalogo', userData, startTime);
  }
}

// ============================================================================
// 5.2. buscar_servico_por_nome(nome)
// ============================================================================
export const buscarServicoPorNomeSchema = z.object({
  nome: z
    .string()
    .min(1)
    .describe('Nome ou descrição falada do serviço (ex: "formatação", "limpeza", "reset", "análise").'),
});

export async function executeBuscarServicoPorNome(
  args: z.infer<typeof buscarServicoPorNomeSchema>,
  userData: SessionUserData,
  abortSignal?: AbortSignal,
): Promise<ToolResponse> {
  const startTime = Date.now();
  try {
    const res = await userData.erpClient.buscarServicoPorNome(args.nome, { signal: abortSignal });
    const durationMs = Math.max(1, Date.now() - startTime);

    metrics.recordToolCall({ toolName: 'buscar_servico_por_nome', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'buscar_servico_por_nome',
      toolName: 'buscar_servico_por_nome',
      durationMs,
      httpStatus: res.metadata.httpStatus,
      operationResult: 'SUCCESS',
      erpMode: userData.erpClient.mode,
    });

    const srvs = res.data;
    if (srvs.length === 0) {
      return {
        status: 'NOT_FOUND',
        messageForSpeech: `Nenhum serviço encontrado com o nome '${args.nome}'.`,
        data: { quantidade: 0, servicos: [] },
        erpMode: userData.erpClient.mode,
        activeOsNumber: userData.activeOsNumber,
      };
    }

    return {
      status: srvs.length > 1 ? 'AMBIGUOUS' : 'SUCCESS',
      messageForSpeech:
        srvs.length === 1
          ? `Serviço encontrado: código ${srvs[0]!.codigo} - ${srvs[0]!.descricao}, valor padrão de ${srvs[0]!.valor_padrao.toFixed(2)} reais.`
          : `Foram encontrados ${srvs.length} serviços compatíveis: ` +
            srvs.map((s) => `código ${s.codigo} (${s.descricao}, ${s.valor_padrao.toFixed(2)} reais)`).join('; '),
      data: { quantidade: srvs.length, servicos: srvs },
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleQueryError(err, 'buscar_servico_por_nome', 'buscar_servico_por_nome', userData, startTime);
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
// 11. sincronizar_erp(data_inicio, data_fim)
// ============================================================================
export const sincronizarErpSchema = z.object({
  data_inicio: z
    .string()
    .nullable()
    .optional()
    .describe('Data inicial para buscar ordens no formato DD/MM/AAAA. Se omitido, usa os últimos 7 dias.'),
  data_fim: z
    .string()
    .nullable()
    .optional()
    .describe('Data final no formato DD/MM/AAAA. Se omitido, usa a data de hoje.'),
});

export async function executeSincronizarErp(
  args: z.infer<typeof sincronizarErpSchema>,
  userData: SessionUserData,
): Promise<ToolResponse> {
  const startTime = Date.now();
  try {
    const res = await inovarFiscalSyncService.triggerSync({
      startDate: args.data_inicio ?? undefined,
      endDate: args.data_fim ?? undefined,
    });
    const durationMs = Math.max(1, Date.now() - startTime);

    metrics.recordToolCall({ toolName: 'sincronizar_erp', durationMs, outcome: 'SUCCESS' });
    logToolAudit({
      sessionId: userData.sessionId,
      userId: userData.userId,
      intent: 'sincronizar_erp',
      toolName: 'sincronizar_erp',
      durationMs,
      operationResult: 'SUCCESS',
      erpMode: userData.erpClient.mode,
    });

    return {
      status: 'SUCCESS',
      messageForSpeech:
        'Iniciei a sincronização com o Inovar Fiscal em segundo plano. Assim que terminar a extração eu te aviso aqui.',
      data: res,
      erpMode: userData.erpClient.mode,
      activeOsNumber: userData.activeOsNumber,
    };
  } catch (err) {
    return handleQueryError(err, 'sincronizar_erp', 'sincronizar_erp', userData, startTime);
  }
}

// ============================================================================
// BUILD LIVEKIT FUNCTION TOOLS FOR AGENT
// ============================================================================
export function createQueryTools() {
  return [
    llm.tool({
      name: 'sincronizar_erp',
      description:
        'Dispara uma sincronização em segundo plano das Ordens de Serviço diretamente com o Inovar Fiscal ERP. Use quando o operador pedir "atualize as ordens", "sincronize com o ERP", "puxe as últimas OSs do sistema" ou similar. A sincronização roda em background e o assistente avisará quando concluir assim que houver um momento de pausa.',
      parameters: sincronizarErpSchema,
      execute: async (args, { ctx }: llm.ToolOptions<SessionUserData>) =>
        executeSincronizarErp(args, ctx.userData),
    }),
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
      name: 'listar_servicos',
      description:
        'Lista todos os serviços oferecidos pela assistência técnica (ex: Formatação, Limpeza Interna, Reset de Impressora, Análise Técnica, Prestação de Serviços) com seus códigos e valores.',
      parameters: listarServicosSchema,
      execute: async (args, { ctx, abortSignal }: llm.ToolOptions<SessionUserData>) =>
        executeListarServicos(args, ctx.userData, abortSignal),
    }),
    llm.tool({
      name: 'buscar_servico_por_nome',
      description:
        'Busca serviços da assistência técnica pelo nome falado (ex: "formatação", "limpeza", "reset", "análise"). Retorna código e valor padrão.',
      parameters: buscarServicoPorNomeSchema,
      execute: async (args, { ctx, abortSignal }: llm.ToolOptions<SessionUserData>) =>
        executeBuscarServicoPorNome(args, ctx.userData, abortSignal),
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
