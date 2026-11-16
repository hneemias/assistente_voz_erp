export type StatusOS =
  | 'aberta'
  | 'em_andamento'
  | 'aguardando_pecas'
  | 'aguardando_aprovacao'
  | 'concluida'
  | 'cancelada';

export interface ItemProdutoOS {
  item_id: string;
  produto_id: string;
  codigo: string;
  nome: string;
  unidade: string;
  quantidade: number;
  preco_unitario: number;
  subtotal: number;
}

export interface ItemServicoOS {
  item_id: string;
  servico_id: string;
  codigo: string;
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  subtotal: number;
}

export interface TotaisOS {
  numero_os: string;
  total_produtos: number;
  total_servicos: number;
  desconto: number;
  valor_total: number;
  moeda: 'BRL';
}

export interface OrdemServicoResumo {
  numero_os: string;
  cliente_nome: string;
  veiculo_equipamento?: string;
  status: StatusOS;
  data_abertura: string; // ISO-8601
  dias_aberta: number;
  aguardando_produto: boolean;
  valor_total: number;
  quantidade_itens: number;
}

export interface OrdemServicoDetalhada extends OrdemServicoResumo {
  observacoes?: string;
  responsavel_tecnico?: string;
  produtos: ItemProdutoOS[];
  servicos: ItemServicoOS[];
  totais: TotaisOS;
  atualizado_em: string;
}

export interface ProdutoERP {
  produto_id: string;
  codigo: string;
  nome: string;
  categoria: string;
  marca?: string;
  especificacao?: string;
  unidade: 'UN' | 'L' | 'KG' | 'KIT' | 'PAR' | 'M';
  preco_venda: number;
  estoque_atual: number;
  estoque_minimo: number;
  ativo: boolean;
}

export interface EstoqueProduto {
  produto_id: string;
  codigo: string;
  nome: string;
  unidade: string;
  estoque_disponivel: number;
  estoque_reservado: number;
  estoque_minimo: number;
  abaixo_do_minimo: boolean;
  localizacao_bancada?: string;
}

export interface ServicoERP {
  servico_id: string;
  codigo: string;
  descricao: string;
  valor_padrao: number;
  tempo_estimado_minutos?: number;
  ativo: boolean;
}

export interface FiltroOS {
  status?: StatusOS;
  aberta_ha_mais_de_dias?: number;
  aguardando_produto?: boolean;
  apenas_nao_concluidas?: boolean;
  cliente?: string;
  limite?: number;
}

export interface FiltroProdutos {
  categoria?: string;
  estoque_abaixo_de?: number;
  apenas_em_estoque?: boolean;
  busca?: string;
  limite?: number;
}

export type ErpOperationName =
  | 'consultar_os'
  | 'listar_os_abertas'
  | 'listar_todas_os'
  | 'consultar_detalhes_os'
  | 'listar_produtos'
  | 'buscar_produto_por_nome'
  | 'consultar_produto_por_codigo'
  | 'consultar_estoque'
  | 'consultar_total_os'
  | 'listar_itens_os'
  | 'alterar_status_os'
  | 'adicionar_produto_os'
  | 'remover_produto_os'
  | 'adicionar_servico_os'
  | 'remover_servico_os';

export interface ErpResponseMetadata {
  operation: ErpOperationName;
  mode: 'mock' | 'live';
  contractStatus: 'PENDING_CONTRACT' | 'CONFIGURED';
  httpStatus: number;
  durationMs: number;
  timestamp: string;
  idempotencyKey?: string;
  warning?: string;
}

export interface ErpOperationResult<T> {
  success: boolean;
  data: T;
  metadata: ErpResponseMetadata;
}
