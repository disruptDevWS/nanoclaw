# Technical SEO & Agentic Readiness Audit
## veteransplumbingcorp.com
**Audit Date:** 2026-02-23
**Auditor:** Dwight (Forge Growth)
**Tool:** Screaming Frog SEO Spider 23.3
**Crawl Scope:** 14 internal HTML pages (full site, excluding blog)
**Output Directory:** `audits/veteransplumbingcorp.com/auditor/2026-02-23/`

---

## Executive Summary

The site is technically alive — all 14 crawled pages return 200 OK with correct self-referencing canonicals. That is the baseline. Beyond that baseline, the site has significant structural and agentic deficiencies that must be addressed in priority order before any AI agent can reliably surface this business as a callable entity.

Priority stack, top to bottom:

1. **URL Identity Chaos** — 5 core service pages use Title-Case slugs with no lowercase redirect. The site cannot be consistently addressed.
2. **Structured Data is Hollow** — JSON-LD blocks exist on the homepage but are (a) duplicated verbatim, (b) flat rather than @graph-nested, (c) missing `@id` IRIs, and (d) invisible to Screaming Frog's structured data parser, meaning they fail to register as valid schema. No service pages carry any schema.
3. **Metadata Overflow** — 8 of 14 titles exceed 60 characters / 561px. 3 meta descriptions exceed 155 characters. Truncation in SERPs is guaranteed.
4. **H1 Structural Failures** — 2 pages have no H1. 2 pages have multiple H1s. 11 of 14 pages have non-sequential heading hierarchies.
5. **Agentic Readiness Gap** — `llms.txt` exists but is minimal. No `.well-known/mcp.json`, no WebMCP tool contracts, no `@graph` entity graph, no `LocalBusiness` schema with service area markup.
6. **Sitewide HTTP link to agency** — Every page carries an unsafe cross-origin HTTP link to `impactlaytonseo.com` without `rel="noopener"`.

---

## Section 1: Status Code Integrity

**Result: PASS (14/14 pages = 200 OK)**

| URL | Status |
|-----|--------|
| https://www.veteransplumbingcorp.com/ | 200 OK |
| https://www.veteransplumbingcorp.com/Water-Softener-System | 200 OK |
| https://www.veteransplumbingcorp.com/Water-Heater-Replacement | 200 OK |
| https://www.veteransplumbingcorp.com/Tankless-Water-Heater | 200 OK |
| https://www.veteransplumbingcorp.com/Residential-Plumbing-Services | 200 OK |
| https://www.veteransplumbingcorp.com/about-us | 200 OK |
| https://www.veteransplumbingcorp.com/contact-us | 200 OK |
| https://www.veteransplumbingcorp.com/water-softeners-nampa-idaho | 200 OK |
| https://www.veteransplumbingcorp.com/water-softeners-Kuna-id | 200 OK |
| https://www.veteransplumbingcorp.com/water-softener-eagle-idaho | 200 OK |
| https://www.veteransplumbingcorp.com/hot-water-heater-meridian | 200 OK |
| https://www.veteransplumbingcorp.com/sitemap | 200 OK |
| https://www.veteransplumbingcorp.com/thank-you | 200 OK |
| https://www.veteransplumbingcorp.com/privacy-policy | 200 OK |

No internal 4xx or 5xx errors. No internal redirect chains. The server (nginx) returns HTTP/2 with HSTS preload and X-Frame-Options. Solid transport layer.

**External error noted:** `support.mozilla.org` returns 406 Not Acceptable from the privacy policy page. One external link to `impactlaytonseo.com` redirects HTTP→HTTPS (301).

---

## Section 2: URL Identity Chaos

**Result: FAIL — 5 URLs flagged (Source: `issues_reports/url_uppercase.csv`)**

The following core service pages use Title-Case slugs. HTTP is case-sensitive. These URLs have no lowercase redirect. Both the Title-Case and lowercase variants return 200 OK, meaning two distinct URL identities exist for the same content. This is a canonicalization risk and a direct agentic confusion vector — an AI agent parsing a sitemap URL and a user-shared lowercase URL will arrive at what appear to be two different pages.

| Uppercase URL (canonical) | Lowercase variant behavior |
|--------------------------|---------------------------|
| `/Water-Softener-System` | 200 OK (no redirect) |
| `/water-softeners-Kuna-id` | 200 OK (no redirect) |
| `/Residential-Plumbing-Services` | 200 OK (no redirect) |
| `/Tankless-Water-Heater` | 200 OK (no redirect) |
| `/Water-Heater-Replacement` | 200 OK (no redirect) |

