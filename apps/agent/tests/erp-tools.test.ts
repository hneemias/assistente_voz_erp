import { describe, it, expect, beforeEach } from 'vitest';
import { ErpMockStore } from '../src/integrations/erp/erp-mock-adapter.ts';
import { ErpClient } from '../src/integrations/erp/erp-client.ts';
import { createSessionUserData, advanceUserTurn } from '../src/services/context-manager.ts';
import {
  executeConsultarOs,
  executeListarOsAbertas,
  executeListarTodasOs,
  executeListarProdutos,
  executeBuscarProdutoPorNome,
  executeListarServicos,
  executeBuscarServicoPorNome,
  executeConsultarEstoque,
  executeConsultarTotalOs,
  executeListarItensOs,
  executeSincronizarErp,
} from '../src/tools/query-tools.ts';
import {
  executeAlterarStatusOs,
  executeAdicionarProdutoOs,
  executeRemoverProdutoOs,
  executeAdicionarServicoOs,
  executeEditarItemOs,
  executeCancelarOperacaoPendente,
} from '../src/tools/mutation-tools.ts';

describe('Suíte de Testes Automatizados dos 10 Cenários Operacionais do ERP', () => {
  let mockStore: ErpMockStore;
  let erpClient: ErpClient;

  beforeEach(() => {
    mockStore = new ErpMockStore();
    erpClient = new ErpClient({ mode: 'mock', mockStore });
  });

  // CENÁRIO 1: Usuário pergunta o status da OS 3030. Esperado: consultar_os é chamada com 3030.
  it('CENÁRIO 1: Consulta status da OS 3030 e atualiza contexto ativo', async () => {
    const userData = createSessionUserData({ erpClient });
    const res = await executeConsultarOs({ numero_os: '3030' }, userData);

    expect(res.status).toBe('SUCCESS');
    expect(res.data).toBeDefined();
    const data = res.data as any;
    expect(data.numero_os).toBe('3030');
    expect(data.status).toBe('em_andamento');
    expect(userData.activeOsNumber).toBe('3030');
  });

  // CENÁRIO 2: Usuário solicita alteração do status da OS 3030. Esperado: o agente pede confirmação antes da alteração.
  it('CENÁRIO 2: Solicita alteração de status da OS 3030 sem confirmação prévia -> Exige confirmação', async () => {
    const userData = createSessionUserData({ erpClient });
    const res = await executeAlterarStatusOs(
      { numero_os: '3030', status: 'concluida', confirmado_pelo_usuario: false },
      { userData },
    );

    expect(res.status).toBe('CONFIRMATION_REQUIRED');
    expect(userData.pendingMutation).not.toBeNull();
    expect(userData.pendingMutation?.operation).toBe('alterar_status_os');
    expect(userData.pendingMutation?.payload.status).toBe('concluida');
    // Nenhuma alteração real no store ainda
    expect(mockStore.consultarOS('3030').status).toBe('em_andamento');
  });

  // CENÁRIO 3: Usuário confirma a alteração. Esperado: alterar_status_os é chamada uma única vez e efetiva.
  it('CENÁRIO 3: Usuário confirma a alteração em turno posterior -> Efetiva no ERP', async () => {
    const userData = createSessionUserData({ erpClient });
    // Turno 1: Solicitação e staging da mutação
    await executeAlterarStatusOs(
      { numero_os: '3030', status: 'concluida', confirmado_pelo_usuario: false },
      { userData },
    );

    // Turno 2: Usuário responde confirmando no turno seguinte
    advanceUserTurn(userData);
    const resCommit = await executeAlterarStatusOs(
      { numero_os: '3030', status: 'concluida', confirmado_pelo_usuario: true },
      { userData },
    );

    expect(resCommit.status).toBe('COMMITTED');
    expect(mockStore.consultarOS('3030').status).toBe('concluida');
    expect(userData.pendingMutation).toBeNull();
  });

  // CENÁRIO 4: Usuário solicita inclusão de produto inexistente. Esperado: informa que não encontrou e não executa.
  it('CENÁRIO 4: Usuário solicita produto inexistente -> Retorna NOT_FOUND e recusa inclusão', async () => {
    const userData = createSessionUserData({ erpClient });
    const res = await executeAdicionarProdutoOs(
      { numero_os: '3030', produto_id: 'turbina de aviao boeing', quantidade: 1, confirmado_pelo_usuario: false },
      { userData },
    );

    expect(res.status).toBe('NOT_FOUND');
    expect(res.messageForSpeech).toContain('Nenhum produto encontrado');
    expect(userData.pendingMutation).toBeNull();
  });

  // CENÁRIO 5: Usuário solicita produtos com nomes semelhantes. Esperado: agente detecta ambiguidade e pergunta qual deseja.
  it('CENÁRIO 5: Nomes semelhantes (óleo 5W30) -> Retorna AMBIGUOUS com lista de candidatos', async () => {
    const userData = createSessionUserData({ erpClient });
    const res = await executeAdicionarProdutoOs(
      { numero_os: '3030', produto_id: 'oleo 5W30', quantidade: 4, confirmado_pelo_usuario: false },
      { userData },
    );

    expect(res.status).toBe('AMBIGUOUS');
    const data = res.data as any;
    expect(data?.candidatos?.length).toBeGreaterThan(1);
    expect(userData.pendingMutation).toBeNull();
  });

  // CENÁRIO 6: Usuário solicita inclusão e o ERP retorna erro (ex: estoque insuficiente ou falha).
  it('CENÁRIO 6: Quantidade superior ao estoque disponível -> Informa erro sem alterar a OS', async () => {
    const userData = createSessionUserData({ erpClient });
    // Produto 125 tem apenas 4 unidades em estoque
    const res = await executeAdicionarProdutoOs(
      { numero_os: '3030', produto_id: '125', quantidade: 50, confirmado_pelo_usuario: false },
      { userData },
    );

    expect(res.status).toBe('INSUFFICIENT_STOCK');
    expect(res.messageForSpeech).toContain('insuficiente');
    expect(userData.pendingMutation).toBeNull();
  });

  // CENÁRIO 7: Usuário pergunta "quanto ficou o total dela?" depois de consultar uma OS. Esperado: usa contexto correto.
  it('CENÁRIO 7: Consulta inicial da OS 3030 seguida de consulta de total sem número ("dela") -> Usa contexto ativo', async () => {
    const userData = createSessionUserData({ erpClient });
    await executeConsultarOs({ numero_os: '3030' }, userData);
    expect(userData.activeOsNumber).toBe('3030');

    // Pergunta subsequente passando null no numero_os
    const resTotal = await executeConsultarTotalOs({ numero_os: null }, userData);
    expect(resTotal.status).toBe('SUCCESS');
    const totalData = resTotal.data as any;
    expect(totalData.numero_os).toBe('3030');
    expect(totalData.valor_total).toBe(517.0);
  });

  // CENÁRIO 8: Dois usuários utilizam o sistema simultaneamente. Esperado: contextos isolados por sessão.
  it('CENÁRIO 8: Dois operadores simultâneos possuem estados de sessão completamente independentes', async () => {
    const userA = createSessionUserData({ sessionId: 'session-A', userId: 'operador-A', erpClient });
    const userB = createSessionUserData({ sessionId: 'session-B', userId: 'operador-B', erpClient });

    await executeConsultarOs({ numero_os: '3030' }, userA);
    await executeConsultarOs({ numero_os: '4040' }, userB);

    expect(userA.activeOsNumber).toBe('3030');
    expect(userB.activeOsNumber).toBe('4040');

    // Staging de mutação no operador A não afeta operador B
    await executeAlterarStatusOs(
      { numero_os: '3030', status: 'concluida', confirmado_pelo_usuario: false },
      { userData: userA },
    );
    expect(userA.pendingMutation?.osNumber).toBe('3030');
    expect(userB.pendingMutation).toBeNull();
  });

  // CENÁRIO 9: Ocorre timeout durante uma operação de escrita. Esperado: o agente não repete automaticamente.
  it('CENÁRIO 9: Timeout durante escrita -> Retorna INCONCLUSIVE_TIMEOUT e não repete a chamada', async () => {
    // Simula um fetch que demora mais que o timeout especificado
    const delayedFetch = (_url: any, init: any) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });

    const fastTimeoutClient = new ErpClient({
      mode: 'live',
      baseUrl: 'http://erp-test.local',
      timeoutMs: 50,
      fetchImpl: delayedFetch as any,
      allowUnconfiguredLiveEndpoints: true,
    });
    const userData = createSessionUserData({ erpClient: fastTimeoutClient });

    // Registra mutação pendente
    userData.pendingMutation = {
      mutationId: 'mut-timeout',
      operation: 'alterar_status_os',
      osNumber: '3030',
      payload: { numero_os: '3030', status: 'concluida' },
      summaryForSpeech: 'Confirma?',
      stagedAtUserTurn: 1,
      stagedAtIso: new Date().toISOString(),
      idempotencyKey: 'idem-test-timeout',
    };
    advanceUserTurn(userData);

    const res = await executeAlterarStatusOs(
      { numero_os: '3030', status: 'concluida', confirmado_pelo_usuario: true },
      { userData },
    );

    expect(res.status).toBe('INCONCLUSIVE_TIMEOUT');
    expect(res.messageForSpeech).toContain('tempo limite');
    expect(userData.pendingMutation).toBeNull();
    // Chave registrada como inconclusiva para impedir retry acidental
    expect(userData.executedMutations.get('idem-test-timeout')?.status).toBe('INCONCLUSIVE_TIMEOUT');
  });

  // CENÁRIO 10: O usuário diz "não, cancele". Esperado: nenhuma operação pendente é executada.
  it('CENÁRIO 10: Operador desiste ("não, cancele") -> Cancela mutação pendente e mantém ERP intacto', async () => {
    const userData = createSessionUserData({ erpClient });
    // Estágio inicial
    await executeAlterarStatusOs(
      { numero_os: '3030', status: 'cancelada', confirmado_pelo_usuario: false },
      { userData },
    );
    expect(userData.pendingMutation).not.toBeNull();

    // Operador cancela
    const resCancel = await executeCancelarOperacaoPendente({ motivo: 'Operador desistiu' }, userData);

    expect(resCancel.status).toBe('CANCELLED');
    expect(userData.pendingMutation).toBeNull();
    // OS 3030 permaneceu inalterada
    expect(mockStore.consultarOS('3030').status).toBe('em_andamento');
  });

  describe('Cenários com Dados Reais da Assistência Técnica (Payload de Produção)', () => {
    it('Consulta OS 4345 da cliente JEANE APARECIDA PIMENTA (Aberta, R$ 60,00)', async () => {
      const userData = createSessionUserData({ erpClient });
      const res = await executeConsultarOs({ numero_os: '4345' }, userData);

      expect(res.status).toBe('SUCCESS');
      const os = res.data as any;
      expect(os.numero_os).toBe('4345');
      expect(os.cliente_nome).toBe('JEANE APARECIDA PIMENTA');
      expect(os.status).toBe('em_aberto');
      expect(os.valor_total).toBe(60);
      expect(userData.activeOsNumber).toBe('4345');
    });

    it('Consulta OS 4344 da RADIO NATIVA FM LTDA com equipamento IMPRESSORA EPSON L3250', async () => {
      const userData = createSessionUserData({ erpClient });
      const res = await executeConsultarOs({ numero_os: '4344' }, userData);

      expect(res.status).toBe('SUCCESS');
      const os = res.data as any;
      expect(os.numero_os).toBe('4344');
      expect(os.cliente_nome).toBe('RADIO NATIVA FM LTDA');
      expect(os.equipamento).toBe('IMPRESSORA');
      expect(os.modelo).toBe('L3250');
      expect(os.marca_equipamento).toBe('EPSON');
      expect(os.status).toBe('em_aberto');
    });

    it('Consulta OS 4340 concluída com impressora de etiquetas HAYOM e valor total R$ 710,00', async () => {
      const userData = createSessionUserData({ erpClient });
      const res = await executeConsultarOs({ numero_os: '4340' }, userData);

      expect(res.status).toBe('SUCCESS');
      const os = res.data as any;
      expect(os.numero_os).toBe('4340');
      expect(os.cliente_nome).toBe('HERINA DOS SANTOS BORGES');
      expect(os.status).toBe('concluido');
      expect(os.valor_total).toBe(710);
      expect(os.quantidade_itens).toBe(2);
    });

    it('Busca produtos reais de informática (ex: EPSON L3250 ou KASPERSKY)', async () => {
      const userData = createSessionUserData({ erpClient });
      const resEpson = await executeBuscarProdutoPorNome({ nome: 'L3250' }, userData);
      expect(resEpson.status).toBe('SUCCESS');
      expect(resEpson.messageForSpeech).toContain('EPSON');

      const resKaspersky = await executeBuscarProdutoPorNome({ nome: 'Kaspersky' }, userData);
      expect(resKaspersky.status).toBe('SUCCESS');
      expect(resKaspersky.messageForSpeech).toContain('KASPERSKY');
    });

    it('Lista todas as ordens abertas reais da bancada', async () => {
      const userData = createSessionUserData({ erpClient });
      const res = await executeListarOsAbertas({}, userData);

      expect(res.status).toBe('SUCCESS');
      const data = res.data as any;
      // Contém OS abertas reais
      expect(data.quantidade).toBeGreaterThanOrEqual(16);
      expect(data.valor_total_acumulado).toBeGreaterThan(0);
    });

    it('Lista TODAS as 7 ordens da data de hoje (16/11/2026) sem omitir nenhuma', async () => {
      const userData = createSessionUserData({ erpClient });
      const res = await executeListarTodasOs({ apenas_hoje: true }, userData);

      expect(res.status).toBe('SUCCESS');
      const data = res.data as any;
      expect(data.quantidade).toBe(7);
      // Mensagem falada cita hoje e as ordens
      expect(res.messageForSpeech).toContain('Hoje temos 7 ordens');
      expect(res.messageForSpeech).toContain('4345');
      expect(res.messageForSpeech).toContain('4344');
      expect(res.messageForSpeech).toContain('4343');
      expect(res.messageForSpeech).toContain('4342');
      expect(res.messageForSpeech).toContain('4341');
      expect(res.messageForSpeech).toContain('4340');
      expect(res.messageForSpeech).toContain('4339');
    });

    it('Lista as ordens ABERTAS da data de hoje (3 ordens abertas)', async () => {
      const userData = createSessionUserData({ erpClient });
      const res = await executeListarOsAbertas({ apenas_hoje: true }, userData);

      expect(res.status).toBe('SUCCESS');
      const data = res.data as any;
      expect(data.quantidade).toBe(3);
      expect(res.messageForSpeech).toContain('Hoje temos 3 ordens');
      expect(res.messageForSpeech).toContain('4345');
      expect(res.messageForSpeech).toContain('4344');
      expect(res.messageForSpeech).toContain('4343');
    });

    it('Lista os serviços cadastrados da assistência técnica', async () => {
      const userData = createSessionUserData({ erpClient });
      const res = await executeListarServicos({}, userData);

      expect(res.status).toBe('SUCCESS');
      const data = res.data as any;
      expect(data.quantidade).toBeGreaterThanOrEqual(5);
      expect(res.messageForSpeech).toContain('FORMATACAO');
      expect(res.messageForSpeech).toContain('RESET');
      expect(res.messageForSpeech).toContain('ANALISE TECNICA');
    });

    it('Busca serviço específico por nome falado (ex: "formatação")', async () => {
      const userData = createSessionUserData({ erpClient });
      const res = await executeBuscarServicoPorNome({ nome: 'formatacao' }, userData);

      expect(res.status).toBe('SUCCESS');
      expect(res.messageForSpeech).toContain('FORMATACAO DESKTOP');
      expect(res.messageForSpeech).toContain('120');
    });

    it('Edita valor de um item já existente na OS com confirmação em 2 turnos', async () => {
      const userData = createSessionUserData({ erpClient });
      // OS 4345 possui o item 663 (PRESTACAO DE SERVICOS) no valor de R$ 60,00
      // Turno 1: Solicita alteração para R$ 80,00
      const resStep1 = await executeEditarItemOs(
        {
          numero_os: '4345',
          item_identificador: '663',
          novo_valor_unitario: 80,
          confirmado_pelo_usuario: false,
        },
        { userData },
      );

      expect(resStep1.status).toBe('CONFIRMATION_REQUIRED');
      expect(userData.pendingMutation).not.toBeNull();

      // Turno 2: Confirma
      advanceUserTurn(userData);
      const resStep2 = await executeEditarItemOs(
        {
          numero_os: '4345',
          item_identificador: '663',
          novo_valor_unitario: 80,
          confirmado_pelo_usuario: true,
        },
        { userData },
      );

      expect(resStep2.status).toBe('COMMITTED');
      expect(resStep2.messageForSpeech).toContain('80');
      const osAtualizada = mockStore.consultarDetalhesOS('4345');
      expect(osAtualizada.valor_total).toBe(80);
      expect(osAtualizada.servicos[0]!.valor_unitario).toBe(80);
    });

    it('O valor total da OS é calculado somando os itens e atualiza automaticamente ao editar item', async () => {
      const userData = createSessionUserData({ erpClient });
      // OS 4343 tem inicialmente 1 serviço de R$ 60, total R$ 60
      const osInicial = mockStore.consultarOS('4343');
      expect(osInicial.valor_total).toBe(60);

      // Turno 1: Solicita alterar o valor do serviço na OS 4343 para R$ 90,00
      const resStep1 = await executeEditarItemOs(
        {
          numero_os: '4343',
          item_identificador: '663',
          novo_valor_unitario: 90,
          confirmado_pelo_usuario: false,
        },
        { userData },
      );

      expect(resStep1.status).toBe('CONFIRMATION_REQUIRED');

      // Turno 2: Confirma
      advanceUserTurn(userData);
      const resStep2 = await executeEditarItemOs(
        {
          numero_os: '4343',
          item_identificador: '663',
          novo_valor_unitario: 90,
          confirmado_pelo_usuario: true,
        },
        { userData },
      );

      expect(resStep2.status).toBe('COMMITTED');
      expect(resStep2.messageForSpeech).toContain('90');
      // O valor total da OS foi recalculado automaticamente para 90
      const os = mockStore.consultarOS('4343');
      expect(os.valor_total).toBe(90);
      const detalhes = mockStore.consultarDetalhesOS('4343');
      expect(detalhes.totais.valor_total).toBe(90);
      expect(detalhes.totais.total_servicos).toBe(90);
    });

    it('Adiciona serviço com valor unitário personalizado', async () => {
      const userData = createSessionUserData({ erpClient });
      // Turno 1: Adiciona Formatação (1091) com valor negociado de R$ 100 em vez do padrão 120
      const resStep1 = await executeAdicionarServicoOs(
        {
          numero_os: '4345',
          servico_id: '1091',
          quantidade: 1,
          valor_unitario: 100,
          confirmado_pelo_usuario: false,
        },
        { userData },
      );

      expect(resStep1.status).toBe('CONFIRMATION_REQUIRED');
      expect(userData.pendingMutation?.payload.valor_unitario).toBe(100);

      // Turno 2: Confirma
      advanceUserTurn(userData);
      const resStep2 = await executeAdicionarServicoOs(
        {
          numero_os: '4345',
          servico_id: '1091',
          quantidade: 1,
          valor_unitario: 100,
          confirmado_pelo_usuario: true,
        },
        { userData },
      );

      expect(resStep2.status).toBe('COMMITTED');
      const os = mockStore.consultarDetalhesOS('4345');
      const srv = os.servicos.find((s) => s.codigo === '1091');
      expect(srv).toBeDefined();
      expect(srv?.valor_unitario).toBe(100);
    });

    it('Diferencia os 9 status oficiais do ERP: concluido, finalizado, em_processo_terceiros, etc.', async () => {
      const userData = createSessionUserData({ erpClient });
      // OS 4341 no payload real é 'Finalizado'
      const osFinalizada = await executeConsultarOs({ numero_os: '4341' }, userData);
      expect((osFinalizada.data as any).status).toBe('finalizado');
      expect(osFinalizada.messageForSpeech).toContain('finalizado');

      // OS 4342 no payload real é 'Concluido' (serviço feito aguardando pagamento)
      const osConcluida = await executeConsultarOs({ numero_os: '4342' }, userData);
      expect((osConcluida.data as any).status).toBe('concluido');
      expect(osConcluida.messageForSpeech).toContain('concluído (aguardando pagamento)');

      // Altera OS 4345 para 'em_processo_terceiros' com 2 turnos
      await executeAlterarStatusOs(
        { numero_os: '4345', status: 'em_processo_terceiros', confirmado_pelo_usuario: false },
        { userData },
      );
      advanceUserTurn(userData);
      const resTerceiros = await executeAlterarStatusOs(
        { numero_os: '4345', status: 'em_processo_terceiros', confirmado_pelo_usuario: true },
        { userData },
      );
      expect(resTerceiros.status).toBe('COMMITTED');
      expect(resTerceiros.messageForSpeech).toContain('em processo de terceiros');
      expect(mockStore.consultarOS('4345').status).toBe('em_processo_terceiros');

      // Verifica que listar_os_abertas não inclui finalizadas nem concluídas
      const abertas = await executeListarOsAbertas({}, userData);
      const numerosAbertas = (abertas.data as any).ordens.map((o: any) => o.numero_os);
      expect(numerosAbertas).not.toContain('4341'); // Finalizado
      expect(numerosAbertas).not.toContain('4342'); // Concluido
    });

    it('Dispara sincronização em segundo plano via sincronizar_erp sem bloquear a conversa', async () => {
      const userData = createSessionUserData({ erpClient });
      const res = await executeSincronizarErp({ data_inicio: '10/11/2026', data_fim: '17/11/2026' }, userData);
      expect(res.status).toBe('SUCCESS');
      expect(res.messageForSpeech).toContain('Iniciei a sincronização com o Inovar Fiscal em segundo plano');
      expect(res.data).toBeDefined();
    });

    it('Filtra ordens por intervalo de datas (data_inicio e data_fim)', async () => {
      const userData = createSessionUserData({ erpClient });
      const res = await executeListarTodasOs({ data_inicio: '10/11/2026', data_fim: '16/11/2026' }, userData);
      expect(res.status).toBe('SUCCESS');
      const ordens = (res.data as any).ordens;
      expect(ordens.length).toBeGreaterThan(0);
      for (const o of ordens) {
        const d = o.data_abertura.slice(0, 10);
        expect(d >= '2026-11-10' && d <= '2026-11-16').toBe(true);
      }
    });

    it('Quando a OS não é encontrada, avisa e sugere busca/sincronização no Inovar Fiscal', async () => {
      const userData = createSessionUserData({ erpClient });
      const res = await executeConsultarOs({ numero_os: '999999' }, userData);
      expect(res.status).toBe('NOT_FOUND');
      expect(res.messageForSpeech).toContain('Não encontrei a OS 999999 no histórico carregado');
      expect(res.messageForSpeech).toContain('Deseja que eu faça uma busca e sincronize direto com o sistema Inovar Fiscal?');
    });
  });
});
