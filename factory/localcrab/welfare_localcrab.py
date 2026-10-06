"""Welfare <-> LocalCrab adapter (작업지시서 v5 §6.4, T34).

상위 LocalCrab(OpenCrab, 고정 commit)의 문법 검사기(opencrab.grammar.validator)와 로컬 SQLite 그래프 저장소
(opencrab.stores.local_graph_store.LocalGraphStore)만 그대로 쓴다. 상위 builder(neo4j·mongo 의존)와
LLM extractor(외부 유료 API)는 쓰지 않는다. 9-Space 문법을 넓히지 않고, 복지 관계는 Claim의 속성으로 손실 없이 담는다.
"""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
PIN = json.loads((HERE / "pin.json").read_text(encoding="utf-8"))
ADAPTER_VERSION = "welfare-localcrab-adapter-1.0.0"

SOURCE_FIELDS = [
    "source_id", "source_version_id", "source_kind", "title", "issuer", "issuer_sido", "issuer_sigungu", "document_number", "url",
    "published_date", "retrieved_at", "raw_sha256", "format", "parse_id", "parser", "adapter_version", "locator_precision", "page_mode", "rights_basis",
]
STATEMENT_FIELDS = [
    "statement_id", "subject_id", "subject_label", "subject_sido", "subject_sigungu", "predicate_id", "value_text", "unit", "scope_text",
    "source_version_id", "assertion_type", "review_status", "reviewed_at",
]
EVIDENCE_FIELDS = [
    "evidence_id", "statement_id", "source_version_id", "parse_id", "block_id", "ir_pointer", "table_id", "cell", "locator_precision", "page_mode",
    "layout_page_start", "physical_page_verified", "quote",
]


def load_upstream(path: str | None = None):
    """고정 commit의 상위 코드를 불러온다. commit이 다르면 거절한다(latest 추종 금지)."""
    root = Path(path or os.environ.get("OPENCRAB_PATH") or HERE.parent.parent / "var" / "upstream" / "OpenCrab").resolve()
    if not (root / "opencrab" / "grammar" / "validator.py").exists():
        raise RuntimeError("UPSTREAM_MISSING: " + str(root) + " (node factory/localcrab/fetch-upstream.mjs로 고정 commit을 받으세요)")
    head = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    if head != PIN["commit"]:
        raise RuntimeError("UPSTREAM_COMMIT_MISMATCH: " + head + " != " + PIN["commit"])
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from opencrab.grammar import validator  # noqa: PLC0415
    from opencrab.stores.local_graph_store import LocalGraphStore  # noqa: PLC0415

    return validator, LocalGraphStore, head


def read_pack(path: str) -> dict[str, list[dict[str, Any]]]:
    """welfare-public-release-v2(knowledge/document-facts-1) 묶음 ZIP 또는 같은 구조의 디렉터리를 읽는다."""
    names = {"sources": "data/knowledge/sources.jsonl", "statements": "data/knowledge/statements.jsonl", "evidence": "data/knowledge/evidence.jsonl"}
    out: dict[str, list[dict[str, Any]]] = {}
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            for key, name in names.items():
                out[key] = [json.loads(line) for line in archive.read(name).decode("utf-8").splitlines() if line.strip()]
    else:
        for key, name in names.items():
            out[key] = [json.loads(line) for line in (Path(path) / name).read_text(encoding="utf-8").splitlines() if line.strip()]
    return out


def _node(store, validator, space: str, node_type: str, node_id: str, props: dict[str, Any]) -> None:
    validator.validate_node(space, node_type).raise_if_invalid()
    validator.validate_node_properties(node_type, props).raise_if_invalid()
    store.upsert_node(node_type, node_id, props, space_id=space)


def _edge(store, validator, from_space: str, from_type: str, from_id: str, relation: str, to_space: str, to_type: str, to_id: str, props: dict[str, Any]) -> None:
    validator.validate_edge(from_space, to_space, relation).raise_if_invalid()
    store.upsert_edge(from_type, from_id, relation, to_type, to_id, props)


def project(records: dict[str, list[dict[str, Any]]], db_path: str, upstream=None) -> dict[str, int]:
    """Welfare 기록을 LocalCrab 그래프로 투영한다. 모든 노드·관계는 상위 문법 검사를 통과해야 한다."""
    validator, LocalGraphStore, _ = upstream or load_upstream()
    store = LocalGraphStore(db_path=db_path)
    if not store.available:
        raise RuntimeError("LOCALCRAB_STORE_UNAVAILABLE")
    try:
        counts = {"nodes": 0, "edges": 0}
        for source in records["sources"]:
            _node(store, validator, "resource", "Document", source["source_version_id"], {"welfare_type": "source_version", "welfare_record": source, "adapter_version": ADAPTER_VERSION})
            _node(store, validator, "subject", "Org", "issuer:" + source["issuer"], {"welfare_type": "issuer_text", "label": source["issuer"]})
            _edge(store, validator, "subject", "Org", "issuer:" + source["issuer"], "owns", "resource", "Document", source["source_version_id"], {"welfare_relation": "issuedBy(inverse)"})
            counts["nodes"] += 2
            counts["edges"] += 1
        subjects: dict[str, dict[str, Any]] = {}
        for statement in records["statements"]:
            subjects.setdefault(statement["subject_id"], statement)
            _node(store, validator, "claim", "Claim", statement["statement_id"], {
                "welfare_type": "statement", "welfare_record": statement, "subject_id": statement["subject_id"], "predicate_id": statement["predicate_id"],
                "object_value": statement["value_text"], "adapter_version": ADAPTER_VERSION,
            })
            counts["nodes"] += 1
        for subject_id, first in subjects.items():
            welfare_type = "implementation" if subject_id.startswith("service:") else "document_program"
            _node(store, validator, "concept", "Entity", subject_id, {"welfare_type": welfare_type, "canonical_id": subject_id, "label": first["subject_label"], "sido": first["subject_sido"], "sigungu": first["subject_sigungu"]})
            counts["nodes"] += 1
        for evidence in records["evidence"]:
            _node(store, validator, "evidence", "Evidence", evidence["evidence_id"], {"welfare_type": "evidence_locator", "welfare_record": {k: v for k, v in evidence.items() if k not in ("statement_id", "source_version_id")}})
            _edge(store, validator, "resource", "Document", evidence["source_version_id"], "contains", "evidence", "Evidence", evidence["evidence_id"], {"welfare_relation": "hasEvidence"})
            _edge(store, validator, "evidence", "Evidence", evidence["evidence_id"], "supports", "claim", "Claim", evidence["statement_id"], {"welfare_relation": "supports"})
            counts["nodes"] += 1
            counts["edges"] += 2
        return counts
    finally:
        store.close()