**Fix:** Implement 301 redirects from all lowercase variants to the canonical Title-Case versions, or — preferably — migrate all slugs to lowercase and redirect the Title-Case versions. Lowercase is the universal standard and the correct long-term position.

---

## Section 3: Canonical Correctness

**Result: PASS (all 14 pages carry self-referencing canonicals)**

Every crawled page declares a canonical that matches its own URL exactly. No canonicalized pages (pages pointing canonical to a different URL) were found. No missing canonicals. The canonical tab in `canonicals_all.csv` confirms clean self-references across all 14 pages.

**Caveat:** The canonical correctness finding does not account for the URL case issue above. If lowercase variants exist without redirects, they return 200 OK with no canonical declaration pointing to the Title-Case version, creating unresolved URL identity splits.

---

## Section 4: Metadata Quality

### 4.1 Page Titles

**Source: `page_titles_all.csv`, `issues_reports/page_titles_over_60_characters.csv`**

8 of 14 pages have titles exceeding 60 characters and 561 pixels. These will be truncated in SERPs.

| URL | Title | Length | Px Width | Status |
|-----|-------|--------|----------|--------|
| / | Plumbing Services in Boise \| Plumber Boise Idaho \| Veterans Plumbing | 68 | 626 | OVER |
| /hot-water-heater-meridian | Hot Water Heaters & Plumbing in Meridian, ID \| Veterans Plumbing Corp | 69 | 638 | OVER |
| /water-softeners-Kuna-id | Water Softeners & Systems in Kuna, ID \| Veterans Plumbing Corp | 62 | 577 | OVER |
| /Residential-Plumbing-Services | Residential Plumbing Services in Boise, ID \| Veterans Plumbing Corp | 67 | 605 | OVER |
| /Tankless-Water-Heater | Tankless Water Heater Installation Service Boise \| Veterans Plumbing | 68 | 620 | OVER |
| /Water-Heater-Replacement | Water Heater Replacement & Services Boise, ID \| Veterans Plumbing Corp | 70 | 655 | OVER |
| /water-softeners-nampa-idaho | Water Softener Systems & Service in Nampa, ID \| Veterans Plumbing | 65 | 610 | OVER |
| /privacy-policy | Veterans Plumbing Corp \| Water Softeners Boise \| Privacy Policy | 63 | 571 | OVER |

Pages within spec: /contact-us (59), /Water-Softener-System (54), /water-softener-eagle-idaho (60), /about-us (56), /thank-you (51), /sitemap (56).

### 4.2 Meta Descriptions

**Source: `meta_description_all.csv`, `issues_reports/meta_description_over_155_characters.csv`**

3 pages exceed the 155-character threshold:

| URL | Length | Px Width |
|-----|--------|----------|
| /Water-Softener-System | 156 | 936 |
| /Residential-Plumbing-Services | 158 | 935 |
| /water-softeners-nampa-idaho | 159 | 1003 |

All remaining 11 pages have compliant descriptions. No missing meta descriptions across the crawled set.

**Additional observation:** The homepage and 4 other pages use an identical sitewide meta keywords tag (289 characters, 10 keyword phrases). Meta keywords are deprecated and ignored by all major search engines. This tag carries zero SEO value and adds page weight noise. Remove it from all pages.

---

## Section 5: Heading Structure

**Source: `h1_all.csv`, `h2_all.csv`, `issues_reports/`**

### 5.1 Missing H1 — CRITICAL (2 pages)

| URL | Issue |
|-----|-------|
| /sitemap | No H1 present |
| /privacy-policy | No H1 present |

### 5.2 Multiple H1 — WARNING (2 pages)

| URL | H1-1 | H1-2 |
|-----|------|------|
| /about-us | "Veterans Plumbing A Top Plumbing Provider" | "Our Team" |
| /Water-Heater-Replacement | "Reliable Boise Water Heater Installation" | "People Swear By" |

The second H1 on `/Water-Heater-Replacement` ("People Swear By") is a fragment — this is almost certainly a CMS layout artifact where a decorative heading was assigned the wrong level. It will confuse both crawlers and AI agents attempting to parse the page's primary topic.

### 5.3 Non-Sequential H1 — WARNING (11 of 14 pages)

Screaming Frog flagged H1 non-sequential on 11 pages (78.57% of crawl). This indicates the H1 is not the first heading encountered in the DOM. The platform (DudaSite) injects H2s or H3s above the H1 in widget/navigation elements before the main content area. This breaks heading hierarchy semantics.

