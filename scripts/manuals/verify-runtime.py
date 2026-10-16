#!/usr/bin/env python3
"""Verify the selected Site's fixed manual corpus without storing credentials.

The deployment owner supplies the Sites verification token on hidden stdin.
Only the fixed Site origin below receives it; redirects are not followed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ORIGIN = "https://integrated-care-national-dashboard.xgfox54.chatgpt.site"
REVISION = "sgw-bdef4e9c1609-v1"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("boundary", "cipher", "ingest", "status"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-polls", type=int, default=300)
    args = parser.parse_args()
    previous = None
    if sys.stdin.isatty():
        import termios
        previous = termios.tcgetattr(sys.stdin.fileno())
        hidden = termios.tcgetattr(sys.stdin.fileno())
        hidden[3] &= ~termios.ECHO
        termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, hidden)
    print("Ready for Site verification JSON on hidden stdin.", flush=True)
    try:
        supplied = json.loads(sys.stdin.readline())
    finally:
        if previous is not None:
            termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, previous)
    token = supplied.get("token")
    if not isinstance(token, str) or not token.strip():
        raise SystemExit("A Sites verification token is required.")
    del supplied
    opener = urllib.request.build_opener(NoRedirect())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    records = []

    def get(path: str, *, method="GET", headers=None) -> dict:
        if not path.startswith("/") or "\r" in path or "\n" in path:
            raise ValueError("Invalid verification path")
        request = urllib.request.Request(ORIGIN + path, method=method, headers={
            "OAI-Sites-Authorization": "Bearer " + token,
            "Accept": "application/json",
            **(headers or {}),
        })
        start = time.monotonic()
        try:
            try:
                response = opener.open(request, timeout=30)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                body = response.read(1_048_577)
                row = {"at": utc(), "path": path, "method": method, "status": response.code,
                       "bytes_read": len(body), "body_sha256": hashlib.sha256(body).hexdigest(),
                       "elapsed_ms": round((time.monotonic() - start) * 1000),
                       "content_type": response.headers.get("Content-Type"),
                       "cache_control": response.headers.get("Cache-Control")}
                if path == "/api/manuals/status":
                    try:
                        row["data"] = json.loads(body)
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        row["error"] = "NON_JSON_STATUS"
                return row
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            return {"at": utc(), "path": path, "method": method, "status": None,
                    "elapsed_ms": round((time.monotonic() - start) * 1000), "error": type(error).__name__}

    def save(row):
        records.append(row)
        args.output.write_text(json.dumps({"origin": ORIGIN, "configured_revision": REVISION,
            "mode": args.mode, "records": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.mode == "boundary":
        tail = REVISION + "/batch-0001.json"
        cases = [("/__manual_corpus/" + tail, "GET", {}),
                 ("/__manual_corpus/" + tail, "HEAD", {}),
                 ("/%5f%5fmanual_corpus/" + tail, "GET", {}),
                 ("/__manual_corpus%2f" + tail, "GET", {}),
                 ("//__manual_corpus/" + tail, "GET", {}),
                 ("/__manual_corpus/" + tail + "?download=1", "GET", {}),
                 ("/__manual_corpus/" + tail, "GET", {"Sec-Fetch-Mode": "navigate", "Accept": "text/html"}),
                 ("/__manual_corpus/" + tail, "GET", {"Range": "bytes=0-99"})]
        for path, method, headers in cases:
            row = get(path, method=method, headers=headers)
            row["request_variant"] = headers
            save(row)
            print(json.dumps({key: row[key] for key in ("path", "method", "status", "bytes_read") if key in row}), flush=True)
            if row["status"] in (200, 206):
                raise SystemExit("Private asset boundary failed; stop publication verification.")
            time.sleep(1.3)
        if any(row["status"] != 404 for row in records):
            raise SystemExit("Private asset boundary is inconclusive; inspect recorded statuses.")
        print("PRIVATE_ASSETS_404_VERIFIED", flush=True)
        return

    if args.mode == "cipher":
        manifest_path = Path(__file__).resolve().parents[2] / "data/manual-corpus/encrypted-assets.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("revision") != REVISION:
            raise SystemExit("Encrypted manifest revision mismatch.")
        for index in (0, 69, len(manifest["batches"]) - 1):
            descriptor = manifest["batches"][index]
            expected_path = f"/__manual_cipher/{REVISION}/{manifest['key_id']}/batch-{index:04d}.bin"
            if descriptor.get("asset_path") != expected_path:
                raise SystemExit("Encrypted manifest path mismatch.")
            row = get(expected_path)
            row["expected_sha256"] = descriptor["sha256"]
            row["expected_bytes"] = descriptor["bytes"]
            row["ciphertext_verified"] = (row["status"] == 200 and
                row.get("body_sha256") == descriptor["sha256"] and row.get("bytes_read") == descriptor["bytes"])
            save(row)
            print(json.dumps({key: row[key] for key in ("path", "status", "ciphertext_verified")}), flush=True)
            if not row["ciphertext_verified"]:
                raise SystemExit("Public ciphertext delivery mismatch.")
        print("PUBLIC_CIPHERTEXT_BYTES_VERIFIED", flush=True)
        return

    maximum = 1 if args.mode == "status" else max(1, min(args.max_polls, 1000))
    for index in range(maximum):
        row = get("/api/manuals/status")
        save(row)
        data = row.get("data", {})
        ingestion = data.get("ingestion") or {}
        active = data.get("active") or {}
        print(json.dumps({"poll": index + 1, "http": row["status"], "active_revision": data.get("active_revision"),
                          "next_batch": ingestion.get("next_batch"), "batch_count": ingestion.get("batch_count"),
                          "documents": active.get("document_count"), "sections": active.get("section_count"),
                          "last_error": ingestion.get("last_error"), "asset_binding_available": data.get("asset_binding_available")}), flush=True)
        if row["status"] in (401, 403):
            raise SystemExit("Site verification access was rejected; no alternate authentication was attempted.")
        if row["status"] == 200 and data.get("asset_binding_available") is False:
            raise SystemExit("Internal ASSETS binding is unavailable.")
        if row["status"] == 200 and data.get("asset_key_available") is False:
            raise SystemExit("The server-side corpus asset key is unavailable.")
        if data.get("active_revision") == REVISION and active.get("document_count") == 39 and active.get("section_count") == 21588:
            print("MANUAL_CORPUS_ACTIVE_VERIFIED", flush=True)
            return
        if args.mode == "ingest":
            time.sleep(2.5 if row["status"] == 200 else 8)
    if args.mode == "ingest":
        raise SystemExit("Manual corpus has not activated within the bounded polling window.")


if __name__ == "__main__":
    main()
