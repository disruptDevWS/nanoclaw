import { getServiceAccountAccessToken } from './google-auth.js';
import * as fs from 'node:fs';
const t = await getServiceAccountAccessToken(['https://www.googleapis.com/auth/analytics.readonly']);

// Organic conversions by landing page, split by event (June), excluding cta_click
const resp = await fetch('https://analyticsdata.googleapis.com/v1beta/properties/358230005:runReport', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
  body: JSON.stringify({
    dateRanges: [{ startDate: '2026-06-01', endDate: '2026-06-30' }],
    dimensions: [{ name: 'landingPagePlusQueryString' }, { name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      andGroup: { expressions: [
        { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { value: 'Organic Search' } } },
        { filter: { fieldName: 'eventName', inListFilter: { values: ['purchase', 'contact_form_submit', 'click_phone'] } } },
      ] },
    },
    limit: 100000,
  }),
});
const d = await resp.json();
const PATH: [string, RegExp][] = [
  ['EMT', /emt/i],
  ['Phlebotomy', /phleb/i],
  ['Medical Assistant', /medical-assistant|\/ma[-\/]/i],
  ['CPR/ACLS/PALS', /cpr|bls|acls|pals|first-aid|aha/i],
];
const coh: Record<string, Record<string, number>> = {};
for (const r of d.rows ?? []) {
  const page = r.dimensionValues[0].value || '';
  const ev = r.dimensionValues[1].value;
  const n = +r.metricValues[0].value || 0;
  for (const [c, re] of PATH) {
    if (re.test(page)) {
      coh[c] = coh[c] || { purchase: 0, contact_form_submit: 0, click_phone: 0, total: 0 };
      coh[c][ev] += n; coh[c].total += n;
      break;
    }
  }
}
fs.writeFileSync('/home/forgegrowth/ima-landing-pages/tmp/ima-organic-conv.json', JSON.stringify(coh, null, 2));
console.log(JSON.stringify(coh, null, 2));
