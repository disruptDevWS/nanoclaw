/**
 * verify-feedback-loop.ts — V3/V4 checks for the 2026-07-08 Michael feedback
 * loop build (migration 044). Pure-logic assertions, no DB writes.
 *
 * Run: npx tsx scratch/verify-feedback-loop.ts
 */
import { isCommitted } from '../scripts/rerun-utils.js';
import { parseBlueprintMarkdown } from '../src/pipeline/blueprint-parse.js';

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures++;
}

// ── V3: isCommitted predicate ────────────────────────────────────────
// The Weiser bug: deprecated michael page re-added by blueprint must be revivable
check('deprecated michael page is NOT committed (revivable)',
  !isCommitted({ status: 'deprecated', source: 'michael', published_at: null }));
check('draft_ready page IS committed (protected)',
  isCommitted({ status: 'draft_ready', source: 'michael', published_at: null }));
check('brief_ready page IS committed (protected)',
  isCommitted({ status: 'brief_ready', source: 'michael', published_at: null }));
check('published-then-deprecated page IS committed (published_at protects content)',
  isCommitted({ status: 'deprecated', source: 'michael', published_at: '2026-01-01' }));
check('not_started cluster_strategy page IS committed (source protects)',
  isCommitted({ status: 'not_started', source: 'cluster_strategy', published_at: null }));
check('deprecated cluster_strategy page IS committed (source protects)',
  isCommitted({ status: 'deprecated', source: 'cluster_strategy', published_at: null }));
check('not_started michael page is NOT committed (normal upsert)',
  !isCommitted({ status: 'not_started', source: 'michael', published_at: null }));

// ── V4: blueprint parser Cluster Key column ──────────────────────────
const WITH_KEY = `# Blueprint
## Executive Summary
Test summary.

## Part 2
### Silo 1: Towing Services
| URL Slug | Status | Silo | Role | Primary Keyword | Volume | Action | Cluster Key |
|---|---|---|---|---|---|---|---|
| towing-services | new | Towing Services | pillar | towing boise | 900 | create | towing_services |
| towing-services/payette-county-id | new | Towing Services | cluster | towing payette | 30 | create | towing_services |

### Silo 2: Service Area
| URL Slug | Status | Silo | Role | Primary Keyword | Volume | Action | Cluster Key |
|---|---|---|---|---|---|---|---|
| service-area/payette-county-id | new | Service Area | support | — | 0 | create | Service Area |
| service-area/adams-county-id | new | Service Area | support | — | 0 | create | — |
`;
const withKey = parseBlueprintMarkdown(WITH_KEY);
check('parses 4 pages from Cluster Key blueprint', withKey.pages.length === 4);
check('cluster_key extracted (towing_services)',
  withKey.pages[0]?.cluster_key === 'towing_services');
check('silo_name NOT swallowed by Cluster Key header (still "Towing Services")',
  withKey.pages[0]?.silo_name === 'Towing Services');
check('prose key normalized to snake_case ("Service Area" → service_area)',
  withKey.pages[2]?.cluster_key === 'service_area');
check('dash placeholder → empty cluster_key',
  withKey.pages[3]?.cluster_key === '');
check('volume still parses with extra column', withKey.pages[0]?.primary_keyword_volume === 900);

// Backward compat: pre-044 blueprint without the column
const WITHOUT_KEY = `# Blueprint
## Executive Summary
Old format.

## Part 2
### Silo 1: Towing Services
| URL Slug | Status | Silo | Role | Primary Keyword | Volume | Action |
|---|---|---|---|---|---|---|
| towing-services | new | Towing Services | pillar | towing boise | 900 | create |
`;
const withoutKey = parseBlueprintMarkdown(WITHOUT_KEY);
check('pre-044 blueprint still parses', withoutKey.pages.length === 1);
check('missing column → empty cluster_key', withoutKey.pages[0]?.cluster_key === '');
check('silo detector still works without Cluster Key column',
  withoutKey.pages[0]?.silo_name === 'Towing Services');

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
