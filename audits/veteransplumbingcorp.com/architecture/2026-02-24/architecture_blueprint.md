# Architecture Blueprint — Veterans Plumbing Corp
**Domain:** veteransplumbingcorp.com
**Date:** 2026-02-24
**Architect:** Michael, Forge Growth
**CMS:** Duda (confirmed via `d-cache` / `d-geo` response headers and `static.cdn-website.com` speculation-rules CDN)
**Data sources:**
- Dwight crawl: `internal_all.csv` — 14 pages indexed
- Dwight semantic report: `semantically_similar_report.csv` — 6 flagged pairs
- Jim research: `research_summary.md` — 101 ranked keywords, $430 ETV

---

## Executive Summary

The site has 14 crawled pages and ranks for 101 keywords at an average position of 52.2. All three top-10 rankings are branded. The homepage carries 55 of 101 keyword rankings — a structural overload that signals a lack of purpose-built service pages. Every commercial and transactional keyword above 100 searches/month is either unranked or sitting on page 3+.

The semantic data reveals a site-wide blending problem: nearly every page scores 0.93–0.97 similarity against another page, meaning Google cannot clearly differentiate what each page is "about." The architecture must solve two problems simultaneously — **canonical identity** (each page owns a distinct topic) and **depth distribution** (high-value transactional pages must live at depth 1–2).

Three gaps are unambiguous:
1. No dedicated "Plumber in Boise" commercial pillar page exists. The homepage is absorbing all 1,900/mo plumber-Boise queries with a diluted, multi-topic page.
2. No standalone "Water Heater Repair Boise" transactional page exists. A blog post is inadvertently ranking for 4,890/mo in water-pressure queries it was never designed to convert.
3. No service-area landing pages exist for Meridian (1,600/mo commercial) or Eagle with proper plumbing + water heater service scope.

The Duda CMS supports flat URL structures natively. No subfolder nesting or subdomain migration is required. All new pages should be created as top-level slugs (e.g., `/plumber-boise`, `/water-heater-repair-boise`).

---

## Part 1: Topic Cluster Map

The 14 crawled pages, plus the 2 confirmed-ranking blog pages not yet in the crawl (`/common-causes-of-low-water-pressure-and-how-to-fix-them` and `/the-role-of-drainage-systems-in-residential-plumbing`), are organized into five silos. The silo structure also defines the 8 net-new pages needed to close Jim's identified gaps.

### Silo 1: Core Plumbing Services (Boise)

This is the highest-priority silo. The homepage is currently the de facto "plumber boise" page — that must change. A dedicated commercial pillar at depth 1 is required to absorb the full plumber-Boise keyword cluster.

| Status | Page | URL | Depth | Words | Role |
|--------|------|-----|-------|-------|------|
| EXISTS | Homepage | `/` | 0 | 2,128 | Brand hub / navigational landing |
| EXISTS | Residential Plumbing Services | `/Residential-Plumbing-Services` | 1 | 750 | Service overview cluster |
| EXISTS | About Us | `/about-us` | 1 | 417 | Trust / E-E-A-T support |
| EXISTS | Contact Us | `/contact-us` | 1 | 333 | Conversion page |
| EXISTS | Sitemap | `/sitemap` | 1 | 144 | Utility (no SEO value) |
| EXISTS | Thank You | `/thank-you` | 2 | 90 | Post-conversion (exclude from index) |
| EXISTS | Privacy Policy | `/privacy-policy` | 2 | 1,696 | Legal utility |
| **NEW** | Plumber in Boise — Pillar | `/plumber-boise` | 1 | 1,500+ | Commercial pillar for "boise plumber" cluster |
| **NEW** | Water Heater Repair Boise | `/water-heater-repair-boise` | 1 | 1,200+ | Transactional page for repair queries |
| **NEW** | Drain Cleaning & Drainage Services | `/drain-cleaning-boise` | 1 | 1,000+ | Supports drainage blog content + service CTA |

**Depth note:** `/Residential-Plumbing-Services` should be retained but repositioned as a cluster support page beneath `/plumber-boise` via internal linking — not via URL restructure (Duda does not require subfolder hierarchies). A contextual internal link from `/plumber-boise` → `/Residential-Plumbing-Services` is sufficient.

---

### Silo 2: Water Heaters

Two pages already exist in this silo (`/Water-Heater-Replacement` and `/Tankless-Water-Heater`). Both are content-rich (1,895 and 1,333 words respectively) and at depth 1. The problem is semantic overlap (0.945 similarity score — cannibalization risk range). These pages need differentiated intent, not consolidation.

| Status | Page | URL | Depth | Words | Role |
|--------|------|-----|-------|-------|------|
| EXISTS | Water Heater Replacement | `/Water-Heater-Replacement` | 1 | 1,895 | Transactional — installation/replacement |
| EXISTS | Tankless Water Heater | `/Tankless-Water-Heater` | 1 | 1,333 | Transactional — tankless product/install |
| EXISTS | Hot Water Heater Meridian | `/hot-water-heater-meridian` | 1 | 1,172 | Location-service hybrid (water heater + Meridian) |
| **NEW** | Water Heater Repair Boise | `/water-heater-repair-boise` | 1 | 1,200+ | Transactional — repair (distinct from replacement) |

**Note:** `/Water-Heater-Replacement` targets installation/replacement. `/water-heater-repair-boise` (new) targets the repair/fix intent — these are distinct enough in intent to coexist without cannibalization, provided H1s, meta titles, and body copy are clearly differentiated. See cannibalization resolution plan below.

---

### Silo 3: Water Softeners

The strongest existing cluster. Four pages exist, all at depth 1, covering Boise, Kuna, Nampa, and Eagle. A pillar page (`/Water-Softener-System`) exists but is competing directly with the homepage (0.956 similarity — the highest pair in the dataset). This silo needs a clear hub-and-spoke architecture and one additional location page.

