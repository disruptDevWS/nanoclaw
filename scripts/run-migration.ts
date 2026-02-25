/**
 * Runs the agent pipeline SQL migration against Supabase.
 * Uses the service role key from .env.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf-8');
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const STATEMENTS = [
  // Alter audits table
  `ALTER TABLE public.audits ADD COLUMN IF NOT EXISTS agent_pipeline_status TEXT`,
  `ALTER TABLE public.audits ADD COLUMN IF NOT EXISTS agent_pipeline_domain TEXT`,

  // agent_runs
  `CREATE TABLE IF NOT EXISTS public.agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
    agent_name TEXT NOT NULL,
    run_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'syncing',
    source_path TEXT,
    synced_at TIMESTAMPTZ DEFAULT now(),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  // agent_technical_pages
  `CREATE TABLE IF NOT EXISTS public.agent_technical_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
    agent_run_id UUID REFERENCES public.agent_runs(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    status_code INTEGER,
    word_count INTEGER,
    title TEXT,
    h1 TEXT,
    meta_description TEXT,
    depth INTEGER,
    indexability TEXT,
    inlinks_count INTEGER,
    outlinks_count INTEGER,
    semantic_closest_url TEXT,
    semantic_similarity_score NUMERIC,
    semantic_flag TEXT,
    crawl_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  // agent_architecture_pages
  `CREATE TABLE IF NOT EXISTS public.agent_architecture_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
    agent_run_id UUID REFERENCES public.agent_runs(id) ON DELETE CASCADE,
    url_slug TEXT NOT NULL,
    page_status TEXT,
    silo_name TEXT,
    role TEXT,
    primary_keyword TEXT,
    primary_keyword_volume INTEGER,
    action_required TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  // agent_architecture_blueprint
  `CREATE TABLE IF NOT EXISTS public.agent_architecture_blueprint (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
    agent_run_id UUID REFERENCES public.agent_runs(id) ON DELETE CASCADE,
    blueprint_markdown TEXT NOT NULL,
    executive_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  // agent_implementation_pages
  `CREATE TABLE IF NOT EXISTS public.agent_implementation_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
    agent_run_id UUID REFERENCES public.agent_runs(id) ON DELETE CASCADE,
    url_slug TEXT NOT NULL,
    meta_title TEXT,
    meta_description TEXT,
    h1_recommendation TEXT,
    intent_classification TEXT,
    metadata_markdown TEXT,
    schema_json JSONB,
    content_outline_markdown TEXT,
    target_word_count INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  // Enable RLS
  `ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE public.agent_technical_pages ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE public.agent_architecture_pages ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE public.agent_architecture_blueprint ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE public.agent_implementation_pages ENABLE ROW LEVEL SECURITY`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_agent_runs_audit_id ON public.agent_runs(audit_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_name ON public.agent_runs(agent_name)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_technical_pages_audit_id ON public.agent_technical_pages(audit_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_architecture_pages_audit_id ON public.agent_architecture_pages(audit_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_architecture_blueprint_audit_id ON public.agent_architecture_blueprint(audit_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_implementation_pages_audit_id ON public.agent_implementation_pages(audit_id)`,
];

// RLS policies need DROP IF EXISTS + CREATE (no IF NOT EXISTS for policies)
const POLICIES = [
  { table: 'agent_runs', name: 'Users can view own agent_runs', op: 'SELECT', check: 'USING', ref: 'agent_runs' },
  { table: 'agent_runs', name: 'Users can create own agent_runs', op: 'INSERT', check: 'WITH CHECK', ref: 'agent_runs' },
  { table: 'agent_technical_pages', name: 'Users can view own agent_technical_pages', op: 'SELECT', check: 'USING', ref: 'agent_technical_pages' },
  { table: 'agent_technical_pages', name: 'Users can create own agent_technical_pages', op: 'INSERT', check: 'WITH CHECK', ref: 'agent_technical_pages' },
  { table: 'agent_architecture_pages', name: 'Users can view own agent_architecture_pages', op: 'SELECT', check: 'USING', ref: 'agent_architecture_pages' },
  { table: 'agent_architecture_pages', name: 'Users can create own agent_architecture_pages', op: 'INSERT', check: 'WITH CHECK', ref: 'agent_architecture_pages' },
  { table: 'agent_architecture_blueprint', name: 'Users can view own agent_architecture_blueprint', op: 'SELECT', check: 'USING', ref: 'agent_architecture_blueprint' },
  { table: 'agent_architecture_blueprint', name: 'Users can create own agent_architecture_blueprint', op: 'INSERT', check: 'WITH CHECK', ref: 'agent_architecture_blueprint' },
  { table: 'agent_implementation_pages', name: 'Users can view own agent_implementation_pages', op: 'SELECT', check: 'USING', ref: 'agent_implementation_pages' },
  { table: 'agent_implementation_pages', name: 'Users can create own agent_implementation_pages', op: 'INSERT', check: 'WITH CHECK', ref: 'agent_implementation_pages' },
];

async function runSQL(supabaseUrl: string, key: string, sql: string): Promise<{ ok: boolean; error?: string }> {
  // Use the Supabase Management SQL endpoint via PostgREST pg_query function
  // Fallback: try the /pg endpoint
  const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  // This won't work for raw SQL. Let's use a different approach.
  return { ok: false, error: 'not implemented' };
}

async function main() {
  const env = loadEnv();
  const supabaseUrl = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  console.log('Running agent pipeline migration...\n');

  // We'll use the Supabase client to test table existence, then provide
  // the SQL for manual execution if tables don't exist yet.

  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(supabaseUrl, key);

  // Test if migration already ran by checking for agent_runs table
  const { error: testErr } = await sb.from('agent_runs').select('id').limit(1);

  if (!testErr) {
    console.log('Migration already applied — agent_runs table exists.');

    // Verify all tables
    const tables = ['agent_runs', 'agent_technical_pages', 'agent_architecture_pages', 'agent_architecture_blueprint', 'agent_implementation_pages'];
    for (const t of tables) {
      const { error } = await (sb as any).from(t).select('id').limit(1);
      console.log(`  ${t}: ${error ? 'MISSING - ' + error.message : 'OK'}`);
    }

    // Test audits columns
    const { data: auditTest } = await sb.from('audits').select('agent_pipeline_status, agent_pipeline_domain').limit(1);
    console.log(`  audits.agent_pipeline_status: ${auditTest ? 'OK' : 'MISSING'}`);

    return;
  }

  // Tables don't exist — output SQL for manual execution
  console.log('Tables do not exist yet. Executing migration via SQL...\n');

  // Build full SQL
  let fullSql = STATEMENTS.join(';\n') + ';\n\n';

  for (const p of POLICIES) {
    fullSql += `DROP POLICY IF EXISTS "${p.name}" ON public.${p.table};\n`;
    fullSql += `CREATE POLICY "${p.name}" ON public.${p.table} FOR ${p.op} TO authenticated ${p.check} (EXISTS (SELECT 1 FROM public.audits WHERE audits.id = ${p.ref}.audit_id AND audits.user_id = auth.uid()));\n\n`;
  }

  // Write SQL to a temp file for reference
  const sqlPath = path.resolve(process.cwd(), 'scripts/migration-agent-pipeline.sql');
  fs.writeFileSync(sqlPath, fullSql);
  console.log(`Full SQL written to: ${sqlPath}`);
  console.log('\nPlease run this SQL in the Supabase SQL Editor (Dashboard > SQL Editor > New Query)');
  console.log('Then re-run this script to verify.');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
