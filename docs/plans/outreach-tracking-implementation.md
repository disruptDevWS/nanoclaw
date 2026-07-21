# Outreach & Scout Tracking — Implementation Status & Admin Checklist

Companion to [`FORGE_OS_OUTREACH_TRACKING_SPEC.md`](FORGE_OS_OUTREACH_TRACKING_SPEC.md).
Started 2026-07-21. Records what shipped in code, the deliberate deviations, and the
Google-UI admin work that only Matt can do.

## Root cause of "forgegrowth.ai isn't tracking"

The GA4 property + GTM container existed in Google's UI, but **no container snippet
was ever placed on either site** — no `GTM-`/`G-` id, no `googletagmanager.com`
script in `localgrowth-spark` or `lovable-repo`. Nothing to fire. Fixed by mounting
the container in the marketing site's root layout.

## What shipped in code (done + verified)

| Area | Change | Verify |
|------|--------|--------|
| **Marketing site** (`localgrowth-spark`) | `@next/third-parties` `GoogleTagManager gtmId="GTM-NN6MGDL3"` in `src/app/layout.tsx` | `npm run build` ✓; commit `ac98cc1`, pushed → Vercel |
| **Outreach generator** (`forge-os-pipeline`) | `buildShareUrl` appends UTM params to the share URL; selects `target_geos`; `marketSlug` helper | `tsc --noEmit` ✓; URL format eval ✓ |
| **DB** | Migration 048 → `scout_engagement_events` (token-keyed, RLS super_admin, service-role writes) | Applied live + columns/policy confirmed ✓ |
| **Edge fn** (`lovable-repo`) | `scout-engagement` — token-as-credential, event allowlist, resolves token→prospect, inserts one row | Deployed `--no-verify-jwt`; smoke-tested valid/400/404 + row landed + cleaned ✓ |
| **Share page** (`lovable-repo`) | `src/lib/scoutTracking.ts` + `ScoutShareReport.tsx`: reads UTM params, `scout_view` on mount, scroll 25/50/75/100, section views (4 `data-track` sections), 30s/90s dwell, `cta_click`, `mailto_click` — dataLayer + Supabase dual-write | `tsc` + `npm run build` ✓ |
| **Book hop** (`lovable-repo`) | `BookScout.tsx` fires `book_redirect` before the scheduler hop | `tsc` ✓ |

The four instrumented sections (`data-track`): `revenue_tile`, `gap_table`,
`positioning`, `cta`.

## Deliberate deviations from the spec (see DECISIONS.md 2026-07-21)

1. **App-driven dual-write, not GTM-driven.** The SPA has no GTM container yet, so
   the app POSTs engagement events itself (spec §7 allows "a small fetch in the app").
   Ad-blocker-resistant and works today. dataLayer pushes still happen for a future
   Scout container.
2. **`variant_id` = `outreach_variant` placeholder** (`pitch`/`courtesy_note`). No
   genome population exists; all plumbing keys off `variant_id` for a one-line swap.
3. **`utm_campaign` = base `scout`** — `prospects` has no `vertical` column. Add one
   to light up `scout_{vertical}`.
4. **No `scout-booked` / `booking_completed`.** Google Calendar has no webhook;
   `book_redirect` / `booking_intent_at` is the terminal signal. Switch to
   Cal.com/Calendly to build the true Booked event.
5. **No open-pixels.** Click = arrival at `/share/scout/:token` (server-logged).

## Admin checklist — Google UI (Matt only)

### Marketing property (`forgegrowth.ai`, container `GTM-NN6MGDL3`) — makes it actually track
- [ ] In GTM, confirm/add a **GA4 Configuration tag** → the marketing GA4 measurement id (`G-…`), trigger **All Pages**. Installing the snippet alone sends nothing without this.
- [ ] **Publish** the container. (This is the real on/off switch.)
- [ ] Verify: load `forgegrowth.ai` → Network shows `gtm.js?id=GTM-NN6MGDL3`; GTM Preview shows the GA4 tag firing; GA4 Realtime shows the hit.
- [ ] Add both `forgegrowth.ai` and `app.forgegrowth.ai` to the property's "configure your domains" list (prevents self-referral).

### Dedicated Scout property (new) — for the outreach funnel
- [ ] Create a **separate GA4 property** for the Scout funnel (isolation from operator/client sessions).
- [ ] Create a **GTM container for `app.forgegrowth.ai`**, give me the `GTM-…` id → I'll mount it in the dashboard `index.html` (one-line add; the dataLayer events are already firing).
- [ ] Scope **every** Scout trigger to Page Path `^/share/scout/` or `^/book/scout/` — authenticated dashboard routes must never fire Scout tags.
- [ ] Build triggers (spec §6): History Change (SPA), custom scroll 25/50/75/100, Element Visibility on the 4 `data-track` sections (≥50% / 1000ms / once), click triggers (CTA, mailto, tel, outbound).
- [ ] Tags per the §5 event catalog; dataLayer variables for `scout_token`, `variant_id`, `campaign`, `market`, `section_name`, etc.
- [ ] Register custom dimensions (event-scoped): `variant_id`, `campaign`, `vertical`, `market`, `revenue_band`, `prospect_domain`, `section_name`.
- [ ] Mark key events: `scout_cta_click`, `book_redirect` (and `booking_completed` only if a webhook scheduler is adopted).

## Open follow-ups (code, when prioritized)
- Add a `vertical` column to `prospects` (carry from candidate at promotion) → real `scout_{vertical}` campaigns.
- When a genome/variant population exists, pass its id as `variantId` in `buildShareUrl` and the fitness function joins immediately.
- If switching to Cal.com/Calendly: build `scout-booked` edge fn + webhook (spec §7) and pass the token as scheduler metadata from `BookScout`.
- A dashboard read view over `scout_engagement_events` (funnel + per-variant rollup).
