# Claude Code Prompt: Core Services as Authoritative Constraint

## Context

Cluster Strategy (Opus) generated an entity map for IMA's "EMT Training Online" cluster that included Hybrid EMT Course as a related entity warranting its own page — but IMA no longer offers hybrid EMT. It also marked In-Person EMT Course as `has_page: false` when a page does exist. The root cause: Opus inferred service offerings from keyword data and crawl data rather than treating the Core Services field in client_context as the authoritative record of what the business offers.

The Core Services field already exists in `audits.client_context` and is already injected into the Cluster Strategy prompt via `clientCtxPrompt`. No new data model or UI is needed. Two changes fix this:

1. Strengthen the prompt to treat Core Services as a binding constraint
2. Ensure the same authority is respected by other agents that make service-related inferences (Gap, Michael)

## Scope

This is a prompt-only change. No new tables, no new UI components, no migrations, no new fields. Touch only agent prompt files and the injection logic.

## Pre-reads

```
configs/agents/cluster-strategy.md (or wherever the Cluster Strategy prompt now lives after Session 1 extraction)
configs/agents/gap.md
configs/agents/michael.md
scripts/generate-cluster-strategy.ts (find how clientCtxPrompt is assembled — what fields from client_context are injected and how they're formatted)
scripts/pipeline-generate.ts (find how client_context is injected into Gap and Michael)
```

## Change 1: Cluster Strategy prompt — add Core Services authority directive

In the Cluster Strategy prompt, add a directive immediately after the `${clientCtxPrompt}` injection point (or within the instructions section that governs how context should be interpreted):

```
## Service Authority Rule
The "Core Services" section in Business Context is the authoritative record of what this business currently offers. Apply these rules:
- Only recommend entities, pages, or content for services listed as active in Core Services.
- If keyword data or crawl data references a service not listed in Core Services (or listed as discontinued), do NOT treat it as an active offering. Note the discrepancy in your analysis if relevant (e.g., "keyword data shows demand for [service] but it is not currently offered — consider whether reintroduction or redirect is appropriate").
- If a Core Services entry includes status notes (e.g., "discontinued," "planned," "seasonal"), respect that status in all entity and page recommendations.
- If Core Services is absent or empty, fall back to inferring services from crawl data and keywords, but flag reduced confidence in service-level recommendations.
```

This follows the existing two-tier authority model: binding constraints override structured data.

## Change 2: Gap agent — same authority directive

The Gap agent identifies authority gaps and recommends topics to address. It should respect the same service authority. Add a similar (shorter) directive to the Gap prompt:

```
## Service Authority
If Business Context includes a "Core Services" section, treat it as the authoritative list of active services. Do not identify gaps for services not listed or listed as discontinued.
```

## Change 3: Michael — same authority directive

Michael builds site architecture and assigns pages to silos. Add:

```
## Service Authority
If Business Context includes a "Core Services" section, treat it as the authoritative list of active services. Do not create silos or recommend pages for services not listed or listed as discontinued. If crawl data shows pages for discontinued services, flag them as candidates for redirect or removal in Risk Flags.
```

## Change 4: Verify clientCtxPrompt assembly

Read `generate-cluster-strategy.ts` and confirm that the Core Services field from `client_context` is actually making it into the prompt. Specifically:
- How is `client_context` loaded? (From disk via `loadClientContext()` or from Supabase?)
- What fields are extracted and formatted into `clientCtxPrompt`?
- Is Core Services a named field, or is client_context a single free-text blob?

If Core Services is a named field within a structured client_context JSON, the injection is probably fine. If client_context is a single text blob, verify that the Core Services content is visible in the prompt and not truncated or buried.

Do NOT change the data model or how client_context is stored. Just verify the injection path works.

## What NOT to do

- Do not create a new `client_services` table or structured service catalog
- Do not add UI for managing services as structured rows
- Do not modify the Settings page client_context form
- Do not add fields to client_profiles
- This is a prompt constraint, not a feature

## Verification

1. Read the updated prompts and confirm the Service Authority directive is present in Cluster Strategy, Gap, and Michael
2. Grep for `clientCtxPrompt` or `clientContext` or `client_context` in the prompt assembly logic to confirm the injection path
3. `npx tsc --noEmit` — clean compile (prompt-only changes shouldn't affect types, but verify)
4. No build verification needed — these are prompt text changes only
