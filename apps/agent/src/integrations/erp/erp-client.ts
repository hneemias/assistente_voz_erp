import { env } from '../../config/env.ts';
import { buildErpAuthHeaders } from './erp-auth.ts';
import { buildEndpointUrl, getEndpointDefinition } from './erp-endpoints.ts';
import {
  ErpContractPendingError,
  ErpError,
  ErpTimeoutError,
} from './erp-errors.ts';
import { defaultMockStore, type ErpMockStore } from './erp-mock-adapter.ts';
import type {
  ErpOperationName,
  ErpOperationResult,
  EstoqueProduto,
  FiltroOS,
  FiltroProdutos,
  ItemProdutoOS,
  ItemServicoOS,
  OrdemServicoDetalhada,
  OrdemServicoResumo,
  ProdutoERP,
  ServicoERP,
  StatusOS,
  TotaisOS,
} from './erp-types.ts';

export interface ErpClientOptions {
  mode?: 'mock' | 'live';
  baseUrl?: string;
  timeoutMs?: number;
  mockStore?: ErpMockStore;
  fetchImpl?: typeof fetch;
  allowUnconfiguredLiveEndpoints?: boolean;
}

export interface RequestExecutionOptions {
  signal?: AbortSignal;
  idempotencyKey?: string;
  timeoutMs?: number;
}

export class ErpClient {
  public readonly mode: 'mock' | 'live';
  public readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  public readonly mockStore: ErpMockStore;
  private readonly fetchImpl: typeof fetch;
  private readonly allowUnconfiguredLiveEndpoints: boolean;

  constructor(options?: ErpClientOptions) {
    this.mode = options?.mode ?? env.ERP_MODE;
    this.baseUrl = options?.baseUrl ?? env.ERP_API_BASE_URL;
    this.defaultTimeoutMs = options?.timeoutMs ?? env.ERP_API_TIMEOUT_MS;
    this.mockStore = options?.mockStore ?? defaultMockStore;
    this.fetchImpl = options?.fetchImpl ?? globalThis.fetch;
    this.allowUnconfiguredLiveEndpoints = options?.allowUnconfiguredLiveEndpoints ?? false;
  }

  private wrapResult<T>(
    operation: ErpOperationName,
    data: T,
    startTime: number,
    httpStatus = 200,
    idempotencyKey?: string,
  ): ErpOperationResult<T> {
    const def = getEndpointDefinition(operation);
    const durationMs = Math.max(1, Date.now() - startTime);
    return {
      success: true,
      data,
      metadata: {
        operation,
        mode: this.mode,
        contractStatus: def.contractStatus,
        httpStatus,
        durationMs,
        timestamp: new Date().toISOString(),
        idempotencyKey,
        warning:
          this.mode === 'mock'
            ? 'ATENÇÃO: Operação executada no ambiente MOCK local. Contratos REST reais do ERP estão pendentes em config/erp-endpoints.ts.'
            : undefined,
      },
    };
  }

