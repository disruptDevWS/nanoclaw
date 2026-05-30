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

## Inline Agents (not yet extracted)

| Agent | Reason |
|-------|--------|
| Jim | ~30 interpolations, multiple conditional context blocks |
| Michael | ~40% static, deeply coupled to re-run/sales/geo logic |
| Competitors | Per-chunk dynamic prompt, minor extraction value |
| Scout | DataForSEO orchestrator — no LLM prompt |

## Placeholder Convention

- Use `{{UPPER_SNAKE_CASE}}` for all placeholders
- Placeholders that appear multiple times in a template are replaced with `.replaceAll()`
- Single-occurrence placeholders use `.replace()`
- Conditional sections (e.g., Section 12 in Dwight) are pre-computed before replacement
