// Verify the exact 7b fallback: query by audit_id + agent_name='strategy-brief',
// run the same extractSection regexes generate-brief.ts uses.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(fs.readFileSync('.env','utf-8').split('\n').map(l=>l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m:any)=>[m[1],m[2].replace(/^"|"$/g,'')]));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
async function main(){
  const {data: audit} = await sb.from('audits').select('id').eq('domain','idahomedicalacademy.com').order('created_at',{ascending:false}).limit(1).maybeSingle();
  const {data: row} = await sb.from('audit_snapshots').select('strategy_brief_markdown').eq('audit_id', audit!.id).eq('agent_name','strategy-brief').order('created_at',{ascending:false}).limit(1).maybeSingle();
  const briefContent = row?.strategy_brief_markdown ?? '';
  const extractSection = (heading: string) => {
    const re = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |\\n---\\s*$|$)`);
    return re.exec(briefContent)?.[1]?.trim() ?? '';
  };
  const posture = extractSection('Visibility Posture');
  const arch = extractSection('Architecture Directive');
  console.log('markdown chars:', briefContent.length);
  console.log('Visibility Posture extracted:', posture ? `yes (${posture.length} chars): "${posture.slice(0,80)}..."` : 'NO');
  console.log('Architecture Directive extracted:', arch ? `yes (${arch.length} chars)` : 'NO');
}
main();
