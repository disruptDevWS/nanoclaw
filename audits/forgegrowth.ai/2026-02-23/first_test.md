# Forge Growth Technical SEO & Agentic Readiness Audit
**Target:** https://forgegrowth.ai
**Crawl Date:** 2026-02-23
**Auditor:** Dwight (Forge Growth Technical SEO & Agentic Readiness Auditor)
**Tool:** Screaming Frog SEO Spider 23.3 (headless, standard rendering mode)
**URLs Crawled:** 36 total (9 HTML pages + 27 static assets)
**Exports:** `internal_all.csv`, `structured_data_all.csv`, `contains_structured_data_detailed_report.csv`, `jsonld_urls_detailed_report.csv`, `validation_errors_detailed_report.csv`

---

## Executive Summary

The site has a clean foundational status code record (100% 200 OK across all URLs). Metadata is present and within spec on all HTML pages. However, there is a single critical failure that undermines the entire agentic readiness posture of the site: **JSON-LD structured data is rendered exclusively via client-side JavaScript (Next.js hydration) and is therefore invisible to non-rendering crawlers, including Googlebot's first-pass crawl queue and every AI agent that does not execute JavaScript.**

The homepage carries the only JSON-LD block on the entire site. The remaining 8 HTML pages — including all three service pages, the About page, and the Contact page — carry zero structured data of any kind.

This is not an optimization gap. It is a foundational architectural defect that prevents entity clarity for any system that reads HTML directly.

---

## Section 1: Foundational SEO — Status Code Integrity

**Result: PASS**

All 36 crawled URLs returned HTTP 200 OK. No 3xx redirects, no 4xx client errors, no 5xx server errors, and no no-response timeouts were recorded.

| Status | Count |
|--------|-------|
| 200 OK | 36 |
| 3xx Redirect | 0 |
| 4xx Client Error | 0 |
| 5xx Server Error | 0 |

Zero URL identity chaos. No redirect chains, no canonicalized URLs pointing to non-200 targets.

---

## Section 2: Canonical Correctness

**Result: PASS**

All 9 indexable HTML pages carry a self-referencing canonical that exactly matches the crawled URL. No missing canonicals, no conflicting canonicals, no cross-origin canonical issues.

| URL | Canonical |
|-----|-----------|
| `https://forgegrowth.ai/` | `https://forgegrowth.ai/` |
| `https://forgegrowth.ai/contact` | `https://forgegrowth.ai/contact` |
| `https://forgegrowth.ai/privacy-policy` | `https://forgegrowth.ai/privacy-policy` |
| `https://forgegrowth.ai/services/seo` | `https://forgegrowth.ai/services/seo` |
| `https://forgegrowth.ai/services/ppc` | `https://forgegrowth.ai/services/ppc` |
| `https://forgegrowth.ai/services/ai-search-optimization` | `https://forgegrowth.ai/services/ai-search-optimization` |
| `https://forgegrowth.ai/terms-of-service` | `https://forgegrowth.ai/terms-of-service` |
| `https://forgegrowth.ai/services` | `https://forgegrowth.ai/services` |
| `https://forgegrowth.ai/about` | `https://forgegrowth.ai/about` |

---

## Section 3: Metadata Quality

**Result: PASS with one flag**

All 9 HTML pages have unique titles and meta descriptions. No duplicates, no missing values, no truncation beyond pixel-width spec.

| URL | Title | Title Length | Meta Description Length | Notes |
|-----|-------|-------------|------------------------|-------|
| `/` | SEO Consulting for Service Businesses | 37 | 167 | Title short (344px); description at 1048px, within 1024px soft cap — borderline |
| `/contact` | Contact Us | 25 | 94 | Title very short at 234px — under-optimized |
| `/privacy-policy` | Privacy Policy | 29 | 86 | Legal page — acceptable |
| `/services/seo` | Local SEO Services for Service Businesses | 56 | 138 | Good |
| `/services/ppc` | Pay-Per-Click (PPC) Management for Service Businesses | 68 | 140 | Long but within spec at 644px |
| `/services/ai-search-optimization` | AI Search Optimization for Service Businesses | 60 | 162 | Good |
| `/terms-of-service` | Terms of Service | 31 | 82 | Legal page — acceptable |
| `/services` | Search Marketing for Service Businesses | 54 | 166 | Description at 1044px — borderline |
| `/about` | Who We Are & What We Stand For | 45 | 141 | Good |

**Flag — `/contact` title:** "Contact Us | Forge Growth" at 25 characters and 234px is significantly under-utilized. Contact pages are indexed and can hold a call-to-action oriented title.

---

## Section 4: Indexability and Crawl Coverage

**Result: PASS**

All 9 HTML pages are marked Indexable. No noindex directives detected on any page. No X-Robots-Tag restrictions found. Language attribute correctly set to `en` on all HTML pages.