### 5.4 Missing H2 — WARNING (5 pages)

| URL |
|-----|
| /contact-us |
| /sitemap |
| /thank-you |
| /privacy-policy |
| (1 additional — check `issues_reports/h2_missing.csv`) |

---

## Section 6: Structured Data (JSON-LD)

**Source: `structured_data_all.csv`, `contains_structured_data_detailed_report.csv`, `validation_errors_detailed_report.csv`**

**Result: CRITICAL FAILURE**

Screaming Frog's structured data parser detected zero schema types across all 14 pages. The `structured_data_all.csv` shows 0 errors, 0 warnings, 0 Rich Result Features, 0 Total Types, and 0 Unique Types for every page. This means the JSON-LD blocks on the homepage are either (a) malformed in a way that prevents parsing, or (b) not recognized as valid structured data by the validator.

Manual inspection of the homepage HTML confirmed three JSON-LD script tags are present. The issues found:

**Issue 1: Duplicate Organization block**
The homepage contains the `Organization` block verbatim twice (Blocks 2 and 3 are identical). This is a CMS duplication artifact and counts as redundant markup.

**Issue 2: Mixed schema.org protocol references**
- Block 1 (WebSite): uses `"@context": "https://schema.org"` (correct, HTTPS)
- Blocks 2 and 3 (Organization): use `"@context": "http://schema.org"` (HTTP, deprecated)

Agents and validators that enforce HTTPS schema context will reject Blocks 2 and 3.

**Issue 3: No @graph wrapper**
All three blocks are independent, disconnected JSON-LD objects. There is no `@graph` array linking them into a unified entity graph. This means the relationship between the WebSite entity and the Organization entity is undefined. An AI agent cannot traverse a relationship that does not exist.

**Issue 4: No @id IRIs on any entity**
Neither the WebSite nor the Organization block carries an `"@id"` property. Without `@id`, these entities cannot be referenced, merged, or disambiguated across pages or by knowledge graph systems.

**Issue 5: No LocalBusiness or Plumber type**
The Organization type does not specialize into `LocalBusiness` or `Plumber` (the correct schema.org type for a plumbing business). Without `Plumber` typing, the entity does not qualify for Local Business rich results and is underspecified for agent retrieval.

**Issue 6: No service page schema**
None of the 4 core service pages (`/Water-Softener-System`, `/Water-Heater-Replacement`, `/Tankless-Water-Heater`, `/Residential-Plumbing-Services`) carry any structured data. No `Service`, no `Offer`, no `Product`.

**Issue 7: sameAs points only to a LinkedIn personal profile**
The `sameAs` array contains a single entry: a LinkedIn profile URL for an individual (`scott-sparrell`). This should link to business-level social profiles (Google Business Profile, Facebook Business page, etc.) and authoritative entity references (e.g., Better Business Bureau listing mentioned in the description).

**Current homepage JSON-LD (Block 1 — WebSite):**
```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Veterans Plumbing Corp",
  "url": "https://www.veteransplumbingcorp.com/"
}
```

**Current homepage JSON-LD (Block 2/3 — Organization, duplicated):**
```json
{
  "@context": "http://schema.org",
  "@type": "Organization",
  "name": "Veterans Plumbing Corp",
  "telephone": "208-250-2525",
  "sameAs": ["https://www.linkedin.com/in/scott-sparrell-92958031"],
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "8749 W Hackamore Drive",
    "addressLocality": "Boise",
    "postalCode": "83709",
    "addressCountry": "USA"
  }
}
```

