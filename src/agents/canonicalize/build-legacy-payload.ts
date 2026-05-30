/**
 * Builds the classification update payload for a single keyword.
 *
 * In hybrid mode (the only mode), canonical_key/canonical_topic/cluster are written
 * exclusively by the hybrid persist step — this function only writes classification fields.
 */

export interface LegacyPayloadInput {
  isBrand: boolean;
  intentType: string;
  isNearMe: boolean;
  primaryEntityType: string;
  canonicalKey: string;
  canonicalTopic: string;
}

export function buildLegacyUpdatePayload(
  input: LegacyPayloadInput,
): Record<string, unknown> {
  return {
    is_brand: input.isBrand,
    intent_type: input.intentType,
    is_near_me: input.isNearMe,
    primary_entity_type: input.primaryEntityType,
  };
}
