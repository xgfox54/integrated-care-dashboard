#!/usr/bin/env python3
"""Rebuild the reviewed manual corpus from a pinned local upstream checkout.

No network requests or upstream package initializer are used. The five reviewed
indexer modules are loaded from the supplied checkout after input hashes match the
recorded manifest. The public build_index() function writes to an in-memory
SQLite connection; only a fully checked serialized database is published.
"""
from __future__ import annotations

import argparse
import dataclasses
import datetime
import hashlib
import json
import os
import platform
import re
import sqlite3
import subprocess
import sys
import types
from pathlib import Path

MODULES = ("types", "schema", "structure", "split", "build")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_blob_sha1(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def save_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def verify_source(root: Path, commit: str, manifest_path: Path) -> tuple[dict, dict[str, bytes], dict]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != "manual-source-input-1":
        raise ValueError("Unsupported source-input manifest")
    if manifest.get("source_commit") != commit:
        raise ValueError("The requested commit differs from the reviewed source manifest")
    rows = manifest["files"]
    if len({row["path"] for row in rows}) != len(rows):
        raise ValueError("Duplicate source manifest paths")
    observed: dict[str, bytes] = {}
    for row in rows:
        relative = Path(row["path"])
        path = root / relative
        if relative.is_absolute() or ".." in relative.parts or not path.resolve().is_relative_to(root):
            raise ValueError("Unexpected source path: " + row["path"])
        data = path.read_bytes()
        if len(data) != row["bytes"] or sha256(data) != row["sha256"] or git_blob_sha1(data) != row["git_blob_sha1"]:
            raise ValueError("Source bytes differ from the pinned manifest: " + row["path"])
        observed[row["path"]] = data
    actual_names = {str(path.relative_to(root)) for path in (root / "source-md").glob("*.md")}
    expected_names = {name for name in observed if name.startswith("source-md/") and name.endswith(".md")}
    if not actual_names or actual_names != expected_names:
        raise ValueError("The complete Markdown input set differs from the pinned manifest")
    required = {"document_metadata.yaml", *(f"welfare_search/{name}.py" for name in MODULES)}
    if not required.issubset(observed):
        raise ValueError("The manifest omits a required indexer input")
    checkout_head = None
    if (root / ".git").exists():
        result = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], check=True, capture_output=True, text=True)
        checkout_head = result.stdout.strip()
        if checkout_head != commit:
            raise ValueError("The checkout HEAD differs from the requested source commit")
    return manifest, observed, {
        "input_manifest_sha256": sha256(manifest_path.read_bytes()),
        "files_verified": len(rows),
        "markdown_files_verified": len(expected_names),
        "git_checkout_head": checkout_head,
        "verification": "PINNED_MANIFEST_BYTES_AND_GIT_BLOBS" + ("_AND_CHECKOUT_HEAD" if checkout_head else ""),
    }


def load_reviewed_builder(root: Path, inputs: dict[str, bytes]) -> types.ModuleType:
    if any(name == "welfare_search" or name.startswith("welfare_search.") for name in sys.modules):
        raise RuntimeError("Use a fresh Python process without a preloaded welfare_search package")
    package = types.ModuleType("welfare_search")
    # Load known reviewed modules directly, preventing unrelated __init__ or
    # bytecode-cache execution. Module source bytes themselves are unchanged.
    package.__path__ = [str(root / "welfare_search")]
    sys.modules["welfare_search"] = package
    for name in MODULES:
        qualified = "welfare_search." + name
        path = "welfare_search/" + name + ".py"
        module = types.ModuleType(qualified)
        module.__file__ = str(root / path)
        module.__package__ = "welfare_search"
        sys.modules[qualified] = module
        exec(compile(inputs[path], str(root / path), "exec"), module.__dict__)
        setattr(package, name, module)
    return sys.modules["welfare_search.build"]