Crawl depth is flat — all HTML pages sit at depth 0 or 1, which is correct for a site of this size.

---

## Section 5: Structured Data — CRITICAL FAILURE

**Result: CRITICAL FAIL**

### 5a. Screaming Frog Detection: Zero Structured Data on All Pages

The `structured_data_all.csv` export records 0 errors, 0 types, and empty Type-1 fields across all 9 HTML pages. The `contains_structured_data_detailed_report.csv`, `jsonld_urls_detailed_report.csv`, and `validation_errors_detailed_report.csv` bulk exports are all empty (headers only, no data rows).

This is not because the site lacks JSON-LD. It is because the JSON-LD is injected by Next.js client-side hydration. Screaming Frog ran in standard (non-JavaScript-rendering) mode and read only the static HTML payload. The JSON-LD script tags are absent from the server-rendered HTML.

### 5b. Live Page Verification

Direct page fetches confirm the following:

**Homepage (`/`) — JSON-LD EXISTS (client-side only)**

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://forgegrowth.ai/#website",
      "url": "https://forgegrowth.ai/",
      "name": "Forge Growth",
      "description": "We help service businesses show up when customers are ready to hire...",
      "publisher": { "@id": "https://forgegrowth.ai/#organization" },
      "inLanguage": "en-US"
    },
    {
      "@type": "WebPage",
      "@id": "https://forgegrowth.ai/#webpage",
      "url": "https://forgegrowth.ai/",
      "name": "SEO Consulting for Service Businesses | Forge Growth",
      "description": "SEO consulting for service businesses...",
      "isPartOf": { "@id": "https://forgegrowth.ai/#website" },
      "about": { "@id": "https://forgegrowth.ai/#organization" },
      "inLanguage": "en-US"
    },
    {
      "@type": "Organization",
      "@id": "https://forgegrowth.ai/#organization",
      "name": "Forge Growth",
      "url": "https://forgegrowth.ai/",
      "sameAs": ["https://www.linkedin.com/company/forge-growth-llc"],
      "areaServed": [{ "@type": "Country", "name": "United States" }]
    }
  ]
}
```

**All other HTML pages — No JSON-LD whatsoever:**

| URL | Structured Data |
|-----|----------------|
| `/services` | None |
| `/services/seo` | None |
| `/services/ppc` | None |
| `/services/ai-search-optimization` | None |
| `/about` | None |
| `/contact` | None |
| `/privacy-policy` | None |
| `/terms-of-service` | None |

### 5c. Rendering Architecture Issue

The JSON-LD on the homepage is tagged `id="jsonld-home"` and is injected post-hydration. This means:

1. Googlebot's first-pass crawl (before JavaScript rendering queue) sees no structured data.
2. Every AI agent that calls the URL directly and reads the response body without executing JavaScript sees no structured data.
3. Screaming Frog in standard mode — the standard audit tool — sees no structured data.

The fix requires moving JSON-LD into the server-rendered HTML `<head>`. In Next.js this means placing the `<script type="application/ld+json">` tag inside the `<Head>` component (Pages Router) or as a `<script>` in the `metadata` export or a Server Component (App Router), not inside a client component that hydrates after load.

---

## Section 6: JSON-LD @graph Entity Analysis (Homepage Only)

**Result: PARTIAL — Structure is correct, coverage is deficient**

### What is correct

The homepage JSON-LD uses the `@graph` pattern correctly. The three entities — `WebSite`, `WebPage`, and `Organization` — cross-reference each other via `@id` IRIs using the established `#website`, `#webpage`, and `#organization` fragment convention. The `publisher` reference on `WebSite` resolves to `#organization`. The `about` reference on `WebPage` resolves to `#organization`. Node resolution within the graph is internally consistent.

### What is missing or deficient

1. **`Organization` is missing `logo`.** The `logo` property with an `ImageObject` is required for Google's Organization knowledge panel eligibility. Without it, the organization entity cannot be matched to a visual identity by any AI system.

2. **`Organization` is missing `contactPoint` or `telephone`.** For a service business that explicitly drives call conversions, the absence of `contactPoint` with `@type: ContactPoint` and `contactType: "customer service"` is a direct agentic readiness gap. An AI agent asked "how do I contact Forge Growth" cannot extract a phone number or email from structured data.

3. **`Organization` `areaServed` uses `Country` only.** The site's service pages reference Boise, Idaho explicitly. `areaServed` should include a `City` or `AdministrativeArea` entity for local relevance signaling alongside the `Country` node.

4. **No `Person` entity for founder Matt Edens.** The About page prominently features Matt Edens. A `Person` entity with `@type: Person`, `name`, `jobTitle`, and `worksFor` referencing `#organization` would establish the human principal behind the brand — a significant trust signal for AI systems evaluating E-E-A-T.

