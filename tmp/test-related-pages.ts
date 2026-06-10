// Ad-hoc verification for Session 3 — computeRelatedPages against live audits.
// Usage: npx tsx tmp/test-related-pages.ts <auditId> <slug>
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { computeRelatedPages, formatRelatedPagesSection } from '../src/agents/linking/related-pages.js';

const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf-8');
for (const line of envContent.split('\n')) {
  const eq = line.indexOf('=');
  if (eq < 0 || line.trim().startsWith('#')) continue;
  const k = line.slice(0, eq).trim();
  let v = line.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

const [auditId, slug] = process.argv.slice(2);
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data: audit } = await sb.from('audits').select('domain').eq('id', auditId).single();
if (!audit) throw new Error('audit not found');
console.log(`Audit ${auditId} → ${audit.domain}, slug: /${slug}`);

const result = await computeRelatedPages(sb, { auditId, domain: audit.domain, slug });
console.log('\n--- formatted section ---\n');
console.log(formatRelatedPagesSection(result));
console.log('\n--- raw candidates ---');
console.log(JSON.stringify(result?.candidates, null, 2));
console.log('risks:', JSON.stringify(result?.cannibalization_risks));