def restore(db_path: str) -> dict[str, list[dict[str, Any]]]:
    """LocalCrab 그래프에서 Welfare 기록을 되살린다. 근거의 소속(문서·사실)은 속성이 아니라 관계 방향에서 읽는다."""
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        nodes = [dict(row) for row in connection.execute("SELECT node_type, node_id, space_id, properties FROM graph_nodes")]
        edges = [dict(row) for row in connection.execute("SELECT from_type, from_id, relation, to_type, to_id FROM graph_edges")]
    finally:
        connection.close()
    by_type: dict[str, list[dict[str, Any]]] = {}
    for node in nodes:
        props = json.loads(node["properties"])
        by_type.setdefault(props.get("welfare_type", ""), []).append({**node, "props": props})
    contains = {e["to_id"]: e["from_id"] for e in edges if e["relation"] == "contains" and e["from_type"] == "Document" and e["to_type"] == "Evidence"}
    supports = {e["from_id"]: e["to_id"] for e in edges if e["relation"] == "supports" and e["from_type"] == "Evidence" and e["to_type"] == "Claim"}
    subject_ids = {node["node_id"] for kind in ("implementation", "document_program") for node in by_type.get(kind, [])}
    sources = [node["props"]["welfare_record"] for node in by_type.get("source_version", [])]
    statements = []
    for node in by_type.get("statement", []):
        record = node["props"]["welfare_record"]
        if record["subject_id"] not in subject_ids:
            raise ValueError("SUBJECT_NODE_MISSING:" + record["subject_id"])
        if node["props"]["predicate_id"] != record["predicate_id"] or node["props"]["subject_id"] != record["subject_id"]:
            raise ValueError("CLAIM_PROPERTY_DRIFT:" + node["node_id"])
        statements.append(record)
    evidence = []
    for node in by_type.get("evidence_locator", []):
        evidence_id = node["node_id"]
        if evidence_id not in contains or evidence_id not in supports:
            raise ValueError("EVIDENCE_EDGE_MISSING:" + evidence_id)
        evidence.append({**node["props"]["welfare_record"], "statement_id": supports[evidence_id], "source_version_id": contains[evidence_id]})
    return {"sources": sources, "statements": statements, "evidence": evidence}


def canonical(records: dict[str, list[dict[str, Any]]]) -> dict[str, list[str]]:
    """비교용 정규형: 각 기록을 키 정렬 JSON으로, 목록은 ID 순으로."""
    keys = {"sources": "source_version_id", "statements": "statement_id", "evidence": "evidence_id"}
    fields = {"sources": SOURCE_FIELDS, "statements": STATEMENT_FIELDS, "evidence": EVIDENCE_FIELDS}
    out = {}
    for kind, key in keys.items():
        rows = sorted(records[kind], key=lambda row: row[key])
        out[kind] = [json.dumps({field: row.get(field, "__MISSING__") for field in fields[kind]} | {"__extra__": sorted(set(row) - set(fields[kind]))}, ensure_ascii=False, sort_keys=True) for row in rows]
    return out


def roundtrip(records: dict[str, list[dict[str, Any]]], db_path: str, upstream=None) -> dict[str, Any]:
    counts = project(records, db_path, upstream)
    back = restore(db_path)
    before, after = canonical(records), canonical(back)
    losses = []
    for kind in before:
        missing = sorted(set(before[kind]) - set(after[kind]))
        added = sorted(set(after[kind]) - set(before[kind]))
        losses += [{"kind": kind, "change": "missing", "record": item} for item in missing] + [{"kind": kind, "change": "added", "record": item} for item in added]
    return {"counts": counts, "records": {kind: len(rows) for kind, rows in records.items()}, "losses": losses}


if __name__ == "__main__":
    import argparse
    import tempfile

    parser = argparse.ArgumentParser(description="Welfare 묶음 → LocalCrab → Welfare 왕복 검사")
    parser.add_argument("pack", help="welfare-public-release-v2 묶음 ZIP 또는 디렉터리")
    parser.add_argument("--opencrab", default=None)
    args = parser.parse_args()
    upstream = load_upstream(args.opencrab)
    with tempfile.TemporaryDirectory() as work:
        result = roundtrip(read_pack(args.pack), os.path.join(work, "graph.db"), upstream)
    print(json.dumps({"upstream_commit": upstream[2], "adapter": ADAPTER_VERSION, **result}, ensure_ascii=False, indent=2))
    sys.exit(1 if result["losses"] else 0)
