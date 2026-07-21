# Forge OS — Outreach & Scout Tracking Spec

> **Scope**: Instrumentation for the cold-outreach → Scout → booking funnel.
> **Owner**: Matt Edens / Forge Growth
> **Version**: v1 — 2026-07-21
> **Consumers**: app code (Claude Code), GTM containers, outreach generator (`generate-outreach-email.ts`), GA4 admin.

---

## 1. Principles (read first — they decide every choice below)

1. **Supabase is the system of record, GA4 is enrichment.** The share lifecycle already logs view + booking-intent server-side with timestamps as source of truth. Cold prospects sit behind corporate networks and ad-blockers, and Apple MPP poisons email opens — client-side GA will systematically undercount exactly the audience that matters. GA4 exists here to capture engagement depth the server can't see (scroll, dwell, section visibility, CTA interaction). It never becomes the outreach scoreboard.

2. **The variant ID must travel on the share link, or nothing is measurable.** The gamification fitness function is a join between *email variant* and *Scout engagement*. That join only exists if the variant ID rides the share URL. This is the single highest-priority change; everything else is inert without it.

3. **Dual-write the fitness-critical events to Supabase.** Engagement events GA4 collects should also POST to a Supabase Edge Function so the fitness function reads one table, token-keyed, ad-blocker-resistant where it counts.

4. **Segment by audience, not by subdomain.** Cold prospects, inbound/brand traffic, and authenticated client/operator usage are three different populations sharing two subdomains. Keep them in separate analytics contexts.

5. **No open-pixels.** They trip spam filters, inflate on MPP, and undercut the "one accountable expert / honest" brand. The click *is* arrival at `/share/scout/:token`, which is already logged. Treat "click" ≈ "scout_view." Opens are not tracked.

---

## 2. Property & stream topology

| Audience | Surface | Analytics context |
|----------|---------|-------------------|
| Inbound / brand | `forgegrowth.ai` | Marketing GA4 property (existing) |
| Cold prospects | `app.forgegrowth.ai/share/scout/*`, `/book/scout/*` | **Dedicated Scout/outreach GA4 property** |
| Authenticated client + operator | `app.forgegrowth.ai` (all other routes) | Separate product-analytics stream, or excluded entirely |

**Decisions:**

- **No cross-domain linker between `forgegrowth.ai` and `app.forgegrowth.ai`.** They share the registrable domain `forgegrowth.ai`, so GA4 writes its cookie at `.forgegrowth.ai` automatically (`cookie_domain` = auto) and `client_id` persists across both with zero linker config.
- **Add both subdomains to the property's "configure your domains" list** so `app.` is not counted as a self-referral.
- **Use a dedicated GA4 property for the Scout funnel.** You lose no useful cross-property stitching — cold prospects arrive directly from Gmail, not by traversing the marketing site, so there is no cross-property journey to preserve. Isolation keeps operator/client sessions out of the prospect dataset and keeps outreach key events clean.
- **Scope all Scout tags to path matches** `^/share/scout/` and `^/book/scout/` only. Authenticated dashboard routes must never fire Scout tags.
- **Cross-domain is only relevant at the scheduler hop** (different registrable domain). Do not solve that with GA cross-domain — solve it server-side (§7).

---

## 3. Share-link contract (outreach generator)

`generate-outreach-email.ts` must append attribution params to the share URL. Token stays in the path for server attribution; the params carry campaign + variant.

```
https://app.forgegrowth.ai/share/scout/{token}
  ?utm_source=outreach
  &utm_medium=email
  &utm_campaign=scout_{vertical}            # e.g. scout_hvac, scout_plumbing
  &utm_content={variant_id}                 # the genome/variant identifier — REQUIRED
  &utm_term={market}                        # optional: e.g. bend_or
```

Rules:
- `variant_id` is the primary key of the email variant in the gamification population. Non-negotiable.
- Preserve the **one-link rule**: the share URL still appears exactly once in the email.
- The app must read these params on load and forward `variant_id`, `utm_campaign`, `utm_term` into both the dataLayer push (§4) and the server dual-write (§7).

---