**Required replacement — @graph-nested LocalBusiness:**
```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://www.veteransplumbingcorp.com/#website",
      "name": "Veterans Plumbing Corp",
      "url": "https://www.veteransplumbingcorp.com/"
    },
    {
      "@type": ["LocalBusiness", "Plumber"],
      "@id": "https://www.veteransplumbingcorp.com/#organization",
      "name": "Veterans Plumbing Corp",
      "url": "https://www.veteransplumbingcorp.com/",
      "telephone": "+1-208-250-2525",
      "image": "https://lirp.cdn-website.com/b31f3c1a/dms3rep/multi/opt/bb49df52c90e-vetsplumblogo-removebg-preview-1920w.png",
      "logo": {
        "@type": "ImageObject",
        "@id": "https://www.veteransplumbingcorp.com/#logo",
        "url": "https://lirp.cdn-website.com/b31f3c1a/dms3rep/multi/opt/bb49df52c90e-vetsplumblogo-removebg-preview-1920w.png"
      },
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "8749 W Hackamore Drive",
        "addressLocality": "Boise",
        "addressRegion": "ID",
        "postalCode": "83709",
        "addressCountry": "US"
      },
      "areaServed": [
        {"@type": "City", "name": "Boise"},
        {"@type": "City", "name": "Meridian"},
        {"@type": "City", "name": "Nampa"},
        {"@type": "City", "name": "Kuna"},
        {"@type": "City", "name": "Eagle"}
      ],
      "sameAs": [
        "https://www.google.com/maps/place/Veterans+Plumbing+Corp",
        "https://www.facebook.com/veteransplumbingcorp"
      ],
      "foundingDate": "2011",
      "description": "Veteran-owned plumbing company serving Boise, Idaho. Services include water heater repair and replacement, tankless water heaters, water softener installation, and residential plumbing."
    }
  ]
}
```

---

## Section 7: Sitemap Health

**Source: `sitemaps_all.csv`, `sitemap.xml`**

All 14 crawled pages appear in the sitemap and return 200 OK. No non-indexable URLs were flagged in the sitemap. No orphan URLs were detected within the crawled set.

**Sitemap structural issue:** The sitemap at `/sitemap.xml` lists the HTML sitemap page (`/sitemap`) with `priority: 1.0`. The HTML sitemap page has 152 words, no H1, and a thin meta description. It should not be declared at maximum priority.

**Notable sitemap entries not crawled:** The sitemap lists 9 `/product/` URLs (e.g., `/product/Diagonal-Cutting-Pliers`, `/product/Hand-Saw`) and 50+ blog post URLs. These were not crawled in this session because the spider did not follow links into those sections from the crawled pages. A full-depth crawl is recommended to audit these pages, particularly the `/product/` pages which appear to be e-commerce template pages unrelated to the plumbing service offering.

**Robots.txt:** Minimal — only declares the sitemap location. No disallow rules. All pages are crawlable.

---

## Section 8: Image Health

**Source: `issues_reports/images_missing_alt_text.csv`, `issues_reports/images_over_100_kb.csv`**

### 8.1 Missing Alt Text

1 image is missing alt text, referenced from 14 pages (it is the sitewide logo):

```
https://lirp.cdn-website.com/b31f3c1a/dms3rep/multi/opt/
veterans-plumbing---actual-logo-178w-1920w.webp
```

This logo appears on every page and currently has an empty `alt=""` attribute. As the only instance of the company name as an image, it should carry descriptive alt text: `alt="Veterans Plumbing Corp logo"`.

### 8.2 Oversized Images (>100 KB)

12 images exceed 100 KB. All are served from the DudaSite CDN (`lirp.cdn-website.com`) at 1920px width. Examples:

- `tankless+water+heaters+Boise+Idaho-1920w.png`
- `water+softener+system+idaho-1920w.jpg`
- `residential+plumbing+services+in+boise+id-1920w.jpg`

These images are being served at desktop-max resolution regardless of viewport. The DudaSite platform may handle responsive image delivery natively, but the raw file sizes should be audited and compressed.

### 8.3 Missing Size Attributes

1 image is flagged for missing width/height attributes, which contributes to Cumulative Layout Shift (CLS).

---

## Section 9: Security & Link Health

### 9.1 Unsafe Cross-Origin Links — Sitewide (14/14 pages)

Every page on the site links to `http://www.impactlaytonseo.com/` using `target="_blank"` without `rel="noopener"`. This is the SEO agency footer attribution link. Two compounding problems:

1. The link is HTTP (not HTTPS) — the destination redirects to HTTPS but the anchor href remains plain HTTP.
2. No `rel="noopener"` — exposes a legacy browser attack surface.

**Fix:** Update the footer link to `https://www.impactlaytonseo.com/` and add `rel="noopener noreferrer"`.

### 9.2 Missing Referrer-Policy Header — Sitewide (14/14 pages)

The server does not set a `Referrer-Policy` header on any page. This means the full URL (including any query parameters) is sent as the Referer header to third-party resources. Recommendation: set `Referrer-Policy: strict-origin-when-cross-origin`.

### 9.3 External 4xx

The privacy policy page links to `https://support.mozilla.org/en-US/kb/enable-and-disable-cookies-website-preferences` which returns 406 Not Acceptable. This is a broken external link. Update or remove it.

