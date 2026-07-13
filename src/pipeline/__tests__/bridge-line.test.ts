import { describe, it, expect } from 'vitest';
import { extractBridgeLine } from '../bridge-line.js';

describe('extractBridgeLine', () => {
  it('extracts the bridge line and strips it from the narrative', () => {
    const raw = `# Where Acme Stands Online

## Where You're Winning
Some wins.

BRIDGE_LINE: Your Spokane sewer-lining gap alone is 1,200 searches a month. I built the system that closes gaps like that.`;
    const { narrative, bridgeLine } = extractBridgeLine(raw);
    expect(bridgeLine).toBe(
      'Your Spokane sewer-lining gap alone is 1,200 searches a month. I built the system that closes gaps like that.',
    );
    expect(narrative).not.toContain('BRIDGE_LINE');
    expect(narrative).toContain("## Where You're Winning");
    expect(narrative.endsWith('Some wins.')).toBe(true);
  });

  it('returns null bridge line when the marker is absent', () => {
    const raw = '# Where Acme Stands Online\n\nNarrative only.';
    const { narrative, bridgeLine } = extractBridgeLine(raw);
    expect(bridgeLine).toBeNull();
    expect(narrative).toBe(raw);
  });

  it('returns null when the marker has no content', () => {
    const raw = 'Narrative.\n\nBRIDGE_LINE: ';
    const { bridgeLine } = extractBridgeLine(raw);
    expect(bridgeLine).toBeNull();
  });

  it('tolerates trailing whitespace after the line', () => {
    const raw = 'Body.\n\nBRIDGE_LINE: One sentence.   \n\n';
    const { narrative, bridgeLine } = extractBridgeLine(raw);
    expect(bridgeLine).toBe('One sentence.');
    expect(narrative).toBe('Body.');
  });
});
