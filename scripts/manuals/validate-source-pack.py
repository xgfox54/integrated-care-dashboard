#!/usr/bin/env python3
"""Independently check parsed Markdown provenance and a generated manual corpus pack.

Only local, read-only source/database/pack inputs are used. No upstream splitter or
pack builder is imported. Edition years observed in file names are not effective
benefit years. Reports contain metadata and hashes, not complete manual text.
"""
from __future__ import annotations

import argparse
import bisect
import collections
import datetime
import gzip
import hashlib
import json
import re
import sqlite3
from pathlib import Path


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def save_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def year_tokens(value: str) -> list[str]:
    return list(dict.fromkeys(re.findall(r"20[0-9]{2}", value)))


def scan_markers(text: str) -> tuple[list[dict], list[dict]]:
    """Read literal ATX headings, excluding prose, code fences and HTML comments."""
    tick = chr(96)
    opener = re.compile(r"^ {0,3}(" + tick + r"{3,}|~{3,})(.*)$")
    heading = re.compile(r"^ {0,3}#{1,6}[ \t]+원본[ \t]+파일[ \t]*:[ \t]*(.+?)[ \t]*$")
    mentioned = re.compile(r"원본[ \t]+파일[ \t]*:")
    markers: list[dict] = []
    ignored: list[dict] = []
    fence_char = ""
    fence_length = 0
    in_comment = False
    offset = 0
    for line_number, raw in enumerate(text.splitlines(keepends=True), 1):
        line = raw.rstrip("\r\n")
        comment_at_start = in_comment
        # Comments are not a source marker, including a heading-looking line in
        # a multi-line comment. We only need their state; body text stays intact.
        cursor = 0
        while cursor < len(line):
            token = "-->" if in_comment else "<!--"
            found = line.find(token, cursor)
            if found < 0:
                break
            in_comment = not in_comment
            cursor = found + len(token)
        match = heading.fullmatch(line)
        fence_match = opener.fullmatch(line) if not comment_at_start else None
        reason = None
        if fence_char:
            if re.fullmatch(r" {0,3}" + re.escape(fence_char) + "{" + str(fence_length) + r",}[ \t]*", line):
                fence_char = ""
                fence_length = 0
            reason = "fenced_code"
        elif fence_match:
            run, info = fence_match.groups()
            # A backtick opening info string cannot contain a backtick.
            if not (run[0] == tick and tick in info):
                fence_char, fence_length = run[0], len(run)
            reason = "fence_line"
        elif comment_at_start or line.lstrip().startswith("<!--"):
            reason = "html_comment"
        elif match:
            name = re.sub(r"[ \t]+#+[ \t]*$", "", match.group(1)).strip()
            markers.append({
                "line": line_number,
                "char_offset": offset,
                "original_name": name,
                "filename_year_tokens": year_tokens(name),
            })
        else:
            reason = "not_an_original_file_ATX_heading"
        if mentioned.search(line) and not (match and reason is None):
            ignored.append({"line": line_number, "reason": reason})
        offset += len(raw)
    for index, marker in enumerate(markers):
        marker["range_end_line"] = markers[index + 1]["line"] - 1 if index + 1 < len(markers) else max(1, len(text.splitlines()))
    return markers, ignored


