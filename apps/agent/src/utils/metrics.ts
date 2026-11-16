export interface ToolMetricEntry {
  toolName: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  confirmationRequiredCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
  lastCalledAt: string | null;
}

export interface SystemMetricsSnapshot {
  uptimeSeconds: number;
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  timeoutOperations: number;
  confirmationsRequested: number;
  confirmationsApproved: number;
  confirmationsCancelled: number;
  averageResponseTimeMs: number;
  tools: Record<string, ToolMetricEntry>;
}

class MetricsCollector {
  private readonly startedAt = Date.now();
  private readonly toolMetrics = new Map<string, ToolMetricEntry>();
  private confirmationsRequested = 0;
  private confirmationsApproved = 0;
  private confirmationsCancelled = 0;

  public recordToolCall(params: {
    toolName: string;
    durationMs: number;
    outcome: 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'CONFIRMATION_REQUIRED' | 'AMBIGUOUS' | 'CANCELLED';
  }): void {
    const existing = this.toolMetrics.get(params.toolName) ?? {
      toolName: params.toolName,
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      timeoutCount: 0,
      confirmationRequiredCount: 0,
      totalDurationMs: 0,
      avgDurationMs: 0,
      maxDurationMs: 0,
      lastCalledAt: null,
    };

    existing.totalCalls += 1;
    existing.totalDurationMs += params.durationMs;
    existing.avgDurationMs = Math.round((existing.totalDurationMs / existing.totalCalls) * 100) / 100;
    existing.maxDurationMs = Math.max(existing.maxDurationMs, params.durationMs);
    existing.lastCalledAt = new Date().toISOString();

    if (params.outcome === 'SUCCESS' || params.outcome === 'AMBIGUOUS' || params.outcome === 'CANCELLED') {
      existing.successCount += 1;
    } else if (params.outcome === 'CONFIRMATION_REQUIRED') {
      existing.confirmationRequiredCount += 1;
      this.confirmationsRequested += 1;
    } else if (params.outcome === 'TIMEOUT') {
      existing.failureCount += 1;
      existing.timeoutCount += 1;
    } else {
      existing.failureCount += 1;
    }

    this.toolMetrics.set(params.toolName, existing);
  }

  public recordConfirmationApproved(): void {
    this.confirmationsApproved += 1;
  }

  public recordConfirmationCancelled(): void {
    this.confirmationsCancelled += 1;
  }

  public getSnapshot(): SystemMetricsSnapshot {
    let totalOperations = 0;
    let successfulOperations = 0;
    let failedOperations = 0;
    let timeoutOperations = 0;
    let totalDurationMs = 0;

    const toolsRecord: Record<string, ToolMetricEntry> = {};
    for (const [name, entry] of this.toolMetrics.entries()) {
      toolsRecord[name] = { ...entry };
      totalOperations += entry.totalCalls;
      successfulOperations += entry.successCount;
      failedOperations += entry.failureCount;
      timeoutOperations += entry.timeoutCount;
      totalDurationMs += entry.totalDurationMs;
    }

    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      totalOperations,
      successfulOperations,
      failedOperations,
      timeoutOperations,
      confirmationsRequested: this.confirmationsRequested,
      confirmationsApproved: this.confirmationsApproved,
      confirmationsCancelled: this.confirmationsCancelled,
      averageResponseTimeMs:
        totalOperations > 0 ? Math.round((totalDurationMs / totalOperations) * 100) / 100 : 0,
      tools: toolsRecord,
    };
  }

  public reset(): void {
    this.toolMetrics.clear();
    this.confirmationsRequested = 0;
    this.confirmationsApproved = 0;
    this.confirmationsCancelled = 0;
  }
}

export const metrics = new MetricsCollector();
