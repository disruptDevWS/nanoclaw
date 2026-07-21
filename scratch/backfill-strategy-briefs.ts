// One-off: backfill audit_snapshots.strategy_brief_markdown from local disk
// artifacts (migration 046). Latest strategy_brief.md per domain wins.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT = '/home/forgegrowth/forge-os-pipeline';

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const auditsBase = path.join(ROOT, 'audits');
  for (const domain of fs.readdirSync(auditsBase)) {
    const researchBase = path.join(auditsBase, domain, 'research');
    if (!fs.existsSync(researchBase)) continue;
    const dates = fs.readdirSync(researchBase).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    let briefPath = '';
    for (const d of dates.reverse()) {
      const p = path.join(researchBase, d, 'strategy_brief.md');
      if (fs.existsSync(p)) { briefPath = p; break; }
    }
    if (!briefPath) continue;

    const { data: audit } = await sb
      .from('audits')
      .select('id')
      .eq('domain', domain)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!audit) { console.log(`SKIP ${domain}: no audit row`); continue; }

    const md = fs.readFileSync(briefPath, 'utf-8');
    const { error } = await sb.from('audit_snapshots').upsert(
      { audit_id: audit.id, agent_name: 'strategy-brief', snapshot_version: 1, strategy_brief_markdown: md },
      { onConflict: 'audit_id,agent_name,snapshot_version' },
    );
    console.log(error ? `FAIL ${domain}: ${error.message}` : `OK ${domain} ← ${path.relative(ROOT, briefPath)} (${md.length} chars)`);
  }
}
main();
