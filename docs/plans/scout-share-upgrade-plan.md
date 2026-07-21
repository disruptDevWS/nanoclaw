# Scout Share Upgrade-in-Place — Session Plan

**Created:** 2026-07-13. **Status:** IMPLEMENTED 2026-07-13 (approved by Matt same day). See DECISIONS.md 2026-07-13 for locked choices. Remaining external tasks: root SPF + Gmail DKIM DNS records (Matt) before sending link-bearing email.

**Decision context (locked 2026-07-13):** Host the prospect deliverable on the existing `app.forgegrowth.ai/share/scout/:token` surface, upgraded in place — NOT a new forgegrowth.ai build. Rationale: the capability-URL page, structured Scout output (`scout_scope_json` + `prospect_narrative`), and brand-palette styling already exist; app./www share the registrable domain so deliverability is identical; the forgegrowth.ai move stays possible later as a template port (same data contract) and goes to FOLLOWUPS. Source brief: `~/tmp/claude-code-prompt-scout-hosted-reports.md`. Copy source: `~/tmp/forge-growth-onepager-copy-spec.md` (final copy; headline C recommended for cold).

**What this adds to the existing share surface:** 14-day expiry, view logging, booking-intent capture, the positioning/credibility layer, a Scout-authored bridge line, discovery-bounding headers, and the outreach-email link swap.

---

## Workstream 1 — Migration 047: share lifecycle columns on `prospects` (pipeline repo)

New columns (all nullable, no CHECKs, no new GRANTs — existing table):

| Column | Type | Written by |
|---|---|---|
| `share_expires_at` | timestamptz | `generate_share_token` (now + 14d, reset on regenerate) |
| `first_viewed_at` | timestamptz | `get_share_report` (first hit only) |
| `last_viewed_at` | timestamptz | `get_share_report` (every hit) |
| `view_count` | int NOT NULL DEFAULT 0 | `get_share_report` (increment) |
| `booking_intent_at` | timestamptz | `log_booking_intent` (first hit only) |
| `prospect_bridge_line` | text | Scout sync (pipeline-generate.ts) |

**Status model (recommendation, confirm):** timestamps are the source of truth; NO new status enum. Expiry derives from `share_expires_at` at request time (no cron flipping rows); Viewed/Booking-intent chips derive from timestamps. `outreach_status` (TEXT, no CHECK — 043 comment says future values are free) gains a manual **`sent`** value via a one-click dashboard control, which also stamps `share_expires_at = now() + 14d` so the expiry clock starts at send, not at draft time. `booking_completed` / `inquired` stay manual observations (out of scope to automate).

Files: `scripts/migrations/047-share-lifecycle.sql` + `047-share-lifecycle-rollback.sql`.

## Workstream 2 — `scout-config` edge function (lovable-repo)

File: `supabase/functions/scout-config/index.ts` (deploy after: `npx supabase functions deploy scout-config --project-ref hohuimkcpihdufunrzvg --no-verify-jwt`)

