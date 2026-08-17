import { ConflictError } from './ddb.js';

export function assertProfileCompatibility(authoritativeModelId: unknown, profileModelId: unknown): void {
  if (typeof authoritativeModelId !== 'string' || !authoritativeModelId || profileModelId !== authoritativeModelId) {
    throw new ConflictError('Selected profile is not compatible with this gateway model');
  }
}

export function assertProfileLineageModel(lineageModelId: unknown, requestedModelId: unknown): void {
  if (typeof lineageModelId !== 'string' || !lineageModelId || requestedModelId !== lineageModelId) {
    throw new ConflictError('An immutable profile lineage cannot change gateway model');
  }
}