| Status | Page | URL | Depth | Words | Role |
|--------|------|-----|-------|-------|------|
| EXISTS | Water Softener Systems — Pillar | `/Water-Softener-System` | 1 | 1,973 | Commercial pillar for Boise water softener |
| EXISTS | Water Softeners Kuna | `/water-softeners-Kuna-id` | 1 | 612 | Location cluster — Kuna |
| EXISTS | Water Softeners Nampa | `/water-softeners-nampa-idaho` | 1 | 663 | Location cluster — Nampa |
| EXISTS | Water Softener Eagle | `/water-softener-eagle-idaho` | 1 | 692 | Location cluster — Eagle |
| **NEW** | Water Softener Meridian | `/water-softener-meridian-idaho` | 1 | 700+ | Location cluster — Meridian (gap vs. competitor coverage) |

**Cluster note:** The three existing location pages (Kuna, Nampa, Eagle) are all 612–692 words. Jim's research confirms the water softener cluster has topical authority signals. Internal links from each location page → `/Water-Softener-System` pillar will consolidate authority.

---

### Silo 4: Service Area Pages (Plumbing + Water Heaters)

Jim's research identifies Meridian (1,600/mo) and Nampa (720/mo) as underserved location targets. Currently, `/hot-water-heater-meridian` is a hybrid page that tries to cover Meridian plumbing and water heaters together. Meridian needs a full-service location pillar, not just a water heater page.

| Status | Page | URL | Depth | Words | Role |
|--------|------|-----|-------|-------|------|
| EXISTS | Hot Water Heater Meridian | `/hot-water-heater-meridian` | 1 | 1,172 | Retain as water heater service for Meridian only |
| **NEW** | Plumber in Meridian — Pillar | `/plumber-meridian-idaho` | 1 | 1,200+ | Commercial pillar for "plumbing meridian idaho" (1,600/mo) |
| **NEW** | Plumber in Nampa | `/plumber-nampa-idaho` | 1 | 1,000+ | Commercial page for Nampa service area (720/mo) |

**Depth note:** Both new pages at depth 1. Internal link from `/plumber-boise` (main pillar) to each location page is required to distribute authority and signal service area scope.

---

### Silo 5: Informational / Blog

Two blog posts are confirmed ranking in Jim's data but not yet in Dwight's crawl (either excluded from internal:all or recently published). These should be retained and improved, not merged into service pages.

| Status | Page | URL | Estimated Words | Role |
|--------|------|-----|----------------|------|
| EXISTS (not in crawl) | Low Water Pressure Blog | `/common-causes-of-low-water-pressure-and-how-to-fix-them` | Unknown | Informational — 4,890/mo keyword volume at pos 59–77 |
| EXISTS (not in crawl) | Drainage Systems Blog | `/the-role-of-drainage-systems-in-residential-plumbing` | Unknown | Informational — 180/mo at pos 12–20 |

**Action:** Both posts need internal links TO the new `/water-heater-repair-boise` (from the water pressure post) and `/drain-cleaning-boise` (from the drainage post) service pages. These posts capture informational traffic; the service pages convert it.

---

## Part 2: Cannibalization Resolution Plan

All six pairs from Dwight's semantically similar report are analyzed below using the defined thresholds.

---

### Pair 1: Homepage vs. Water Softener System
**Score: 0.956 — Near-duplicate threshold (> 0.95) → CONSOLIDATE / DIFFERENTIATE**

| Property | Homepage `/` | Water Softener System `/Water-Softener-System` |
|----------|-------------|----------------------------------------------|
| Crawl Depth | 0 | 1 |
| Word Count | 2,128 | 1,973 |
| Inlinks | 64 | 56 |
| Current H1 | "Plumbing & Water Softener Services in Boise" | "Veterans Plumbing Offers the Water Softener Boise People Trust" |
| Current Title | "Plumbing Services in Boise | Plumber Boise Idaho | Veterans Plumbing" | "Water Softener Systems Boise Idaho | Veterans Plumbing" |

**Root cause:** The homepage H1 explicitly names water softeners as a co-equal service to plumbing. This causes Google to treat the homepage as a water softener page, triggering near-duplicate scoring against `/Water-Softener-System`.

**Resolution:**
1. Rewrite the homepage H1 to focus exclusively on the brand and general plumbing (e.g., "Boise's Trusted Plumbing Company — Veterans Plumbing Corp"). Remove water softener as an H1-level topic.
2. On the homepage, replace detailed water softener body copy with a short 2–3 sentence teaser + a prominent CTA link to `/Water-Softener-System`. This creates a hub-to-spoke link without duplicating content.
3. `/Water-Softener-System` retains all water softener detail and becomes the sole target for "water softener boise" and related queries.
4. The homepage should target: "plumbing boise" / "plumbers boise" / "boise plumbing company" — navigational + branded intent.
5. The new `/plumber-boise` pillar (Silo 1) will absorb commercial "hire a plumber" intent from the homepage, further reducing the homepage's topical dilution.

---

### Pair 2: Contact Us vs. About Us
**Score: 0.966 — Near-duplicate threshold (> 0.95) → DIFFERENTIATE (do not consolidate)**

| Property | Contact Us `/contact-us` | About Us `/about-us` |
|----------|--------------------------|----------------------|
| Word Count | 333 | 417 |
| Inlinks | 60 | 49 |
| H1 | "Contact Veterans Plumbing Today!" | "Veterans Plumbing A Top Plumbing Provider" |
| Meta Description | "Contact our water softeners Boise experts..." | "We take pride on having the best Boise water softener..." |

**Root cause:** Both pages are thin (333 and 417 words), and both meta descriptions lead with "water softeners Boise" — the same keyword phrase. The semantic embedding engine is reading these as near-identical because neither page has a strongly differentiated semantic identity beyond the brand boilerplate they share.

