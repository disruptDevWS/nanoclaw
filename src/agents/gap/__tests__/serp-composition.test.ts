import { describe, it, expect } from 'vitest';
import {
  classifySerpDomain,
  computeEffectiveKd,
  buildSerpCompositionEntry,
  selectSerpTargets,
  buildSerpCompositionBlock,
  normalizeDomain,
  SerpTargetKeyword,
} from '../serp-composition.js';

const COMPETITORS = new Set(['texasemsschool.com', 'eliteemtacademy.com']);
const CLIENT = 'idahomedicalacademy.com';

describe('classifySerpDomain', () => {
  it('classifies weak slots, competitors, client, and authorities', () => {
    expect(classifySerpDomain('www.reddit.com', COMPETITORS, CLIENT)).toBe('weak_slot');
    expect(classifySerpDomain('yelp.com', COMPETITORS, CLIENT)).toBe('weak_slot');
    expect(classifySerpDomain('forums.emtlife.com', COMPETITORS, CLIENT)).toBe('weak_slot');
    expect(classifySerpDomain('texasemsschool.com', COMPETITORS, CLIENT)).toBe('direct_competitor');
    expect(classifySerpDomain('www.idahomedicalacademy.com', COMPETITORS, CLIENT)).toBe('client');
    expect(classifySerpDomain('redcross.org', COMPETITORS, CLIENT)).toBe('authority');
  });

  it('normalizeDomain strips www and paths', () => {
    expect(normalizeDomain('www.Reddit.com/r/emt')).toBe('reddit.com');
  });
});

describe('computeEffectiveKd', () => {
  it('4+ weak slots → one tier easier (×0.7)', () => {
    expect(computeEffectiveKd(35, 4)).toEqual({ effective_kd: 25, modifier: 'easier' });
  });
  it('0–1 weak slots → one tier harder (×1.3)', () => {
    expect(computeEffectiveKd(20, 0)).toEqual({ effective_kd: 26, modifier: 'harder' });
    expect(computeEffectiveKd(20, 1)).toEqual({ effective_kd: 26, modifier: 'harder' });
  });
  it('2–3 weak slots → unchanged', () => {
    expect(computeEffectiveKd(20, 2)).toEqual({ effective_kd: 20, modifier: 'none' });
    expect(computeEffectiveKd(20, 3)).toEqual({ effective_kd: 20, modifier: 'none' });
  });
});

describe('buildSerpCompositionEntry', () => {
  const organic = (domains: string[]) => domains.map((domain, i) => ({ rank: i + 1, domain }));

  it('counts classes and applies ceiling verdict with +5 headroom', () => {
    const entry = buildSerpCompositionEntry({
      keyword: 'emt course online',
      canonical_key: 'emt_training',
      kd: 20,
      organicDomains: organic([
        'reddit.com', 'quora.com', 'yelp.com', 'thumbtack.com', // 4 weak
        'texasemsschool.com', // competitor
        'redcross.org', 'nremt.org', 'ems1.com', 'idahomedicalacademy.com', 'percomcourses.com',
      ]),
      hasVideoCarousel: true,
      competitorDomains: COMPETITORS,
      clientDomain: CLIENT,
      clusterCeiling: 11,
      siteCeiling: 49,
    });
    expect(entry.weak_slots).toBe(4);
    expect(entry.direct_competitors).toBe(1);
    expect(entry.authorities).toBe(4); // client slot excluded
    expect(entry.effective_kd).toBe(14); // 20 × 0.7
    expect(entry.modifier).toBe('easier');
    expect(entry.ceiling_used).toBe(11); // cluster ceiling preferred over site
    expect(entry.vs_ceiling).toBe('within_reach'); // 14 ≤ 11 + 5
    expect(entry.has_video_carousel).toBe(true);
  });

  it('wall-to-wall authorities makes a low-KD keyword a stretch vs cluster ceiling', () => {
    const entry = buildSerpCompositionEntry({
      keyword: 'cpr certification',
      canonical_key: 'cpr',
      kd: 15,
      organicDomains: organic([
        'redcross.org', 'heart.org', 'nsc.org', 'cprcertified.com', 'procpr.org',
        'emedcert.com', 'aedcpr.com', 'nationalcprfoundation.com', 'cpr.io', 'osha.gov',
      ]),
      hasVideoCarousel: false,
      competitorDomains: COMPETITORS,
      clientDomain: CLIENT,
      clusterCeiling: 11,
      siteCeiling: 49,
    });
    expect(entry.effective_kd).toBe(20); // 15 × 1.3 ≈ 20
    expect(entry.modifier).toBe('harder');
    expect(entry.vs_ceiling).toBe('stretch'); // 20 > 11 + 5
  });

  it('falls back to site ceiling, and to unknown when no ceiling exists', () => {
    const base = {
      keyword: 'k',
      canonical_key: null,
      kd: 30,
      organicDomains: organic(['reddit.com', 'quora.com', 'a.com', 'b.com']),
      hasVideoCarousel: false,
      competitorDomains: COMPETITORS,
      clientDomain: CLIENT,
    };
    expect(buildSerpCompositionEntry({ ...base, clusterCeiling: null, siteCeiling: 49 }).ceiling_used).toBe(49);
    const unknown = buildSerpCompositionEntry({ ...base, clusterCeiling: null, siteCeiling: null });
    expect(unknown.ceiling_used).toBeNull();
    expect(unknown.vs_ceiling).toBe('unknown');
  });
});

