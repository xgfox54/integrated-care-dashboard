#!/usr/bin/env python3
"""Compare captured manual fetches with the pinned SQLite and import pack.

No network or production database access. Text is sliced by Unicode code point,
without newline/whitespace normalization. Reports contain hashes and locators,
not complete source bodies. A collection-in-progress report is never PASS.
"""
from __future__ import annotations

import argparse
import datetime
import gzip
import hashlib
import json
import os
import re
import sqlite3
import subprocess
from pathlib import Path
from urllib.parse import quote


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical(value: object) -> str:
    return sha(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode())


def unwrap(value: object) -> tuple[dict | None, bool, bool | None]:
    if not isinstance(value, dict):
        return None, False, None
    outer = value.get("result") if "jsonrpc" in value else value
    if not isinstance(outer, dict):
        return None, False, None
    structured = outer.get("structuredContent")
    text_payload = None
    text = "\n".join(block.get("text", "") for block in outer.get("content", []) if block.get("type") == "text")
    if text:
        try:
            text_payload = json.loads(text)
        except json.JSONDecodeError:
            pass
    data = structured if isinstance(structured, dict) else text_payload
    if not isinstance(data, dict):
        data = outer
    same = structured == text_payload if isinstance(structured, dict) and isinstance(text_payload, dict) else None
    return data, not bool(outer.get("isError") or outer.get("error") or data.get("error")), same


def observe_status(row: dict) -> dict:
    """Require actual status payloads; an end marker alone is not completion."""
    dataset, dataset_ok, dataset_same = unwrap(row.get("dataset_status"))
    integration, integration_ok, integration_same = unwrap(row.get("integration_status"))
    dataset_data = dataset.get("data") if isinstance(dataset, dict) else None
    integration_data = integration.get("data") if isinstance(integration, dict) else None
    dataset_valid = (dataset_ok and dataset_same is not False and isinstance(dataset_data, dict)
        and isinstance(dataset.get("release_bundle_id"), str) and bool(dataset["release_bundle_id"])
        and isinstance(dataset_data.get("server_version"), str) and bool(dataset_data["server_version"])
        and isinstance(dataset_data.get("manuals"), dict) and bool(dataset_data["manuals"].get("revision"))
        and isinstance(dataset_data.get("gov24"), dict) and bool(dataset_data["gov24"].get("revision")))
    integration_valid = (integration_ok and integration_same is not False and isinstance(integration_data, dict)
        and isinstance(integration.get("release_bundle_id"), str) and bool(integration["release_bundle_id"])
        and isinstance(integration_data.get("datasets"), list) and bool(integration_data["datasets"])
        and all(isinstance(item, dict) and bool(item.get("dataset_key")) for item in integration_data["datasets"]))
    return {"phase": row.get("phase"), "at": row.get("at"),
        "dataset_status_successful": bool(dataset_valid), "integration_status_successful": bool(integration_valid),
        "release_bundle_id": dataset.get("release_bundle_id") if dataset_valid else None,
        "server_version": dataset_data["server_version"] if dataset_valid else None,
        "manual_revision": dataset_data["manuals"]["revision"] if dataset_valid else None,
        "gov24_revision": dataset_data["gov24"]["revision"] if dataset_valid else None}


def source_year(section: dict, document: dict) -> tuple[str | None, str]:
    years = set(re.findall(r"(?<![0-9])(20[0-9]{2})(?![0-9])", section["original_name"]))
    if section["original_name_basis"] == "mixed_original_files" or len(years) > 1:
        return None, "unknown"
    if len(years) == 1:
        return next(iter(years)), "original_name"
    return (document["document_year"], "document_name") if document["document_year"] else (None, "unknown")


def extract_body(payload: dict) -> tuple[str, bool, bool]:
    """Validate the exact five-line card prefix and suffix; do not strip body text."""
    metadata = payload["metadata"]
    source = metadata["sources"][0]
    location, excerpt = source["location"], metadata["excerpt"]
    prefix = "\n".join([
        "문서: " + source["document_title"],
        "내부 원문명: " + source["original_name"],
        f"위치: 파싱 Markdown {location['start_line']}–{location['end_line']}행 / {location['heading_path']}",
        f"연도 표기: {source['source_year'] or '미확인'} ({source['source_year_basis']}, 적용연도 확인값 아님)",
        "출처: " + source["url"],
    ]) + "\n\n"
    text = payload["text"]
    if not isinstance(text, str) or not text.startswith(prefix):
        return "", False, False
    start, count = len(prefix), excerpt["returned_chars"]
    body = text[start:start + count]
    continuation = ["", f"이 구간의 본문이 더 있습니다. get_manual_section에 같은 section_id와 next_offset={excerpt['next_offset']}을 전달해 이어 읽으세요."] if excerpt["truncated"] else []
    suffix = "".join("\n" + line for line in continuation + [""] + metadata["warnings"])
    return body, True, text[start + count:] == suffix


