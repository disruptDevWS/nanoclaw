/**
 * schema-diff.ts — Mechanical verification that a proposed @graph replacement
 * preserves the live schema (page-audit deliverable contract).
 *
 * "Complete replacement" is only a safe copy-paste artifact if it is a verified
 * superset of everything currently correct. The LLM is INSTRUCTED to carry every
 * valid current property forward, but preservation must not be prompt-asserted
 * (see DECISIONS.md 2026-07-05) — this module computes the actual entity-by-entity,
 * property-by-property diff in code. Removals surface in the dashboard as
 * warnings requiring human sign-off before paste.
 *
 * Matching: entities are keyed by normalized @id when present, else by @type.
 * Values compare by normalized JSON (key-order-insensitive).
 */

export interface SchemaPropertyChange {
  /** "<EntityLabel>.<property>" */
  path: string;
  current: unknown;
  proposed?: unknown;
}

export interface SchemaDiff {
  preserved: string[];
  added: string[];
  modified: SchemaPropertyChange[];
  /** Properties (or whole entities) present in the live schema but absent from
   * the proposal — each one is a potential silent regression. */
  removed: SchemaPropertyChange[];
  current_entity_count: number;
  proposed_entity_count: number;
}

interface FlatEntity {
  key: string;    // match key: @id (normalized) or @type
  label: string;  // display: Type (name-or-id)
  props: Map<string, unknown>;
}

/** Walk JSON-LD blocks / @graph arrays and collect every typed entity. */
function flattenEntities(input: unknown): FlatEntity[] {
  const out: FlatEntity[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj['@graph'])) {
      for (const item of obj['@graph'] as unknown[]) visit(item);
    }
    if (obj['@type'] !== undefined) {
      const type = Array.isArray(obj['@type']) ? (obj['@type'] as unknown[]).join('+') : String(obj['@type']);
      const id = obj['@id'] != null ? normalizeId(String(obj['@id'])) : null;
      const name = typeof obj['name'] === 'string' ? (obj['name'] as string) : null;
      const props = new Map<string, unknown>();
      for (const [k, v] of Object.entries(obj)) {
        if (k === '@context' || k === '@graph') continue;
        props.set(k, v);
      }
      out.push({
        key: id ?? `type:${type}`,
        label: `${type}(${id ?? name ?? '?'})`,
        props,
      });
    }
  };
  visit(input);
  return out;
}

/** @id fragments are often absolute-vs-relative or trailing-slash variants of
 * the same identifier — compare on host+path+fragment, lowercased. */
function normalizeId(id: string): string {
  try {
    const u = new URL(id);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.hash}`.toLowerCase();
  } catch {
    return id.toLowerCase();
  }
}

/** Key-order-insensitive value comparison; nested @id references normalize. */
function normalizeValue(v: unknown): string {
  if (Array.isArray(v)) return JSON.stringify(v.map((x) => normalizeValue(x)).sort());
  if (v !== null && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return JSON.stringify(keys.map((k) => [k, k === '@id' ? normalizeId(String(obj[k])) : normalizeValue(obj[k])]));
  }
  return JSON.stringify(v);
}

/** Truncate stored values so the diff stays a readable artifact, not a dump. */
function forStorage(v: unknown): unknown {
  const s = JSON.stringify(v);
  return s && s.length > 400 ? `${s.slice(0, 400)}… (truncated)` : v;
}

export function diffJsonLd(currentBlocks: unknown[], proposed: unknown): SchemaDiff {
  const current = flattenEntities(currentBlocks);
  const next = flattenEntities(proposed);

  // Index proposed entities: by key, with a by-type fallback pool for entities
  // whose @id changed (common when the proposal introduces canonical IRIs).
  const nextByKey = new Map<string, FlatEntity>();
  const nextByType = new Map<string, FlatEntity[]>();
  for (const e of next) {
    if (!nextByKey.has(e.key)) nextByKey.set(e.key, e);
    const type = e.label.split('(')[0];
    if (!nextByType.has(type)) nextByType.set(type, []);
    nextByType.get(type)!.push(e);
  }

  const diff: SchemaDiff = {
    preserved: [],
    added: [],
    modified: [],
    removed: [],
    current_entity_count: current.length,
    proposed_entity_count: next.length,
  };

  const matchedNext = new Set<FlatEntity>();

  for (const cur of current) {
    const type = cur.label.split('(')[0];
    const match =
      nextByKey.get(cur.key) ??
      (nextByType.get(type) ?? []).find((e) => !matchedNext.has(e)) ??
      null;

    if (!match) {
      // Whole entity dropped
      diff.removed.push({ path: `${cur.label}`, current: forStorage(Object.fromEntries(cur.props)) });
      continue;
    }
    matchedNext.add(match);

    for (const [prop, curVal] of cur.props) {
      if (prop === '@id') continue; // ID relocation is expected; entity matching already handled it
      const path = `${cur.label}.${prop}`;
      if (!match.props.has(prop)) {
        diff.removed.push({ path, current: forStorage(curVal) });
      } else if (normalizeValue(curVal) !== normalizeValue(match.props.get(prop))) {
        diff.modified.push({ path, current: forStorage(curVal), proposed: forStorage(match.props.get(prop)) });
      } else {
        diff.preserved.push(path);
      }
    }

    for (const prop of match.props.keys()) {
      if (prop !== '@id' && !cur.props.has(prop)) diff.added.push(`${cur.label}.${prop}`);
    }
  }

  // Entirely new entities in the proposal
  for (const e of next) {
    if (!matchedNext.has(e) && !current.some((c) => c.key === e.key)) {
      diff.added.push(`${e.label} (new entity)`);
    }
  }

  return diff;
}
