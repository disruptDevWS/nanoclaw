# Agent Prompts

Extracted system prompts for pipeline agents. Follows the pattern established by Oscar (`configs/oscar/seo-playbook.md`).

## Structure

```
configs/agents/{agent-name}/system-prompt.md
```

Each file contains the agent's identity and instructions with `{{PLACEHOLDER}}` markers for runtime data injection. The pipeline loads these via `fs.readFileSync()` and replaces placeholders with `.replace()` / `.replaceAll()`.

## Extracted Agents

| Agent | Prompt File | Placeholders | Notes |
|-------|-------------|-------------|-------|
| Dwight | `dwight/system-prompt.md` | 12 | Technical SEO auditor — crawl analysis |
| Gap | `gap/system-prompt.md` | 10 | Competitive gap analysis |
| QA | `qa/system-prompt.md` | 4 | Quality evaluation rubric |
| Keyword Research | `keyword-research/system-prompt.md` | 6 | Keyword synthesis prompt |
| Strategy Brief | `strategy-brief/system-prompt.md` | 10 | Phase 1b strategic framing — entity authority directive |
| Michael | `michael/system-prompt.md` | 8 | Entity-authority architecture blueprint — coverage_role column, entity relationship map |
| Pam | `pam/system-prompt.md` | 30+ | Content brief synthesizer — entity-first context ordering, visibility queries, information gain directive |

## Inline Agents (not yet extracted)

| Agent | Reason |
|-------|--------|
| Jim | ~30 interpolations, multiple conditional context blocks |
| Competitors | Per-chunk dynamic prompt, minor extraction value |
| Scout | DataForSEO orchestrator — no LLM prompt |

## Placeholder Convention

- Use `{{UPPER_SNAKE_CASE}}` for all placeholders
- Placeholders that appear multiple times in a template are replaced with `.replaceAll()`
- Single-occurrence placeholders use `.replace()`
- Conditional sections (e.g., Section 12 in Dwight) are pre-computed before replacement

## Multi-File Prompt Contracts — Pre-Flight Check

Oscar's prompt is assembled from TWO files: `configs/oscar/system-prompt.md` AND `configs/oscar/seo-playbook.md`. When they conflict, the more permissive instruction wins (an explicit "ignore X" overrides a binding directive added to the other file). Before changing any Oscar directive, grep BOTH files for standing language on the same topic (length, links, schema, structure, tone) and reconcile contradictions explicitly — add the exception to the overriding language, don't just add the new rule. (Caught live 2026-06-12: the playbook's binding BoF word-count ceiling was silently defeated by the system prompt's "ignore word counts" — see DECISIONS.md.) The same risk applies to any future agent whose prompt spans multiple config files.