  private async executeHttp<T>(params: {
    operation: ErpOperationName;
    pathParams?: Record<string, string | number>;
    queryParams?: Record<string, string | number | boolean | undefined | null>;
    body?: unknown;
    options?: RequestExecutionOptions;
  }): Promise<ErpOperationResult<T>> {
    const startTime = Date.now();
    const def = getEndpointDefinition(params.operation);

    if (def.contractStatus === 'PENDING_CONTRACT' && !this.allowUnconfiguredLiveEndpoints) {
      throw new ErpContractPendingError(params.operation);
    }

    const url = buildEndpointUrl(
      this.baseUrl,
      params.operation,
      params.pathParams,
      params.queryParams,
    );

    const timeoutMs =
      params.options?.timeoutMs ??
      (this.defaultTimeoutMs < def.timeoutMs ? this.defaultTimeoutMs : def.timeoutMs);
    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(new Error('TIMEOUT'));
    }, timeoutMs);

    const signals: AbortSignal[] = [timeoutController.signal];
    if (params.options?.signal && !def.isMutation) {
      signals.push(params.options.signal);
    }

    const combinedSignal =
      typeof AbortSignal.any === 'function'
        ? AbortSignal.any(signals)
        : timeoutController.signal;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...buildErpAuthHeaders(),
    };

    if (params.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (def.supportsIdempotencyKey && params.options?.idempotencyKey) {
      headers['Idempotency-Key'] = params.options.idempotencyKey;
    }

    try {
      const response = await this.fetchImpl(url, {
        method: def.method,
        headers,
        body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
        signal: combinedSignal,
      });

      if (!response.ok) {
        let errorPayload: unknown = null;
        try {
          errorPayload = await response.json();
        } catch {
          errorPayload = await response.text().catch(() => null);
        }

        const extractedMessage =
          typeof errorPayload === 'object' &&
          errorPayload !== null &&
          'message' in errorPayload &&
          typeof (errorPayload as { message: unknown }).message === 'string'
            ? (errorPayload as { message: string }).message
            : `Erro HTTP ${response.status} ao executar '${params.operation}' no ERP.`;

        throw new ErpError({
          message: extractedMessage,
          code:
            response.status === 404
              ? 'ERP_NOT_FOUND'
              : response.status === 401 || response.status === 403
                ? 'ERP_UNAUTHORIZED'
                : response.status === 409
                  ? 'ERP_CONFLICT'
                  : response.status === 400 || response.status === 422
                    ? 'ERP_VALIDATION_ERROR'
                    : 'ERP_HTTP_ERROR',
          operation: params.operation,
          httpStatus: response.status,
          isMutation: def.isMutation,
          isRetryable: !def.isMutation && response.status >= 500,
          details: errorPayload,
        });
      }

      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch (err) {
        throw new ErpError({
          message: `Resposta JSON inválida recebida do ERP na operação '${params.operation}'.`,
          code: 'ERP_INVALID_RESPONSE',
          operation: params.operation,
          httpStatus: response.status,
          isMutation: def.isMutation,
          details: err instanceof Error ? err.message : String(err),
        });
      }

      if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
        throw new ErpError({
          message: `Formato de resposta inválido do ERP na operação '${params.operation}'.`,
          code: 'ERP_INVALID_RESPONSE',
          operation: params.operation,
          httpStatus: response.status,
          isMutation: def.isMutation,
        });
      }

      const data = ('data' in parsed ? (parsed as { data: T }).data : (parsed as T));
      return this.wrapResult(
        params.operation,
        data,
        startTime,
        response.status,
        params.options?.idempotencyKey,
      );
    } catch (error) {
      if (error instanceof ErpError) {
        throw error;
      }
      if (timeoutController.signal.aborted) {
        throw new ErpTimeoutError(params.operation, timeoutMs, def.isMutation);
      }
      throw new ErpError({
        message: `Falha de comunicação com o ERP durante '${params.operation}': ${
          error instanceof Error ? error.message : String(error)
        }`,
        code: 'ERP_NETWORK_ERROR',
        operation: params.operation,
        httpStatus: null,
        isMutation: def.isMutation,
        isRetryable: false,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // ==========================================================================
  // 10 OPERAÇÕES DE CONSULTA
  // ==========================================================================

  public async consultarOS(
    numeroOs: string,
    options?: RequestExecutionOptions,
  ): Promise<ErpOperationResult<OrdemServicoResumo>> {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult('consultar_os', this.mockStore.consultarOS(numeroOs), start);
    }
    return this.executeHttp<OrdemServicoResumo>({
      operation: 'consultar_os',
      pathParams: { numero_os: numeroOs },
      options,
    });
  }

  public async listarOSAbertas(
    filtros?: FiltroOS,
    options?: RequestExecutionOptions,
  ): Promise<ErpOperationResult<OrdemServicoResumo[]>> {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult('listar_os_abertas', this.mockStore.listarOSAbertas(filtros), start);
    }
    return this.executeHttp<OrdemServicoResumo[]>({
      operation: 'listar_os_abertas',
      queryParams: filtros ? { ...filtros } : undefined,
      options,
    });
  }

  public async listarTodasOS(
    filtros?: FiltroOS,
    options?: RequestExecutionOptions,
  ): Promise<ErpOperationResult<OrdemServicoResumo[]>> {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult('listar_todas_os', this.mockStore.listarTodasOS(filtros), start);
    }
    return this.executeHttp<OrdemServicoResumo[]>({
      operation: 'listar_todas_os',
      queryParams: filtros ? { ...filtros } : undefined,
      options,
    });
  }

  public async consultarDetalhesOS(
    numeroOs: string,
    options?: RequestExecutionOptions,
  ): Promise<ErpOperationResult<OrdemServicoDetalhada>> {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult(
        'consultar_detalhes_os',
        this.mockStore.consultarDetalhesOS(numeroOs),
        start,
      );
    }
    return this.executeHttp<OrdemServicoDetalhada>({
      operation: 'consultar_detalhes_os',
      pathParams: { numero_os: numeroOs },
      options,
    });
  }

  public async listarProdutos(
    filtros?: FiltroProdutos,
    options?: RequestExecutionOptions,
  ): Promise<ErpOperationResult<ProdutoERP[]>> {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult('listar_produtos', this.mockStore.listarProdutos(filtros), start);
    }
    return this.executeHttp<ProdutoERP[]>({
      operation: 'listar_produtos',
      queryParams: filtros ? { ...filtros } : undefined,
      options,
    });
  }

  public async buscarProdutoPorNome(
    nome: string,
    options?: RequestExecutionOptions,
  ): Promise<ErpOperationResult<ProdutoERP[]>> {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult(
        'buscar_produto_por_nome',
        this.mockStore.buscarProdutoPorNome(nome),
        start,
      );
    }
    return this.executeHttp<ProdutoERP[]>({
      operation: 'buscar_produto_por_nome',
      queryParams: { q: nome },
      options,
    });
  }

  public async consultarProdutoPorCodigo(
    codigo: string,
    options?: RequestExecutionOptions,
  ): Promise<ErpOperationResult<ProdutoERP>> {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult(
        'consultar_produto_por_codigo',
        this.mockStore.consultarProdutoPorCodigo(codigo),
        start,
      );
    }
    return this.executeHttp<ProdutoERP>({
      operation: 'consultar_produto_por_codigo',
      pathParams: { codigo },
      options,
    });
  }

  public async consultarEstoque(
    produtoId: string,
    options?: RequestExecutionOptions,
  ): Promise<ErpOperationResult<EstoqueProduto>> {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult(
        'consultar_estoque',
        this.mockStore.consultarEstoque(produtoId),
        start,
      );
    }
    return this.executeHttp<EstoqueProduto>({
      operation: 'consultar_estoque',
      pathParams: { produto_id: produtoId },
      options,
    });
  }

  public async consultarTotalOS(
    numeroOs: string,
    options?: RequestExecutionOptions,
  ): Promise<ErpOperationResult<TotaisOS>> {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult(
        'consultar_total_os',
        this.mockStore.consultarTotalOS(numeroOs),
        start,
      );
    }
    return this.executeHttp<TotaisOS>({
      operation: 'consultar_total_os',
      pathParams: { numero_os: numeroOs },
      options,
    });
  }

  public async listarItensOS(
    numeroOs: string,
    options?: RequestExecutionOptions,
  ): Promise<
    ErpOperationResult<{
      numero_os: string;
      produtos: ItemProdutoOS[];
      servicos: ItemServicoOS[];
      totais: TotaisOS;
    }>
  > {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult('listar_itens_os', this.mockStore.listarItensOS(numeroOs), start);
    }
    return this.executeHttp({
      operation: 'listar_itens_os',
      pathParams: { numero_os: numeroOs },
      options,
    });
  }

  public async listarServicos(
    options?: RequestExecutionOptions,
  ): Promise<ErpOperationResult<ServicoERP[]>> {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult('listar_servicos', this.mockStore.buscarServicos(), start);
    }
    return this.executeHttp<ServicoERP[]>({
      operation: 'listar_servicos',
      options,
    });
  }

  public async buscarServicoPorNome(
    nome: string,
    options?: RequestExecutionOptions,
  ): Promise<ErpOperationResult<ServicoERP[]>> {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult('buscar_servico_por_nome', this.mockStore.buscarServicos(nome), start);
    }
    return this.executeHttp<ServicoERP[]>({
      operation: 'buscar_servico_por_nome',
      queryParams: { q: nome },
      options,
    });
  }

  public async buscarServicosCatalogo(termo?: string): Promise<ServicoERP[]> {
    if (this.mode === 'mock') {
      return this.mockStore.buscarServicos(termo);
    }
    return [];
  }

  // ==========================================================================
  // 5 OPERAÇÕES DE ALTERAÇÃO (ESCRITA)
  // ==========================================================================

  public async alterarStatusOS(
    numeroOs: string,
    status: StatusOS,
    options?: RequestExecutionOptions,
  ): Promise<ErpOperationResult<OrdemServicoResumo>> {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult(
        'alterar_status_os',
        this.mockStore.alterarStatusOS(numeroOs, status),
        start,
        200,
        options?.idempotencyKey,
      );
    }
    return this.executeHttp<OrdemServicoResumo>({
      operation: 'alterar_status_os',
      pathParams: { numero_os: numeroOs },
      body: { status },
      options,
    });
  }

  public async adicionarProdutoOS(
    numeroOs: string,
    produtoId: string,
    quantidade: number,
    precoUnitarioCustom?: number,
    options?: RequestExecutionOptions,
  ): Promise<ErpOperationResult<{ item_adicionado: ItemProdutoOS; totais: TotaisOS }>> {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult(
        'adicionar_produto_os',
        this.mockStore.adicionarProdutoOS(numeroOs, produtoId, quantidade, precoUnitarioCustom),
        start,
        201,
        options?.idempotencyKey,
      );
    }
    return this.executeHttp<{ item_adicionado: ItemProdutoOS; totais: TotaisOS }>({
      operation: 'adicionar_produto_os',
      pathParams: { numero_os: numeroOs },
      body: { produto_id: produtoId, quantidade, preco_unitario: precoUnitarioCustom },
      options,
    });
  }

  public async removerProdutoOS(
    numeroOs: string,
    itemId: string,
    options?: RequestExecutionOptions,
  ): Promise<ErpOperationResult<{ item_removido: ItemProdutoOS; totais: TotaisOS }>> {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult(
        'remover_produto_os',
        this.mockStore.removerProdutoOS(numeroOs, itemId),
        start,
        200,
        options?.idempotencyKey,
      );
    }
    return this.executeHttp<{ item_removido: ItemProdutoOS; totais: TotaisOS }>({
      operation: 'remover_produto_os',
      pathParams: { numero_os: numeroOs, item_id: itemId },
      options,
    });
  }

  public async adicionarServicoOS(
    numeroOs: string,
    servicoId: string,
    quantidade: number,
    valorUnitarioCustom?: number,
    options?: RequestExecutionOptions,
  ): Promise<ErpOperationResult<{ item_adicionado: ItemServicoOS; totais: TotaisOS }>> {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult(
        'adicionar_servico_os',
        this.mockStore.adicionarServicoOS(numeroOs, servicoId, quantidade, valorUnitarioCustom),
        start,
        201,
        options?.idempotencyKey,
      );
    }
    return this.executeHttp<{ item_adicionado: ItemServicoOS; totais: TotaisOS }>({
      operation: 'adicionar_servico_os',
      pathParams: { numero_os: numeroOs },
      body: { servico_id: servicoId, quantidade, valor_unitario: valorUnitarioCustom },
      options,
    });
  }

  public async removerServicoOS(
    numeroOs: string,
    itemId: string,
    options?: RequestExecutionOptions,
  ): Promise<ErpOperationResult<{ item_removido: ItemServicoOS; totais: TotaisOS }>> {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult(
        'remover_servico_os',
        this.mockStore.removerServicoOS(numeroOs, itemId),
        start,
        200,
        options?.idempotencyKey,
      );
    }
    return this.executeHttp<{ item_removido: ItemServicoOS; totais: TotaisOS }>({
      operation: 'remover_servico_os',
      pathParams: { numero_os: numeroOs, item_id: itemId },
      options,
    });
  }

  public async editarItemOS(
    numeroOs: string,
    itemIdOuNomeOuCodigo: string,
    params: {
      novaQuantidade?: number;
      novoValorUnitario?: number;
    },
    options?: RequestExecutionOptions,
  ): Promise<
    ErpOperationResult<{
      item_atualizado: ItemProdutoOS | ItemServicoOS;
      tipo: 'produto' | 'servico';
      totais: TotaisOS;
    }>
  > {
    const start = Date.now();
    if (this.mode === 'mock') {
      return this.wrapResult(
        'editar_item_os',
        this.mockStore.editarItemOS(numeroOs, itemIdOuNomeOuCodigo, params),
        start,
        200,
        options?.idempotencyKey,
      );
    }
    return this.executeHttp({
      operation: 'editar_item_os',
      pathParams: { numero_os: numeroOs, item_id: itemIdOuNomeOuCodigo },
      body: params,
      options,
    });
  }
}

export const defaultErpClient = new ErpClient();
