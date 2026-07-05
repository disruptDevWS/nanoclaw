# Claude Code Prompt: Cluster Strategy View — Full-Width, Entity Map Legibility, PDF Export

## Context

The Cluster Strategy panel on the Clusters page currently renders as a slide-out drawer at approximately 1/3 screen width. This was adequate when strategies were simple data displays, but after the entity-authority reframe the strategy content includes entity maps (JSON + visualization), buyer journey maps, page-level recommendations, schema directives, and AI visibility queries. The narrow panel creates excessive vertical scrolling, makes the entity map visualization illegible, and forces JSON blocks into horizontal scroll.

This is a working document the operator reviews to make decisions and a deliverable they walk clients through. The presentation needs to match that function.

## Pre-reads

```
lovable-repo/src/pages/audit-detail/ClustersPage.tsx
lovable-repo/src/components/clusters/ (all components in this directory)
lovable-repo/src/hooks/use-cluster-strategy.ts (or similar — find the hook that fetches cluster strategy data)
lovable-repo/src/components/clusters/ClusterStrategyPanel.tsx (or whatever the slide-out component is named)
lovable-repo/src/components/clusters/EntityMapVisualization.tsx (or similar — the force-directed graph component)
```

Read the existing components before making changes. Understand the current data flow, component structure, and design system (colors, spacing, typography patterns used elsewhere in the dashboard).

## Change 1: Full-Width Strategy View

Replace the slide-out drawer with a full-width view. Two implementation options — pick whichever integrates more cleanly with the existing router and layout structure:

**Option A: Route-based.** Clicking "View Strategy" on a cluster navigates to a dedicated route (e.g., `/audits/:id/clusters/:clusterId/strategy`) that renders the strategy as a full-width page. Back button returns to the clusters list. This is the cleaner approach if the dashboard already uses route-based navigation for detail views.

**Option B: Overlay.** The strategy renders as a full-width overlay that replaces the clusters list view, with a back/close button in the top-left. The cluster list is unmounted (not just hidden behind a z-index layer). This avoids adding a new route but achieves the same result.

**Either way:**
- The strategy view should use the full available width within the existing page layout (respecting the sidebar navigation)
- No content from the clusters list should be visible behind or alongside the strategy — the operator is doing one thing at a time
- The header should show the cluster name, activation date, and status prominently
- Include a clear back/close affordance

## Change 2: Entity Map Visualization Improvements

The entity map graph currently renders in the narrow panel and is difficult to read. At full width, it has room to be genuinely useful. Improve it:

**Layout and sizing:**
- Give the entity map a generous rendering area — at least 600px height at desktop widths
- Use the available width (which is now full-page minus sidebar)
- Nodes should be spaced enough that labels don't overlap

**Node improvements:**
- Color-code by coverage status: use the dashboard's existing color palette to distinguish between entities that have existing pages (solid/filled) and entities that need pages (`warrants_own_page: true` but no matching `execution_page` exists yet — outlined or desaturated)
- Show entity type as a subtle label or badge on each node (Course, FAQPage, WebPage, EducationalOccupationalCredential)
- Primary entity node should be visually distinct (larger, different treatment) from related entities

**Edge improvements:**
- Show relationship text on edges (or on hover if space is tight) — the `relationship` field from the entity map JSON contains descriptions like "Alternative delivery format" or "The credential earned after completing the course"
- Edge style could vary by relationship type if that improves readability (e.g., solid for direct relationships, dashed for informational/supporting content)

**Interaction:**
- Clicking a node that has an existing page should link to that page's detail or highlight it in the Current Pages list below
- Hovering a node should show the full entity details (key_attributes, relationship description) in a tooltip or side panel

**Important:** Work within the existing design system. Match colors, typography, and interaction patterns used elsewhere in the dashboard. Don't introduce new design language.

## Change 3: PDF Export

Add an "Export Strategy" button in the strategy view header (near the back/close button). When clicked, generate a downloadable PDF containing:

**Page 1: Overview**
- Cluster name, activation date, status
- Buyer Journey summary (stages with keyword counts and gap indicators)
- Entity Map — rendered as a static diagram (the SVG from the visualization, or a clean layout-only version if the interactive graph doesn't export well)

**Page 2+: Entity Details**
- Entity map data formatted as a readable table or structured list (not raw JSON): entity name, type, relationship to primary entity, warrants own page, key attributes
- Schema notes section

**Page 3+: Buyer Journey Detail**
- Per-stage: keywords, buyer questions, has_page status, gap_severity
- Page recommendations with coverage role, rationale, target keywords

**Page 4+: AI Visibility (if available)**
- Visibility queries with query type and target platforms
- AI optimization targets

**Implementation approach:**
- Use a client-side PDF generation library. Check what's already in the project's dependencies — if `jspdf`, `html2canvas`, `react-pdf`, or similar is already installed, use it. If not, `jspdf` + `html2canvas` is the simplest approach for rendering existing React components to PDF.
- The PDF should be clean and professional — dark-on-light (invert the dashboard's dark theme for print readability), clear headings, adequate spacing. This is a client-facing deliverable.
- Filename: `{domain}-{cluster-name}-strategy-{date}.pdf` (e.g., `idahomedicalacademy-emt-training-online-strategy-2026-06-02.pdf`)

## Verification

1. Navigate to Clusters page for IMA audit
2. Click into EMT Training Online strategy → should open full-width, not slide-out
3. Entity map should be readable: node labels visible, color coding reflects page existence, relationship labels visible on edges or hover
4. Click "Export Strategy" → PDF downloads with all sections, readable formatting, correct filename
5. Back button returns to clusters list with scroll position preserved
6. Test on at least one other activated cluster if available to verify the layout works with different data shapes
7. Check that non-activated clusters still show their current UI (activation prompt or whatever exists) — this change only affects the activated strategy view

## What NOT to change

- The clusters list page itself (layout, columns, sorting, filtering)
- The cluster activation flow
- The strategy data fetching logic (hooks, queries) — only the presentation layer changes
- Any other dashboard pages
