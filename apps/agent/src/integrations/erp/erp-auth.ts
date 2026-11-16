import { env } from '../../config/env.ts';

export interface ErpAuthConfig {
  type: 'bearer' | 'api-key' | 'basic';
  token: string;
  apiKeyHeader?: string;
}

/**
 * Constrói os headers de autenticação para o ERP exclusivamente no backend.
 * Nunca expõe tokens em logs ou ao frontend.
 */
export function buildErpAuthHeaders(customConfig?: Partial<ErpAuthConfig>): Record<string, string> {
  const type = customConfig?.type ?? env.ERP_AUTH_TYPE;
  const token = customConfig?.token ?? env.ERP_API_TOKEN;
  const headerName = customConfig?.apiKeyHeader ?? env.ERP_API_KEY_HEADER;

  if (!token || token.trim() === '') {
    return {};
  }

  switch (type) {
    case 'bearer':
      return {
        Authorization: `Bearer ${token.trim()}`,
      };
    case 'api-key':
      return {
        [headerName]: token.trim(),
      };
    case 'basic': {
      const encoded = Buffer.from(token.trim()).toString('base64');
      return {
        Authorization: `Basic ${encoded}`,
      };
    }
    default:
      return {
        Authorization: `Bearer ${token.trim()}`,
      };
  }
}

/**
 * Mascara headers sensíveis antes de qualquer inspeção ou diagnóstico.
 */
export function sanitizeHeadersForLog(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      lower === 'authorization' ||
      lower === 'x-api-key' ||
      lower.includes('token') ||
      lower.includes('secret')
    ) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
