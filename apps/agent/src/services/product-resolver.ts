import type { ErpClient } from '../integrations/erp/erp-client.ts';
import type { ProdutoERP } from '../integrations/erp/erp-types.ts';

export type ProductResolutionResult =
  | {
      status: 'RESOLVED';
      product: ProdutoERP;
      unitWarning?: string;
      stockAvailable: boolean;
    }
  | {
      status: 'AMBIGUOUS';
      candidates: ProdutoERP[];
      messageForAgent: string;
    }
  | {
      status: 'NOT_FOUND';
      searchTerm: string;
      messageForAgent: string;
    }
  | {
      status: 'INSUFFICIENT_STOCK';
      product: ProdutoERP;
      requestedQuantity: number;
      availableQuantity: number;
      messageForAgent: string;
    };

/**
 * Resolve de forma inteligente um produto falado pelo operador (por ID, código ou nome),
 * validando ambiguidades, estoque e unidade de medida antes de permitir inclusão na OS.
 */
export async function resolveProductForOperation(params: {
  erpClient: ErpClient;
  produtoIdentificador: string;
  quantidade: number;
  unidadeFalada?: string;
}): Promise<ProductResolutionResult> {
  const { erpClient, produtoIdentificador, quantidade, unidadeFalada } = params;
  const clean = produtoIdentificador.trim();

  // 1. Tenta localizar por código ou produto_id exato primeiro
  try {
    const exactByCode = await erpClient.consultarProdutoPorCodigo(clean);
    if (exactByCode.data) {
      return evaluateResolvedProduct(exactByCode.data, quantidade, unidadeFalada);
    }
  } catch {
    // Continua para busca por nome
  }

  // 2. Busca por nome / especificação no catálogo do ERP
  const searchRes = await erpClient.buscarProdutoPorNome(clean);
  const candidates = searchRes.data;

  if (!candidates || candidates.length === 0) {
    return {
      status: 'NOT_FOUND',
      searchTerm: clean,
      messageForAgent: `Nenhum produto encontrado no catálogo do ERP para '${clean}'. Informe ao operador que o produto não foi localizado e NÃO execute a inclusão.`,
    };
  }

  if (candidates.length === 1) {
    return evaluateResolvedProduct(candidates[0]!, quantidade, unidadeFalada);
  }

  // Verifica se algum candidato tem nome ou código 100% idêntico ao termo falado
  const exactNameMatch = candidates.find(
    (c) =>
      c.nome.toLowerCase() === clean.toLowerCase() ||
      c.codigo.toLowerCase() === clean.toLowerCase() ||
      c.produto_id.toLowerCase() === clean.toLowerCase(),
  );
  if (exactNameMatch) {
    return evaluateResolvedProduct(exactNameMatch, quantidade, unidadeFalada);
  }

  // 3. Múltiplos produtos semelhantes -> Ambiguidade detectada!
  const optionsText = candidates
    .map(
      (c) =>
        `código ${c.codigo} (${c.nome}, ${c.preco_venda.toFixed(2)} reais por ${c.unidade}, estoque: ${c.estoque_atual})`,
    )
    .join('; ');

  return {
    status: 'AMBIGUOUS',
    candidates,
    messageForAgent: `Foram encontrados ${candidates.length} produtos semelhantes para '${clean}': ${optionsText}. Pergunte ao operador qual deles ele deseja adicionar antes de prosseguir.`,
  };
}

function evaluateResolvedProduct(
  product: ProdutoERP,
  quantidade: number,
  unidadeFalada?: string,
): ProductResolutionResult {
  if (product.estoque_atual < quantidade) {
    return {
      status: 'INSUFFICIENT_STOCK',
      product,
      requestedQuantity: quantidade,
      availableQuantity: product.estoque_atual,
      messageForAgent: `O produto '${product.nome}' (código ${product.codigo}) possui apenas ${product.estoque_atual} ${product.unidade} em estoque, insuficiente para a quantidade solicitada de ${quantidade} ${product.unidade}.`,
    };
  }

  let unitWarning: string | undefined;
  if (unidadeFalada) {
    const normFalada = unidadeFalada.toUpperCase().trim();
    const isLitroSpoken = normFalada.startsWith('L') || normFalada.includes('LITRO');
    const isUnidadeSpoken = normFalada.startsWith('UN') || normFalada.includes('PECA');
    if (isLitroSpoken && product.unidade !== 'L') {
      unitWarning = `Atenção: o produto é cadastrado em '${product.unidade}' e não em litros.`;
    } else if (isUnidadeSpoken && product.unidade === 'L') {
      unitWarning = `Nota: o produto '${product.nome}' é medido em Litros (L).`;
    }
  }

  return {
    status: 'RESOLVED',
    product,
    unitWarning,
    stockAvailable: true,
  };
}
