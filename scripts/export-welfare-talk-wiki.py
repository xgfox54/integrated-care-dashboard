# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
# ─── How to run ───
# uv run scripts/export-welfare-talk-wiki.py <welfare.db> <output.json>

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
import json
from pathlib import Path
import re
import sqlite3
import sys
from typing import Final, Sequence, TypedDict


@dataclass(frozen=True, slots=True)
class ExtractSpec:
    entry_id: str
    section_id: str
    terms: tuple[str, ...]
    citation_heading: str
    start_marker: str
    end_marker: str


class WikiEntry(TypedDict):
    id: str
    terms: list[str]
    sourceName: str
    sourceSha256: str
    sectionId: str
    heading: str
    startLine: int
    endLine: int
    quote: str


class WikiSnapshot(TypedDict):
    schemaVersion: int
    sourceDatabase: str
    sourceDatabaseSha256: str
    generatedAt: str
    entries: list[WikiEntry]


SPECS: Final[tuple[ExtractSpec, ...]] = (
    ExtractSpec(
        "older-tailored-care",
        "c85717fe8f93520d7fcd",
        ("노인맞춤돌봄", "노인돌봄맞춤", "독거노인돌봄"),
        "노인맞춤돌봄서비스",
        "£ 일상생활 영위가 어려운 취약노인에게",
        "### 나. 서비스 대상",
    ),
    ExtractSpec(
        "discharge-intensive-care",
        "c85717fe8f93520d7fcd",
        ("퇴원환자단기", "퇴원환자지역사회", "퇴원지원", "지역사회연계"),
        "퇴원환자 단기집중 서비스",
        "(퇴원환자 단기집중 서비스)",
        "![image]",
    ),
    ExtractSpec(
        "urgent-care",
        "91927e487b4ab2b896d0",
        ("긴급돌봄", "단기돌봄", "틈새돌봄"),
        "긴급돌봄 지원사업",
        "갑작스러운 돌봄공백에 적시대응하여",
        "보건복지부",
    ),
    ExtractSpec(
        "daily-care",
        "ec5fc2ac018f1e15df5c",
        ("일상돌봄",),
        "일상돌봄 서비스",
        "(개요)",
        "| (대상자)",
    ),
    ExtractSpec(
        "housekeeping-nursing",
        "6f2ea9fea60d7be2ce17",
        ("가사간병방문지원", "가사간병", "신체수발"),
        "가사·간병 방문지원사업",
        "## 2 서비스 내용",
        "## 3 서비스 준비",
    ),
    ExtractSpec(
        "integrated-care",
        "125256b5ab3fddf8a0be",
        ("통합돌봄", "통합지원", "통합사례관리", "케어안내창구"),
        "의료·요양·돌봄 통합지원",
        "(목표)",
        "다 추진원칙",
    ),
    ExtractSpec(
        "home-visit-care",
        "6d67ba6405751327cc72",
        ("일차의료방문진료", "재택의료센터", "방문의료", "방문진료"),
        "일차의료 방문진료 수가 시범사업",
        "사업 목적",
        "서비스 내용",
    ),
    ExtractSpec(
        "polypharmacy",
        "ef3351f7c8654e00d826",
        ("다제약물", "방문복약", "복약관리", "복약지도"),
        "다제약물관리사업",
        "라 다제약물관리사업",
        "### 서비스 대상",
    ),
    ExtractSpec(
        "emergency-safety",
        "a297ec1449879873ea82",
        ("응급안전안심", "안전안심서비스", "응급호출", "안부살핌"),
        "독거노인·장애인 응급안전안심서비스",
        "나 독거노인·장애인 응급안전안심서비스",
        "### 서비스 대상",
    ),
    ExtractSpec(
        "home-medical-aid",
        "2ec7fbd0b6f776e1b638",
        (
            "재가의료급여",
            "의료급여사례관리",
            "식사지원",
            "도시락",
            "반찬",
            "병원동행",
            "이동지원",
            "가사지원",
        ),
        "재가 의료급여",
        "### ● 의료급여 퇴원자의",
        "### ｜재가 의료급여 급여 유형｜",
    ),
    ExtractSpec(
        "disability-health",
        "fc4157dc155e269976d0",
        ("장애인건강주치의", "장애인건강보건", "지역사회중심재활", "장애인재활"),
        "장애인 건강보건 사례관리",
        "Ⅰ 내용 의료를 기반으로",
        "Ⅰ 방법",
    ),
    ExtractSpec(
        "long-term-care",
        "5a96b2938fb2905f89a8",
        ("장기요양방문요양", "장기요양방문간호", "장기요양방문목욕", "통합재가", "주야간보호"),
        "노인장기요양보험",
        "## ② 목적",
        "## ③ 대상",
    ),
)


