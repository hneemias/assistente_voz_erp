import { createMutationTools } from './mutation-tools.ts';
import { createQueryTools } from './query-tools.ts';

export * from './query-tools.ts';
export * from './mutation-tools.ts';

export function createAllErpTools() {
  return [...createQueryTools(), ...createMutationTools()];
}
