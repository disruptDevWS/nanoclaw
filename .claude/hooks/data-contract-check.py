#!/usr/bin/env python3
"""
PreToolUse hook: inject DATA_CONTRACT.md context when editing files
that reference Supabase tables, disk artifacts, or edge functions.

Reads the full file being edited, detects table/artifact references,
extracts relevant sections from DATA_CONTRACT.md, and returns them
as additionalContext in the hook response JSON.

Advisory only — never blocks (no exit code 2).
"""

import json
import os
import re
import sys

# Resolve DATA_CONTRACT.md relative to the repo this hook now lives in.
# Prefer $CLAUDE_PROJECT_DIR (set by Claude Code); fall back to walking up
# from this file: .claude/hooks/ -> .claude/ -> <repo root>.
_HERE = os.path.dirname(os.path.abspath(__file__))
_PROJECT_DIR = os.environ.get("CLAUDE_PROJECT_DIR") or os.path.normpath(
    os.path.join(_HERE, "..", "..")
)
DATA_CONTRACT_PATH = os.path.join(_PROJECT_DIR, "docs", "DATA_CONTRACT.md")

MAX_CONTEXT_CHARS = 4000

# Known artifact filenames that indicate disk artifact usage
ARTIFACT_FILENAMES = [
    "strategy_brief.md",
    "ranked_keywords.json",
    "research_summary.md",
    "AUDIT_REPORT.md",
    "architecture_blueprint.md",
    "scope.json",
    "prospect-narrative.md",
    "internal_all.csv",
    "gsc_data.json",
    "gsc_summary.md",
    "prospect-config.json",
    "client-context.json",
]


