#!/usr/bin/env python3
"""Build bounded, reproducible D1 import batches from the pinned source SQLite.

This adapter reads the repository's documented schema; it does not vendor or
modify the upstream indexer. Original section text, IDs and hashes are retained.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from bisect import bisect_right
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "manual-corpus-1"
ADAPTER = "seoguipowelfare-schema6-adapter-1"
REPOSITORY = "https://gitlab.aigov.go.kr/memory365/seoguipowelfare"
MAX_BATCH_BYTES = 600_000
MAX_BATCH_ROWS = 180


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encoded(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def save_json(filename: Path, value: object) -> None:
    filename.parent.mkdir(parents=True, exist_ok=True)
    filename.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-db", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True, help="Pinned repository containing the source directory")
    parser.add_argument("--source-directory", default="source-md", help="Tracked Markdown directory within the pinned repository")
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--output-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--created-at", help="Reuse the recorded timestamp when reproducing a pack")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.source_directory):
        raise ValueError("The source directory must be one repository-relative directory")
    if not re.fullmatch(r"[0-9a-f]{40}", args.source_commit):
        raise ValueError("A full, verified source commit is required")
    revision = "sgw-" + args.source_commit[:12] + "-v1"
    root = args.output_root.resolve()
    manifest_path = root / "data/manual-corpus/manifest.json"
    created_at = args.created_at
    if not created_at and manifest_path.exists():
        old = json.loads(manifest_path.read_text(encoding="utf-8"))
        if old.get("revision") == revision:
            created_at = old["created_at"]
    created_at = created_at or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    conn = sqlite3.connect(args.source_db.resolve().as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    if conn.execute("PRAGMA user_version").fetchone()[0] != 6:
        raise ValueError("Only inspected upstream schema 6 is supported")
    if conn.execute("PRAGMA quick_check").fetchall()[0][0] != "ok":
        raise ValueError("Source SQLite integrity check failed")
    documents: list[dict] = []
    ids: dict[str, str] = {}
    original_markers: dict[str, list[tuple[int, str]]] = {}
    source_bytes = 0
    image_references = 0
    for row in conn.execute("SELECT * FROM documents ORDER BY source_name"):
        name = row["source_name"]
        if Path(name).name != name or not name.endswith(".md"):
            raise ValueError("Unexpected source name: " + name)
        source_path = args.source_directory + "/" + name
        source = (args.source_root / source_path).read_bytes()
        if len(source) != row["byte_size"] or sha256(source) != row["sha256"]:
            raise ValueError("Source Markdown hash differs from indexed document: " + name)
        source_bytes += len(source)
        image_references += len(re.findall(r"!\[[^\]]*\]\([^\n]+\)", source.decode("utf-8")))
        original_markers[name] = []
        fenced = False
        for line_number, line in enumerate(source.decode("utf-8").splitlines(), 1):
            if re.match(r"^\s*(```|~~~)", line):
                fenced = not fenced
            match = re.match(r"^#{1,6}\s+원본\s+파일\s*:\s*(.+?)\s*$", line)
            if match and not fenced:
                original_markers[name].append((line_number, match.group(1)))
        document_id = "md-" + sha256(name.encode("utf-8"))[:20]
        ids[name] = document_id
        documents.append({
            "document_id": document_id, "source_name": name, "source_path": source_path,
            "sha256": row["sha256"], "byte_size": row["byte_size"],
            "document_year": str(row["year"]) if re.fullmatch(r"20\d{2}", str(row["year"] or "")) else None,
            **{field: row[field] for field in ("category", "document_type", "publisher", "edition", "effective_from", "effective_to", "topic", "authority", "source_role", "jurisdiction", "section_count")},
        })
    actual_sections = conn.execute("SELECT COUNT(*) FROM sections").fetchone()[0]
    if sum(doc["section_count"] for doc in documents) != actual_sections:
        raise ValueError("Document section counts do not match the actual section table")
    for row in conn.execute("SELECT source_name, COUNT(*) AS n FROM sections GROUP BY source_name"):
        doc = next(doc for doc in documents if doc["source_name"] == row["source_name"])
        if row["n"] != doc["section_count"]:
            raise ValueError("Per-document section count mismatch")

    # Logical manifest paths stay stable; plaintext batches are local build inputs.
    batch_dir = root / "data/manual-corpus/assets/__manual_corpus" / revision
    batch_dir.mkdir(parents=True, exist_ok=True)
    descriptors: list[dict] = []

    def write_batch(doc_rows: list[dict], section_rows: list[dict]) -> None:
        index = len(descriptors)
        payload = {"schema_version": SCHEMA, "revision": revision, "batch_index": index, "documents": doc_rows, "sections": section_rows}
        data = encoded(payload)
        if len(data) > 1_048_576 or len(doc_rows) + len(section_rows) > 200:
            raise ValueError("A batch exceeds the bounded import contract")
        name = f"batch-{index:04d}.json"
        (batch_dir / name).write_bytes(data)
        descriptors.append({"path": f"/__manual_corpus/{revision}/{name}", "sha256": sha256(data), "bytes": len(data), "documents": len(doc_rows), "sections": len(section_rows)})

    write_batch(documents, [])
    pending: list[dict] = []
    pending_bytes = 200
    largest_section_bytes = 0
    mismatched_year_sections = 0
    original_name_corrections = 0
    mixed_original_sections: list[dict] = []
    # Read in original document/section order. Repeated text is retained because
    # source location, table notes and edition can differ even when words match.
    for row in conn.execute("SELECT * FROM sections ORDER BY source_name, ordinal"):
        if sha256(row["content"].encode("utf-8")) != row["content_hash"]:
            raise ValueError("Source section content hash mismatch: " + row["section_id"])
        markers = original_markers[row["source_name"]]
        marker_lines = [marker[0] for marker in markers]
        before = bisect_right(marker_lines, row["start_line"]) - 1
        relevant = ([markers[before]] if before >= 0 else []) + [marker for marker in markers if row["start_line"] < marker[0] <= row["end_line"]]
        unique_names = set(marker[1] for marker in relevant)
        corrected_name = row["original_name"]
        origin_basis = "upstream_metadata"
        origin_line = None
        if len(unique_names) == 1:
            corrected_name = relevant[0][1]
            origin_basis = "explicit_original_file_marker"
            origin_line = relevant[0][0]
        elif len(unique_names) > 1:
            origin_basis = "mixed_original_files"
            mixed_original_sections.append({"section_id": row["section_id"], "source_name": row["source_name"], "start_line": row["start_line"], "end_line": row["end_line"], "original_markers": relevant})
        if corrected_name != row["original_name"]:
            original_name_corrections += 1
        section = {
            "section_id": row["section_id"], "document_id": ids[row["source_name"]],
            "ordinal": row["ordinal"], "node_id": row["node_id"], "title": row["title"],
            "heading_path": row["headings"], "service_names": row["service_names"],
            "original_name": corrected_name, "upstream_original_name": row["original_name"],
            "original_name_basis": origin_basis, "original_name_line": origin_line,
            "start_line": row["start_line"],
            "end_line": row["end_line"], "content": row["content"], "content_hash": row["content_hash"],
        }
        size = len(encoded(section))
        largest_section_bytes = max(largest_section_bytes, size)
        if pending and (pending_bytes + size > MAX_BATCH_BYTES or len(pending) >= MAX_BATCH_ROWS):
            write_batch([], pending)
            pending = []
            pending_bytes = 200
        pending.append(section)
        pending_bytes += size
        document_year = re.search(r"20\d{2}", row["source_name"])
        original_year = re.search(r"20\d{2}", corrected_name) if origin_basis != "mixed_original_files" else None
        if document_year and original_year and document_year.group() != original_year.group():
            mismatched_year_sections += 1
    if pending:
        write_batch([], pending)

    manifest = {"schema_version": SCHEMA, "revision": revision, "source_commit": args.source_commit,
                "source_repository": REPOSITORY, "created_at": created_at,
                "document_count": len(documents), "section_count": actual_sections, "batches": descriptors}
    save_json(manifest_path, manifest)
    save_json(root / "data/manual-corpus/catalog.json", {"revision": revision, "documents": documents})
    quality = [dict(row) for row in conn.execute("SELECT severity, issue_code, COUNT(*) AS count FROM quality_issues GROUP BY severity, issue_code ORDER BY severity, issue_code")]
    audit = {
        "adapter": ADAPTER, "source_repository": REPOSITORY, "source_commit": args.source_commit,
        "source_sqlite_schema": 6, "source_sqlite_sha256": sha256(args.source_db.read_bytes()),
        "sqlite_integrity": "ok", "source_document_hashes_verified": len(documents),
        "section_content_hashes_verified": actual_sections, "source_document_bytes": source_bytes,
        "documents": len(documents), "sections": actual_sections,
        "source_nodes": conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0],
        "batch_count": len(descriptors), "batch_bytes": sum(batch["bytes"] for batch in descriptors),
        "largest_batch_bytes": max(batch["bytes"] for batch in descriptors), "largest_section_json_bytes": largest_section_bytes,
        "internal_filename_year_differs_from_document_sections": mismatched_year_sections,
        "original_name_corrections_from_explicit_markers": original_name_corrections,
        "documents_with_original_file_markers": sum(bool(markers) for markers in original_markers.values()),
        "original_file_markers": sum(len(markers) for markers in original_markers.values()),
        "mixed_original_file_sections": mixed_original_sections,
        "markdown_image_reference_count": image_references, "image_content_available": False,
        "upstream_quality_issues": quality, "created_at": created_at,
        "provenance_notes": [
            "The upstream repository tracks parsed Markdown and indexer code, not the generated SQLite binary.",
            "Section IDs, content, hashes, upstream_original_name, heading paths and Markdown line bounds are retained.",
            "original_name is resolved from explicit source Markdown original-file markers across later H1 headings; the original indexer's value is retained separately with correction basis and marker line.",
            "Publisher, authority, jurisdiction and document dates are unverified source metadata, including indexer defaults.",
            "Document or internal filename years are not confirmed benefit eligibility/application years.",
            "Parsed Markdown line numbers are not physical PDF page numbers; image bodies are absent.",
            "Facility directory material is retained with original index/metadata source roles; it is not a benefit eligibility manual.",
            "Original full files are not exposed through the public app. MCP returns bounded source excerpts.",
        ],
    }
    save_json(root / "data/manual-corpus/import-audit.json", audit)
    conn.close()
    manifest_ts = root / "lib/manuals/manifest.ts"
    manifest_ts.parent.mkdir(parents=True, exist_ok=True)
    manifest_ts.write_text(
        '// Generated by scripts/manuals/build-corpus-pack.py. Reviewed, deployment-pinned input only.\n'
        'import manifest from "../../data/manual-corpus/manifest.json" with { type: "json" };\n'
        'import type { ManualCorpusManifest } from "./types.ts";\n\n'
        'export const MANUAL_CORPUS_MANIFEST = manifest as ManualCorpusManifest;\n', encoding="utf-8")
    print(json.dumps({"revision": revision, "documents": len(documents), "sections": actual_sections, "batches": len(descriptors), "bytes": audit["batch_bytes"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