**Resolution:** These pages should NOT be consolidated. Contact and About serve different user intents and should remain separate.
1. **About Us:** Rewrite to lead with the company's service history, veteran-owned identity, years in business, service area, and team credentials. Target: "veteran owned plumbing boise" / E-E-A-T signals. Remove "water softeners Boise" from meta description entirely. Target word count: 600–800 words.
2. **Contact Us:** Strip all service description copy. The page should contain only: contact form, phone number, address, hours, and a brief "Ready to schedule?" intro sentence. Add LocalBusiness schema with `contactPoint`. Target word count: 150–200 words (intentionally lean — this is a utility page, not a ranking page).
3. Add a canonical tag on `/contact-us` pointing to itself to signal it is authoritative for its own URL.

---

### Pair 3: Hot Water Heater Meridian vs. Water Softeners Kuna
**Score: 0.950 — Near-duplicate threshold (> 0.95) → DIFFERENTIATE**

| Property | Hot Water Heater Meridian `/hot-water-heater-meridian` | Water Softeners Kuna `/water-softeners-Kuna-id` |
|----------|-------------------------------------------------------|------------------------------------------------|
| Word Count | 1,172 | 612 |
| Inlinks | 36 | 35 |
| H1 | "High-Quality Water Heaters in Meridian" | "Water Softener Systems & Service in Kuna" |

**Root cause:** Both pages are location service pages with similar structural templates — intro paragraph, service list, call to action, contact block. The boilerplate copy surrounding each service's unique content is semantically dominating the pages, making them appear near-identical.

**Resolution:** These pages should NOT be consolidated — they serve different services and different cities.
1. **`/hot-water-heater-meridian`:** Increase differentiation by adding Meridian-specific content: local hard water data, why Meridian homes need water heater servicing, local customer testimonials or references. Target: "water heater meridian idaho" + "hot water heater meridian id". Target word count: 1,200+ (already at 1,172 — minimal expansion needed, focus on differentiation).
2. **`/water-softeners-Kuna-id`:** Expand from 612 words to 900+. Add Kuna-specific content: local water quality data, why Kuna homeowners need softeners (hard water data from City of Kuna), FAQs specific to Kuna. Target: "water softener kuna idaho" + "kuna id water softener".
3. Reduce shared boilerplate copy. Each page should have a unique intro, unique local data point, and unique customer-facing FAQ section. The footer CTA block can remain templated.

---

### Pair 4: Water Softener System vs. Homepage
**Score: 0.956 — (Same pair as Pair 1, mirrored direction)**

This is the reciprocal entry of Pair 1 in Dwight's report. Resolution is identical to Pair 1 above — differentiate the homepage H1 and body copy away from water softeners. No additional action beyond Pair 1 resolution.

---

### Pair 5: About Us vs. Contact Us
**Score: 0.966 — (Same pair as Pair 2, mirrored direction)**

Reciprocal entry of Pair 2. Resolution is identical to Pair 2 above.

---

### Pair 6: Water Softeners Kuna vs. Hot Water Heater Meridian
**Score: 0.950 — (Same pair as Pair 3, mirrored direction)**

Reciprocal entry of Pair 3. Resolution is identical to Pair 3 above.

---

### Additional Semantic Risk: Water Heater Replacement vs. Tankless Water Heater
**Score: 0.945 (from internal_all.csv) — Cannibalization risk range (0.80–0.95) → DIFFERENTIATE INTENT**