## 4. dataLayer contract (app / Claude Code)

`app.forgegrowth.ai` is a Vite SPA. Route changes do not reload the page, so GA needs an explicit push on mount plus a History Change trigger. On mount of the Scout share route, push:

```js
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: 'scout_view',
  scout_token: '{token}',
  prospect_domain: '{domain}',      // e.g. accuairheat.com
  vertical: '{vertical}',           // e.g. hvac
  market: '{market}',               // e.g. bend_or
  revenue_band: '{band}',           // e.g. '2500-5000' | '5000-10000' | '10000+'
  variant_id: '{utm_content}',      // echo the share-link param
  campaign: '{utm_campaign}'
});
```

Additional pushes:
- On the booking-intent CTA click → push `event: 'scout_cta_click'` with `{ cta_location }`.
- On `/book/scout/:token` mount → push `event: 'book_redirect'` with `{ scout_token }`.

All Scout GA4 tags read their params from this dataLayer, so the token/variant context attaches to every downstream event automatically (set them as GTM dataLayer variables and attach to all Scout tags).

---

## 5. GA4 event catalog

| Event | Trigger | Key params | Key event? |
|-------|---------|-----------|:---------:|
| `scout_view` | Custom Event `scout_view` (from dataLayer) + History Change on `/share/scout/` | scout_token, prospect_domain, vertical, market, revenue_band, variant_id, campaign | — |
| `scout_scroll_25/50/75/100` | Custom scroll-depth trigger at 25/50/75/100% | percent, + inherited context | — |
| `scout_section_view` | Element Visibility (≥50% for ≥1s) on: revenue tile, gap table, positioning block, CTA | section_name | — |
| `scout_engaged_30s` / `scout_engaged_90s` | GTM timer / engagement timer | seconds | — |
| `scout_cta_click` | Click on "Book a Strategy Call" | cta_location | **Yes** |
| `scout_mailto_click` | Click on `mailto:` reply link | — | — |
| `scout_tel_click` | Click on `tel:` link | — | — |
| `scout_outbound_click` | Click to `forgegrowth.ai` | link_url | — |
| `book_redirect` | `/book/scout/:token` route mount | scout_token | **Yes** |
| `booking_completed` | Scheduler webhook → server (see §7); mirror into GA4 via Measurement Protocol or `/booked` page | scout_token, scheduled_for | **Yes** |

Notes:
- GA4 enhanced-measurement scroll fires only at 90% — build the 25/50/75/100 milestones as a **custom** scroll trigger, don't rely on enhanced measurement.
- Register `variant_id`, `campaign`, `vertical`, `market`, `revenue_band`, `prospect_domain`, `section_name` as **custom dimensions** (event-scoped) in the Scout property so they're reportable.

---

## 6. GTM trigger specs

- **History Change trigger** (SPA): fire `scout_view` tag on history change where Page Path matches `^/share/scout/`.
- **Custom scroll**: vertical scroll depths 25/50/75/100, scoped to `^/share/scout/`.
- **Element Visibility** triggers (one per tracked section): selection method = CSS/ID, min on-screen 50%, min duration 1000ms, "once per page." Add stable `id`/`data-track` attributes to the four sections in the app.
- **Click triggers**: Just Links / All Elements as appropriate, matched on the CTA selector, `mailto:`, `tel:`, and outbound host `forgegrowth.ai`.
- Scope **every** trigger to the Scout path prefixes so authenticated routes never fire.

---

## 7. Server-side dual-write & booking webhook (Supabase)

**Dual-write (engagement enrichment):** add a GTM Custom HTML / Google Tag "server" tag (or a small fetch in the app) that POSTs fitness-critical events to a Supabase Edge Function, keyed by token, so the fitness table doesn't depend on GA collection:

```json
POST /functions/v1/scout-engagement
{
  "scout_token": "a48184e6-...",
  "event": "scroll_75" | "section_view" | "engaged_90s" | "cta_click",
  "variant_id": "v_hvac_datalead_03",
  "section_name": "revenue_tile",         // when applicable
  "occurred_at": "2026-07-21T16:04:11Z"
}
```

