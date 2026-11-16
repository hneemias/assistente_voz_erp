import { ERP_ENDPOINTS_CONFIG, type ErpEndpointDefinition } from '../../config/erp-endpoints.ts';
import type { ErpOperationName } from './erp-types.ts';

export { ERP_ENDPOINTS_CONFIG, type ErpEndpointDefinition };

export function getEndpointDefinition(operation: ErpOperationName): ErpEndpointDefinition {
  return ERP_ENDPOINTS_CONFIG[operation];
}

export function buildEndpointUrl(
  baseUrl: string,
  operation: ErpOperationName,
  pathParams?: Record<string, string | number>,
  queryParams?: Record<string, string | number | boolean | undefined | null>,
): string {
  const def = ERP_ENDPOINTS_CONFIG[operation];
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  let resolvedPath = def.pathTemplate;

  if (pathParams) {
    for (const [key, value] of Object.entries(pathParams)) {
      resolvedPath = resolvedPath.replace(`:${key}`, encodeURIComponent(String(value)));
    }
  }

  const url = new URL(`${normalizedBase}${resolvedPath}`);
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}