describe('selectSerpTargets', () => {
  const kw = (overrides: Partial<SerpTargetKeyword>): SerpTargetKeyword => ({
    keyword: 'kw',
    canonical_key: 'c1',
    keyword_difficulty: 20,
    is_brand: false,
    intent_type: 'commercial',
    search_volume: 100,
    delta_revenue_mid: 0,
    ...overrides,
  });

  it('ranks by revenue then volume, caps per cluster and total', () => {
    const keywords = [
      kw({ keyword: 'low', delta_revenue_mid: 10 }),
      kw({ keyword: 'high', delta_revenue_mid: 500 }),
      kw({ keyword: 'mid', delta_revenue_mid: 100 }),
      kw({ keyword: 'third-in-cluster', delta_revenue_mid: 50 }),
      kw({ keyword: 'other-cluster', canonical_key: 'c2', delta_revenue_mid: 5 }),
    ];
    const out = selectSerpTargets(keywords, 3, 2);
    expect(out.map((k) => k.keyword)).toEqual(['high', 'mid', 'other-cluster']);
  });

  it('excludes brand, informational/navigational, and KD-less keywords', () => {
    const keywords = [
      kw({ keyword: 'brand', is_brand: true }),
      kw({ keyword: 'info', intent_type: 'informational' }),
      kw({ keyword: 'nav', intent_type: 'navigational' }),
      kw({ keyword: 'no-kd', keyword_difficulty: null }),
      kw({ keyword: 'ok' }),
    ];
    expect(selectSerpTargets(keywords).map((k) => k.keyword)).toEqual(['ok']);
  });
});

describe('buildSerpCompositionBlock', () => {
  it('returns empty for no entries and renders the block otherwise', () => {
    expect(buildSerpCompositionBlock([], 49)).toBe('');
    const entry = buildSerpCompositionEntry({
      keyword: 'emt course online',
      canonical_key: 'emt_training',
      kd: 20,
      organicDomains: [{ rank: 1, domain: 'reddit.com' }],
      hasVideoCarousel: true,
      competitorDomains: COMPETITORS,
      clientDomain: CLIENT,
      clusterCeiling: 11,
      siteCeiling: 49,
    });
    const block = buildSerpCompositionBlock([entry], 49);
    expect(block).toContain('SERP Composition');
    expect(block).toContain('Site proven ranking ceiling: KD 49');
    expect(block).toContain('VIDEO CAROUSEL');
    expect(block).toContain('effective KD');
  });
});