**Booking completion (the off-domain hop):** the scheduler (Cal.com / Calendly) is a different registrable domain — do not stitch GA sessions across it.
1. Pass the token into the scheduler as a prefill/hidden field or metadata when redirecting from `/book/scout/:token`.
2. Configure the scheduler's booking webhook → Supabase Edge Function:

```json
POST /functions/v1/scout-booked
{
  "scout_token": "a48184e6-...",
  "variant_id": "v_hvac_datalead_03",
  "scheduled_for": "2026-07-24T17:00:00Z",
  "invitee_email": "...",
  "source": "calendly"
}
```

3. Optionally mirror `booking_completed` into the GA4 Scout property via the Measurement Protocol (using the stored `client_id` if captured) **or** redirect post-booking to `forgegrowth.ai/booked?token=` and fire the key event there. The webhook is the source of truth regardless.

---

## 8. Funnel → fitness-function mapping

| Stage | Event | Primary source | Signal density | Suggested fitness weight |
|-------|-------|----------------|----------------|--------------------------|
| Delivered | (Gmail send) | pipeline | n/a | — |
| Opened | *(not tracked — MPP noise)* | — | — | 0 |
| Clicked → arrived | `scout_view` | **Supabase** (mirror GA4) | high | low-moderate |
| Engaged | scroll 50/75, section_view, engaged_90s | **Supabase** + GA4 | moderate | **highest early-signal weight** |
| Intent | `scout_cta_click`, `book_redirect` | Supabase + GA4 | low | high |
| Booked | `booking_completed` | **Supabase webhook** | very low | terminal validator |
| Closed | manual / CRM | operator | very low | terminal validator |

Weight the *fast-accumulating* mid-funnel engagement signals for early variant selection (they produce enough events at ~3 sends/day to select on within weeks), and fold intent/booked in as slow terminal validators as volume accrues. Reply/booked alone are too sparse to breed on at current volume.

---

## 9. Implementation checklist (by owner)

**Outreach generator (`generate-outreach-email.ts`)**
- [ ] Append `utm_source/medium/campaign/content/term` to the share URL; `utm_content = variant_id`.
- [ ] Persist `variant_id` on the outreach record so replies/bookings can be attributed.

**App (Claude Code)**
- [ ] Read share-link params on `/share/scout/:token` load; push `scout_view` dataLayer event with full context.
- [ ] Add stable `id`/`data-track` attributes to the revenue tile, gap table, positioning block, CTA.
- [ ] Push `scout_cta_click` and `book_redirect` events.
- [ ] Fire the Supabase dual-write POSTs (§7) for scroll_75, section_view, engaged_90s, cta_click.
- [ ] Pass `token` (+ variant_id) into the scheduler prefill on `/book/scout/:token`.

**GTM (dedicated Scout property container)**
- [ ] History Change, custom scroll, Element Visibility, and click triggers, all scoped to `^/share/scout/` / `^/book/scout/`.
- [ ] Tags per §5 event catalog; dataLayer variables for all context params.

**GA4 admin (Scout property)**
- [ ] Create dedicated property; add both subdomains to "configure your domains."
- [ ] Register custom dimensions (variant_id, campaign, vertical, market, revenue_band, prospect_domain, section_name).
- [ ] Mark `scout_cta_click`, `book_redirect`, `booking_completed` as key events.

**Supabase**
- [ ] `scout-engagement` Edge Function + table (token-keyed).
- [ ] `scout-booked` Edge Function + scheduler webhook wired.

---

## 10. Anti-patterns (do not do)

- ❌ Email open-pixels (spam risk, MPP noise, brand-inconsistent).
- ❌ GA4 as the outreach ledger (ad-blocker/corporate-network undercount).
- ❌ GA cross-domain linker to the scheduler (use the webhook).
- ❌ Cross-domain config between forgegrowth.ai ↔ app.forgegrowth.ai (unnecessary — same registrable domain).
- ❌ Firing Scout tags on authenticated routes (pollutes the prospect dataset).
- ❌ Sending outreach whose share link lacks `variant_id` (unmeasurable — breaks the fitness function).
