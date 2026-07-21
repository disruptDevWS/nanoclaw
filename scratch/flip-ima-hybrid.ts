#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
    return env;
  }
  return Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined)
  ) as Record<string, string>;
}

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await sb
    .from('audits')
    .update({ canonicalize_mode: 'hybrid' })
    .eq('id', '08409ae8-28ab-4a34-b92c-2c92f73e5af7')
    .select('id, domain, canonicalize_mode');
  if (error) {
    console.error('Update error:', error);
    process.exit(1);
  }
  console.log('Updated:', JSON.stringify(data, null, 2));

  // Read-back to confirm
  const { data: readback, error: rbErr } = await sb
    .from('audits')
    .select('id, domain, canonicalize_mode')
    .eq('id', '08409ae8-28ab-4a34-b92c-2c92f73e5af7')
    .single();
  if (rbErr) {
    console.error('Read-back error:', rbErr);
    process.exit(1);
  }
  console.log('Confirmed:', JSON.stringify(readback, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