These two pages were not flagged in the semantically_similar_report.csv (threshold was set to > 0.95 in Dwight's export). However, at 0.945 they are in the high-overlap zone and require proactive differentiation before they cross the threshold as the site grows.

| Property | Water Heater Replacement `/Water-Heater-Replacement` | Tankless Water Heater `/Tankless-Water-Heater` |
|----------|------------------------------------------------------|------------------------------------------------|
| Word Count | 1,895 | 1,333 |
| Inlinks | 58 | 54 |
| H1 | "Reliable Boise Water Heater Installation" | "The Best Boise Tankless Water Heater Installation Resident Can Buy" |

**Resolution:**
1. `/Water-Heater-Replacement` should own the "traditional tank water heater" replacement intent. Remove any duplicate tankless content. Introduce a comparison section: "Tank vs. Tankless — Which is right for your home?" with a CTA link → `/Tankless-Water-Heater`. This differentiates intent while building internal link equity.
2. `/Tankless-Water-Heater` should own the "tankless" product intent exclusively. Lead with tankless benefits, brands carried, installation process, and energy savings data. Remove generic "water heater" copy that overlaps with `/Water-Heater-Replacement`.

---

### Outlier Assessment: Privacy Policy
**Score: 0.837 (closest match: about-us) — Outlier range (0.80–0.95)**

The privacy policy is not an SEO page. At 0.837 it is not creating meaningful cannibalization risk. No action required beyond ensuring it is deindexed via a `noindex` meta robots tag or excluded from the sitemap. Currently it is marked indexable in the crawl — this should be corrected.

**Action:** Add `<meta name="robots" content="noindex, follow">` to `/privacy-policy`.

---

### Outlier Assessment: Sitemap and Thank You Pages
**Sitemap `/sitemap`:** Score 0.934, 144 words. This is a utility page with no ranking value.
**Action:** Add `noindex` tag. Remove from XML sitemap.

**Thank You `/thank-you`:** Score 0.934, 90 words, Depth 2. Post-conversion page only.
**Action:** Already at depth 2 with only 5 inlinks. Add `noindex` tag. Verify it fires a conversion event via Google Tag Manager before adding noindex.

---

## Part 3: Page Title and Metadata Blueprint

This section defines the primary keyword, value proposition, and intent for every page. Pam writes the final meta titles and descriptions using the Fact-Feel-Proof structure from these specifications.

**Duda note:** Duda sets meta titles and descriptions per-page in the Site Settings > SEO panel. No plugin required. Character limits apply: titles 50–60 characters, descriptions 140–160 characters.

---

### Homepage — `/`

| Field | Value |
|-------|-------|
| Primary keyword | `boise plumbing` (1,900/mo, pos 37 — improve to top 5) |
| Supporting keywords | `boise plumbers`, `plumbing boise`, `veterans plumbing` |
| Value prop | Veterans Plumbing Corp is Boise's veteran-owned plumbing company serving residential customers across the Treasure Valley — the brand hub that orientates visitors to the right service page |
| Intent | Navigational |
| Schema logic | LocalBusiness schema with aggregate rating, service area, opening hours |
| Pam directive — Fact | Veteran-owned plumbing company serving Boise, Meridian, Nampa, Kuna, and Eagle. Licensed, insured. Water heaters, water softeners, residential plumbing. |
| Pam directive — Feel | Trusted by Boise homeowners who want the job done right the first time |
| Pam directive — Proof | [Insert year founded], [insert review count] 5-star reviews on Google |

---

### NEW: Plumber in Boise — `/plumber-boise`

| Field | Value |
|-------|-------|
| Primary keyword | `plumbers in boise` (1,900/mo, pos 22 — move to top 5) |
| Supporting keywords | `boise idaho plumbers` (1,900/mo), `boise id plumber` (1,900/mo), `plumbing boise idaho`, `best plumbers in boise` |
| Value prop | The main commercial landing page for the entire Boise plumber keyword cluster — designed to rank for all "boise plumber" variants and convert searchers ready to hire |
| Intent | Commercial |
| Schema logic | Service schema (type: Plumber), LocalBusiness, FAQ schema (for "how much does a plumber cost in Boise" type queries), AggregateRating |
| Pam directive — Fact | Licensed plumbers in Boise, Idaho. Residential plumbing repairs, installations, and emergency service. Serving the full Treasure Valley. |
| Pam directive — Feel | When something breaks, you need a plumber who shows up on time and fixes it right |
| Pam directive — Proof | [Review count] Google reviews, licensed and insured, veteran-owned |
| Content requirements | 1,500+ words. Must include: service list, service area section with named cities, FAQ block (min 5 questions), customer testimonials section, schema-ready review mentions |

---

### Residential Plumbing Services — `/Residential-Plumbing-Services`

| Field | Value |
|-------|-------|
| Primary keyword | `residential plumbing services boise` |
| Supporting keywords | `plumbing services boise`, `home plumbing repair boise` |
| Value prop | Service overview page that details all residential plumbing work offered — supports the `/plumber-boise` pillar by capturing longer-tail "plumbing services" queries |
| Intent | Commercial |
| Schema logic | Service schema (type: PlumbingService) |
| Pam directive — Fact | Full-service residential plumbing in Boise, Idaho. Repairs, remodels, new construction rough-in, fixture installation, leak detection. |
| Pam directive — Feel | One company for every plumbing need in your home — no subcontracting |
| Pam directive — Proof | Licensed master plumber, [years] years serving Boise homeowners |
| Content note | Expand from 750 to 1,200+ words. Add individual service sections with descriptions. Each service should link to a dedicated page where one exists. |

---

### Water Heater Replacement — `/Water-Heater-Replacement`

| Field | Value |
|-------|-------|
| Primary keyword | `water heater replacement boise` |
| Supporting keywords | `water heater installation boise idaho`, `boise water heater`, `replace water heater boise` |
| Value prop | The dedicated transactional page for customers whose water heater has failed and need a replacement installed — focuses on tank-style units, brands, and installation process |
| Intent | Transactional |
| Schema logic | Service schema, FAQ schema ("how long does water heater replacement take", "how much does it cost") |
| Pam directive — Fact | Water heater replacement and installation in Boise, Idaho. Tank water heaters. Same-day and next-day availability. |
| Pam directive — Feel | A cold shower is an emergency — we move fast on water heater replacements |
| Pam directive — Proof | [Insert number] water heaters installed in Boise. Licensed and insured. |
| Content note | 1,895 words already — revise, not expand. Remove tankless overlap. Add tank vs. tankless comparison with link to `/Tankless-Water-Heater`. |

---

### Tankless Water Heater — `/Tankless-Water-Heater`

| Field | Value |
|-------|-------|
| Primary keyword | `tankless water heater installation boise` |
| Supporting keywords | `tankless water heater boise idaho`, `boise tankless water heater`, `on demand water heater boise` |
| Value prop | The dedicated product and installation page for customers actively considering a tankless upgrade — focuses on energy savings, brands, and installation specifics |
| Intent | Transactional |
| Schema logic | Service schema, Product schema (if specific brands/models are listed), FAQ schema |
| Pam directive — Fact | Tankless water heater installation in Boise, Idaho. Energy-efficient on-demand hot water. Brands: [insert brands carried]. |
| Pam directive — Feel | Endless hot water and lower energy bills — the upgrade Boise homeowners are making |
| Pam directive — Proof | [Number] tankless installs completed, manufacturer-certified installation |
| Content note | Remove generic "water heater" copy. Lead with tankless-specific content. Add energy savings comparison chart. |

---

### NEW: Water Heater Repair Boise — `/water-heater-repair-boise`

| Field | Value |
|-------|-------|
| Primary keyword | `water heater repair boise idaho` (90/mo, pos 19 — move to top 3) |
| Supporting keywords | `water heater low pressure` (2,400/mo, pos 59), `low water pressure hot water heater` (2,400/mo, pos 77), `boise heater repair` (170/mo, pos 76) |
| Value prop | The dedicated repair/diagnostic page that converts the informational water-pressure traffic from Jim's blog post into repair service leads — occupies the "fix it" intent slot that currently has no page |
| Intent | Transactional |
| Schema logic | Service schema, FAQ schema ("why is my hot water pressure low", "how much does water heater repair cost in Boise") |
| Pam directive — Fact | Water heater repair service in Boise, Idaho. Diagnose and fix low hot water pressure, leaks, pilot light issues, thermostat failures, and sediment buildup. |
| Pam directive — Feel | Don't replace it until you know it can't be fixed — our techs diagnose first |
| Pam directive — Proof | Licensed plumbers, [years] years repairing water heaters in Boise |
| Content note | 1,200+ words. Include: diagnostic guide section (pulls from blog post themes), repair vs. replace decision guide, FAQ block targeting water pressure keywords. Add internal link from `/common-causes-of-low-water-pressure-and-how-to-fix-them` blog post. |

---

### Hot Water Heater Meridian — `/hot-water-heater-meridian`

| Field | Value |
|-------|-------|
| Primary keyword | `water heater meridian idaho` |
| Supporting keywords | `hot water heater meridian id`, `meridian idaho plumbing water heater` |
| Value prop | The Meridian-specific water heater service page covering installation and repair for Meridian, Idaho customers — distinct from the Boise water heater pages by location context |
| Intent | Commercial |
| Schema logic | Service schema with Meridian serviceArea, LocalBusiness |
| Pam directive — Fact | Water heater installation, repair, and replacement in Meridian, Idaho. Tank and tankless. Same-day availability. |
| Pam directive — Feel | Meridian homeowners trust Veterans Plumbing for fast, local water heater service |
| Pam directive — Proof | Serving Meridian for [X] years, [review count] reviews |
| Content note | At 1,172 words this page is adequately sized. Add Meridian-specific data (hard water stats, local permits process) to differentiate from Kuna page (same-template cannibalization risk). |

---

### Water Softener Systems — `/Water-Softener-System`

| Field | Value |
|-------|-------|
| Primary keyword | `water softener boise` (140/mo, pos 13 — move to top 3) |
| Supporting keywords | `water softeners boise idaho` (140/mo), `water softener installation boise`, `best water softener boise` |
| Value prop | The Boise-area water softener pillar page that serves as the hub for the entire water softener cluster — installation, brands, sizing, and service for Boise homeowners |
| Intent | Commercial |
| Schema logic | Service schema, FAQ schema ("do I need a water softener in Boise", "how much does water softener installation cost") |
| Pam directive — Fact | Water softener installation and service in Boise, Idaho. Whole-home systems, salt-free options, water quality testing. |
| Pam directive — Feel | Boise's hard water is hard on your pipes and appliances — a water softener is the fix |
| Pam directive — Proof | [Number] water softener systems installed, [certifications if any], [review count] |
| Content note | At 1,973 words this is the strongest content piece on the site. Revise H1 and first 200 words to remove any language that mirrors the homepage. Add links to all location pages (Kuna, Nampa, Eagle, Meridian). |

---

### Water Softeners Kuna — `/water-softeners-Kuna-id`

| Field | Value |
|-------|-------|
| Primary keyword | `water softener kuna idaho` |
| Supporting keywords | `kuna id water softener`, `kuna idaho water softener service` |
| Value prop | Location-specific water softener service page for Kuna, Idaho customers — supports the Boise pillar with unique local content and internal link equity |
| Intent | Commercial |
| Schema logic | Service schema with Kuna serviceArea |
| Pam directive — Fact | Water softener installation and service in Kuna, Idaho. Residential systems, salt delivery, maintenance contracts. |
| Pam directive — Feel | Kuna homeowners know hard water — Veterans Plumbing knows how to fix it |
| Pam directive — Proof | Serving Kuna customers, [review references if available] |
| Content note | Expand from 612 to 900+ words. Add Kuna-specific hard water data (City of Kuna water quality report data), local testimonial references, FAQ section. |

---

### Water Softeners Nampa — `/water-softeners-nampa-idaho`

| Field | Value |
|-------|-------|
| Primary keyword | `water softener nampa idaho` |
| Supporting keywords | `nampa idaho water softener`, `water softener service nampa` |
| Value prop | Location-specific water softener page for Nampa customers — capitalizes on Jim's identified "nampa idaho water" keyword cluster (720/mo at pos 64) |
| Intent | Commercial |
| Schema logic | Service schema with Nampa serviceArea |
| Pam directive — Fact | Water softener installation and service in Nampa, Idaho. Whole-home hard water treatment, filter systems, maintenance. |
| Pam directive — Feel | Nampa's water is notoriously hard — protect your appliances and pipes with a professional system |
| Pam directive — Proof | Licensed plumbers serving Nampa, [review references] |
| Content note | Expand from 663 to 900+ words. Nampa water quality data adds unique differentiation. Link back to `/Water-Softener-System` pillar. |

---

### Water Softener Eagle — `/water-softener-eagle-idaho`

| Field | Value |
|-------|-------|
| Primary keyword | `water softener eagle idaho` |
| Supporting keywords | `eagle idaho water softener`, `water softener service eagle id` |
| Value prop | Location-specific water softener page for Eagle, Idaho customers — extends the cluster into the growing Eagle market |
| Intent | Commercial |
| Schema logic | Service schema with Eagle serviceArea |
| Pam directive — Fact | Water softener installation and service in Eagle, Idaho. Residential hard water treatment systems, installation, and service. |
| Pam directive — Feel | Eagle's rapid growth means more homeowners discovering hard water problems for the first time |
| Pam directive — Proof | Serving the Eagle area, licensed and insured |
| Content note | Expand from 692 to 900+ words. Eagle-specific content: recent municipal water quality data, typical system sizing for Eagle home sizes. |

---

### NEW: Water Softener Meridian — `/water-softener-meridian-idaho`

| Field | Value |
|-------|-------|
| Primary keyword | `water softener meridian idaho` |
| Supporting keywords | `meridian idaho water softener`, `water softener service meridian` |
| Value prop | Fills the Meridian gap in the water softener cluster — Meridian is one of Idaho's fastest-growing cities and a high-potential service area |
| Intent | Commercial |
| Schema logic | Service schema with Meridian serviceArea |
| Pam directive — Fact | Water softener installation and service in Meridian, Idaho. Hard water treatment systems for homes and new construction. |
| Pam directive — Feel | Meridian is growing fast — make sure your new home starts with soft water |
| Pam directive — Proof | Serving Meridian alongside our Boise and Eagle customers, licensed and insured |
| Content note | 700+ words at launch. Meridian-specific water quality data. Link to `/Water-Softener-System` and `/plumber-meridian-idaho`. |

---

### NEW: Plumber in Meridian — `/plumber-meridian-idaho`

| Field | Value |
|-------|-------|
| Primary keyword | `plumbing meridian idaho` (1,600/mo, pos 46 — move to page 1) |
| Supporting keywords | `plumbers in meridian` (1,600/mo, pos 120), `meridian idaho plumber`, `meridian plumbing company` |
| Value prop | The highest-opportunity new page in the blueprint — a dedicated Meridian plumbing commercial pillar that targets 1,600/mo in commercial searches currently at position 120 (not even indexed correctly) |
| Intent | Commercial |
| Schema logic | Service schema (Plumber type), LocalBusiness with Meridian serviceArea, FAQ schema |
| Pam directive — Fact | Licensed plumbers serving Meridian, Idaho. Residential plumbing repairs, water heaters, water softeners, drain service. Same-day availability. |
| Pam directive — Feel | Meridian homeowners deserve the same fast, reliable service we deliver in Boise |
| Pam directive — Proof | [Reviews], veteran-owned, licensed and insured, serving the Treasure Valley |
| Content note | 1,200+ words. Include Meridian-specific content: growth statistics, local permit notes, service list, FAQ. Cross-link to `/hot-water-heater-meridian` and `/water-softener-meridian-idaho`. |

---

### NEW: Plumber in Nampa — `/plumber-nampa-idaho`

| Field | Value |
|-------|-------|
| Primary keyword | `plumber nampa idaho` |
| Supporting keywords | `nampa idaho plumber`, `plumbing company nampa id`, `nampa plumbing services` |
| Value prop | Service area page capturing Nampa plumbing demand — supports the "nampa idaho water" keyword cluster Jim identified at 720/mo and creates a linkable location page for the water softener Nampa page |
| Intent | Commercial |
| Schema logic | Service schema, LocalBusiness with Nampa serviceArea |
| Pam directive — Fact | Licensed plumbers in Nampa, Idaho. Residential plumbing, water heaters, water softeners, drain cleaning. Serving Nampa and Canyon County. |
| Pam directive — Feel | Fast, professional plumbing from a local team that already serves your neighbors |
| Pam directive — Proof | Veteran-owned, [review count] reviews, licensed and insured |
| Content note | 1,000+ words. Cross-link to `/water-softeners-nampa-idaho`. Internal link from `/plumber-boise` service area section. |

---

### NEW: Drain Cleaning Boise — `/drain-cleaning-boise`

| Field | Value |
|-------|-------|
| Primary keyword | `drain cleaning boise idaho` |
| Supporting keywords | `boise drain cleaning`, `drain cleaning service boise`, `clogged drain boise` |
| Value prop | Captures drain service queries that currently have no dedicated page — provides the service CTA target for traffic arriving via the drainage blog post |
| Intent | Transactional |
| Schema logic | Service schema (DrainCleaning type), FAQ schema |
| Pam directive — Fact | Professional drain cleaning service in Boise, Idaho. Clogged drains, sewer line cleaning, hydro-jetting, camera inspection. |
| Pam directive — Feel | Don't wait for a backup to become a flood — fast drain service from a licensed plumber |
| Pam directive — Proof | Licensed plumbers, [years] years clearing Boise drains |
| Content note | 1,000+ words. Include types of drain problems, process description, FAQ. Internal link from `/the-role-of-drainage-systems-in-residential-plumbing` blog post. |

---

### About Us — `/about-us`

| Field | Value |
|-------|-------|
| Primary keyword | `veteran owned plumbing boise` |
| Supporting keywords | `veterans plumbing corp`, `about veterans plumbing` |
| Value prop | E-E-A-T foundation page — establishes trust through the veteran-owned story, team credentials, years in business, and community ties |
| Intent | Navigational |
| Schema logic | LocalBusiness with founding date, founder (Person schema), sameAs links to GBP and social profiles |
| Pam directive — Fact | Veterans Plumbing Corp is a veteran-owned plumbing company based in Boise, Idaho. Licensed, insured. Founded [year]. Serving the Treasure Valley. |
| Pam directive — Feel | Behind every call is a team that served our country — and now serves your home |
| Pam directive — Proof | [Founder name], [military branch], [years in business], [license number if displayable] |
| Content note | Expand from 417 to 600–800 words. Remove all "water softeners Boise" keyword stuffing from body and meta description. |

---

### Contact Us — `/contact-us`

| Field | Value |
|-------|-------|
| Primary keyword | `veterans plumbing contact` (navigational) |
| Value prop | Pure conversion utility page — contact form, phone, address, hours. No competing SEO content. |
| Intent | Navigational |
| Schema logic | LocalBusiness contactPoint, PostalAddress, OpeningHoursSpecification |
| Pam directive — Fact | Contact Veterans Plumbing Corp. Phone: [number]. Address: [address]. Hours: [hours]. Boise, Idaho. |
| Pam directive — Feel | We're ready to help — reach out and we'll get back to you same day |
| Pam directive — Proof | [Response time SLA if available] |
| Content note | Strip to 150–200 words max. Contact form + details only. Remove duplicate "water softeners Boise" language from title and meta. |

---

### Informational Blog: Low Water Pressure — `/common-causes-of-low-water-pressure-and-how-to-fix-them`

| Field | Value |
|-------|-------|
| Primary keyword | `water heater low pressure` (2,400/mo, pos 59) |
| Supporting keywords | `low water pressure hot water heater` (2,400/mo, pos 77) |
| Value prop | Informational hub that captures top-of-funnel awareness for water heater problems — funnel leads to `/water-heater-repair-boise` for conversion |
| Intent | Informational |
| Schema logic | Article schema, FAQ schema |
| Pam directive — Fact | Guide to diagnosing and fixing low hot water pressure. Covers water heater causes, pipe issues, pressure regulators, sediment buildup. |
| Pam directive — Feel | Low hot water pressure is frustrating — most causes are fixable without a full replacement |
| Pam directive — Proof | Written by Veterans Plumbing's licensed plumbers with [X] years diagnostic experience |
| Content note | This post is currently at pos 59–77 for 4,890/mo in queries. Primary opportunity is on-page optimization and internal linking. Add CTA block mid-article pointing to `/water-heater-repair-boise`. |

---

### Informational Blog: Drainage Systems — `/the-role-of-drainage-systems-in-residential-plumbing`

| Field | Value |
|-------|-------|
| Primary keyword | `drainage system in plumbing` (90/mo, pos 20) |
| Supporting keywords | `purpose of drainage system` (90/mo, pos 12) |
| Value prop | Informational support page targeting drainage-related searches — funnel leads to `/drain-cleaning-boise` and `/Residential-Plumbing-Services` |
| Intent | Informational |
| Schema logic | Article schema |
| Pam directive — Fact | Explains the role of residential drainage systems: drain-waste-vent design, slope requirements, common failure points, maintenance tips. |
| Pam directive — Feel | Understanding your drainage system helps you prevent the expensive backups — know the warning signs |
| Pam directive — Proof | Written by Veterans Plumbing's licensed residential plumbing team |
| Content note | Add internal links to `/drain-cleaning-boise` and `/Residential-Plumbing-Services`. This post already ranks at pos 12 for one term — protect that ranking by preserving the content, only adding CTAs. |

---

### Utility Pages (noindex recommended)

| Page | URL | Action |
|------|-----|--------|
| Privacy Policy | `/privacy-policy` | Add `noindex` meta robots tag. Remove from XML sitemap. |
| Sitemap | `/sitemap` | Add `noindex` meta robots tag. HTML sitemap has no SEO value. |
| Thank You | `/thank-you` | Add `noindex` meta robots tag. Verify conversion event fires before adding. |

---

## Part 4: Architecture Report

### Current State Summary

| Metric | Value |
|--------|-------|
| Total indexed pages | 14 |
| Pages at Depth 0 | 1 (homepage) |
| Pages at Depth 1 | 11 |
| Pages at Depth 2 | 2 (thank-you, privacy-policy) |
| Average word count (service pages) | 1,086 words |
| Thin pages (< 500 words) | 4 (contact-us, sitemap, thank-you, about-us) |
| Near-duplicate pairs (> 0.95) | 3 unique pairs (6 directional entries) |
| Cannibalization risk pairs (0.80–0.95) | 1 (Water-Heater-Replacement vs. Tankless, 0.945) |
| Pages with noindex needed | 3 (privacy-policy, sitemap, thank-you) |

### Target State Summary

| Metric | Target |
|--------|--------|
| Total indexed pages | 19 (14 existing + 8 new - 3 noindexed) |
| All commercial pages at Depth | 1 |
| All transactional pages at Depth | 1 |
| Thin pages resolved | 0 (expand or noindex) |
| Near-duplicate pairs resolved | 3 (differentiated) |
| Topic silos fully linked | 5 (Plumbing, Water Heaters, Water Softeners, Service Areas, Blog) |

### New Pages Required (Priority Order)

| Priority | Page | URL | Keyword Target | Monthly Volume | Rationale |
|----------|------|-----|---------------|----------------|-----------|
| 1 | Plumber in Boise Pillar | `/plumber-boise` | plumbers in boise | 1,900 | Highest volume commercial gap; homepage overload fix |
| 2 | Plumber in Meridian Pillar | `/plumber-meridian-idaho` | plumbing meridian idaho | 1,600 | Currently pos 120; zero dedicated page |
| 3 | Water Heater Repair Boise | `/water-heater-repair-boise` | water heater repair boise idaho | 90 (+ 2,400 from blog funnel) | Striking distance at pos 19; captures blog funnel |
| 4 | Plumber in Nampa | `/plumber-nampa-idaho` | plumber nampa idaho | ~300 est. | Nampa service area gap; supports water softener page |
| 5 | Drain Cleaning Boise | `/drain-cleaning-boise` | drain cleaning boise | ~200 est. | No dedicated drain page; converts blog traffic |
| 6 | Water Softener Meridian | `/water-softener-meridian-idaho` | water softener meridian idaho | ~100 est. | Completes the water softener cluster for all 4 service cities |

### Existing Pages Requiring Content Action (Priority Order)

| Priority | Page | URL | Action | Why |
|----------|------|-----|--------|-----|
| 1 | Homepage | `/` | Rewrite H1 + body to remove water softener co-topic | Near-duplicate (0.956) with `/Water-Softener-System` |
| 2 | About Us | `/about-us` | Expand from 417 to 700 words; remove water softener keyword stuffing | Near-duplicate (0.966) with contact-us; thin content |
| 3 | Contact Us | `/contact-us` | Strip to utility-only; remove water softener copy in title/meta | Near-duplicate (0.966) with about-us |
| 4 | Water Softener System | `/Water-Softener-System` | Revise opening to differentiate from homepage; add cluster links | Near-duplicate (0.956) with homepage |
| 5 | Tankless Water Heater | `/Tankless-Water-Heater` | Remove generic water heater copy; add tank vs. tankless comparison link | Cannibalization risk (0.945) with Water-Heater-Replacement |
| 6 | Water Heater Replacement | `/Water-Heater-Replacement` | Remove tankless overlap; add comparison CTA to Tankless page | Cannibalization risk (0.945) with Tankless |
| 7 | Water Softeners Kuna | `/water-softeners-Kuna-id` | Expand from 612 to 900+ words with Kuna-specific content | Near-duplicate (0.950) with hot-water-heater-meridian; thin |
| 8 | Water Softeners Nampa | `/water-softeners-nampa-idaho` | Expand from 663 to 900+ words with Nampa water data | Thin content |
| 9 | Water Softener Eagle | `/water-softener-eagle-idaho` | Expand from 692 to 900+ words with Eagle-specific content | Thin content |
| 10 | Residential Plumbing Services | `/Residential-Plumbing-Services` | Expand from 750 to 1,200+ words; add internal links to service pages | Thin pillar; should support new `/plumber-boise` |

### Flat URL Architecture (Duda-Compatible)

All pages live at top-level slugs. No subfolder hierarchy required. Duda's native URL structure supports this flat model natively.

```
veteransplumbingcorp.com/
├── plumber-boise                     [NEW — Commercial Pillar]
├── plumber-meridian-idaho            [NEW — Location Pillar]
├── plumber-nampa-idaho               [NEW — Location Page]
├── Residential-Plumbing-Services     [EXISTS — expand]
├── Water-Heater-Replacement          [EXISTS — differentiate]
├── Tankless-Water-Heater             [EXISTS — differentiate]
├── water-heater-repair-boise         [NEW — Transactional]
├── hot-water-heater-meridian         [EXISTS — location water heater]
├── Water-Softener-System             [EXISTS — Pillar, differentiate from homepage]
├── water-softeners-Kuna-id           [EXISTS — expand]
├── water-softeners-nampa-idaho       [EXISTS — expand]
├── water-softener-eagle-idaho        [EXISTS — expand]
├── water-softener-meridian-idaho     [NEW — complete cluster]
├── drain-cleaning-boise              [NEW — Transactional]
├── about-us                          [EXISTS — expand, differentiate]
├── contact-us                        [EXISTS — strip to utility]
├── common-causes-of-low-water-...    [EXISTS blog — add CTAs]
├── the-role-of-drainage-systems-...  [EXISTS blog — add CTAs]
├── privacy-policy                    [EXISTS — noindex]
├── sitemap                           [EXISTS — noindex]
└── thank-you                         [EXISTS — noindex]
```

### Internal Linking Blueprint

The following cross-silo links are required to distribute authority and signal topical relationships to Google:

**From Homepage (`/`):**
- → `/plumber-boise` (primary CTA: "Find a Boise Plumber")
- → `/Water-Softener-System` (teaser block)
- → `/Water-Heater-Replacement` (teaser block)
- → `/about-us`
- → `/contact-us`

**From `/plumber-boise` (new pillar):**
- → `/Residential-Plumbing-Services`
- → `/Water-Heater-Replacement`
- → `/drain-cleaning-boise`
- → `/plumber-meridian-idaho`
- → `/plumber-nampa-idaho`
- → `/contact-us`

**From `/Water-Softener-System` (pillar):**
- → `/water-softeners-Kuna-id`
- → `/water-softeners-nampa-idaho`
- → `/water-softener-eagle-idaho`
- → `/water-softener-meridian-idaho` (once created)
- → `/contact-us`

**From blog post `/common-causes-of-low-water-pressure-and-how-to-fix-them`:**
- → `/water-heater-repair-boise` (inline CTA + end-of-post CTA)
- → `/Water-Heater-Replacement`

**From blog post `/the-role-of-drainage-systems-in-residential-plumbing`:**
- → `/drain-cleaning-boise` (inline CTA + end-of-post CTA)
- → `/Residential-Plumbing-Services`

### Schema Logic Summary (for Pam)

| Page | Schema Type | Key Fields |
|------|-------------|------------|
| `/` | LocalBusiness + AggregateRating | name, address, phone, serviceArea, aggregateRating |
| `/plumber-boise` | Service (Plumber) + FAQ + AggregateRating | provider, serviceType, areaServed, FAQPage |
| `/plumber-meridian-idaho` | Service (Plumber) + LocalBusiness | provider, areaServed: Meridian |
| `/plumber-nampa-idaho` | Service (Plumber) + LocalBusiness | provider, areaServed: Nampa |
| `/Water-Heater-Replacement` | Service + FAQ | serviceType: water heater replacement, FAQPage |
| `/Tankless-Water-Heater` | Service + Product (if brands listed) | serviceType: tankless installation |
| `/water-heater-repair-boise` | Service + FAQ | serviceType: water heater repair, FAQPage |
| `/hot-water-heater-meridian` | Service + LocalBusiness | areaServed: Meridian |
| `/Water-Softener-System` | Service + FAQ | serviceType: water softener installation |
| All water softener location pages | Service + LocalBusiness | areaServed: [city] |
| `/about-us` | LocalBusiness + Person (founder) | foundingDate, founder, sameAs |
| `/contact-us` | LocalBusiness + PostalAddress | contactPoint, openingHoursSpecification |
| Blog posts | Article | author, datePublished, publisher |

---

## Appendix: Decision Log

| Decision | Rationale |
|----------|-----------|
| Do not consolidate Contact Us and About Us despite 0.966 score | These pages serve different user intents and are both needed for conversion and E-E-A-T. Resolution is differentiation, not consolidation. |
| Do not consolidate Hot Water Heater Meridian and Water Softeners Kuna despite 0.950 score | Different services, different cities. Similarity is caused by shared boilerplate template copy, not overlapping intent. Resolution is content differentiation. |
| Do not restructure URLs into subfolders | CMS is Duda. Flat URL structure is native and appropriate. No technical benefit to subfolder nesting for a site this size. |
| Homepage retains primary navigational role | Homepage has 64 inlinks and 55 keyword rankings — it should not be converted to a service page. Instead, new dedicated pages absorb commercial intent, and the homepage becomes a hub with clear links to each. |
| Blog posts retained as separate informational pages | Both posts show genuine ranking traction. Merging into service pages would destroy keyword coverage and the informational intent differentiation. Link them to service pages instead. |
| Water Heater Repair page is new, not a rename of existing pages | `/Water-Heater-Replacement` already exists and targets installation intent. `/water-heater-repair-boise` must be a new, distinct page targeting diagnostic/repair intent. These are different searcher jobs. |

---

*Architecture blueprint produced by Michael, The Architect — Forge Growth*
*Input data: Dwight crawl (2026-02-24), Jim research (2026-02-23)*
*Pam executes meta titles, descriptions, and schema code from this blueprint.*
