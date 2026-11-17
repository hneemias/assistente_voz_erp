/**
 * Adaptador de Armazenamento Local do ERP baseado em SQLite nativo (node:sqlite).
 * Substitui mocks estáticos em memória por persistência ACID em arquivo local (data/erp_cache.sqlite).
 */
export {
  ErpSqliteStore,
  ErpSqliteStore as ErpMockStore,
  defaultSqliteStore,
  defaultSqliteStore as defaultMockStore,
  normalizeStatusCanonical,
} from '../../database/erp-sqlite-store.ts';
