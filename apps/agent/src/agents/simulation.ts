import { type SimulationContext, voice } from '@livekit/agents';
import { z } from 'zod';
import { ErpClient } from '../integrations/erp/erp-client.ts';
import { ErpMockStore } from '../integrations/erp/erp-mock-adapter.ts';
import type { SessionUserData } from '../types/session-types.ts';
import { ErpVoiceAgent } from './erp-voice-agent.ts';

const simulationUserdataSchema = z.object({
  initialActiveOs: z.string().optional(),
  failingTools: z.array(z.string()).optional(),
  expectedOsStatus: z
    .object({
      numero_os: z.string(),
      status: z.string(),
    })
    .optional(),
  expectedActiveOs: z.string().optional(),
  expectedTotalMin: z.number().optional(),
});

const sessions = new WeakMap<SimulationContext, voice.AgentSession<SessionUserData>>();
const mocks = new WeakMap<SimulationContext, Disposable>();

export function setupErpSimulation(
  simulation: SimulationContext,
  session: voice.AgentSession<SessionUserData>,
): void {
  const rawUserdata = simulation.userdata() ?? {};
  const parsed = simulationUserdataSchema.safeParse(rawUserdata);

  // Isola um banco mock determinístico exclusivo para este cenário de simulação
  const scenarioStore = new ErpMockStore();
  session.userData.erpClient = new ErpClient({
    mode: 'mock',
    mockStore: scenarioStore,
  });

  if (parsed.success) {
    if (parsed.data.initialActiveOs) {
      session.userData.activeOsNumber = parsed.data.initialActiveOs;
    }

    const failingTools = parsed.data.failingTools ?? [];
    if (failingTools.length > 0) {
      mocks.set(
        simulation,
        voice.testing.withMockTools(
          ErpVoiceAgent,
          Object.fromEntries(
            failingTools.map((toolName) => [
              toolName,
              () => {
                throw new Error(`Falha simulada na ferramenta ${toolName}`);
              },
            ]),
          ),
          { session: session as unknown as voice.AgentSession },
        ),
      );
    }
  }

  sessions.set(simulation, session);
}

export function onErpSimulationEnd(simulation: SimulationContext): void {
  try {
    const rawUserdata = simulation.userdata() ?? {};
    const parsed = simulationUserdataSchema.safeParse(rawUserdata);
    if (!parsed.success) return;

    const session = sessions.get(simulation);
    if (!session) return;

    const { expectedOsStatus, expectedActiveOs, expectedTotalMin } = parsed.data;

    if (expectedActiveOs && session.userData.activeOsNumber !== expectedActiveOs) {
      simulation.fail(
        `Contexto de OS esperado era '${expectedActiveOs}', mas terminou com '${session.userData.activeOsNumber}'`,
      );
      return;
    }

    if (expectedOsStatus) {
      const os = session.userData.erpClient.mockStore.consultarOS(expectedOsStatus.numero_os);
      if (os.status !== expectedOsStatus.status) {
        simulation.fail(
          `Status final esperado da OS ${expectedOsStatus.numero_os} era '${expectedOsStatus.status}', mas terminou como '${os.status}'`,
        );
        return;
      }
    }

    if (expectedTotalMin !== undefined && session.userData.activeOsNumber) {
      const totais = session.userData.erpClient.mockStore.consultarTotalOS(
        session.userData.activeOsNumber,
      );
      if (totais.valor_total < expectedTotalMin) {
        simulation.fail(
          `Valor total da OS esperado >= ${expectedTotalMin}, mas foi ${totais.valor_total}`,
        );
      }
    }
  } catch (err) {
    simulation.fail(
      `Erro ao avaliar estado final da simulação: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    mocks.get(simulation)?.[Symbol.dispose]();
    mocks.delete(simulation);
    sessions.delete(simulation);
  }
}
