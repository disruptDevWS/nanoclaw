import { getServiceAccountAccessToken } from './google-auth.js';
const t = await getServiceAccountAccessToken(['https://www.googleapis.com/auth/analytics.readonly']);
const resp = await fetch('https://analyticsdata.googleapis.com/v1beta/properties/358230005:runReport', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
  body: JSON.stringify({
    dateRanges: [{ startDate: '2026-05-01', endDate: '2026-05-31' }],
    dimensions: [{ name: 'customEvent:program_name' }],
    metrics: [{ name: 'eventValue' }, { name: 'eventCount' }],
    dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: 'purchase' } } },
    limit: 100,
  }),
});
const d = await resp.json();
const rows = (d.rows ?? []).map((r: any) => ({ program: r.dimensionValues[0].value, value: +r.metricValues[0].value, count: +r.metricValues[1].value }));
import * as fs from 'node:fs';
fs.writeFileSync('/home/forgegrowth/ima-landing-pages/tmp/ima-may-programs.json', JSON.stringify(rows, null, 2));
const cpr = rows.filter((r: any) => /cpr|aha|enrollware/i.test(r.program)).reduce((s: number, r: any) => s + r.value, 0);
console.log('May total purchase value:', rows.reduce((s: number, r: any) => s + r.value, 0));
console.log('May CPR/AHA program value:', cpr);
console.log('May non-CPR enrollment revenue:', rows.reduce((s: number, r: any) => s + r.value, 0) - cpr);