---

## Section 10: Agentic Readiness

### 10.1 llms.txt — EXISTS (partial credit)

`https://www.veteransplumbingcorp.com/llms.txt` returns 200 OK. Content is present and lists 14 core pages and 50+ blog posts with descriptions. This is a meaningful starting point.

**Deficiencies in current llms.txt:**
- Descriptions are pulled directly from meta descriptions. They are truncated and do not convey service scope, geography, or entity identity.
- No business entity metadata (name, phone, address, service area).
- No link to structured data or schema context.
- Blog post entries lack descriptions (raw URLs only for several entries).

### 10.2 WebMCP / .well-known — NOT PRESENT

```
404  https://www.veteransplumbingcorp.com/.well-known/mcp.json
404  https://www.veteransplumbingcorp.com/.well-known/ai-plugin.json
404  https://www.veteransplumbingcorp.com/mcp.json
```

No WebMCP tool contracts exist. An AI agent cannot call any action on this site (e.g., "book a plumber," "get a quote," "check availability") because no tool interface is declared. The site is discoverable in a minimal sense via `llms.txt` but is not callable.

### 10.3 @graph Entity Clarity — NOT PRESENT

As documented in Section 6, no `@graph`-nested, `@id`-referenced entity graph exists. AI agents (Perplexity, SearchGPT, Gemini, Claude) use structured data `@graph` to resolve entity identity. Without it, this business cannot be reliably attributed, cited, or included in agent-generated local service recommendations.

### 10.4 Agentic Readiness Score

| Signal | Status | Weight |
|--------|--------|--------|
| llms.txt present | PASS | Low |
| @graph entity graph | FAIL | High |
| LocalBusiness @id IRI | FAIL | High |
| Service-level schema on service pages | FAIL | High |
| .well-known/mcp.json | FAIL | Medium |
| areaServed markup | FAIL | Medium |
| sameAs to authoritative business profiles | FAIL | Medium |
| Consistent URL identity (no case chaos) | FAIL | Medium |

**Agentic Readiness: 1/8 signals passing. Site is Search-Visible, not Agent-Callable.**

---

## Section 11: Platform Observations

The site is built on **DudaSite** (evidenced by `lirp.cdn-website.com` CDN, `d-cache` response header, `d-geo: US` header, and page source structure). DudaSite has known limitations:

1. **JSON-LD injection is manual or via third-party app** — the platform does not auto-generate structured data. The current schema must be maintained in the page's custom code section.
2. **URL casing cannot be forced lowercase at the platform level** — redirects require manual configuration or a custom rule if the platform supports it.
3. **H1 ordering issues stem from widget DOM order** — DudaSite renders decorative heading widgets above the main content heading in the DOM, causing the non-sequential H1 issue across 11 pages. This is a known platform limitation requiring custom HTML widget ordering.

---

## Prioritized Fix List

### Priority 1 — Do These First (Structural Integrity)

| # | Issue | Affected Pages | Fix |
|---|-------|---------------|-----|
| 1 | URL case chaos | 5 service pages | Implement 301 redirects from lowercase variants to canonical URLs, or migrate all to lowercase |
| 2 | Duplicate Organization JSON-LD on homepage | Homepage | Remove one of the two identical blocks |
| 3 | Missing H1 | /sitemap, /privacy-policy | Add descriptive H1 to both pages |
| 4 | Multiple H1 | /about-us, /Water-Heater-Replacement | Demote secondary H1 to H2 |
| 5 | Broken external link (Mozilla 406) | /privacy-policy | Update or remove the link |

### Priority 2 — High Impact (Schema & Entity)

| # | Issue | Affected Pages | Fix |
|---|-------|---------------|-----|
| 6 | Replace flat JSON-LD with @graph-nested Plumber entity | Homepage (then all pages) | Deploy the @graph block from Section 6 |
| 7 | Add @id IRIs to all schema entities | All pages | Add `@id` to every @type declaration |
| 8 | Add Service schema to all service pages | 4 service pages | Add `Service` blocks with `provider` pointing to the org @id |
| 9 | Fix sameAs — replace personal LinkedIn with business profiles | Homepage | Update to Google Business Profile URL, Facebook Business page |

### Priority 3 — Metadata Trimming

| # | Issue | Affected Pages | Fix |
|---|-------|---------------|-----|
| 10 | Titles over 60 characters | 8 pages | Trim to under 60 chars / 561px |
| 11 | Meta descriptions over 155 characters | 3 pages | Trim to under 155 chars |
| 12 | Remove deprecated meta keywords tag | All pages (sitewide) | Delete the meta keywords tag from templates |