- **`generate_share_token`**: also set `share_expires_at = now() + 14d`. Regeneration already mints a new token — expired links stay dead, new link gets a fresh window.
- **`get_share_report`** (public): after token lookup — expiry check (`share_expires_at < now()` → **410** `{error: 'expired'}`); on success, view logging (single UPDATE: `first_viewed_at` coalesce, `last_viewed_at`, `view_count + 1`); add `bridge_line` and `booking_available: !!BOOKING_URL` to the payload.
- **New public action `log_booking_intent`** `{token}`: validate token + not expired → stamp `booking_intent_at` (first only) → return `{redirect: Deno.env.get('BOOKING_URL')}`. Keeps the scheduling target a server-side config value (brief requirement), swappable without a template change.
- New secret: `BOOKING_URL` (Matt's Google Calendar appointment link) via `supabase secrets set`.

This function remains the brief's "single server-side checkpoint" — access, expiry, and logging all live here.

## Workstream 3 — Dashboard share surface (lovable-repo)

- **`src/pages/ScoutShareReport.tsx`**: expired state ("This report link has expired — get in touch" + mailto, graceful, no auth flow); payload-first order per brief (identity bar → their report → bridge line → positioning → CTA); CTA block — primary "Walk through your report — 15 minutes" → `/book/scout/:token`, secondary reply-to-email.
- **New `src/components/scout/ScoutSharePositioning.tsx`**: renders the copy-spec blocks (headline C, The System 3-dimension table, Why Forge, background, engagement). Copy inlined from the spec — it's final; placeholder `{{entity-grade schema / structured data}}` resolves to "structured data" (trades-heavy prospect pool; segmentation fork is a FOLLOWUPS item).
- **New route + page `/book/scout/:token`** (public, in `src/App.tsx`): calls `log_booking_intent`, then `window.location.replace(redirect)`; error/expired fallback UI. SPA route rather than an edge-function 302 so the URL lives on app.forgegrowth.ai.
- **`vercel.json`**: `headers` entries for `/share/scout/*` and `/book/scout/*` — `X-Robots-Tag: noindex, nofollow` + `Referrer-Policy: no-referrer` (token can't leak via outbound referrers). Verify they coexist with the SPA rewrite on a preview deploy.
- **`src/components/scout/ShareLinkButton.tsx` / ScoutReport share card**: show expiry date; add the one-click "Mark sent" control (flips `outreach_status='sent'`, stamps `share_expires_at`).
- Types: extend prospects row types with the 047 columns (or `(supabase as any)` per convention).

## Workstream 4 — Pipeline: bridge line + email link (pipeline repo)

- **`scripts/pipeline-generate.ts`** (prospect narrative phase, ~L6090; sync at ~L5968): prompt emits a 1–2 sentence prospect-specific bridge (their sharpest finding → why the engagement follows) as a delimited block; parsed and persisted to `prospects.prospect_bridge_line`. Non-fatal on parse failure (page falls back to the spec's generic bridge line).
- **`scripts/generate-outreach-email.ts`** (~L169/174): replace "Do NOT include any links or URLs" with: exactly one link — the share URL — plain `https://`, no shorteners, placed after the value line. Before generating, ensure `share_token` exists (service-role generate if null) and build the URL from `DASHBOARD_URL`. Both variants (pitch + courtesy_note).
- **PRECONDITION (Matt, before sending any link-bearing email):** SPF/DKIM/DMARC verified for forgegrowth.ai. Code ships; sending waits on DNS.

## Workstream 5 — Docs (same commits)

- `PIPELINE.md`: share flow (expiry/view/intent), `log_booking_intent`, outreach link rule change.
- `DATA_CONTRACT.md`: 047 columns + writers, scout-config action inventory.
- `DECISIONS.md`: upgrade-in-place over forgegrowth.ai (rationale above); timestamps-over-status-enum; expiry-at-send; no-links rule reversal (and its deliverability gate).
- `FOLLOWUPS.md`: forgegrowth.ai migration (template port, same data contract); trades/training positioning fork; `booking_completed`/`inquired` automation.

---

## Schema/infra assumptions and how they'll be verified (pre-flight, output shown before migration)

1. None of the 6 new columns exist on `prospects` (live Management API query).
2. `prospects` RLS: service-role writes unaffected; confirm the dashboard's authenticated read policy covers new columns (SELECT policies are column-agnostic — confirm policy exists at all) and that "Mark sent" (authenticated UPDATE) has a policy — **RLS silent-failure gotcha applies**; add policy in 047 if missing.
3. `DASHBOARD_URL` secret exists (used by `generate_share_token` today); `BOOKING_URL` is new.
4. `get_share_report` payload additions are additive — ScoutShareReport tolerates unknown fields (verify its type handling).
5. `vercel.json` headers + SPA rewrite coexistence — verify with `curl -I` on preview before merging.
6. Narrative prompt/persist insertion points at pipeline-generate.ts L6090/L5968 (verified 2026-07-13; re-grep at implementation).

## Verification plan

- Pre-flight live-DB queries (above) with output shown; 047 applied via Management API; confirmation query after.
- `npx tsc --noEmit` + tests in both repos; dashboard `npm run build`.
- E2E on Vietzke: regenerate link → `share_expires_at` set; open share URL → `first_viewed_at`/`view_count`; `/book/scout/:token` → `booking_intent_at` + redirect to calendar; `UPDATE share_expires_at = past` → expired state renders; restore. Outreach `--force` regen on a scouted prospect → draft contains exactly one share link.
- `curl -I` share + book routes for both headers.
- Commit + push both repos; deploy scout-config; confirm Railway/Vercel deploys.

## Out of scope (per brief + prior decisions)

Full pipeline runs on prospects; auth/email-capture gates; Calendly/Cal.com; trades-vs-training fork; SPF/DKIM/DMARC execution; `booking_completed`/`inquired` automation; forgegrowth.ai hosting.

## Open questions — RESOLVED (Matt, 2026-07-13)

1. **`BOOKING_URL`** = `https://calendar.app.google/AXxRKHuyMjvhtrNs7`. Window: 24h–14 days out — matches the 14-day link expiry exactly. Edge case accepted: a prospect viewing on day 13–14 books within a narrow horizon; if it bites, widen the calendar window, not the expiry.
2. **"Mark sent" control** — proceeding with it (default; Matt did not object).
3. **Headline** — replaced spec's A/B/C with Matt's direction: business-outcomes-vs-vanity-metrics framing. Final wording chosen at implementation (see conversation).
4. **DNS precondition — NOT met for the Gmail path (live-DNS verified 2026-07-13):** root `forgegrowth.ai` has NO SPF record and `google._domainkey` is unpublished; DMARC is `p=none`. The `send.` subdomain records (SES/Resend) cover the contact form only. Gmail-sent cold email currently fails DMARC (delivered only because p=none). **Matt's tasks before sending link-bearing email:** (a) Cloudflare root TXT `v=spf1 include:_spf.google.com ~all`; (b) Google Admin → Gmail → Authenticate email → publish `google._domainkey` TXT → Start authentication; (c) optionally DMARC → `v=DMARC1; p=none; rua=mailto:matt@forgegrowth.ai`. Code ships regardless; sending waits on (a)+(b).

**Size estimate:** M — one focused session, both repos + one migration + one edge-function deploy.
