# CLAUDE.md — Forge OS pipeline

Forge OS is an **SEO audit pipeline toolkit**. Dashboard buttons trigger Supabase Edge Functions, which POST to a Node.js HTTP server on Railway, which spawns a shell orchestrator that runs TypeScript phase generators, then syncs results back to Supabase tables for the dashboard to display.

Companion repo: `../lovable-repo` (dashboard). The two deploy independently — pushing here does **not** trigger a Vercel redeploy, and vice versa.

## Session start

Review MEMORY.md (auto-loaded) and confirm you're oriented. That's it — do **not** read PIPELINE.md or DATA_CONTRACT.md in full at session start.

**Reference docs — grep as needed during the session, never bulk-read:**

| Doc | Size | What it's for |
|-----|------|---------------|
| [docs/PIPELINE.md](docs/PIPELINE.md) | ~29k tokens | Authoritative phase contract. Grep for the specific phase, trigger path, or table you're working on. |
| [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md) | ~18k tokens | Supabase table/column ownership. Grep for the table or column name you need. |
| [docs/DECISIONS.md](docs/DECISIONS.md) | ~31k tokens | Why non-obvious choices were made. **Before "fixing" something that looks wrong, grep this file for the relevant topic.** |
| [docs/FOLLOWUPS.md](docs/FOLLOWUPS.md) | — | The sized backlog. |

These documents are the source of truth:

- If a phase responsibility changes, update **PIPELINE.md** in the same commit.
- If a non-obvious choice is made, add an entry to **DECISIONS.md**.
- If a table, column, edge function, or sync pattern changes, update **DATA_CONTRACT.md** in the same commit.

Stale documentation causes bugs in future sessions.

## Deployment

| Repo | Platform | GitHub | Trigger |
|------|----------|--------|---------|
| this repo | **Railway** | `disruptDevWS/forge-os-pipeline` | auto-deploy on push to `main` (Dockerfile.railway) |
| `lovable-repo/` | **Vercel** | `disruptDevWS/forge-os-lovable` | auto-deploy on push to `main` (vercel.json SPA rewrite) |

- Railway runs the pipeline HTTP server on **port 3847**. Supabase Edge Functions POST to it.
- Vercel serves the static React SPA. All routes rewrite to `/` for React Router.
- Railway uses the **Railpack** builder — use `railpack.json`, **NOT** `nixpacks.toml`.
- Google API auth is **service-account impersonation**, not OAuth refresh tokens.
- Favicons and static assets referenced from HTML must be tracked in git or embedded as base64 to display on Vercel.

## Conventions

- This repo is **ESM** (`"type": "module"`). Imports use `.js` extensions.
- Run `npx tsc --noEmit` and build verification after multi-file TypeScript changes, before committing. Watch for: curly quote characters in strings, non-existent column/enum references in Supabase types, and invalid status enum values.
- When parsing `service_area` or similar user-supplied fields, do **not** naively split on commas — validate tokens against expected patterns.
- Audit artifacts go to `audits/{domain}/` (Railway volume; local copies untracked). Never commit client artifacts.

## Live database access

Verified 2026-07-04: `supabase db query` does **not** exist in the installed CLI (v2.75.0) and no `SUPABASE_DB_PASSWORD` is on file. Use the Management API:

```bash
TOKEN=$(cat ~/.supabase/access-token)
curl -s -X POST "https://api.supabase.com/v1/projects/hohuimkcpihdufunrzvg/database/query" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "<sql>"}'
```

Use **curl** — other HTTP clients may be Cloudflare-blocked. Tokens are short-lived (Matt issues 1-day and 7-day temps); if it 401s, ask him for a fresh one and `supabase login --token sbp_...`.

## SQL and migrations

- **Before writing any SQL migration**, run a live verification query against the database confirming that every referenced table, column, enum, function and **RLS policy** actually exists. The live schema has known drift from the migration files (policies added via the SQL editor). Never assume a database object exists from a plan or from code. **Show me the verification query output before writing the migration SQL.**
- Convention: sequential `scripts/migrations/NNN-name.sql` with a matching `-rollback.sql`, executed via the Management API above.
- **After running a migration**, verify the new columns/tables/policies exist with a confirmation query.

## Session end

Run `/wrap`, then additionally update the three contract docs for anything this session changed: **PIPELINE.md** for any changed phase, trigger path, Supabase write, CLI flag, external API, mode, threshold or data flow; **DECISIONS.md** for non-obvious architectural choices; **DATA_CONTRACT.md** for new or changed tables, columns, edge functions or sync patterns.