def file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def clean_quote(value: str) -> str:
    without_html = re.sub(r"<[^>]+>", " ", value)
    without_markdown = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", without_html)
    without_images = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", without_markdown)
    normalized = (
        without_images.replace("\\~", "~")
        .replace("\\", "")
        .replace("£", "")
        .replace("●", "")
    )
    return re.sub(r"\s+", " ", normalized).strip(" -|\t\r\n")


def extract_quote(content: str, spec: ExtractSpec, section_start_line: int) -> tuple[str, int, int]:
    start = content.find(spec.start_marker)
    if start < 0:
        raise LookupError(f"start marker missing for {spec.entry_id}")
    end = content.find(spec.end_marker, start + len(spec.start_marker))
    if end < 0:
        raise LookupError(f"end marker missing for {spec.entry_id}")
    quote = clean_quote(content[start:end])
    if len(quote) < 20:
        raise LookupError(f"quote too short for {spec.entry_id}")
    quote_start_line = section_start_line + content[:start].count("\n")
    quote_end_line = quote_start_line + content[start:end].count("\n")
    return quote, quote_start_line, quote_end_line


def build_entry(connection: sqlite3.Connection, spec: ExtractSpec) -> WikiEntry:
    query = (
        "SELECT s.source_name, s.title, s.headings, s.start_line, s.end_line, "
        "s.content, d.sha256 FROM sections AS s "
        "JOIN documents AS d USING (source_name) WHERE s.section_id = ?"
    )
    row = connection.execute(query, (spec.section_id,)).fetchone()
    if row is None:
        raise LookupError(f"section missing: {spec.section_id}")
    source_name, title, headings, start_line, end_line, content, source_sha = row
    quote, quote_start_line, quote_end_line = extract_quote(
        str(content), spec, int(start_line)
    )
    return WikiEntry(
        id=spec.entry_id,
        terms=list(spec.terms),
        sourceName=str(source_name),
        sourceSha256=str(source_sha),
        sectionId=spec.section_id,
        heading=spec.citation_heading,
        startLine=quote_start_line,
        endLine=quote_end_line,
        quote=quote,
    )


def export_snapshot(database: Path, output: Path) -> None:
    database_uri = f"file:{database.as_posix()}?mode=ro"
    with sqlite3.connect(database_uri, uri=True) as connection:
        entries = [build_entry(connection, spec) for spec in SPECS]
    snapshot = WikiSnapshot(
        schemaVersion=1,
        sourceDatabase="wiki/kb-v120/welfare.db",
        sourceDatabaseSha256=file_sha256(database),
        generatedAt=datetime.fromtimestamp(database.stat().st_mtime, tz=UTC).isoformat(),
        entries=entries,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main(arguments: Sequence[str]) -> int:
    if len(arguments) != 3:
        print("usage: export-welfare-talk-wiki.py <welfare.db> <output.json>", file=sys.stderr)
        return 2
    export_snapshot(Path(arguments[1]).resolve(), Path(arguments[2]).resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