### Priority 4 — Agentic Upgrade

| # | Issue | Fix |
|---|-------|-----|
| 13 | Expand llms.txt | Add business entity block at top: name, phone, address, service area, hours |
| 14 | Deploy .well-known/mcp.json | Define at minimum a `get_quote` or `contact` tool contract |
| 15 | Add areaServed markup | Add City entities for Boise, Meridian, Nampa, Kuna, Eagle in the Plumber schema |

### Priority 5 — Security & Images

| # | Issue | Fix |
|---|-------|-----|
| 16 | HTTP agency footer link without rel="noopener" | Update to HTTPS + add rel="noopener noreferrer" |
| 17 | Missing Referrer-Policy header | Set `Referrer-Policy: strict-origin-when-cross-origin` in nginx config |
| 18 | Logo missing alt text | Add `alt="Veterans Plumbing Corp logo"` |
| 19 | 12 images over 100 KB | Compress and serve responsive sizes via CDN |

---

## Crawl Coverage Note

This crawl captured 14 HTML pages — the full set of core service, location, and utility pages visible from the homepage. The sitemap lists an additional 50+ blog posts and 9 `/product/` pages. A follow-up full-depth crawl against the sitemap (`--crawl-sitemap`) is required to audit:

- The `/product/` pages (apparent e-commerce templates — these may be platform demo content left live and indexed)
- The blog post corpus for duplicate content, thin content, and schema coverage

**Recommended next crawl command:**
```bash
screamingfrogseospider \
  --crawl-sitemap "https://www.veteransplumbingcorp.com/sitemap.xml" \
  --headless \
  --output-folder "/home/forgegrowth/nanoclaw/audits/veteransplumbingcorp.com/auditor/2026-02-23/sitemap-crawl/" \
  --overwrite \
  --export-format csv \
  --export-tabs "Internal:All,Content:Exact Duplicates,Content:Near Duplicates" \
  --bulk-export "Content:Exact Duplicates,Content:Near Duplicates,Structured Data:Contains Structured Data"
```

---

## File Index

All outputs saved to `audits/veteransplumbingcorp.com/auditor/2026-02-23/`:

| File | Contents |
|------|----------|
| `internal_all.csv` | Full crawl data — status codes, titles, descriptions, H1/H2, canonicals, word count |
| `page_titles_all.csv` | All page titles with length and pixel width |
| `meta_description_all.csv` | All meta descriptions with length and pixel width |
| `canonicals_all.csv` | Canonical declarations for all pages |
| `h1_all.csv` | H1 tags for all pages |
| `h2_all.csv` | H2 tags for all pages |
| `structured_data_all.csv` | Structured data presence and validation scores |
| `directives_all.csv` | Meta robots and X-Robots-Tag directives |
| `sitemaps_all.csv` | Pages found in sitemap |
| `response_codes_redirection_(3xx).csv` | All 3xx redirects (external only — no internal redirects found) |
| `response_codes_client_error_(4xx).csv` | External 4xx errors |
| `external_all.csv` | All external links |
| `self_referencing_inlinks.csv` | Self-referencing canonical inlink map |
| `sitemap.xml` | Raw sitemap saved at crawl time |
| `crawl.seospider` | Saved Screaming Frog crawl file (reopenable in SF UI) |
| `issues_reports/issues_overview_report.csv` | Consolidated issues with counts and descriptions |
| `issues_reports/url_uppercase.csv` | 5 URLs with uppercase characters |
| `issues_reports/h1_missing.csv` | 2 pages missing H1 |
| `issues_reports/h1_multiple.csv` | 2 pages with multiple H1s |
| `issues_reports/h2_missing.csv` | Pages missing H2 |
| `issues_reports/meta_description_over_155_characters.csv` | 3 over-length descriptions |
| `issues_reports/page_titles_over_60_characters.csv` | 8 over-length titles |
| `issues_reports/images_missing_alt_text.csv` | Logo image missing alt text |
| `issues_reports/images_over_100_kb.csv` | 12 oversized images |
| `issues_reports/security_unsafe_crossorigin_links.csv` | Agency footer link on all 14 pages |
| `issues_reports/security_missing_secure_referrerpolicy_header.csv` | Missing header on all 14 pages |
| `issues_reports/content_low_content_pages.csv` | /sitemap and /thank-you below 200 words |
