import { describe, it, expect } from 'vitest';
import { parseInternalAllCsv } from '../crawl-meta.js';

const HEADER = 'Address,Content Type,Status Code,Title 1,H1-1,Meta Description 1';

describe('parseInternalAllCsv()', () => {
  it('strips UTF-8 BOM', () => {
    const csv = '\ufeff' + HEADER + '\nhttps://ex.com/a,text/html; charset=UTF-8,200,Title A,H1 A,Meta A';
    const pages = parseInternalAllCsv(csv);
    expect(pages).toHaveLength(1);
    expect(pages[0].url).toBe('https://ex.com/a');
  });

  it('filters non-HTML content types', () => {
    const csv = [
      HEADER,
      'https://ex.com/a,text/html,200,Title A,H1 A,Meta A',
      'https://ex.com/img.jpg,image/jpeg,200,,,',
      'https://ex.com/doc.pdf,application/pdf,200,,,',
    ].join('\n');
    const pages = parseInternalAllCsv(csv);
    expect(pages).toHaveLength(1);
    expect(pages[0].url).toBe('https://ex.com/a');
  });

  it('filters non-200 status codes', () => {
    const csv = [
      HEADER,
      'https://ex.com/a,text/html,200,Title A,H1 A,Meta A',
      'https://ex.com/gone,text/html,404,Gone,,',
      'https://ex.com/moved,text/html,301,Moved,,',
    ].join('\n');
    const pages = parseInternalAllCsv(csv);
    expect(pages).toHaveLength(1);
    expect(pages[0].url).toBe('https://ex.com/a');
  });

  it('maps Screaming Frog columns to PageMeta fields', () => {
    const csv = HEADER + '\nhttps://ex.com/a,text/html,200,My Title,My H1,My Meta';
    const [page] = parseInternalAllCsv(csv);
    expect(page).toEqual({
      url: 'https://ex.com/a',
      title: 'My Title',
      h1: 'My H1',
      metaDescription: 'My Meta',
    });
  });

  it('returns null for empty title/h1/meta fields', () => {
    const csv = HEADER + '\nhttps://ex.com/a,text/html,200,,,';
    const [page] = parseInternalAllCsv(csv);
    expect(page.title).toBeNull();
    expect(page.h1).toBeNull();
    expect(page.metaDescription).toBeNull();
  });

  it('drops rows with no Address', () => {
    const csv = HEADER + '\n,text/html,200,Title,,';
    expect(parseInternalAllCsv(csv)).toHaveLength(0);
  });

  it('treats empty content type as HTML (matches syncDwight)', () => {
    const csv = HEADER + '\nhttps://ex.com/a,,200,Title A,,';
    expect(parseInternalAllCsv(csv)).toHaveLength(1);
  });
});