def javascript_extractions(entries: list[dict], evaluator: Path) -> dict:
    """Run the repository's offline JS extractor without inheriting secret envs.

    Bodies remain in the parent/child process pipes for exact comparison and
    are never printed by this audit or copied to its report.
    """
    source = r"""
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const evaluator = await import(pathToFileURL(process.argv[1]).href);
const entries = JSON.parse(readFileSync(0, 'utf8'));
const results = entries.map((entry) => {
  try {
    const body = evaluator.extractManualFetchBody(entry.payload);
    if (typeof body !== 'string') throw new Error('INVALID_BODY_TYPE');
    return { call_id: entry.call_id, id: entry.id, accepted: true, body };
  } catch {
    return { call_id: entry.call_id, id: entry.id, accepted: false };
  }
});
process.stdout.write(JSON.stringify({ evaluation_version: evaluator.EVALUATION_VERSION,
  node_version: process.version, results }));
"""
    payloads = [{key: entry[key] for key in ["call_id", "id", "payload"]} for entry in entries]
    process = subprocess.run(["node", "--input-type=module", "-e", source, str(evaluator.resolve())],
        input=json.dumps(payloads, ensure_ascii=False), capture_output=True, text=True,
        encoding="utf8", timeout=30, check=False,
        env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"})
    if process.returncode != 0:
        raise ValueError("JAVASCRIPT_EXTRACTOR_PROCESS_FAILED")
    result = json.loads(process.stdout)
    if not isinstance(result.get("results"), list) or len(result["results"]) != len(entries):
        raise ValueError("JAVASCRIPT_EXTRACTOR_RESULT_INVALID")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", required=True, type=Path)
    parser.add_argument("--source-db", required=True, type=Path)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--snapshot", type=Path, help="Optional immutable gzip input snapshot outside the collector directory")
    parser.add_argument("--final", action="store_true", help="Only after the collector's final-records signal; completion is also checked")
    args = parser.parse_args()
    raw = args.records.read_bytes()
    if args.records.suffix == ".gz":
        raw = gzip.decompress(raw)
    rows = [json.loads(line) for line in raw.splitlines() if line]
    if args.snapshot:
        args.snapshot.parent.mkdir(parents=True, exist_ok=True)
        if args.snapshot.exists():
            if gzip.decompress(args.snapshot.read_bytes()) != raw:
                parser.error("SNAPSHOT_ALREADY_EXISTS_WITH_DIFFERENT_INPUT")
        else:
            with args.snapshot.open("xb") as snapshot:
                snapshot.write(gzip.compress(raw, mtime=0))
    errors: list[dict] = []

    def check(ok: bool, code: str, **context: object) -> None:
        if not ok:
            errors.append({"code": code, **context})

    records = [row for row in rows if row.get("kind") == "record"]
    golden_path = args.repo / "quality/faq_200_20261010.json"
    golden = json.loads(golden_path.read_bytes())
    expected_questions = {item["id"]: item["question"] for item in golden["items"]}
    seen_records, wanted_ids, wanted_links, successful_searches = set(), set(), set(), 0
    unique, calls_to_ids = {}, {}
    manual_links = 0
    for row in records:
        question_id = row.get("id")
        check(question_id not in seen_records, "DUPLICATE_QUESTION_ID", question_id=question_id)
        seen_records.add(question_id)
        check(expected_questions.get(question_id) == row.get("question"), "QUESTION_TEXT_MISMATCH", question_id=question_id)
        search, search_ok, _ = unwrap(row.get("search", {}).get("result"))
        valid_search = search_ok and isinstance(search, dict) and isinstance(search.get("results"), list)
        candidates = search["results"] if valid_search else []
        successful_searches += int(valid_search)
        wanted_ids.update(candidate["id"] for candidate in candidates[:5] if str(candidate.get("id", "")).startswith("manual:"))
        wanted_links.update((question_id, candidate["id"]) for candidate in candidates[:5] if str(candidate.get("id", "")).startswith("manual:"))
        for fetched in row.get("fetched", []):
            requested_id = fetched.get("id", "")
            if not str(requested_id).startswith("manual:"):
                continue
            manual_links += 1
            call_id, rank = fetched.get("call_id"), fetched.get("rank")
            valid_rank = type(rank) is int and 1 <= rank <= 5 and rank <= len(candidates)
            valid_link = valid_rank and candidates[rank - 1].get("id") == requested_id
            valid_arguments = fetched.get("arguments", {}).get("id") == requested_id and fetched.get("tool") == "fetch"
            valid_call_id = isinstance(call_id, str) and bool(call_id)
            check(valid_link, "SEARCH_FETCH_LINK_MISMATCH", question_id=question_id, call_id=call_id, id=requested_id, rank=rank)
            check(valid_arguments, "FETCH_ARGUMENT_MISMATCH", question_id=question_id, call_id=call_id)
            check(valid_call_id, "FETCH_CALL_ID_MISSING", question_id=question_id, id=requested_id)
            check(call_id not in calls_to_ids or calls_to_ids[call_id] == requested_id, "CALL_ID_ENTITY_CONFLICT", call_id=call_id)
            calls_to_ids[call_id] = requested_id
            key = (call_id, requested_id)
            payload, ok, same = unwrap(fetched.get("result"))
            response_hash = canonical(fetched.get("result"))
            link = {"question_id": question_id, "rank": rank, "valid_search_fetch_link": bool(valid_link and valid_arguments and valid_call_id)}
            if key in unique:
                check(unique[key]["response_sha256"] == response_hash, "SHARED_CACHE_RESPONSE_CONFLICT", call_id=call_id, id=requested_id)
                unique[key]["links"].append(link)
            else:
                unique[key] = {"call_id": call_id, "id": requested_id, "payload": payload, "ok": ok, "native_representations_equal": same,
                    "response_sha256": response_hash, "arguments": fetched.get("arguments", {}), "links": [link]}

    manifest_path = args.repo / "data/manual-corpus/manifest.json"
    manifest = json.loads(manifest_path.read_bytes())
    wanted_sections = {row["id"].split(":", 2)[-1] for row in unique.values()}
    documents, sections, pack_checks = {}, {}, []
    for index, descriptor in enumerate(manifest["batches"]):
        path = args.repo / "data/manual-corpus/assets" / descriptor["path"].lstrip("/")
        data = path.read_bytes()
        verified = len(data) == descriptor["bytes"] and sha(data) == descriptor["sha256"]
        check(verified, "PACK_BATCH_DIGEST_MISMATCH", batch_index=index)
        batch = json.loads(data)
        check(batch["revision"] == manifest["revision"] and batch["batch_index"] == index, "PACK_BATCH_IDENTITY_MISMATCH", batch_index=index)
        pack_checks.append({"batch_index": index, "sha256": sha(data), "bytes": len(data), "matches_manifest": verified})
        for document in batch["documents"]:
            check(document["document_id"] not in documents, "PACK_DUPLICATE_DOCUMENT", document_id=document["document_id"])
            documents[document["document_id"]] = document
        for section in batch["sections"]:
            if section["section_id"] in wanted_sections:
                check(section["section_id"] not in sections, "PACK_DUPLICATE_SECTION", section_id=section["section_id"])
                sections[section["section_id"]] = section

    database_hash = file_sha(args.source_db)
    evaluator_path = args.repo / "scripts/mcp/evaluate-golden-qa.mjs"
    evaluator_hash = file_sha(evaluator_path)
    js_run = {}
    try:
        js_run = javascript_extractions(list(unique.values()), evaluator_path)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        check(False, "JAVASCRIPT_EXTRACTION_CHECK_UNAVAILABLE", error_type=type(error).__name__)
    js_results = {(entry["call_id"], entry["id"]): entry for entry in js_run.get("results", [])}
    check(len(js_results) == len(unique), "JAVASCRIPT_EXTRACTION_RESULT_COUNT_MISMATCH")
    check(file_sha(evaluator_path) == evaluator_hash, "JAVASCRIPT_EVALUATOR_CHANGED_DURING_AUDIT")
    db = sqlite3.connect(args.source_db.resolve().as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only = ON")
    findings = []
    for entry in unique.values():
        start_errors = len(errors)
        call_id, identity, payload = entry["call_id"], entry["id"], entry["payload"]
        check(entry["ok"] and isinstance(payload, dict), "MANUAL_FETCH_UNSUCCESSFUL", call_id=call_id, id=identity)
        finding = {key: entry[key] for key in ["call_id", "id", "response_sha256", "native_representations_equal", "links"]}
        if not entry["ok"] or not isinstance(payload, dict):
            finding["status"] = "FAIL"
            findings.append(finding)
            continue
        check(entry["native_representations_equal"] is not False, "NATIVE_REPRESENTATIONS_DIFFER", call_id=call_id)
        try:
            prefix, revision, section_id = identity.split(":", 2)
            metadata = payload["metadata"]
            source = metadata["sources"][0]
            section = sections[section_id]
            document = documents[section["document_id"]]
            original = dict(db.execute("SELECT * FROM sections WHERE section_id=?", (section_id,)).fetchone())
            original_document = dict(db.execute("SELECT * FROM documents WHERE source_name=?", (original["source_name"],)).fetchone())
            content, excerpt = original["content"], metadata["excerpt"]
            full_hash = sha(content.encode("utf8"))
            check(prefix == "manual" and revision == manifest["revision"] and payload.get("id") == identity, "FETCH_IDENTITY_MISMATCH", call_id=call_id)
            for field, expected in {"entity_type": "manual_section", "manual_revision": revision, "section_id": section_id,
                "document_id": section["document_id"], "manual_component": "manuals:" + revision,
                "image_content_available": False, "personal_determination": False}.items():
                check(metadata.get(field) == expected, "FETCH_METADATA_MISMATCH", call_id=call_id, field=field)
            check(section["content"] == content and section["content_hash"] == original["content_hash"] == full_hash,
                "SQLITE_PACK_BODY_OR_HASH_MISMATCH", call_id=call_id)
            for field in ["title", "start_line", "end_line", "ordinal", "node_id", "service_names"]:
                check(section[field] == original[field], "SQLITE_PACK_SECTION_METADATA_MISMATCH", call_id=call_id, field=field)
            check(section["heading_path"] == original["headings"] and section["upstream_original_name"] == original["original_name"], "SQLITE_PACK_UPSTREAM_METADATA_MISMATCH", call_id=call_id)
            check(document["source_name"] == original["source_name"] and document["sha256"] == original_document["sha256"], "SQLITE_PACK_DOCUMENT_MISMATCH", call_id=call_id)
            expected_year, year_origin = source_year(section, document)
            expected_url = manifest["source_repository"].rstrip("/") + "/-/blob/" + manifest["source_commit"] + "/" + quote(document["source_path"], safe="/!~*'()-._") + f"#L{section['start_line']}-{section['end_line']}"
            expected_source = {"source_repository": manifest["source_repository"], "source_commit": manifest["source_commit"],
                "source_path": document["source_path"], "url": expected_url, "url_kind": "repository_parsed_copy", "official_url": None,
                "document_title": document["source_name"], "document_year": document["document_year"],
                "document_year_basis": "filename_inferred" if document["document_year"] else "unknown",
                "source_year": expected_year, "source_year_origin": year_origin, "source_year_basis": "filename_inferred" if expected_year else "unknown",
                "applicable_year": None, "publisher": document["publisher"], "publisher_verified": False,
                "authority": document["authority"], "authority_verified": False, "source_role": document["source_role"],
                "jurisdiction": document["jurisdiction"], "jurisdiction_verified": False,
                "content_sha256": full_hash, "document_sha256": document["sha256"]}
            for field in ["original_name", "upstream_original_name", "original_name_basis", "original_name_line"]:
                expected_source[field] = section[field]
            for field, expected in expected_source.items():
                check(field in source and source[field] == expected, "SOURCE_METADATA_MISMATCH", call_id=call_id, field=field)
            expected_location = {"basis": "parsed_markdown_lines", "start_line": section["start_line"], "end_line": section["end_line"],
                "heading_path": section["heading_path"], "physical_page": None, "physical_page_verified": False}
            check(source["location"] == expected_location, "SOURCE_LOCATION_MISMATCH", call_id=call_id)
            check(payload.get("url") == expected_url and payload.get("title") == (section["title"] or section["heading_path"] or section["original_name"]), "CARD_TITLE_OR_URL_MISMATCH", call_id=call_id)
            check(all(type(excerpt.get(field)) is int and excerpt[field] >= 0 for field in ["offset", "returned_chars", "total_chars"]), "EXCERPT_INVALID_COUNTS", call_id=call_id)
            offset, returned = excerpt["offset"], excerpt["returned_chars"]
            expected_count = min(8000, max(0, len(content) - offset))
            expected_next = offset + expected_count if offset + expected_count < len(content) else None
            check(offset == 0, "FIRST_FETCH_OFFSET_NOT_ZERO", call_id=call_id)
            check(returned == expected_count and excerpt["total_chars"] == len(content) and excerpt["next_offset"] == expected_next
                and excerpt["truncated"] == (expected_next is not None), "EXCERPT_RANGE_MISMATCH", call_id=call_id)
            body, preface_ok, suffix_ok = extract_body(payload)
            js_result = js_results.get((call_id, identity), {})
            js_match = js_result.get("accepted") is True and js_result.get("body") == body
            check(js_match, "JAVASCRIPT_PYTHON_EXTRACTION_MISMATCH", call_id=call_id)
            expected_body = content[offset:offset + returned]
            check(preface_ok and suffix_ok, "CARD_FRAME_MISMATCH", call_id=call_id, preface=preface_ok, suffix=suffix_ok)
            check(body == expected_body and len(body) == returned, "RETURNED_BODY_MISMATCH", call_id=call_id)
            entire_section = offset == 0 and returned == len(content) and not excerpt["truncated"]
            body_hash = sha(body.encode("utf8"))
            check(not entire_section or body_hash == full_hash, "FULL_BODY_HASH_MISMATCH", call_id=call_id)
            finding.update({"server_version": metadata.get("server_version"), "release_bundle_id": metadata.get("release_bundle_id"),
                "manual_revision": revision, "section_id": section_id, "document_id": section["document_id"], "source": source,
                "excerpt": excerpt, "returned_body_sha256": body_hash, "expected_substring_sha256": sha(expected_body.encode("utf8")),
                "returned_body_matches_sqlite_substring": body == expected_body, "returned_body_matches_pack_substring": body == section["content"][offset:offset + returned],
                "full_section_sha256": full_hash, "full_section_hash_metadata_matches": source["content_sha256"] == full_hash,
                "full_body_direct_hash_match": body_hash == full_hash if entire_section else None,
                "body_scope": "COMPLETE_SECTION" if entire_section else "PARTIAL_SUBSTRING",
                "card_preface_exact": preface_ok, "card_suffix_exact": suffix_ok,
                "javascript_extractor_accepted": js_result.get("accepted") is True,
                "javascript_python_unicode_body_exact_match": js_match,
                "source_metadata_matches_pack": all(source.get(field) == expected for field, expected in expected_source.items()) and source["location"] == expected_location})
        except (KeyError, TypeError, ValueError, IndexError) as error:
            check(False, "CAPTURE_OR_SOURCE_SHAPE_INVALID", call_id=call_id, error_type=type(error).__name__)
        finding["status"] = "MATCH" if len(errors) == start_errors else "FAIL"
        findings.append(finding)
    db.close()
    check(file_sha(args.source_db) == database_hash, "SOURCE_DB_CHANGED_DURING_AUDIT")
    received_ids = {row["id"] for row in findings if row["status"] == "MATCH"}
    received_links = {(link["question_id"], row["id"]) for row in findings if row["status"] == "MATCH"
        for link in row["links"] if link["valid_search_fetch_link"]}
    missing_links = [{"question_id": question_id, "id": identity} for question_id, identity in sorted(wanted_links - received_links)]
    complete_ids = set(expected_questions) == seen_records and len(records) == len(expected_questions) == 200
    status_observations = [observe_status(row) for row in rows if row.get("kind") == "status"]
    end_rows = [row for row in status_observations if row["phase"] == "end"]
    end_present = bool(end_rows)
    end_successful = bool(end_rows and end_rows[-1]["dataset_status_successful"] and end_rows[-1]["integration_status_successful"])
    collection_complete = (complete_ids and successful_searches == 200 and end_successful
        and wanted_ids == received_ids and wanted_links == received_links)
    status = "FAIL" if errors else "PASS" if args.final and collection_complete else "PARTIAL"
    report = {"schema_version": "manual-fetch-integrity-1", "recorded_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "status": status, "final_requested": args.final, "scope": "CAPTURED_MANUAL_FETCH_TRANSMISSION_INTEGRITY_NOT_FAQ_CORRECTNESS",
        "inputs": {"records_path": str(args.records.resolve()), "records_uncompressed_sha256": sha(raw), "records_bytes": len(raw),
            "snapshot_gzip_path": str(args.snapshot.resolve()) if args.snapshot else None,
            "snapshot_gzip_sha256": file_sha(args.snapshot) if args.snapshot else None,
            "source_db_path": str(args.source_db.resolve()), "source_db_sha256": database_hash, "source_db_readonly": True,
            "golden_sha256": file_sha(golden_path), "manifest_path": str(manifest_path.resolve()), "manifest_sha256": file_sha(manifest_path),
            "source_commit": manifest["source_commit"], "manual_revision": manifest["revision"], "audit_script_sha256": file_sha(Path(__file__))},
        "collection": {"question_rows": len(records), "expected_ids_match": complete_ids, "successful_searches": successful_searches,
            "end_status_present": end_present, "end_status_successful": end_successful,
            "status_observations": status_observations, "complete_manual_fetch_collection": collection_complete,
            "top5_unique_manual_ids_expected_so_far": len(wanted_ids), "unique_manual_call_id_entity_pairs_received": len(unique),
            "unique_manual_ids_received": len({row['id'] for row in unique.values()}), "manual_fetch_links": manual_links,
            "cache_links_deduplicated": manual_links - len(unique), "unfetched_or_nonmatching_manual_ids": sorted(wanted_ids - received_ids),
            "per_question_top5_manual_ids_expected_so_far": len(wanted_links), "per_question_manual_ids_with_matching_fetch": len(received_links),
            "missing_or_nonmatching_per_question_fetch_links": missing_links},
        "summary": {"matching_unique_responses": sum(row["status"] == "MATCH" for row in findings), "failing_unique_responses": sum(row["status"] == "FAIL" for row in findings),
            "complete_section_responses": sum(row.get("body_scope") == "COMPLETE_SECTION" for row in findings),
            "partial_substring_responses": sum(row.get("body_scope") == "PARTIAL_SUBSTRING" for row in findings), "error_count": len(errors),
            "server_versions": sorted({row.get("server_version") for row in findings if row.get("server_version")}),
            "release_bundle_ids": sorted({row.get("release_bundle_id") for row in findings if row.get("release_bundle_id")})},
        "javascript_extraction_comparison": {"scope": "SAME_CAPTURED_UNIQUE_MANUAL_CALL_ID_ENTITY_PAIRS_ONLY",
            "evaluator_path": str(evaluator_path.resolve()), "evaluator_sha256": evaluator_hash,
            "evaluation_version": js_run.get("evaluation_version"), "node_version": js_run.get("node_version"),
            "expected_unique_manual_responses": len(unique), "javascript_results": len(js_results),
            "exact_unicode_string_matches": sum(row.get("javascript_python_unicode_body_exact_match") is True for row in findings),
            "status": "MATCH_ON_CAPTURED_RESPONSES" if len(unique) == len(js_results) and all(row.get("javascript_python_unicode_body_exact_match") is True for row in findings) else "MISMATCH_OR_UNAVAILABLE",
            "nonmanual_responses": "NOT_APPLICABLE", "process_environment": "PATH_LANG_LC_ALL_ONLY", "network_calls": 0},
        "pack_batch_checks": pack_checks, "responses": findings, "errors": errors,
        "limitations": ["Only actual captured manual fetches are checked; this does not sample or claim every D1 row.",
            "Full content_sha256 metadata is compared with the full source section; partial response hashes are separately compared only with the matching Unicode substring.",
            "Document SHA is compared with the pinned SQLite and pack metadata; physical PDF pages and official-original provenance are not inferred.",
            "Card suffix checks confirm consistency with warnings in the same captured metadata, not independent validation of every warning against runtime code.",
            "Final collection gating checks all per-question top-five manual links and successful end-status payloads; cross-dataset release consistency is reported separately by the collector audit.",
            "Exact transmission does not establish semantic relevance, current eligibility, benefit amounts, or FAQ answer correctness."],
        "answer_correctness": "NOT_EVALUATED", "human_review": "PENDING"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"status": status, **report["summary"], "successful_searches": successful_searches, "output": str(args.output)}, ensure_ascii=False))
    if errors or (args.final and not collection_complete):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