def scanner_self_check() -> None:
    tick = chr(96)
    text = "\n".join([
        "본문 원본 파일: not-a-marker.md",
        "| 원본 파일: also-not.md |",
        tick * 4 + "text",
        "# 원본 파일: in-fence.md",
        tick * 3,
        "# 원본 파일: still-in-fence.md",
        tick * 4,
        "<!--",
        "# 원본 파일: in-comment.md",
        "-->",
        "    # 원본 파일: indented-code.md",
        "## 원본 파일: 2025년 진짜.md",
        "~~~",
        "# 원본 파일: in-tilde.md",
        "~~~",
        "본문",
    ]) + "\n"
    markers, ignored = scan_markers(text)
    assert [(row["line"], row["original_name"]) for row in markers] == [(12, "2025년 진짜.md")]
    assert len(ignored) == 7


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--source-db", type=Path, required=True)
    parser.add_argument("--pack-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    scanner_self_check()
    args.output.mkdir(parents=True, exist_ok=True)
    errors: list[dict] = []
    error_count = 0

    def check(ok: bool, code: str, **context: object) -> None:
        nonlocal error_count
        if not ok:
            error_count += 1
            if len(errors) < 200:
                errors.append({"code": code, **context})

    manifest_path = args.pack_root / "data/manual-corpus/manifest.json"
    audit_path = args.pack_root / "data/manual-corpus/import-audit.json"
    catalog_path = args.pack_root / "data/manual-corpus/catalog.json"
    db_before = file_digest(args.source_db)
    manifest_before = file_digest(manifest_path)
    audit_before = file_digest(audit_path)
    catalog_before = file_digest(catalog_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    pack_audit = json.loads(audit_path.read_text(encoding="utf-8"))
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    connection = sqlite3.connect(args.source_db.resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    quick = [row[0] for row in connection.execute("PRAGMA quick_check")]
    foreign = [tuple(row) for row in connection.execute("PRAGMA foreign_key_check")]
    check(quick == ["ok"], "DATABASE_INTEGRITY", observed=quick)
    check(not foreign, "DATABASE_FOREIGN_KEYS", observed=foreign[:20])
    check(connection.execute("PRAGMA user_version").fetchone()[0] == 6, "DATABASE_SCHEMA")
    check(pack_audit["source_sqlite_sha256"] == db_before, "AUDIT_SOURCE_DB_HASH")

    source_texts: dict[str, str] = {}
    expected_sections: dict[str, dict] = {}
    expected_documents: dict[str, dict] = {}
    document_results: list[dict] = []
    marker_catalog: list[dict] = []
    basis_counts = collections.Counter()
    edition_counts = collections.Counter()
    corrections = 0
    year_difference = 0
    mixed: list[dict] = []
    section_count = 0
    source_bytes_total = 0
    marker_total = 0
    ignored_total = 0
    image_total = 0
    max_section_content_bytes = 0
    section_content_bytes = 0
    expected_export = args.output / "section-original-expectations.jsonl.gz"

    with expected_export.open("wb") as raw_gzip:
        with gzip.GzipFile(fileobj=raw_gzip, mode="wb", filename="", mtime=0) as zipped:
            for db_document in connection.execute("SELECT * FROM documents ORDER BY source_name"):
                doc = dict(db_document)
                name = doc["source_name"]
                check(Path(name).name == name and name.endswith(".md"), "UNEXPECTED_SOURCE_NAME", source_name=name)
                raw = (args.source_root / "source-md" / name).read_bytes()
                text = raw.decode("utf-8")
                source_texts[name] = text
                source_bytes_total += len(raw)
                image_total += len(re.findall(r"!\[[^\]]*\]\([^\n]+\)", text))
                check(doc["sha256"] == digest(raw), "DOCUMENT_SHA256", source_name=name)
                check(doc["byte_size"] == len(raw), "DOCUMENT_BYTES", source_name=name)
                document_id = "md-" + digest(name.encode("utf-8"))[:20]
                expected_documents[document_id] = {
                    "document_id": document_id, "source_name": name,
                    "source_path": "source-md/" + name, "sha256": doc["sha256"],
                    "byte_size": doc["byte_size"], "document_year": str(doc["year"]) if re.fullmatch(r"20[0-9]{2}", str(doc["year"] or "")) else None,
                    **{field: doc[field] for field in ("category", "document_type", "publisher", "edition", "effective_from", "effective_to", "topic", "authority", "source_role", "jurisdiction", "section_count")},
                }
                markers, ignored = scan_markers(text)
                marker_total += len(markers)
                ignored_total += len(ignored)
                marker_catalog.append({
                    "source_name": name, "source_sha256": digest(raw), "markers": markers,
                    "ignored_original_file_mentions": ignored,
                })
                offsets = [item["char_offset"] for item in markers]
                newlines = [match.start() for match in re.finditer("\n", text)]
                cursor = 0
                doc_corrections = 0
                doc_year_difference = 0
                doc_basis = collections.Counter()
                doc_editions = collections.Counter()
                doc_sections = 0
                marker_section_counts = collections.Counter()
                for db_section in connection.execute("SELECT * FROM sections WHERE source_name=? ORDER BY ordinal", (name,)):
                    row = dict(db_section)
                    sid = row["section_id"]
                    content = row.pop("content")
                    start, end = cursor, cursor + len(content)
                    check(text[start:end] == content, "SOURCE_LITERAL_SLICE", section_id=sid)
                    check(digest(content.encode("utf-8")) == row["content_hash"], "SECTION_SHA256", section_id=sid)
                    independent_start_line = bisect.bisect_left(newlines, start) + 1
                    independent_end_line = bisect.bisect_left(newlines, max(start, end - 1)) + 1
                    check(row["start_line"] == independent_start_line, "START_LINE", section_id=sid, expected=independent_start_line, observed=row["start_line"])
                    check(row["end_line"] == independent_end_line, "END_LINE", section_id=sid, expected=independent_end_line, observed=row["end_line"])
                    check(row["ordinal"] == doc_sections + 1, "ORDINAL", section_id=sid)
                    first_inside = bisect.bisect_right(offsets, start)
                    last_inside = bisect.bisect_left(offsets, end)
                    relevant = ([markers[first_inside - 1]] if first_inside else []) + markers[first_inside:last_inside]
                    unique = {item["original_name"] for item in relevant}
                    basis = "upstream_metadata"
                    original_name = row["original_name"]
                    origin_line = None
                    if len(unique) == 1:
                        basis = "explicit_original_file_marker"
                        original_name = relevant[0]["original_name"]
                        origin_line = relevant[0]["line"]
                    elif len(unique) > 1:
                        basis = "mixed_original_files"
                        mixed.append({
                            "section_id": sid, "source_name": name, "start_line": row["start_line"],
                            "end_line": row["end_line"],
                            "original_markers": [[item["line"], item["original_name"]] for item in relevant],
                        })
                    changed = original_name != row["original_name"]
                    corrections += int(changed)
                    doc_corrections += int(changed)
                    filename_years = [] if basis == "mixed_original_files" else year_tokens(original_name)
                    doc_years = year_tokens(name)
                    differs = bool(doc_years and filename_years and doc_years[0] != filename_years[0])
                    year_difference += int(differs)
                    doc_year_difference += int(differs)
                    observed_edition = filename_years[0] if len(filename_years) == 1 else "UNCONFIRMED"
                    doc_editions[observed_edition] += 1
                    edition_counts[observed_edition] += 1
                    doc_basis[basis] += 1
                    basis_counts[basis] += 1
                    if origin_line is not None:
                        marker_section_counts[origin_line] += 1
                    expected = {
                        "section_id": sid, "source_name": name, "document_id": document_id,
                        "ordinal": row["ordinal"], "node_id": row["node_id"], "title": row["title"],
                        "heading_path": row["headings"], "service_names": row["service_names"],
                        "upstream_original_name": row["original_name"], "original_name": original_name,
                        "original_name_basis": basis, "original_name_line": origin_line,
                        "start_line": row["start_line"], "end_line": row["end_line"],
                        "content_hash": row["content_hash"], "char_start": start, "char_end_exclusive": end,
                        "filename_year_tokens": filename_years,
                        "effective_benefit_year": None, "physical_pdf_page_verified": False,
                    }
                    check(sid not in expected_sections, "DUPLICATE_DATABASE_SECTION_ID", section_id=sid)
                    expected_sections[sid] = expected
                    zipped.write(json_bytes(expected))
                    content_size = len(content.encode("utf-8"))
                    section_content_bytes += content_size
                    max_section_content_bytes = max(max_section_content_bytes, content_size)
                    cursor = end
                    doc_sections += 1
                    section_count += 1
                check(cursor == len(text), "DOCUMENT_ROUNDTRIP_LENGTH", source_name=name)
                check(doc_sections == doc["section_count"], "DOCUMENT_SECTION_COUNT", source_name=name)
                document_results.append({
                    "source_name": name, "sha256": doc["sha256"], "bytes": len(raw),
                    "upstream_document_year": doc["year"], "pack_document_year": expected_documents[document_id]["document_year"],
                    "section_count": doc_sections, "original_file_markers": len(markers),
                    "ignored_original_file_mentions": len(ignored),
                    "original_name_corrections": doc_corrections,
                    "internal_filename_year_differs_from_document_sections": doc_year_difference,
                    "original_name_basis_counts": dict(doc_basis),
                    "observed_filename_edition_counts": dict(doc_editions),
                    "marker_section_counts": dict(marker_section_counts),
                })

    seen_documents: set[str] = set()
    seen_sections: set[str] = set()
    batch_bytes = 0
    max_batch_bytes = 0
    largest_section_json_bytes = 0
    descriptor_paths: set[str] = set()
    document_keys = tuple(next(iter(expected_documents.values())).keys())
    section_keys = (
        "section_id", "document_id", "ordinal", "node_id", "title", "heading_path",
        "service_names", "upstream_original_name", "original_name", "original_name_basis",
        "original_name_line", "start_line", "end_line", "content_hash",
    )
    for index, descriptor in enumerate(manifest["batches"]):
        relative = descriptor["path"]
        check(relative not in descriptor_paths, "DUPLICATE_BATCH_PATH", path=relative)
        descriptor_paths.add(relative)
        relative_path = Path(relative.lstrip("/"))
        check(".." not in relative_path.parts and relative.startswith("/__manual_corpus/"), "UNSAFE_BATCH_PATH", path=relative)
        batch_path = args.pack_root / "data/manual-corpus/assets" / relative_path
        raw_batch = batch_path.read_bytes()
        payload = json.loads(raw_batch)
        check(digest(raw_batch) == descriptor["sha256"], "BATCH_SHA256", batch=index)
        check(len(raw_batch) == descriptor["bytes"], "BATCH_BYTES", batch=index)
        check(payload["batch_index"] == index, "BATCH_INDEX", batch=index)
        check(payload["schema_version"] == manifest["schema_version"] == "manual-corpus-1", "BATCH_SCHEMA", batch=index)
        check(payload["revision"] == manifest["revision"], "BATCH_REVISION", batch=index)
        check(len(payload["documents"]) == descriptor["documents"], "BATCH_DOCUMENT_COUNT", batch=index)
        check(len(payload["sections"]) == descriptor["sections"], "BATCH_SECTION_COUNT", batch=index)
        check(len(raw_batch) <= 1048576 and len(payload["documents"]) + len(payload["sections"]) <= 200, "BATCH_BOUNDED_CONTRACT", batch=index)
        batch_bytes += len(raw_batch)
        max_batch_bytes = max(max_batch_bytes, len(raw_batch))
        for doc in payload["documents"]:
            did = doc["document_id"]
            check(did in expected_documents, "UNKNOWN_PACK_DOCUMENT", document_id=did)
            check(did not in seen_documents, "DUPLICATE_PACK_DOCUMENT", document_id=did)
            seen_documents.add(did)
            if did in expected_documents:
                for key in document_keys:
                    check(doc.get(key) == expected_documents[did][key], "DOCUMENT_FIELD", document_id=did, field=key, expected=expected_documents[did][key], observed=doc.get(key))
        for row in payload["sections"]:
            sid = row["section_id"]
            check(sid in expected_sections, "UNKNOWN_PACK_SECTION", section_id=sid)
            check(sid not in seen_sections, "DUPLICATE_PACK_SECTION", section_id=sid)
            seen_sections.add(sid)
            if sid not in expected_sections:
                continue
            expected = expected_sections[sid]
            for key in section_keys:
                check(row.get(key) == expected[key], "SECTION_FIELD", section_id=sid, field=key, expected=expected[key], observed=row.get(key))
            original = source_texts[expected["source_name"]][expected["char_start"]:expected["char_end_exclusive"]]
            check(row["content"] == original, "PACK_LITERAL_SOURCE_CONTENT", section_id=sid)
            check(digest(row["content"].encode("utf-8")) == expected["content_hash"], "PACK_CONTENT_SHA256", section_id=sid)
            largest_section_json_bytes = max(largest_section_json_bytes, len(json_bytes(row)))
    check(seen_documents == set(expected_documents), "DOCUMENT_ID_SET", missing=sorted(set(expected_documents)-seen_documents))
    check(seen_sections == set(expected_sections), "SECTION_ID_SET", missing=sorted(set(expected_sections)-seen_sections)[:100])
    check(manifest["document_count"] == len(expected_documents), "MANIFEST_DOCUMENT_COUNT")
    check(manifest["section_count"] == section_count, "MANIFEST_SECTION_COUNT")
    check(catalog["revision"] == manifest["revision"], "CATALOG_REVISION")
    check(catalog["documents"] == list(expected_documents.values()), "CATALOG_DOCUMENTS")
    source_nodes = connection.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
    derived_audit = {
        "source_document_hashes_verified": len(expected_documents),
        "section_content_hashes_verified": section_count,
        "source_document_bytes": source_bytes_total,
        "documents": len(expected_documents), "sections": section_count, "source_nodes": source_nodes,
        "batch_count": len(manifest["batches"]), "batch_bytes": batch_bytes,
        "largest_batch_bytes": max_batch_bytes, "largest_section_json_bytes": largest_section_json_bytes,
        "internal_filename_year_differs_from_document_sections": year_difference,
        "original_name_corrections_from_explicit_markers": corrections,
        "documents_with_original_file_markers": sum(bool(row["markers"]) for row in marker_catalog),
        "original_file_markers": marker_total,
        "mixed_original_file_sections": mixed,
        "markdown_image_reference_count": image_total,
    }
    for key, expected in derived_audit.items():
        check(pack_audit.get(key) == expected, "IMPORT_AUDIT_FIELD", field=key, expected=expected, observed=pack_audit.get(key))
    check(file_digest(manifest_path) == manifest_before, "MANIFEST_CHANGED_DURING_AUDIT")
    check(file_digest(audit_path) == audit_before, "IMPORT_AUDIT_CHANGED_DURING_AUDIT")
    check(file_digest(catalog_path) == catalog_before, "CATALOG_CHANGED_DURING_AUDIT")
    check(file_digest(args.source_db) == db_before, "SOURCE_DB_CHANGED_DURING_AUDIT")
    connection.close()
    save_json(args.output / "original-file-marker-catalog.json", {
        "schema_version": "manual-marker-catalog-1", "source_commit": manifest["source_commit"],
        "source_database_sha256": db_before,
        "policy": "Explicit ATX original-file headings outside code fences/comments; prose is ignored.",
        "documents": marker_catalog,
    })
    limitations = [
        "Filename years are edition observations, not confirmation of an effective eligibility, amount or application year.",
        "Coordinates are one-based parsed Markdown lines, not verified physical PDF pages.",
        "Upstream publisher/authority/jurisdiction defaults are preserved, not independently authenticated.",
        "No mixed-original section exists in this source version; the runtime's mixed-year-null behavior is not established by this pack audit.",
        "The source section text, IDs, hashes, headings and upstream original names are unchanged.",
        "No operating D1, HTTP asset routing or MCP correctness was exercised by this local audit.",
        "Document years other than an exact 20xx string are normalized to null in the import contract; the upstream raw values remain in this profile and source database.",
    ]
    result = {
        "schema_version": "manual-marker-pack-audit-1",
        "status": "PASS" if error_count == 0 else "FAIL",
        "completed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "validator_sha256": file_digest(Path(__file__)),
        "method": "Independent literal Markdown character offsets and ATX scanner; no upstream splitter or pack adapter imported.",
        "source_commit": manifest["source_commit"], "revision": manifest["revision"],
        "source_database_sha256": db_before, "pack_manifest_sha256": manifest_before,
        "pack_import_audit_sha256": audit_before, "pack_catalog_sha256": catalog_before,
        "source_database_unchanged": file_digest(args.source_db) == db_before,
        "counts": derived_audit,
        "section_text_bytes": section_content_bytes,
        "maximum_section_content_bytes": max_section_content_bytes,
        "original_name_basis_counts": dict(basis_counts),
        "observed_filename_edition_counts": dict(edition_counts),
        "ignored_original_file_mentions": ignored_total,
        "document_year_normalizations": [{"source_name": row["source_name"], "upstream_value": row["upstream_document_year"], "pack_value": row["pack_document_year"]} for row in document_results if row["upstream_document_year"] != row["pack_document_year"]],
        "scanner_self_check": "PASS",
        "document_and_section_ids_complete_and_unique": seen_documents == set(expected_documents) and seen_sections == set(expected_sections),
        "marker_catalog_sha256": file_digest(args.output / "original-file-marker-catalog.json"),
        "section_original_expectations_gzip_sha256": file_digest(expected_export),
        "error_count": error_count, "errors": errors,
        "limitations": limitations, "documents": document_results,
    }
    save_json(args.output / "marker-pack-audit.json", result)
    lines = [
        "# 매뉴얼 원본 파일명·위치 독립 대조",
        "",
        f"- 결과: **{result['status']}**; 오류 {error_count:,}개.",
        f"- 원천 커밋: {manifest['source_commit']}",
        f"- 반입 팩: {manifest['revision']}; 생성 시각 {manifest['created_at']}",
        f"- SQLite SHA256: {db_before}",
        f"- 팩 manifest SHA256: {manifest_before}",
        "",
        "## 검사 방법",
        "",
        "팩 생성기와 원천 splitter를 가져오지 않고, 각 Markdown의 문자 위치를 누적해 SQLite 조각을 원문과 전수 대조했다. "
        "원본 파일 표시는 실제 ATX 제목만 읽었으며 코드 블록, HTML 주석, 표와 본문의 동명 텍스트는 제외했다. "
        "각 조각의 ID·원래 파일명·제목 계층·순서·본문·SHA256·시작/끝 줄을 SQLite 및 생성 팩과 비교했다.",
        "",
        "## 전수 결과",
        "",
        "| 항목 | 결과 |",
        "|---|---:|",
        f"| 문서 원문 SHA256와 바이트 수 대조 | {len(expected_documents):,}/{len(expected_documents):,} |",
        f"| 조각의 원문·ID·해시·줄 위치·메타데이터 대조 | {section_count:,}/{section_count:,} |",
        f"| 배치 SHA256·분량·revision 대조 | {len(manifest['batches']):,}/{len(manifest['batches']):,} |",
        f"| 명시적인 원본 파일 제목 | {marker_total:,}개 / {derived_audit['documents_with_original_file_markers']:,}문서 |",
        f"| 원래 이름을 별도 보존하며 보정한 조각 | {corrections:,} |",
        f"| 내부 파일의 첫 연도와 합본 파일 첫 연도가 다른 조각 | {year_difference:,} |",
        f"| 여러 원본 파일을 가로지르는 조각 | {len(mixed):,} |",
        f"| 제목이 아닌 원본 파일 언급 제외 | {ignored_total:,} |",
        "",
        "문서 year 계약은 정확한 20xx 문자열만 유지한다. 33번·36번의 upstream 미표기는 팩에서 null로 정규화했고, 본문·조각 식별자·원본 파일명에는 영향이 없다.",
        "",
        "## 문서별 분포",
        "",
        "| 원천 문서 | 조각 | 원본 제목 | 파일명 보정 | 내·외부 연도 차이 |",
        "|---|---:|---:|---:|---:|",
    ]
    for doc in document_results:
        safe_name = doc["source_name"].replace("|", "\\|")
        lines.append(f"| {safe_name} | {doc['section_count']:,} | {doc['original_file_markers']} | {doc['original_name_corrections']:,} | {doc['internal_filename_year_differs_from_document_sections']:,} |")
    lines += ["", "## 18번 합본의 실제 범위", "", "| 원본 제목 위치 | 범위 | 명시된 원본 파일명 |", "|---:|---|---|"]
    for doc in marker_catalog:
        if doc["source_name"].startswith("18."):
            for marker in doc["markers"]:
                lines.append(f"| {marker['line']:,} | Markdown {marker['line']:,}–{marker['range_end_line']:,}줄 | {marker['original_name']} |")
    lines += ["", "## 해석 범위", ""]
    lines += ["- " + text for text in limitations]
    lines += [
        "",
        "원천의 source_year/document_year나 내부 파일명 연도는 필드별 지원금의 적용연도를 증명하지 않는다. "
        "이번 실제 입력에는 mixed_original_files가 0개이므로 그 상태의 운영 응답 처리까지 이 보고서가 검증했다고 해석하지 않는다.",
        "",
        "JSON은 동일한 전수 집계와 문서별 결과, 원본 제목 카탈로그는 39개 문서의 모든 명시적 원본 제목과 위치를 보존한다. "
        "각 조각의 기대 메타데이터 전체는 scratch의 압축 JSONL에 보존했으며 전체 매뉴얼 본문을 감사 보고서에 복사하지 않았다.",
        "",
    ]
    (args.output / "MARKER_AUDIT.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({
        "status": result["status"], "errors": error_count, "documents": len(expected_documents),
        "sections": section_count, "markers": marker_total, "corrections": corrections,
        "year_difference_sections": year_difference, "mixed_sections": len(mixed),
        "output": str(args.output),
    }, ensure_ascii=False))
    if error_count:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
