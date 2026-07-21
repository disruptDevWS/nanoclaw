#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const AID = '08409ae8-28ab-4a34-b92c-2c92f73e5af7';

async function run() {
  // Check canonicalize_mode values on keywords
  const { data: kwModes, error: e1 } = await (sb as any).from('audit_keywords')
    .select('canonicalize_mode')
    .eq('audit_id', AID);
  if (e1) console.log('canonicalize_mode query error:', e1.message);
  else {
    const modeDist: Record<string, number> = {};
    for (const m of kwModes) { const k = m.canonicalize_mode || 'null'; modeDist[k] = (modeDist[k] || 0) + 1; }
    console.log('=== KEYWORD CANONICALIZE_MODE ===');
    console.log(JSON.stringify(modeDist));
  }

  // Committed page detail
  const { data: page } = await sb.from('execution_pages')
    .select('url_slug, canonical_key, silo, status, source')
    .eq('audit_id', AID)
    .eq('url_slug', 'how-to-become-an-emt-in-idaho');
  console.log('\n=== COMMITTED PAGE ===');
  console.log(JSON.stringify(page, null, 2));

  // Check if emt_training exists in audit_keywords canonical_key
  const { data: etKw, count: etCount } = await sb.from('audit_keywords')
    .select('keyword, canonical_key', { count: 'exact' })
    .eq('audit_id', AID)
    .eq('canonical_key', 'emt_training')
    .limit(5);
  console.log('\n=== Keywords with canonical_key=emt_training ===');
  console.log(`Count: ${etCount ?? etKw?.length ?? 0}`);
  for (const k of (etKw || [])) console.log(`  ${(k as any).keyword}`);

  // Check if emt_training exists in shadow
  const { data: etShadow } = await sb.from('audit_keywords')
    .select('keyword, shadow_canonical_key', { count: 'exact' })
    .eq('audit_id', AID)
    .eq('shadow_canonical_key', 'emt_training')
    .limit(5);
  console.log(`\n=== Keywords with shadow_canonical_key=emt_training ===`);
  console.log(`Count: ${etShadow?.length ?? 0}`);

  // Check agent_runs for in-progress IMA work
  const { data: runs } = await (sb as any).from('agent_runs')
    .select('agent_name, status, created_at')
    .eq('audit_id', AID)
    .in('status', ['running', 'pending', 'in_progress'])
    .limit(10);
  console.log('\n=== IN-PROGRESS AGENT RUNS ===');
  console.log(`Count: ${runs?.length ?? 0}`);
  for (const r of (runs || [])) console.log(`  ${r.agent_name} | ${r.status} | ${r.created_at}`);
}

run().catch(e => { console.error(e); process.exit(1); });
