import { describe, it, expect, beforeEach } from 'vitest';
import { ErpMockStore } from '../src/integrations/erp/erp-mock-adapter.ts';
import { ErpClient } from '../src/integrations/erp/erp-client.ts';
import { createSessionUserData, advanceUserTurn } from '../src/services/context-manager.ts';
import {
  executeConsultarOs,
  executeListarOsAbertas,
  executeListarProdutos,
  executeBuscarProdutoPorNome,
  executeConsultarEstoque,
  executeConsultarTotalOs,
  executeListarItensOs,
} from '../src/tools/query-tools.ts';
import {
  executeAlterarStatusOs,
  executeAdicionarProdutoOs,
  executeRemoverProdutoOs,
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
});
