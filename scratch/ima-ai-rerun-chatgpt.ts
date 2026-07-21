/**
 * One-off: re-run AI visibility analysis for IMA with a raised domain budget
 * so ChatGPT client mentions are captured (default $1.00 cap skipped ChatGPT).
 * Non-destructive: builds env from .env in memory + overrides, does not edit .env.
 */
import * as fs from 'node:fs';
import { runAiVisibilityAnalysis } from '../scripts/ai-visibility-analysis.js';

const env: Record<string, string> = {};
for (const line of fs.readFileSync('.env', 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 0) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[t.slice(0, i).trim()] = v;
}

// Raise the per-domain LLM mention budget so BOTH google + chat_gpt are fetched.
env.LLM_DOMAIN_BUDGET = '3.0';
env.LLM_COMPETITOR_BUDGET = '1.5';
// Anthropic SDK reads process.env; anthropic-client falls back to ANTHROPIC_KEY.
if (env.ANTHROPIC_KEY && !process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_KEY;

const request = {
  domain: 'idahomedicalacademy.com',
  email: 'matt@forgegrowth.ai',
  audit_id: '08409ae8-28ab-4a34-b92c-2c92f73e5af7',
  competitor_domains: ['idahocprplus.com', 'emtutah.com', 'impactems.com', 'safetytrainingseminars.com', 'calregional.com'],
};

runAiVisibilityAnalysis(env, request as any)
  .then((r: any) => {
    console.log('\n=== RERUN COMPLETE ===');
    console.log('google_cited:', r?.summary?.google_cited_count, 'chatgpt_cited:', r?.summary?.chatgpt_cited_count);
    console.log('cost:', r?.costs?.total);
    process.exit(0);
  })
  .catch((e: any) => { console.error('FATAL:', e?.message || e); process.exit(1); });
