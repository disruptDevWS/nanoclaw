import { describe, it, expect } from 'vitest';
import { buildLegacyUpdatePayload, type LegacyPayloadInput } from '../build-legacy-payload.js';

const BASE_INPUT: LegacyPayloadInput = {
  isBrand: false,
  intentType: 'commercial',
  isNearMe: false,
  primaryEntityType: 'Service',
  canonicalKey: 'emt_basic_course',
  canonicalTopic: 'EMT Basic Course',
};

describe('buildLegacyUpdatePayload', () => {
  it('does NOT include canonical_key, canonical_topic, or cluster (hybrid-only)', () => {
    const payload = buildLegacyUpdatePayload(BASE_INPUT);

    expect(payload).not.toHaveProperty('canonical_key');
    expect(payload).not.toHaveProperty('canonical_topic');
    expect(payload).not.toHaveProperty('cluster');
  });

  it('includes classification fields (is_brand, intent_type, etc.)', () => {
    const payload = buildLegacyUpdatePayload(BASE_INPUT);

    expect(payload).toEqual({
      is_brand: false,
      intent_type: 'commercial',
      is_near_me: false,
      primary_entity_type: 'Service',
    });
  });

  it('uses primaryEntityType when provided', () => {
    const input = { ...BASE_INPUT, primaryEntityType: 'Organization' };
    const payload = buildLegacyUpdatePayload(input);
    expect(payload.primary_entity_type).toBe('Organization');
  });

  it('handles branded navigational keywords', () => {
    const input: LegacyPayloadInput = {
      isBrand: true,
      intentType: 'navigational',
      isNearMe: true,
      primaryEntityType: 'Organization',
      canonicalKey: 'brand_key',
      canonicalTopic: 'Brand Topic',
    };

    const payload = buildLegacyUpdatePayload(input);

    expect(payload.is_brand).toBe(true);
    expect(payload.is_near_me).toBe(true);
    expect(payload.intent_type).toBe('navigational');
    // canonical fields never written — hybrid persist handles these
    expect(payload).not.toHaveProperty('canonical_key');
    expect(payload).not.toHaveProperty('canonical_topic');
  });
});
