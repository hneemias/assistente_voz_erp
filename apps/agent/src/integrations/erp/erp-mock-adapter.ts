import { ErpNotFoundError, ErpValidationError } from './erp-errors.ts';
import realOrdersData from './mock-data/real-erp-orders.json' with { type: 'json' };
import type {
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

function normalizeText(value?: string | null): string {
  if (!value) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseBrazilianDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString();
  const parts = dateStr.trim().split(' ');
  const dateParts = parts[0]?.split('/');
  if (dateParts && dateParts.length === 3) {
    const timePart = parts[1] || '00:00:00';
    return `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}T${timePart}-03:00`;
  }
  return dateStr;
}

function parseBrazilianCurrency(val: string | number): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const cleaned = String(val).replace(/\./g, '').replace(',', '.').trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

function calculateDaysOpen(dateStr: string, refDate = new Date('2026-11-16T15:00:00-03:00')): number {
  const osDate = new Date(parseBrazilianDate(dateStr));
  const diffTime = Math.max(0, refDate.getTime() - osDate.getTime());
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

function mapSituationToStatus(situacao: string): StatusOS {
  const norm = normalizeText(situacao);
  if (norm.includes('concluid') || norm.includes('finaliz')) return 'concluida';
  if (norm.includes('cancel')) return 'cancelada';
  if (norm.includes('aguard')) return 'aguardando_pecas';
  if (norm.includes('andamento')) return 'em_andamento';
  return 'aberta';
}

function getCategoryForProduct(name: string): string {
  const n = normalizeText(name);
  if (n.includes('impressora')) return 'Impressoras';
  if (n.includes('tinta') || n.includes('refil')) return 'Tintas e Suprimentos';
  if (n.includes('notebook') || n.includes('fonte')) return 'Notebooks e Fontes';
  if (n.includes('camera') || n.includes('vbox')) return 'Segurança e Redes';
  if (n.includes('mouse') || n.includes('cooler') || n.includes('som')) return 'Periféricos';
  if (n.includes('cartao') || n.includes('memoria') || n.includes('ssd')) return 'Armazenamento';
  if (n.includes('cabo') || n.includes('plug')) return 'Cabos e Conectores';
  if (n.includes('antivirus') || n.includes('licenca')) return 'Software';
  return 'Geral';
}

export class ErpMockStore {
  private ordens = new Map<string, OrdemServicoDetalhada>();
  private produtos = new Map<string, ProdutoERP>();
  private servicos = new Map<string, ServicoERP>();
  private nextItemSeq = 900;

  constructor() {
    this.seed();
  }

  public reset(): void {
    this.ordens.clear();
    this.produtos.clear();
    this.servicos.clear();
    this.nextItemSeq = 900;
    this.seed();
  }

  private seed(): void {
    const initialProdutos: ProdutoERP[] = [
      {
        produto_id: 'PROD-101',
        codigo: '101',
        nome: 'Filtro de Óleo Tecfil PSL55 (Linha Leve)',
        categoria: 'Filtros',
        marca: 'Tecfil',
        especificacao: 'PSL55 Rosca M20',
        unidade: 'UN',
        preco_venda: 45.0,
        estoque_atual: 18,
        estoque_minimo: 5,
        ativo: true,
      },
      {
        produto_id: 'PROD-102',
        codigo: '102',
        nome: 'Filtro de Óleo Mann W712/95 (Linha TSI)',
        categoria: 'Filtros',
        marca: 'Mann',
        especificacao: 'W712/95 Alta Pressão',
        unidade: 'UN',
        preco_venda: 68.0,
        estoque_atual: 7,
        estoque_minimo: 5,
        ativo: true,
      },
      {
        produto_id: 'PROD-125',
        codigo: '125',
        nome: 'Pastilha de Freio Dianteira Cobreq N-250',
        categoria: 'Freios',
        marca: 'Cobreq',
        especificacao: 'Dianteira Cerâmica',
        unidade: 'KIT',
        preco_venda: 185.0,
        estoque_atual: 4,
        estoque_minimo: 5,
        ativo: true,
      },
      {
        produto_id: 'PROD-201',
        codigo: '201',
        nome: 'Óleo Motor 5W30 Sintético Castrol Magnatec',
        categoria: 'Lubrificantes',
        marca: 'Castrol',
        especificacao: '5W30 API SP Sintético',
        unidade: 'L',
        preco_venda: 58.0,
        estoque_atual: 24,
        estoque_minimo: 10,
        ativo: true,
      },
      {
        produto_id: 'PROD-202',
        codigo: '202',
        nome: 'Óleo Motor 5W30 Sintético Mobil Super',
        categoria: 'Lubrificantes',
        marca: 'Mobil',
        especificacao: '5W30 Dexos1 Gen3',
        unidade: 'L',
        preco_venda: 52.0,
        estoque_atual: 12,
        estoque_minimo: 8,
        ativo: true,
      },
      {
        produto_id: 'PROD-305',
        codigo: '305',
        nome: 'Fluido de Freio DOT 4 Bosch 500ml',
        categoria: 'Fluidos',
        marca: 'Bosch',
        especificacao: 'DOT 4 500ml',
        unidade: 'UN',
        preco_venda: 39.0,
        estoque_atual: 3,
        estoque_minimo: 6,
        ativo: true,
      },
      {
        produto_id: 'PROD-410',
        codigo: '410',
        nome: 'Correia Dentada Gates CT874',
        categoria: 'Motor',
        marca: 'Gates',
        especificacao: '111 Dentes',
        unidade: 'UN',
        preco_venda: 140.0,
        estoque_atual: 2,
        estoque_minimo: 5,
        ativo: true,
      },
    ];

    for (const prod of initialProdutos) {
      this.produtos.set(prod.produto_id, prod);
    }

    const initialServicos: ServicoERP[] = [
      {
        servico_id: 'SRV-01',
        codigo: 'S01',
        descricao: 'Troca de óleo e filtro',
        valor_padrao: 90.0,
        tempo_estimado_minutos: 45,
        ativo: true,
      },
      {
        servico_id: 'SRV-02',
        codigo: 'S02',
        descricao: 'Alinhamento e balanceamento 3D',
        valor_padrao: 150.0,
        tempo_estimado_minutos: 60,
        ativo: true,
      },
      {
        servico_id: 'SRV-03',
        codigo: 'S03',
        descricao: 'Revisão completa do sistema de freios',
        valor_padrao: 220.0,
        tempo_estimado_minutos: 90,
        ativo: true,
      },
      {
        servico_id: 'SRV-04',
        codigo: 'S04',
        descricao: 'Diagnóstico computadorizado via scanner',
        valor_padrao: 120.0,
        tempo_estimado_minutos: 30,
        ativo: true,
      },
    ];

    for (const srv of initialServicos) {
      this.servicos.set(srv.servico_id, srv);
    }

    const os3030Produtos: ItemProdutoOS[] = [
      {
        item_id: 'ITEM-P-301',
        produto_id: 'PROD-101',
        codigo: '101',
        nome: 'Filtro de Óleo Tecfil PSL55 (Linha Leve)',
        unidade: 'UN',
        quantidade: 1,
        preco_unitario: 45.0,
        subtotal: 45.0,
      },
      {
        item_id: 'ITEM-P-302',
        produto_id: 'PROD-201',
        codigo: '201',
        nome: 'Óleo Motor 5W30 Sintético Castrol Magnatec',
        unidade: 'L',
        quantidade: 4,
        preco_unitario: 58.0,
        subtotal: 232.0,
      },
    ];

    const os3030Servicos: ItemServicoOS[] = [
      {
        item_id: 'ITEM-S-301',
        servico_id: 'SRV-01',
        codigo: 'S01',
        descricao: 'Troca de óleo e filtro',
        quantidade: 1,
        valor_unitario: 90.0,
        subtotal: 90.0,
      },
      {
        item_id: 'ITEM-S-302',
        servico_id: 'SRV-02',
        codigo: 'S02',
        descricao: 'Alinhamento e balanceamento 3D',
        quantidade: 1,
        valor_unitario: 150.0,
        subtotal: 150.0,
      },
    ];

    this.ordens.set('3030', this.buildOrdem({
      numero_os: '3030',
      cliente_nome: 'Carlos Eduardo Mendes',
      veiculo_equipamento: 'VW Gol 1.6 MSI - Placa ABC-3030',
      status: 'em_andamento',
      data_abertura: '2026-11-14T08:30:00-03:00',
      dias_aberta: 2,
      aguardando_produto: false,
      observacoes: 'Revisão de 40.000 km na bancada 01.',
      responsavel_tecnico: 'Operador Bancada 01',
      produtos: os3030Produtos,
      servicos: os3030Servicos,
    }));

    this.ordens.set('3031', this.buildOrdem({
      numero_os: '3031',
      cliente_nome: 'Transportadora Rápido Sul Ltda',
      veiculo_equipamento: 'Fiat Fiorino Endurance - Placa RTY-3031',
      status: 'aguardando_pecas',
      data_abertura: '2026-11-10T09:15:00-03:00',
      dias_aberta: 6,
      aguardando_produto: true,
      observacoes: 'Aguardando kit de embreagem do fornecedor.',
      responsavel_tecnico: 'Operador Bancada 02',
      produtos: [
        {
          item_id: 'ITEM-P-310',
          produto_id: 'PROD-125',
          codigo: '125',
          nome: 'Pastilha de Freio Dianteira Cobreq N-250',
          unidade: 'KIT',
          quantidade: 1,
          preco_unitario: 185.0,
          subtotal: 185.0,
        },
      ],
      servicos: [
        {
          item_id: 'ITEM-S-311',
          servico_id: 'SRV-03',
          codigo: 'S03',
          descricao: 'Revisão completa do sistema de freios',
          quantidade: 1,
          valor_unitario: 220.0,
          subtotal: 220.0,
        },
      ],
    }));

    this.ordens.set('4040', this.buildOrdem({
      numero_os: '4040',
      cliente_nome: 'Mariana Costa',
      veiculo_equipamento: 'Chevrolet Onix 1.0 Turbo - Placa ONX-4040',
      status: 'aberta',
      data_abertura: '2026-11-12T14:00:00-03:00',
      dias_aberta: 4,
      aguardando_produto: false,
      observacoes: 'Verificar ruído na suspensão dianteira e diagnóstico via scanner.',
      responsavel_tecnico: 'Operador Bancada 01',
      produtos: [],
      servicos: [
        {
          item_id: 'ITEM-S-401',
          servico_id: 'SRV-04',
          codigo: 'S04',
          descricao: 'Diagnóstico computadorizado via scanner',
          quantidade: 1,
          valor_unitario: 120.0,
          subtotal: 120.0,
        },
      ],
    }));

    this.ordens.set('2090', this.buildOrdem({
      numero_os: '2090',
      cliente_nome: 'Roberto Almeida',
      veiculo_equipamento: 'Toyota Corolla XEi - Placa COR-2090',
      status: 'concluida',
      data_abertura: '2026-11-08T10:00:00-03:00',
      dias_aberta: 8,
      aguardando_produto: false,
      observacoes: 'Serviço finalizado e entregue.',
      responsavel_tecnico: 'Operador Bancada 01',
      produtos: [],
      servicos: [
        {
          item_id: 'ITEM-S-291',
          servico_id: 'SRV-01',
          codigo: 'S01',
          descricao: 'Troca de óleo e filtro',
          quantidade: 1,
          valor_unitario: 90.0,
          subtotal: 90.0,
        },
      ],
    }));

    // Ingestão das 26 Ordens de Serviço reais extraídas do ERP de produção
    for (const raw of realOrdersData.result) {
      const osServicos: ItemServicoOS[] = [];
      const osProdutos: ItemProdutoOS[] = [];

      for (const it of raw.itens || []) {
        const isService = /servico|analise|reset|formatac|limpeza/i.test(it.produtoServico);
        if (isService) {
          const srvId = `SRV-${it.codigo}`;
          if (!this.servicos.has(srvId)) {
            this.servicos.set(srvId, {
              servico_id: srvId,
              codigo: it.codigo,
              descricao: it.produtoServico,
              valor_padrao: it.valorUnitario,
              tempo_estimado_minutos: 60,
              ativo: true,
            });
          }
          osServicos.push({
            item_id: `ITEM-S-${raw.numero}-${it.seq}`,
            servico_id: srvId,
            codigo: it.codigo,
            descricao: it.produtoServico,
            quantidade: it.quantidade,
            valor_unitario: it.valorUnitario,
            subtotal: it.quantidade * it.valorUnitario,
          });
        } else {
          const prodId = `PROD-${it.codigo}`;
          if (!this.produtos.has(prodId)) {
            this.produtos.set(prodId, {
              produto_id: prodId,
              codigo: it.codigo,
              nome: it.produtoServico,
              categoria: getCategoryForProduct(it.produtoServico),
              marca: it.marca || undefined,
              especificacao: it.referencia || undefined,
              unidade: (it.unidade || 'UN') as any,
              preco_venda: it.valorUnitario,
              estoque_atual: 12,
              estoque_minimo: 3,
              ativo: true,
            });
          }
          osProdutos.push({
            item_id: `ITEM-P-${raw.numero}-${it.seq}`,
            produto_id: prodId,
            codigo: it.codigo,
            nome: it.produtoServico,
            unidade: it.unidade || 'UN',
            quantidade: it.quantidade,
            preco_unitario: it.valorUnitario,
            subtotal: it.quantidade * it.valorUnitario,
          });
        }
      }

      const status = mapSituationToStatus(raw.situacao);
      const dataAbertura = parseBrazilianDate(raw.data);
      const diasAberta = calculateDaysOpen(raw.data);
      const valorTotal =
        parseBrazilianCurrency(raw.vendedor) ||
        osProdutos.reduce((a, b) => a + b.subtotal, 0) + osServicos.reduce((a, b) => a + b.subtotal, 0);

      const eq = [raw.equipamento, raw.marcaEquipamento, raw.modelo].filter(Boolean).join(' ');
      const veiculoEquip = eq || (raw.observacao ? raw.observacao.split('\n')[0].substring(0, 40) : 'Equipamento não especificado');

      this.ordens.set(
        raw.numero,
        this.buildOrdem({
          numero_os: raw.numero,
          cliente_nome: raw.cliente,
          veiculo_equipamento: veiculoEquip,
          equipamento: raw.equipamento || undefined,
          modelo: raw.modelo || undefined,
          marca_equipamento: raw.marcaEquipamento || undefined,
          numero_serie: raw.nSerie || undefined,
          status,
          data_abertura: dataAbertura,
          dias_aberta: diasAberta,
          aguardando_produto: false,
          observacoes:
            [raw.observacao, raw.obsLaudoTecnico ? `Laudo: ${raw.obsLaudoTecnico}` : ''].filter(Boolean).join('\n') || undefined,
          responsavel_tecnico: 'Inovar Assistência',
          cpf_cnpj: raw.cpfCnpj || undefined,
          endereco: raw.endereco || undefined,
          laudo_tecnico: raw.obsLaudoTecnico || undefined,
          produtos: osProdutos,
          servicos: osServicos,
          valor_total_override: valorTotal,
        }),
      );
    }
  }

  private buildOrdem(params: {
    numero_os: string;
    cliente_nome: string;
    veiculo_equipamento?: string;
    equipamento?: string;
    modelo?: string;
    marca_equipamento?: string;
    numero_serie?: string;
    status: StatusOS;
    data_abertura: string;
    dias_aberta: number;
    aguardando_produto: boolean;
    observacoes?: string;
    responsavel_tecnico?: string;
    cpf_cnpj?: string;
    endereco?: string;
    laudo_tecnico?: string;
    produtos: ItemProdutoOS[];
    servicos: ItemServicoOS[];
    valor_total_override?: number;
  }): OrdemServicoDetalhada {
    const total_produtos = params.produtos.reduce((acc, p) => acc + p.subtotal, 0);
    const total_servicos = params.servicos.reduce((acc, s) => acc + s.subtotal, 0);
    const valor_total =
      params.valor_total_override !== undefined ? params.valor_total_override : total_produtos + total_servicos;

    return {
      numero_os: params.numero_os,
      cliente_nome: params.cliente_nome,
      veiculo_equipamento: params.veiculo_equipamento,
      equipamento: params.equipamento,
      modelo: params.modelo,
      marca_equipamento: params.marca_equipamento,
      numero_serie: params.numero_serie,
      status: params.status,
      data_abertura: params.data_abertura,
      dias_aberta: params.dias_aberta,
      aguardando_produto: params.aguardando_produto,
      valor_total,
      quantidade_itens: params.produtos.length + params.servicos.length,
      observacoes: params.observacoes,
      responsavel_tecnico: params.responsavel_tecnico,
      cpf_cnpj: params.cpf_cnpj,
      endereco: params.endereco,
      laudo_tecnico: params.laudo_tecnico,
      produtos: params.produtos,
      servicos: params.servicos,
      totais: {
        numero_os: params.numero_os,
        total_produtos,
        total_servicos,
        desconto: 0,
        valor_total,
        moeda: 'BRL',
      },
      atualizado_em: new Date().toISOString(),
    };
  }

  private recalculateOrdem(os: OrdemServicoDetalhada): void {
    const total_produtos = os.produtos.reduce((acc, p) => acc + p.subtotal, 0);
    const total_servicos = os.servicos.reduce((acc, s) => acc + s.subtotal, 0);
    const valor_total = total_produtos + total_servicos - os.totais.desconto;

    os.totais = {
      numero_os: os.numero_os,
      total_produtos,
      total_servicos,
      desconto: os.totais.desconto,
      valor_total,
      moeda: 'BRL',
    };
    os.valor_total = valor_total;
    os.quantidade_itens = os.produtos.length + os.servicos.length;
    os.atualizado_em = new Date().toISOString();
  }

  private toResumo(os: OrdemServicoDetalhada): OrdemServicoResumo {
    return {
      numero_os: os.numero_os,
      cliente_nome: os.cliente_nome,
      veiculo_equipamento: os.veiculo_equipamento,
      equipamento: os.equipamento,
      modelo: os.modelo,
      marca_equipamento: os.marca_equipamento,
      numero_serie: os.numero_serie,
      status: os.status,
      data_abertura: os.data_abertura,
      dias_aberta: os.dias_aberta,
      aguardando_produto: os.aguardando_produto,
      valor_total: os.valor_total,
      quantidade_itens: os.quantidade_itens,
    };
  }

  public consultarOS(numeroOs: string): OrdemServicoResumo {
    const os = this.ordens.get(String(numeroOs).trim());
    if (!os) {
      throw new ErpNotFoundError('consultar_os', `Ordem de Serviço ${numeroOs}`);
    }
    return this.toResumo(os);
  }

  public consultarDetalhesOS(numeroOs: string): OrdemServicoDetalhada {
    const os = this.ordens.get(String(numeroOs).trim());
    if (!os) {
      throw new ErpNotFoundError('consultar_detalhes_os', `Ordem de Serviço ${numeroOs}`);
    }
    return structuredClone(os);
  }

  public listarOSAbertas(filtros?: FiltroOS): OrdemServicoResumo[] {
    const abertas = Array.from(this.ordens.values()).filter(
      (os) => os.status !== 'concluida' && os.status !== 'cancelada',
    );
    return this.applyFiltroOS(abertas, filtros).map((os) => this.toResumo(os));
  }

  public listarTodasOS(filtros?: FiltroOS): OrdemServicoResumo[] {
    const todas = Array.from(this.ordens.values());
    return this.applyFiltroOS(todas, filtros).map((os) => this.toResumo(os));
  }

  private applyFiltroOS(
    lista: OrdemServicoDetalhada[],
    filtros?: FiltroOS,
  ): OrdemServicoDetalhada[] {
    if (!filtros) return lista;
    return lista.filter((os) => {
      if (filtros.status && os.status !== filtros.status) return false;
      if (
        filtros.aberta_ha_mais_de_dias !== undefined &&
        os.dias_aberta <= filtros.aberta_ha_mais_de_dias
      ) {
        return false;
      }
      if (
        filtros.aguardando_produto !== undefined &&
        os.aguardando_produto !== filtros.aguardando_produto
      ) {
        return false;
      }
      if (
        filtros.apenas_nao_concluidas &&
        (os.status === 'concluida' || os.status === 'cancelada')
      ) {
        return false;
      }
      if (
        filtros.cliente &&
        !normalizeText(os.cliente_nome).includes(normalizeText(filtros.cliente))
      ) {
        return false;
      }
      return true;
    });
  }

  public listarProdutos(filtros?: FiltroProdutos): ProdutoERP[] {
    let lista = Array.from(this.produtos.values()).filter((p) => p.ativo);
    if (filtros) {
      if (filtros.categoria) {
        const cat = normalizeText(filtros.categoria);
        lista = lista.filter((p) => normalizeText(p.categoria).includes(cat));
      }
      if (filtros.estoque_abaixo_de !== undefined) {
        lista = lista.filter((p) => p.estoque_atual < filtros.estoque_abaixo_de!);
      }
      if (filtros.apenas_em_estoque) {
        lista = lista.filter((p) => p.estoque_atual > 0);
      }
      if (filtros.busca) {
        lista = this.buscarProdutoPorNome(filtros.busca);
      }
      if (filtros.limite && filtros.limite > 0) {
        lista = lista.slice(0, filtros.limite);
      }
    }
    return structuredClone(lista);
  }

  public buscarProdutoPorNome(termo: string): ProdutoERP[] {
    const query = normalizeText(termo);
    if (!query) return [];
    const tokens = query
      .split(/\s+/)
      .filter((t) => t.length > 1 && !['de', 'do', 'da', 'para', 'com', 'um', 'uma'].includes(t));

    return Array.from(this.produtos.values())
      .filter((prod) => {
        if (!prod.ativo) return false;
        const searchable = normalizeText(
          `${prod.nome} ${prod.categoria} ${prod.marca ?? ''} ${prod.especificacao ?? ''} ${prod.codigo}`,
        );
        if (searchable.includes(query)) return true;
        return tokens.length > 0 && tokens.every((tk) => searchable.includes(tk));
      })
      .map((p) => structuredClone(p));
  }

  public consultarProdutoPorCodigo(codigo: string): ProdutoERP {
    const clean = String(codigo).trim().toUpperCase();
    const found = Array.from(this.produtos.values()).find(
      (p) => p.codigo.toUpperCase() === clean || p.produto_id.toUpperCase() === clean,
    );
    if (!found) {
      throw new ErpNotFoundError('consultar_produto_por_codigo', `Produto com código '${codigo}'`);
    }
    return structuredClone(found);
  }

  public consultarEstoque(produtoIdOuCodigo: string): EstoqueProduto {
    const clean = String(produtoIdOuCodigo).trim().toUpperCase();
    const prod = Array.from(this.produtos.values()).find(
      (p) => p.produto_id.toUpperCase() === clean || p.codigo.toUpperCase() === clean,
    );
    if (!prod) {
      throw new ErpNotFoundError('consultar_estoque', `Produto '${produtoIdOuCodigo}'`);
    }
    return {
      produto_id: prod.produto_id,
      codigo: prod.codigo,
      nome: prod.nome,
      unidade: prod.unidade,
      estoque_disponivel: prod.estoque_atual,
      estoque_reservado: 0,
      estoque_minimo: prod.estoque_minimo,
      abaixo_do_minimo: prod.estoque_atual < prod.estoque_minimo,
      localizacao_bancada: 'Prateleira Central A2',
    };
  }

  public consultarTotalOS(numeroOs: string): TotaisOS {
    const os = this.ordens.get(String(numeroOs).trim());
    if (!os) {
      throw new ErpNotFoundError('consultar_total_os', `Ordem de Serviço ${numeroOs}`);
    }
    return structuredClone(os.totais);
  }

  public listarItensOS(numeroOs: string): {
    numero_os: string;
    produtos: ItemProdutoOS[];
    servicos: ItemServicoOS[];
    totais: TotaisOS;
  } {
    const os = this.ordens.get(String(numeroOs).trim());
    if (!os) {
      throw new ErpNotFoundError('listar_itens_os', `Ordem de Serviço ${numeroOs}`);
    }
    return {
      numero_os: os.numero_os,
      produtos: structuredClone(os.produtos),
      servicos: structuredClone(os.servicos),
      totais: structuredClone(os.totais),
    };
  }

  public buscarServicos(termo?: string): ServicoERP[] {
    const all = Array.from(this.servicos.values()).filter((s) => s.ativo);
    if (!termo) return structuredClone(all);
    const q = normalizeText(termo);
    const tokens = q
      .split(/\s+/)
      .filter((t) => t.length > 1 && !['de', 'do', 'da', 'e', 'no', 'na'].includes(t));
    return all
      .filter((s) => {
        const hay = normalizeText(`${s.servico_id} ${s.codigo} ${s.descricao}`);
        return hay.includes(q) || (tokens.length > 0 && tokens.every((t) => hay.includes(t)));
      })
      .map((s) => structuredClone(s));
  }

  public alterarStatusOS(numeroOs: string, novoStatus: StatusOS): OrdemServicoResumo {
    const os = this.ordens.get(String(numeroOs).trim());
    if (!os) {
      throw new ErpNotFoundError('alterar_status_os', `Ordem de Serviço ${numeroOs}`);
    }
    os.status = novoStatus;
    os.aguardando_produto = novoStatus === 'aguardando_pecas';
    os.atualizado_em = new Date().toISOString();
    return this.toResumo(os);
  }

  public adicionarProdutoOS(
    numeroOs: string,
    produtoIdOuCodigo: string,
    quantidade: number,
  ): { item_adicionado: ItemProdutoOS; totais: TotaisOS } {
    if (quantidade <= 0) {
      throw new ErpValidationError('adicionar_produto_os', 'A quantidade deve ser maior que zero.');
    }
    const os = this.ordens.get(String(numeroOs).trim());
    if (!os) {
      throw new ErpNotFoundError('adicionar_produto_os', `Ordem de Serviço ${numeroOs}`);
    }
    const clean = String(produtoIdOuCodigo).trim().toUpperCase();
    const prod = Array.from(this.produtos.values()).find(
      (p) => p.produto_id.toUpperCase() === clean || p.codigo.toUpperCase() === clean,
    );
    if (!prod) {
      throw new ErpNotFoundError('adicionar_produto_os', `Produto '${produtoIdOuCodigo}'`);
    }
    if (prod.estoque_atual < quantidade) {
      throw new ErpValidationError(
        'adicionar_produto_os',
        `Estoque insuficiente para '${prod.nome}'. Disponível: ${prod.estoque_atual} ${prod.unidade}, solicitado: ${quantidade} ${prod.unidade}.`,
      );
    }

    prod.estoque_atual -= quantidade;
    this.nextItemSeq += 1;
    const novoItem: ItemProdutoOS = {
      item_id: `ITEM-P-${this.nextItemSeq}`,
      produto_id: prod.produto_id,
      codigo: prod.codigo,
      nome: prod.nome,
      unidade: prod.unidade,
      quantidade,
      preco_unitario: prod.preco_venda,
      subtotal: Math.round(prod.preco_venda * quantidade * 100) / 100,
    };

    os.produtos.push(novoItem);
    this.recalculateOrdem(os);

    return {
      item_adicionado: structuredClone(novoItem),
      totais: structuredClone(os.totais),
    };
  }

  public removerProdutoOS(
    numeroOs: string,
    itemIdOuProdutoId: string,
  ): { item_removido: ItemProdutoOS; totais: TotaisOS } {
    const os = this.ordens.get(String(numeroOs).trim());
    if (!os) {
      throw new ErpNotFoundError('remover_produto_os', `Ordem de Serviço ${numeroOs}`);
    }
    const clean = String(itemIdOuProdutoId).trim().toUpperCase();
    const index = os.produtos.findIndex(
      (i) =>
        i.item_id.toUpperCase() === clean ||
        i.produto_id.toUpperCase() === clean ||
        i.codigo.toUpperCase() === clean,
    );
    if (index === -1) {
      throw new ErpNotFoundError(
        'remover_produto_os',
        `Item de produto '${itemIdOuProdutoId}' na OS ${numeroOs}`,
      );
    }

    const [removed] = os.produtos.splice(index, 1);
    const prod = this.produtos.get(removed.produto_id);
    if (prod) {
      prod.estoque_atual += removed.quantidade;
    }
    this.recalculateOrdem(os);

    return {
      item_removido: structuredClone(removed),
      totais: structuredClone(os.totais),
    };
  }

  public adicionarServicoOS(
    numeroOs: string,
    servicoIdOuDescricao: string,
    quantidade: number,
  ): { item_adicionado: ItemServicoOS; totais: TotaisOS } {
    if (quantidade <= 0) {
      throw new ErpValidationError('adicionar_servico_os', 'A quantidade deve ser maior que zero.');
    }
    const os = this.ordens.get(String(numeroOs).trim());
    if (!os) {
      throw new ErpNotFoundError('adicionar_servico_os', `Ordem de Serviço ${numeroOs}`);
    }
    const clean = String(servicoIdOuDescricao).trim().toUpperCase();
    let srv = Array.from(this.servicos.values()).find(
      (s) => s.servico_id.toUpperCase() === clean || s.codigo.toUpperCase() === clean,
    );
    if (!srv) {
      const matches = this.buscarServicos(servicoIdOuDescricao);
      if (matches.length === 1) {
        srv = matches[0];
      }
    }
    if (!srv) {
      throw new ErpNotFoundError('adicionar_servico_os', `Serviço '${servicoIdOuDescricao}'`);
    }

    this.nextItemSeq += 1;
    const novoItem: ItemServicoOS = {
      item_id: `ITEM-S-${this.nextItemSeq}`,
      servico_id: srv.servico_id,
      codigo: srv.codigo,
      descricao: srv.descricao,
      quantidade,
      valor_unitario: srv.valor_padrao,
      subtotal: Math.round(srv.valor_padrao * quantidade * 100) / 100,
    };

    os.servicos.push(novoItem);
    this.recalculateOrdem(os);

    return {
      item_adicionado: structuredClone(novoItem),
      totais: structuredClone(os.totais),
    };
  }

  public removerServicoOS(
    numeroOs: string,
    itemIdOuServicoId: string,
  ): { item_removido: ItemServicoOS; totais: TotaisOS } {
    const os = this.ordens.get(String(numeroOs).trim());
    if (!os) {
      throw new ErpNotFoundError('remover_servico_os', `Ordem de Serviço ${numeroOs}`);
    }
    const clean = String(itemIdOuServicoId).trim().toUpperCase();
    const index = os.servicos.findIndex(
      (s) =>
        s.item_id.toUpperCase() === clean ||
        s.servico_id.toUpperCase() === clean ||
        s.codigo.toUpperCase() === clean,
    );
    if (index === -1) {
      throw new ErpNotFoundError(
        'remover_servico_os',
        `Item de serviço '${itemIdOuServicoId}' na OS ${numeroOs}`,
      );
    }

    const [removed] = os.servicos.splice(index, 1);
    this.recalculateOrdem(os);

    return {
      item_removido: structuredClone(removed),
      totais: structuredClone(os.totais),
    };
  }
}

export const defaultMockStore = new ErpMockStore();
