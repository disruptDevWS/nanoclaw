import { describe, it, expect } from 'vitest';
import { parseBlueprintMarkdown } from '../blueprint-parse.js';

const BLUEPRINT = `# Architecture Blueprint

## Executive Summary
Five-silo structure.

## Part 2: Silos

### Silo 1: HVAC Services Hub

| URL Slug | Status | Silo | Role | Coverage Role | Primary Keyword | Volume | Action |
|----------|--------|------|------|---------------|-----------------|--------|--------|
| hvac-services | exists | HVAC Services Hub | pillar | commercial | heating boise | 390 | optimize |
| hvac-repair-boise | new | HVAC Services Hub | cluster | commercial | hvac repair boise | 70 | create |

**Buyer Journey Coverage Assessment**

| Buyer Stage | Coverage | Pages | Notes |
|-------------|----------|-------|-------|
| Awareness (problem recognition, research queries) | Covered | hvac-services, hvac-repair-boise | Thin layer |
| Decision (pricing, booking, contact) | Partial | hvac-repair-boise | Needs trust page |
`;

describe('parseBlueprintMarkdown', () => {
  it('parses silo page tables and ignores Buyer Journey Coverage tables', () => {
    const r = parseBlueprintMarkdown(BLUEPRINT);
    expect(r.pages.map((p) => p.url_slug)).toEqual(['hvac-services', 'hvac-repair-boise']);
    expect(r.validSlugCount).toBe(2);
    // Buyer Journey rows used to be counted as corrupted slugs (~38% false
    // rejection per blueprint, one wasted retry Sonnet call per Michael run)
    expect(r.rejectedSlugCount).toBe(0);
    expect(r.parseWarnings).toEqual([]);
  });

  it('still rejects genuinely corrupt slug cells in silo tables', () => {
    const corrupt = BLUEPRINT.replace('| hvac-repair-boise | new', '| hvac repair (boise), new page | new');
    const r = parseBlueprintMarkdown(corrupt);
    expect(r.rejectedSlugCount).toBe(1);
    expect(r.validSlugCount).toBe(1);
  });
});
