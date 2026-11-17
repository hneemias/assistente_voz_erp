import { env } from '../config/env.ts';
import { defaultMockStore } from '../integrations/erp/erp-mock-adapter.ts';
import { logger } from '../utils/logger.ts';
import { queueIdleAnnouncement } from './idle-notifier.ts';

export interface InovarFiscalJobResponse {
  id: string;
  type: string;
  params: { start: string; end: string };
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  result?: any[];
  error?: string;
  created_at: number;
  updated_at: number;
}

export class InovarFiscalSyncService {
  private baseUrl: string;
  private isSyncing = false;
  private currentJobId: string | null = null;
  private lastSyncTimestamp: number | null = null;
  private lastSyncCount = 0;
  private pollIntervalTimer: NodeJS.Timeout | null = null;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? env.INOVAR_FISCAL_API_URL;
  }

  public getStatus() {
    return {
      isSyncing: this.isSyncing,
      currentJobId: this.currentJobId,
      lastSyncTimestamp: this.lastSyncTimestamp,
      lastSyncCount: this.lastSyncCount,
      baseUrl: this.baseUrl,
    };
  }

  private formatDateBrazilian(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  public async triggerSync(options?: {
    startDate?: string;
    endDate?: string;
    numeroOs?: string;
  }): Promise<{ jobId: string; status: string; message: string }> {
    if (this.isSyncing && this.currentJobId) {
      return {
        jobId: this.currentJobId,
        status: 'PROCESSING',
        message: 'Já existe uma sincronização com o ERP em andamento.',
      };
    }

    const cleanNumero = options?.numeroOs ? String(options.numeroOs).trim().replace(/^#/, '') : undefined;
    let url: string;

    if (cleanNumero) {
      url = `${this.baseUrl}/api/service-orders?numero=${encodeURIComponent(cleanNumero)}`;
      logger.info({ numeroOs: cleanNumero, baseUrl: this.baseUrl }, '[InovarFiscalSync] Disparando busca pontual da OS no ERP...');
    } else {
      const today = new Date();
      const defaultStart = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const start = options?.startDate ?? this.formatDateBrazilian(defaultStart);
      const end = options?.endDate ?? this.formatDateBrazilian(today);
      url = `${this.baseUrl}/api/service-orders?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
      logger.info({ start, end, baseUrl: this.baseUrl }, '[InovarFiscalSync] Disparando extração de OSs por período...');
    }

    try {
      const res = await fetch(url);

      if (!res.ok) {
        throw new Error(`Falha ao enfileirar extração no ERP: HTTP ${res.status}`);
      }

      const data = (await res.json()) as { jobId: string; status: string; message?: string };
      this.isSyncing = true;
      this.currentJobId = data.jobId;

      logger.info({ jobId: data.jobId, numeroOs: cleanNumero }, '[InovarFiscalSync] Job enfileirado com sucesso. Iniciando monitoramento em background...');

      // Inicia polling assíncrono em background sem bloquear
      this.startPolling(data.jobId, cleanNumero);

      return {
        jobId: data.jobId,
        status: data.status,
        message: cleanNumero
          ? `Busca da OS ${cleanNumero} iniciada em segundo plano.`
          : 'Sincronização iniciada em segundo plano.',
      };
    } catch (err) {
      this.isSyncing = false;
      this.currentJobId = null;
      logger.error({ err }, '[InovarFiscalSync] Erro ao disparar sincronização com ERP');
      throw err;
    }
  }

  private startPolling(jobId: string, targetNumeroOs?: string): void {
    if (this.pollIntervalTimer) {
      clearInterval(this.pollIntervalTimer);
      this.pollIntervalTimer = null;
    }

    const startTime = Date.now();
    const MAX_WAIT_MS = 60000; // 60 segundos timeout máx de extração

    this.pollIntervalTimer = setInterval(async () => {
      try {
        const jobUrl = `${this.baseUrl}/api/jobs/${jobId}`;
        const res = await fetch(jobUrl);

        if (!res.ok) {
          logger.warn({ status: res.status, jobId }, '[InovarFiscalSync] Falha temporária ao consultar status do job');
          return;
        }

        const job = (await res.json()) as InovarFiscalJobResponse;

        if (job.status === 'COMPLETED') {
          if (this.pollIntervalTimer) clearInterval(this.pollIntervalTimer);
          this.isSyncing = false;
          this.currentJobId = null;
          this.lastSyncTimestamp = Date.now();

          const orders = job.result || [];
          const count = defaultMockStore.ingestRawOrders(orders);
          this.lastSyncCount = count;

          logger.info(
            { jobId, targetNumeroOs, totalOrdens: count, durationMs: Date.now() - startTime },
            '[InovarFiscalSync] Sincronização concluída com sucesso! Base de dados local atualizada.',
          );

          // Enfileira anúncio amigável para quando o técnico e o assistente estiverem IDLE
          if (targetNumeroOs) {
            if (count > 0) {
              queueIdleAnnouncement(
                `Só para te avisar: a busca da OS ${targetNumeroOs} no Inovar Fiscal foi concluída! Já atualizei os dados dela aqui na bancada.`
              );
            } else {
              queueIdleAnnouncement(
                `Só para te avisar: a busca da OS ${targetNumeroOs} no Inovar Fiscal foi concluída, mas essa ordem não foi encontrada no sistema.`
              );
            }
          } else {
            queueIdleAnnouncement(
              `Só para avisar: a atualização dos dados com o ERP foi concluída com sucesso. Agora temos ${count} ordens sincronizadas.`
            );
          }
        } else if (job.status === 'FAILED') {
          if (this.pollIntervalTimer) clearInterval(this.pollIntervalTimer);
          this.isSyncing = false;
          this.currentJobId = null;

          logger.error({ jobId, error: job.error }, '[InovarFiscalSync] O job de extração no ERP falhou');
          queueIdleAnnouncement(
            'Houve uma instabilidade temporária ao sincronizar com o Inovar Fiscal, mas continuamos operando com os dados locais normalmente.'
          );
        } else if (Date.now() - startTime > MAX_WAIT_MS) {
          if (this.pollIntervalTimer) clearInterval(this.pollIntervalTimer);
          this.isSyncing = false;
          this.currentJobId = null;
          logger.warn({ jobId }, '[InovarFiscalSync] Timeout de polling atingido (60s)');
        }
      } catch (pollErr) {
        logger.warn({ pollErr }, '[InovarFiscalSync] Erro no polling de job do ERP');
      }
    }, 2500);
  }
}

export const inovarFiscalSyncService = new InovarFiscalSyncService();