def validate_database(connection: sqlite3.Connection, root: Path, manifest: dict) -> dict:
    if connection.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
        raise RuntimeError("SQLite integrity validation failed")
    if connection.execute("PRAGMA foreign_key_check").fetchall():
        raise RuntimeError("SQLite foreign-key validation failed")
    if connection.execute("PRAGMA user_version").fetchone()[0] != 6:
        raise RuntimeError("Unexpected upstream schema version")
    tables = ("documents", "nodes", "sections", "sections_fts", "index_state", "references_map", "quality_issues", "embeddings")
    counts = {table: connection.execute("SELECT COUNT(*) FROM " + table).fetchone()[0] for table in tables}
    expected = manifest["expected_corpus"]
    for key in ("documents", "nodes", "sections"):
        if counts[key] != expected[key]:
            raise RuntimeError("Rebuilt corpus count differs: " + key)
    if counts["sections_fts"] != counts["sections"] or counts["quality_issues"] != 0:
        raise RuntimeError("FTS coverage or upstream quality validation failed")
    doc_count = 0
    section_count = 0
    source_bytes = 0
    for source_name, expected_hash, expected_bytes, expected_sections in connection.execute(
        "SELECT source_name,sha256,byte_size,section_count FROM documents ORDER BY source_name"
    ):
        raw = (root / "source-md" / source_name).read_bytes()
        if sha256(raw) != expected_hash or len(raw) != expected_bytes:
            raise RuntimeError("Document bytes/hash differ after indexing: " + source_name)
        reconstructed = hashlib.sha256()
        observed_sections = 0
        for content, content_hash in connection.execute(
            "SELECT content,content_hash FROM sections WHERE source_name=? ORDER BY ordinal", (source_name,)
        ):
            section_bytes = content.encode("utf-8")
            if sha256(section_bytes) != content_hash:
                raise RuntimeError("Section hash differs: " + source_name)
            reconstructed.update(section_bytes)
            observed_sections += 1
        if reconstructed.hexdigest() != expected_hash or observed_sections != expected_sections:
            raise RuntimeError("Source text roundtrip differs: " + source_name)
        doc_count += 1
        section_count += observed_sections
        source_bytes += expected_bytes
    if source_bytes != expected["source_document_bytes"] or section_count != counts["sections"] or doc_count != counts["documents"]:
        raise RuntimeError("Corpus aggregate validation failed")
    return {
        "counts": counts, "source_document_bytes": source_bytes,
        "document_hashes_and_roundtrips_verified": doc_count,
        "section_content_hashes_verified": section_count,
        "quick_check": "ok", "foreign_key_check": [],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True, help="Pinned local checkout/archive root containing source-md and welfare_search")
    parser.add_argument("--source-commit", required=True, help="Full commit matching the reviewed input manifest")
    parser.add_argument("--output", type=Path, required=True, help="New directory; existing output is never overwritten")
    parser.add_argument("--source-manifest", type=Path, default=Path(__file__).resolve().parents[2] / "docs/qa/manual-corpus-source-20261010/source-input-manifest.json")
    parser.add_argument("--verify-only", action="store_true", help="Validate pinned input bytes and exit before rebuilding")
    args = parser.parse_args()
    if sys.version_info < (3, 12) or not hasattr(sqlite3.Connection, "serialize"):
        raise RuntimeError("Python 3.12+ with SQLite serialize() and FTS5 is required")
    if not re.fullmatch(r"[0-9a-f]{40}", args.source_commit):
        raise ValueError("A full lower-case source commit SHA is required")
    root = args.source_root.resolve()
    output = args.output.resolve()
    manifest, inputs, input_checks = verify_source(root, args.source_commit, args.source_manifest)
    if args.verify_only:
        print(json.dumps({"status": "SOURCE_INPUTS_VERIFIED", **input_checks}, ensure_ascii=False))
        return
    if output.exists():
        raise ValueError("Refusing to overwrite an existing output directory")
    if output == root or output.is_relative_to(root):
        raise ValueError("Keep generated output outside the immutable source checkout")
    builder = load_reviewed_builder(root, inputs)
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    connection = sqlite3.connect(":memory:")
    original_sqlite = builder.sqlite3

    def memory_connect(path: object, *unused_args: object, **unused_kwargs: object) -> sqlite3.Connection:
        if Path(path).resolve() != output / "welfare.db":
            raise RuntimeError("Unexpected database path requested by upstream builder")
        return connection

    builder.sqlite3 = types.SimpleNamespace(connect=memory_connect, Connection=sqlite3.Connection)
    try:
        report = builder.build_index(root / "source-md", output)
        connection.commit()
        checks = validate_database(connection, root, manifest)
        # Recheck every immutable input after upstream has consumed it.
        verify_source(root, args.source_commit, args.source_manifest)
        blob = connection.serialize()
    finally:
        builder.sqlite3 = original_sqlite
        connection.close()
    temporary = output / "welfare.db.complete-tmp"
    with temporary.open("xb") as handle:
        handle.write(blob)
        handle.flush()
        os.fsync(handle.fileno())
    database_sha256 = sha256(blob)
    database_bytes = len(blob)
    del blob
    # Validate the serialized file through a distinct read-only connection before
    # giving it its importable final name. A failed temporary artifact is retained.
    readonly = sqlite3.connect(temporary.as_uri() + "?mode=ro", uri=True)
    try:
        readonly_checks = validate_database(readonly, root, manifest)
    finally:
        readonly.close()
    if readonly_checks != checks:
        raise RuntimeError("Independent read-only verification differs")
    if sha256(temporary.read_bytes()) != database_sha256:
        raise RuntimeError("Serialized file hash changed before publication")
    temporary.replace(output / "welfare.db")
    result = {
        "schema_version": "manual-source-rebuild-1",
        "provenance": "LOCAL_REBUILD_FROM_COMMIT_PINNED_SOURCE_NOT_DOWNLOADED_BINARY",
        "source_commit": args.source_commit, "started_at": started,
        "completed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "input_verification": input_checks,
        "report": dataclasses.asdict(report),
        "persistence": "MEMORY_SQLITE_SERIALIZED_AFTER_COMMIT_AND_VALIDATION",
        "upstream_source_module_bytes_modified": False,
        "upstream_package_initializer_executed": False,
        "loaded_module_sha256": {name: sha256(inputs["welfare_search/" + name + ".py"]) for name in MODULES},
        "database_sha256": database_sha256, "database_bytes": database_bytes,
        "validation": checks, "separate_readonly_connection": "ok",
        "runtime": {"python": platform.python_version(), "sqlite": sqlite3.sqlite_version, "pyyaml": sys.modules["yaml"].__version__},
        "byte_reproduction_note": "SQLite file bytes include index_state.indexed_at build timestamps and absolute upstream source paths, and can vary by build time, checkout path or SQLite version; section IDs/text/hashes and normalized import batches are the logical reproduction targets.",
    }
    save_json(output / "REBUILD_AUDIT.json", result)
    print(json.dumps({"status": "VERIFIED", "output": str(output), "database_sha256": database_sha256, **checks}, ensure_ascii=False))


if __name__ == "__main__":
    main()
