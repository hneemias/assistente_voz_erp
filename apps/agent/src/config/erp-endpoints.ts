import type { ErpOperationName } from '../integrations/erp/erp-types.ts';

export interface ErpEndpointDefinition {
  operation: ErpOperationName;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /**
   * Template de rota relativo ao ERP_API_BASE_URL.
   * IMPORTANTE: Estes caminhos são placeholders estruturados aguardando o mapeamento
   * oficial do seu ERP Node.js/Express (veja docs/ERP_API_MAPPING.md).
   */
  pathTemplate: string;
  isMutation: boolean;
  supportsIdempotencyKey: boolean;
  timeoutMs: number;
  /**
   * Enquanto o contrato JSON real do ERP não for confirmado pelo usuário,
   * o status permanece 'PENDING_CONTRACT'. Quando você configurar a rota real,
   * altere para 'CONFIGURED'.
   */
  contractStatus: 'PENDING_CONTRACT' | 'CONFIGURED';
  description: string;
}

export const ERP_ENDPOINTS_CONFIG: Record<ErpOperationName, ErpEndpointDefinition> = {
  // ==========================================================================
  // CONSULTAS (LEITURA)
  // ==========================================================================
  consultar_os: {
    operation: 'consultar_os',
    method: 'GET',
    pathTemplate: '/ordens-servico/:numero_os',
    isMutation: false,
    supportsIdempotencyKey: false,
    timeoutMs: 6000,
    contractStatus: 'PENDING_CONTRACT',
    description: 'Consulta resumo e status atual de uma Ordem de Serviço pelo número.',
  },
  listar_os_abertas: {
    operation: 'listar_os_abertas',
    method: 'GET',
    pathTemplate: '/ordens-servico/abertas',
    isMutation: false,
    supportsIdempotencyKey: false,
    timeoutMs: 8000,
    contractStatus: 'PENDING_CONTRACT',
    description: 'Lista ordens de serviço em aberto com filtros opcionais (dias aberta, aguardando peça).',
  },
  listar_todas_os: {
    operation: 'listar_todas_os',
    method: 'GET',
    pathTemplate: '/ordens-servico',
    isMutation: false,
    supportsIdempotencyKey: false,
    timeoutMs: 8000,
    contractStatus: 'PENDING_CONTRACT',
    description: 'Lista todas as ordens de serviço com filtros de status, período ou cliente.',
  },
  consultar_detalhes_os: {
    operation: 'consultar_detalhes_os',
    method: 'GET',
    pathTemplate: '/ordens-servico/:numero_os/detalhes',
    isMutation: false,
    supportsIdempotencyKey: false,
    timeoutMs: 6000,
    contractStatus: 'PENDING_CONTRACT',
    description: 'Consulta detalhes completos da OS incluindo cabeçalho, produtos, serviços e totais.',
  },
  listar_produtos: {
    operation: 'listar_produtos',
    method: 'GET',
    pathTemplate: '/produtos',
    isMutation: false,
    supportsIdempotencyKey: false,
    timeoutMs: 8000,
    contractStatus: 'PENDING_CONTRACT',
    description: 'Lista produtos cadastrados no catálogo com filtros (categoria, estoque baixo).',
  },
  buscar_produto_por_nome: {
    operation: 'buscar_produto_por_nome',
    method: 'GET',
    pathTemplate: '/produtos/busca',
    isMutation: false,
    supportsIdempotencyKey: false,
    timeoutMs: 6000,
    contractStatus: 'PENDING_CONTRACT',
    description: 'Pesquisa produtos por nome falado ou especificação técnica (ex: óleo 5W30, filtro).',
  },
  consultar_produto_por_codigo: {
    operation: 'consultar_produto_por_codigo',
    method: 'GET',
    pathTemplate: '/produtos/codigo/:codigo',
    isMutation: false,
    supportsIdempotencyKey: false,
    timeoutMs: 6000,
    contractStatus: 'PENDING_CONTRACT',
    description: 'Consulta um produto específico pelo seu código ou SKU cadastrado no ERP.',
  },
  consultar_estoque: {
    operation: 'consultar_estoque',
    method: 'GET',
    pathTemplate: '/produtos/:produto_id/estoque',
    isMutation: false,
    supportsIdempotencyKey: false,
    timeoutMs: 6000,
    contractStatus: 'PENDING_CONTRACT',
    description: 'Consulta disponibilidade de estoque atual, reservado e mínimo de um produto.',
  },
  consultar_total_os: {
    operation: 'consultar_total_os',
    method: 'GET',
    pathTemplate: '/ordens-servico/:numero_os/totais',
    isMutation: false,
    supportsIdempotencyKey: false,
    timeoutMs: 6000,
    contractStatus: 'PENDING_CONTRACT',
    description: 'Consulta os totais financeiros (produtos, serviços, descontos e total líquido) da OS.',
  },
  listar_itens_os: {
    operation: 'listar_itens_os',
    method: 'GET',
    pathTemplate: '/ordens-servico/:numero_os/itens',
    isMutation: false,
    supportsIdempotencyKey: false,
    timeoutMs: 6000,
    contractStatus: 'PENDING_CONTRACT',
    description: 'Lista todos os produtos e serviços vinculados a uma Ordem de Serviço.',
  },

  // ==========================================================================
  // ALTERAÇÕES (ESCRITA / MUTAÇÃO — EXIGEM CONFIRMAÇÃO PRÉVIA)
  // ==========================================================================
  alterar_status_os: {
    operation: 'alterar_status_os',
    method: 'PATCH',
    pathTemplate: '/ordens-servico/:numero_os/status',
    isMutation: true,
    supportsIdempotencyKey: true,
    timeoutMs: 8000,
    contractStatus: 'PENDING_CONTRACT',
    description: 'Altera o status de uma Ordem de Serviço (ex: em_andamento, aguardando_pecas, concluida).',
  },
  adicionar_produto_os: {
    operation: 'adicionar_produto_os',
    method: 'POST',
    pathTemplate: '/ordens-servico/:numero_os/produtos',
    isMutation: true,
    supportsIdempotencyKey: true,
    timeoutMs: 8000,
    contractStatus: 'PENDING_CONTRACT',
    description: 'Adiciona um produto e quantidade a uma Ordem de Serviço.',
  },
  remover_produto_os: {
    operation: 'remover_produto_os',
    method: 'DELETE',
    pathTemplate: '/ordens-servico/:numero_os/produtos/:item_id',
    isMutation: true,
    supportsIdempotencyKey: true,
    timeoutMs: 8000,
    contractStatus: 'PENDING_CONTRACT',
    description: 'Remove um item de produto específico de uma Ordem de Serviço.',
  },
  adicionar_servico_os: {
    operation: 'adicionar_servico_os',
    method: 'POST',
    pathTemplate: '/ordens-servico/:numero_os/servicos',
    isMutation: true,
    supportsIdempotencyKey: true,
    timeoutMs: 8000,
    contractStatus: 'PENDING_CONTRACT',
    description: 'Adiciona um serviço e quantidade a uma Ordem de Serviço.',
  },
  remover_servico_os: {
    operation: 'remover_servico_os',
    method: 'DELETE',
    pathTemplate: '/ordens-servico/:numero_os/servicos/:item_id',
    isMutation: true,
    supportsIdempotencyKey: true,
    timeoutMs: 8000,
    contractStatus: 'PENDING_CONTRACT',
    description: 'Remove um item de serviço específico de uma Ordem de Serviço.',
  },
};
