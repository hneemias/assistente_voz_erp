import type { ErpOperationName } from './erp-types.ts';

export type ErpErrorCode =
  | 'ERP_TIMEOUT'
  | 'ERP_NOT_FOUND'
  | 'ERP_VALIDATION_ERROR'
  | 'ERP_CONTRACT_PENDING'
  | 'ERP_CONFLICT'
  | 'ERP_UNAUTHORIZED'
  | 'ERP_INVALID_RESPONSE'
  | 'ERP_HTTP_ERROR'
  | 'ERP_NETWORK_ERROR';

export class ErpError extends Error {
  public readonly code: ErpErrorCode;
  public readonly operation: ErpOperationName;
  public readonly httpStatus: number | null;
  public readonly isRetryable: boolean;
  public readonly isMutation: boolean;
  public readonly details?: unknown;

  constructor(params: {
    message: string;
    code: ErpErrorCode;
    operation: ErpOperationName;
    httpStatus?: number | null;
    isRetryable?: boolean;
    isMutation?: boolean;
    details?: unknown;
  }) {
    super(params.message);
    this.name = 'ErpError';
    this.code = params.code;
    this.operation = params.operation;
    this.httpStatus = params.httpStatus ?? null;
    // Regra de segurança obrigatória: operações de escrita NUNCA devem ser repetidas automaticamente
    this.isMutation = params.isMutation ?? false;
    this.isRetryable = this.isMutation ? false : (params.isRetryable ?? false);
    this.details = params.details;
  }
}

export class ErpTimeoutError extends ErpError {
  constructor(operation: ErpOperationName, timeoutMs: number, isMutation: boolean) {
    super({
      message: isMutation
        ? `Tempo limite de ${timeoutMs}ms excedido durante a operação de escrita '${operation}'. Por segurança, a operação NÃO foi repetida automaticamente e o resultado no ERP é inconclusivo.`
        : `Tempo limite de ${timeoutMs}ms excedido ao consultar '${operation}' no ERP.`,
      code: 'ERP_TIMEOUT',
      operation,
      httpStatus: 408,
      isRetryable: false,
      isMutation,
    });
    this.name = 'ErpTimeoutError';
  }
}

export class ErpNotFoundError extends ErpError {
  constructor(operation: ErpOperationName, resourceDescription: string) {
    super({
      message: `${resourceDescription} não encontrado(a) no ERP.`,
      code: 'ERP_NOT_FOUND',
      operation,
      httpStatus: 404,
      isRetryable: false,
      isMutation: false,
    });
    this.name = 'ErpNotFoundError';
  }
}

export class ErpContractPendingError extends ErpError {
  constructor(operation: ErpOperationName) {
    super({
      message: `O endpoint real do ERP para a operação '${operation}' ainda está com status PENDING_CONTRACT em config/erp-endpoints.ts. Configure o contrato REST real ou utilize ERP_MODE=mock para testes.`,
      code: 'ERP_CONTRACT_PENDING',
      operation,
      httpStatus: 501,
      isRetryable: false,
      isMutation: false,
    });
    this.name = 'ErpContractPendingError';
  }
}

export class ErpValidationError extends ErpError {
  constructor(operation: ErpOperationName, message: string, details?: unknown) {
    super({
      message,
      code: 'ERP_VALIDATION_ERROR',
      operation,
      httpStatus: 400,
      isRetryable: false,
      details,
    });
    this.name = 'ErpValidationError';
  }
}
