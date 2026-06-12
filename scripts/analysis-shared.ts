/**
 * analysis-shared.ts — shared plumbing for the Workstream A analysis CLIs
 * (compute-proven-ceiling, detect-reeval-candidates, detect-llm-citation-queries).
 *
 * Read-only against Supabase; outputs go to audits/{domain}/analysis/.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const AUDITS_BASE = path.resolve(process.cwd(), 'audits');

export function loadEnv(): Record<string, string> {
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
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
    return env;
  }
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val !== undefined) env[key] = val;
  }
  return env;
}

export function createSb(env: Record<string, string>): SupabaseClient {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(supabaseUrl, supabaseKey);
}

export function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    }
  }
  return flags;
}

/** Latest audit for a domain (analysis scripts are not user-scoped). */
export async function resolveAuditByDomain(
  sb: SupabaseClient,
  domain: string,
): Promise<{ id: string; domain: string }> {
  const { data, error } = await sb
    .from('audits')
    .select('id, domain')
    .eq('domain', domain)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`audits lookup failed: ${error.message}`);
  if (!data) throw new Error(`No audit found for domain ${domain}`);
  return data as { id: string; domain: string };
}

/** Paginated full fetch (PostgREST max-rows=1000). */
export async function fetchAll<T>(
  sb: SupabaseClient,
  table: string,
  select: string,
  applyFilters: (q: any) => any,
): Promise<T[]> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await applyFilters(
      (sb as any).from(table).select(select),
    ).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Write {name}.json (+ optional .md) under audits/{domain}/analysis/. */
export function writeAnalysisArtifact(
  domain: string,
  name: string,
  data: unknown,
  markdown?: string,
): string {
  const dir = path.join(AUDITS_BASE, domain, 'analysis');
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, `${name}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  if (markdown !== undefined) {
    fs.writeFileSync(path.join(dir, `${name}.md`), markdown);
  }
  return jsonPath;
}

export function todayStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