def read_file_safe(path: str) -> str:
    """Read a file, returning empty string on any error."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except (OSError, IOError):
        return ""


def parse_sections(contract_text: str) -> list[tuple[str, str, int]]:
    """
    Parse DATA_CONTRACT.md into sections.
    Returns list of (heading_text, section_content, heading_level).
    heading_text includes the markdown prefix (e.g., "### `audits`").
    section_content is everything from the heading to the next heading of ANY level.
    """
    lines = contract_text.split("\n")
    # First pass: find all heading positions
    headings: list[tuple[int, int, str]] = []  # (line_idx, level, heading_text)
    for i, line in enumerate(lines):
        m = re.match(r"^(#{2,4})\s+(.+)$", line)
        if m:
            headings.append((i, len(m.group(1)), line))

    sections = []
    for idx, (line_idx, level, heading) in enumerate(headings):
        # Content runs from this heading to the next heading (exclusive)
        if idx + 1 < len(headings):
            end_idx = headings[idx + 1][0]
        else:
            end_idx = len(lines)
        content = "\n".join(lines[line_idx:end_idx])
        sections.append((heading, content, level))

    return sections


def extract_table_name_from_heading(heading: str) -> str | None:
    """Extract table name from heading like '### `audit_keywords`'."""
    m = re.search(r"`([a-z_]+)`", heading)
    return m.group(1) if m else None


def find_supabase_tables(source: str) -> tuple[set[str], set[str]]:
    """
    Find Supabase table references in source code.
    Returns (write_tables, read_tables).
    """
    write_tables: set[str] = set()
    read_tables: set[str] = set()

    # JS/TS: .from('table') or .from("table")
    from_matches = re.findall(r"""\.from\(\s*['"]([a-z_]+)['"]\s*\)""", source)

    for table in from_matches:
        # Check if followed by write operations in the same vicinity
        # Build a pattern that looks for .from('table').<write_op>
        write_pattern = rf"""\.from\(\s*['"]{re.escape(table)}['"]\s*\)\s*\.\s*(insert|upsert|update|delete)"""
        if re.search(write_pattern, source):
            write_tables.add(table)
        else:
            read_tables.add(table)

    # SQL: CREATE TABLE, ALTER TABLE, INSERT INTO, UPDATE, DELETE FROM
    sql_write_patterns = [
        r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?[`\"']?([a-z_]+)",
        r"ALTER\s+TABLE\s+(?:public\.)?[`\"']?([a-z_]+)",
        r"INSERT\s+INTO\s+(?:public\.)?[`\"']?([a-z_]+)",
        r"UPDATE\s+(?:public\.)?[`\"']?([a-z_]+)",
        r"DELETE\s+FROM\s+(?:public\.)?[`\"']?([a-z_]+)",
        r"DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?[`\"']?([a-z_]+)",
    ]
    for pattern in sql_write_patterns:
        for match in re.findall(pattern, source, re.IGNORECASE):
            write_tables.add(match.lower())

    # SQL: SELECT ... FROM
    sql_read_pattern = r"SELECT\s+.+?\s+FROM\s+(?:public\.)?[`\"']?([a-z_]+)"
    for match in re.findall(sql_read_pattern, source, re.IGNORECASE | re.DOTALL):
        table = match.lower()
        if table not in write_tables:
            read_tables.add(table)

    # Remove read entries that are also write (write takes precedence)
    read_tables -= write_tables

    return write_tables, read_tables


def find_artifact_refs(source: str) -> bool:
    """Check if source references disk artifacts."""
    if "resolveArtifactPath" in source:
        return True
    if re.search(r"""audits/[^'"}\s]+/""", source):
        return True
    for filename in ARTIFACT_FILENAMES:
        if filename in source:
            return True
    return False


def build_context(
    file_path: str,
    source: str,
    sections: list[tuple[str, str, int]],
) -> str:
    """Build the context string from detected references."""
    parts: list[str] = []

    # --- Path A: Supabase tables ---
    write_tables, read_tables = find_supabase_tables(source)

    # Build table->section map
    table_sections: dict[str, str] = {}
    for heading, content, level in sections:
        table_name = extract_table_name_from_heading(heading)
        if table_name:
            table_sections[table_name] = content

    # Write tables first (highest priority), then read tables
    for table in sorted(write_tables):
        if table in table_sections:
            parts.append(table_sections[table])

    for table in sorted(read_tables):
        if table in table_sections:
            parts.append(table_sections[table])

    # --- Path B: Disk artifacts ---
    if find_artifact_refs(source):
        for heading, content, level in sections:
            if "Disk Artifacts" in heading:
                parts.append(content)
                break

    # --- Path C: Special paths ---
    if "supabase/functions/" in file_path:
        for heading, content, level in sections:
            if "Edge Functions" in heading:
                parts.append(content)
                break

    if "migration" in file_path.lower() or file_path.endswith(".sql"):
        for heading, content, level in sections:
            if "Column Name Mismatches" in heading:
                parts.append(content)
                break

    if not parts:
        return ""

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_parts: list[str] = []
    for part in parts:
        if part not in seen:
            seen.add(part)
            unique_parts.append(part)

    header = "[DATA CONTRACT] Tables/artifacts referenced in this file:\n\n"
    result = header + "\n---\n".join(unique_parts)

    if len(result) > MAX_CONTEXT_CHARS:
        truncated = result[: MAX_CONTEXT_CHARS - 80]
        # Cut at last complete line
        last_newline = truncated.rfind("\n")
        if last_newline > len(header):
            truncated = truncated[:last_newline]
        truncated += (
            "\n\n... truncated. See forge-os-pipeline/docs/DATA_CONTRACT.md for full details."
        )
        result = truncated

    return result


def main() -> None:
    try:
        raw = sys.stdin.read()
        event = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)

    tool_input = event.get("tool_input", {})
    file_path = tool_input.get("file_path", "")

    if not file_path:
        sys.exit(0)

    # Read the full file being edited (may be empty for new files)
    source = read_file_safe(file_path)

    # For Write tool, also use the content being written (covers new file creation)
    write_content = tool_input.get("content", "")
    if write_content:
        source = source + "\n" + write_content if source else write_content

    # Path C can match on file_path alone, so don't bail on empty source yet
    has_path_match = (
        "supabase/functions/" in file_path
        or "migration" in file_path.lower()
        or file_path.endswith(".sql")
    )
    if not source and not has_path_match:
        sys.exit(0)

    # Read DATA_CONTRACT.md
    contract_path = os.path.normpath(DATA_CONTRACT_PATH)
    contract_text = read_file_safe(contract_path)
    if not contract_text:
        sys.exit(0)

    sections = parse_sections(contract_text)
    context = build_context(file_path, source, sections)

    if not context:
        # No matches — exit silently (no JSON = no context injected)
        sys.exit(0)

    # Output hook response. additionalContext MUST be nested inside
    # hookSpecificOutput alongside hookEventName -- a bare top-level
    # {"additionalContext": ...} is not valid and is silently discarded.
    response = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "additionalContext": context,
        }
    }
    print(json.dumps(response))


if __name__ == "__main__":
    main()
