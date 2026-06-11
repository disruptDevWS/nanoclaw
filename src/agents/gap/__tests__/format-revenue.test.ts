import { describe, it, expect } from 'vitest';
import { formatRevenueOpportunity } from '../format-revenue.js';

describe('formatRevenueOpportunity', () => {
  it('formats the current {value, basis} object', () => {
    expect(formatRevenueOpportunity({ value: 2507, basis: 'CPC × volume ÷ 10' }))
      .toBe('$2,507/mo (CPC × volume ÷ 10)');
  });

  it('falls back to basis when value is null', () => {
    expect(formatRevenueOpportunity({ value: null, basis: 'No CPC data available' }))
      .toBe('No CPC data available');
  });

  it('returns em dash for null/undefined and empty objects', () => {
    expect(formatRevenueOpportunity(null)).toBe('—');
    expect(formatRevenueOpportunity(undefined)).toBe('—');
    expect(formatRevenueOpportunity({})).toBe('—');
    expect(formatRevenueOpportunity({ value: null, basis: '' })).toBe('—');
  });

  it('passes legacy strings through (cleaned)', () => {
    expect(formatRevenueOpportunity('$1285–$34272/mo across Boise'))
      .toBe('$1285–$34272/mo across Boise');
  });

  it('escapes pipes so markdown tables survive', () => {
    expect(formatRevenueOpportunity('high | risky')).toBe('high \\| risky');
    expect(formatRevenueOpportunity({ value: 100, basis: 'a | b' })).toBe('$100/mo (a \\| b)');
  });

  it('truncates very long basis text', () => {
    const long = 'x'.repeat(300);
    const out = formatRevenueOpportunity({ value: null, basis: long });
    expect(out.length).toBeLessThanOrEqual(121);
    expect(out.endsWith('…')).toBe(true);
  });

  it('formats bare numbers', () => {
    expect(formatRevenueOpportunity(1500)).toBe('$1,500/mo');
  });

  it('collapses internal whitespace/newlines', () => {
    expect(formatRevenueOpportunity('high\nvalue  topic')).toBe('high value topic');
  });
});