5. **No `Service` entities on service pages.** `/services/seo`, `/services/ppc`, and `/services/ai-search-optimization` carry zero structured data. Each should have at minimum a `Service` entity with `name`, `description`, `provider` (referencing `#organization`), and `areaServed`. Without these, an AI agent parsing the site's offerings cannot ground the services in structured claims — it must rely entirely on prose extraction.

6. **No `WebMCP` tool contracts or API endpoint declarations.** There is no `EntryPoint`, `Action`, or equivalent machine-readable contract declaring callable endpoints. The contact form at `/contact` is not exposed as an agent-callable surface.

---

## Section 7: Agentic Readiness Summary

| Check | Status | Detail |
|-------|--------|--------|
| JSON-LD present in static HTML | FAIL | Client-side hydration only; not in server-rendered `<head>` |
| @graph nesting with @id cross-references | PASS (homepage only) | Node resolution is internally consistent |
| Organization entity | PARTIAL | Missing `logo`, `contactPoint`, and granular `areaServed` |
| Person entity (founder) | FAIL | No `Person` entity for Matt Edens |
| Service entities on service pages | FAIL | Zero structured data on all 3 service pages |
| Contact page structured data | FAIL | No `ContactPage` or `ContactPoint` entity |
| WebMCP / callable endpoint declaration | FAIL | No machine-readable API or action surface declared |

---

## Prioritized Remediation List

These are ordered by impact. Do not optimize for AI agents until the rendering defect in item 1 is resolved — everything else depends on it.

### Priority 1 — Move JSON-LD to server-rendered HTML (Foundational)

The JSON-LD must be present in the static HTML payload returned by the server, not injected by client-side JavaScript. In Next.js App Router, use a Server Component to render `<script type="application/ld+json">` tags. In Pages Router, use `next/head`. This single fix will make all downstream structured data work visible to Googlebot, Screaming Frog, and AI agents.

**Impact:** Unblocks all other structured data work. Without this, no other schema fix is verifiable.

### Priority 2 — Add per-page JSON-LD to all HTML pages

Every indexable HTML page needs its own `WebPage` node in the `@graph` (with `isPartOf` referencing `#website`) plus the relevant page-type entity:

- `/services/seo`, `/services/ppc`, `/services/ai-search-optimization`: Add `Service` entities with `name`, `description`, `provider`, `areaServed`.
- `/about`: Add a `Person` entity for Matt Edens with `name`, `jobTitle`, `worksFor`.
- `/contact`: Add a `ContactPage` entity and a `contactPoint` property on the `Organization` node.

### Priority 3 — Expand the Organization entity

Add the following properties to the `Organization` node in the homepage `@graph`:

```json
"logo": {
  "@type": "ImageObject",
  "@id": "https://forgegrowth.ai/#logo",
  "url": "https://forgegrowth.ai/_next/static/media/forge-logo-icon.2056caba.png",
  "contentUrl": "https://forgegrowth.ai/_next/static/media/forge-logo-icon.2056caba.png",
  "width": 256,
  "height": 256
},
"contactPoint": {
  "@type": "ContactPoint",
  "contactType": "customer service",
  "url": "https://forgegrowth.ai/contact",
  "areaServed": "US"
},
"address": {
  "@type": "PostalAddress",
  "addressLocality": "Boise",
  "addressRegion": "ID",
  "addressCountry": "US"
}
```

### Priority 4 — Fix the `/contact` page title

Replace the generic "Contact Us | Forge Growth" title with something that captures intent, for example: "Book a Strategy Call | Forge Growth" or "Contact Forge Growth — Service Business SEO Consultants". This improves CTR from search and gives AI agents a more actionable surface label.

### Priority 5 — WebMCP / Agentic Endpoint Declaration (Future)

Once the structured data foundation is stable, consider declaring a `WebMCP` tool contract or an `EntryPoint` Action on the contact/booking endpoint. This makes the site callable by AI agents following the emerging agentic discovery pattern, not just readable.

---

## Audit Files

All raw exports are saved to `/home/forgegrowth/nanoclaw/audits/`:

| File | Contents |
|------|----------|
| `internal_all.csv` | All 36 crawled URLs with full metadata columns |
| `structured_data_all.csv` | 9 HTML pages, all showing 0 structured data types (rendering issue) |
| `contains_structured_data_detailed_report.csv` | Empty — no structured data detected by non-rendering crawler |
| `jsonld_urls_detailed_report.csv` | Empty — no JSON-LD detected by non-rendering crawler |
| `validation_errors_detailed_report.csv` | Empty — nothing to validate |
| `sf-audit-config.seospiderconfig` | Crawl config used for this run |
