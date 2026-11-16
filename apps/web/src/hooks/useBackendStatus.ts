import { useCallback, useEffect, useState } from 'react';
import {
  fetchErpMapping,
  fetchHealthStatus,
  fetchMetricsSnapshot,
} from '../services/api.ts';
import type {
  ErpMappingResponse,
  HealthStatus,
  MetricsSnapshot,
} from '../types/assistant.ts';

export function useBackendStatus(pollIntervalMs = 4000) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [erpMapping, setErpMapping] = useState<ErpMappingResponse | null>(null);
  const [backendOffline, setBackendOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [h, m, map] = await Promise.all([
        fetchHealthStatus(),
        fetchMetricsSnapshot(),
        fetchErpMapping(),
      ]);
      setHealth(h);
      setMetrics(m);
      setErpMapping(map);
      setBackendOffline(false);
    } catch {
      setBackendOffline(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, pollIntervalMs);
    return () => window.clearInterval(id);
  }, [refresh, pollIntervalMs]);

  return {
    health,
    metrics,
    erpMapping,
    backendOffline,
    refresh,
  };
}
