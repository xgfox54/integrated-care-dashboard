#!/usr/bin/env python3
"""Join the completed, prespecified AI reviews and verify their native evidence.

This is an offline report assembler. It neither generates answers nor grades
them, and refuses incomplete reviews instead of filling missing judgments.
"""
import argparse
import collections
import datetime
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path


CLASSES = ("adequate_candidate", "partial_evidence", "unrelated", "insufficient")
STATES = ("covered", "partial", "not_observed", "not_evaluated")
LABELS = {
    "adequate_candidate": "필요 기준의 근거 후보 확보",
    "partial_evidence": "일부 근거 확보",
    "unrelated": "다른 주제·대상 자료",
    "insufficient": "판단할 근거 부족",
    "covered": "직접 관찰", "partial": "부분 관찰",
    "not_observed": "관찰 못함", "not_evaluated": "평가하지 않음",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--records", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    repo = args.repo.resolve()
    output = args.output or repo / "docs/qa/faq-200-20261010"
    records_path = args.records or output / "records.jsonl.gz"
    qa_path = repo / "quality/faq_200_20261010.json"
    qa_bytes = qa_path.read_bytes()
    qa = json.loads(qa_bytes)
    questions = {row["id"]: row for row in qa["items"]}
    preparation = json.loads((repo / "docs/qa/manual-corpus-runtime-20261010/semantic-review-spaced-preparation.json").read_text())
    files = [output / ("semantic-review-" + suffix + ".json") for suffix in ("targeted", "spaced-early", "spaced-later")]
    reviews = [json.loads(path.read_text()) for path in files]
    target_ids = set(reviews[0]["sample"]["ids"])
    spaced_ids = {row["id"] for row in preparation["items"]}
    require(not target_ids & spaced_ids, "Prespecified review samples overlap")
    expected = target_ids | spaced_ids
    require(len(target_ids) == 12 and len(spaced_ids) == 11 and len(expected) == 23, "Unexpected prespecified sample")

    spec = importlib.util.spec_from_file_location("manual_integrity", repo / "scripts/manuals/audit-manual-fetch-integrity.py")
    integrity = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(integrity)
    rows, seen = {}, set()
    opener = gzip.open if records_path.suffix == ".gz" else open
    with opener(records_path, "rt", encoding="utf-8") as stream:
        for line in stream:
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("id") not in questions:
                continue
            require(row["id"] not in seen, "Duplicate native question record")
            seen.add(row["id"])
            if row["id"] in expected:
                rows[row["id"]] = row.get("raw", row)
    require(seen == set(questions) and len(seen) == 200, "All 200 native question records are required")

    items, found, notes, spans, fetch_ids = [], set(), [], set(), set()
    quote_occurrences = body_links = body_chars = 0
    file_provenance = []
    for path, review in zip(files, reviews, strict=True):
        file_provenance.append({"path": str(path.relative_to(repo)), "sha256": digest(path.read_bytes())})
        for item in review["items"]:
            qid = item["id"]
            require(qid in expected and qid not in found, "Unexpected or duplicate review ID: " + qid)
            found.add(qid)
            question = questions[qid]
            require(item["question"] == question["question"] and item["question_sha256"] == question["provenance"]["question_sha256"], qid + " question changed")
            require(item["semantic_classification"] in CLASSES, qid + " review is incomplete")
            require(item["human_review"] == "PENDING" and item["answer_correctness"] == "NOT_EVALUATED", qid + " review must not become answer scoring")
            criteria = item["criteria"]
            expected_criteria = [line for line in question["evaluation_criteria"].splitlines() if line.strip()]
            require([c["provided_text"] for c in criteria] == expected_criteria, qid + " original criteria changed")
            require(all(c["observation_status"] in STATES for c in criteria), qid + " criterion is incomplete")
            raw = rows[qid]
            require(raw.get("transport") == "native_connector" and raw["search"]["arguments"]["query"] == question["question"], qid + " lacks original native query")
            search, ok, same = integrity.unwrap(raw["search"]["result"])
            require(ok and same is not False and isinstance(search.get("results"), list), qid + " search invalid")
            selected = {rank: hit for rank, hit in enumerate(search["results"][:5], 1)}
            require(all(hit["id"].startswith("manual:") for hit in selected.values()), "This run's review assembler expects manual-only top-five evidence")
            candidates = item.get("candidate_reviews", item.get("candidates", []))
            require(len(candidates) == len(selected), qid + " must review every original top-five candidate")
            fetched = {entry["id"]: entry for entry in raw["fetched"]}
            contexts = {}
            for candidate in candidates:
                rank = candidate.get("rank", candidate.get("original_rank"))
                require(rank in selected and candidate["id"] == selected[rank]["id"], qid + " candidate rank changed")
                require(rank not in contexts, qid + " duplicate candidate rank")
                entry = fetched[candidate["id"]]
                require(entry["rank"] == rank, qid + " native detail rank mismatch")
                call_id = candidate.get("fetch_call_id", candidate.get("call_id"))
                require(call_id == entry["call_id"], qid + " detail call changed")
                payload, ok, same = integrity.unwrap(entry["result"])
                require(ok and same is not False and payload["id"] == candidate["id"], qid + " detail response mismatch")
                body, prefix_ok, suffix_ok = integrity.extract_body(payload)
                require(prefix_ok and suffix_ok, qid + " manual body frame invalid")
                require(digest(body.encode()) == candidate.get("body_sha256", candidate.get("returned_body_sha256")), qid + " reviewed body differs from native response")
                require(payload["metadata"]["excerpt"] == candidate.get("body_extent", candidate.get("excerpt")), qid + " reviewed body extent changed")
                contexts[rank] = {"body": body, "id": candidate["id"], "call_id": call_id}
                body_links += 1
                body_chars += len(body)
                fetch_ids.add(candidate["id"])
            for parent in criteria + candidates:
                for quote in parent.get("evidence", parent.get("quotes", [])):
                    rank = quote.get("rank", quote.get("original_rank", parent.get("rank", parent.get("original_rank"))))
                    require(rank in contexts, qid + " quote outside selected context")
                    context = contexts[rank]
                    text = quote.get("quote", quote.get("text"))
                    start = quote.get("body_code_point_start", quote.get("body_char_start"))
                    end = quote.get("body_code_point_end_exclusive", quote.get("body_char_end_exclusive"))
                    require(isinstance(start, int) and isinstance(end, int) and 0 <= start < end <= len(context["body"]), qid + " quote bounds invalid")
                    require(context["body"][start:end] == text, qid + " quote is not exact native body text")
                    require(quote.get("candidate_id", context["id"]) == context["id"], qid + " quote candidate mismatch")
                    require(quote.get("fetch_call_id", quote.get("call_id", context["call_id"])) == context["call_id"], qid + " quote call mismatch")
                    spans.add((qid, rank, start, end, text))
                    quote_occurrences += 1
            reason = item.get("classification_reason", item.get("assessment"))
            require(isinstance(reason, str) and reason.strip(), qid + " assessment is missing")
            counts = collections.Counter(c["observation_status"] for c in criteria)
            items.append({"id": qid, "question": item["question"], "question_sha256": item["question_sha256"],
                "semantic_classification": item["semantic_classification"], "assessment": reason,
                "criterion_counts": {key: counts[key] for key in STATES}, "criteria": criteria,
                "source_review": str(path.relative_to(output)), "original_top5_first_fetches_reviewed": len(contexts),
                "human_review": "PENDING", "answer_correctness": "NOT_EVALUATED"})
            note = "AI 근거 검토(사람 검수 미완료): " + LABELS[item["semantic_classification"]] + ". " + reason
            note += "\n평가요소 관찰: " + " / ".join(LABELS[key] + " " + str(counts[key]) for key in STATES)
            note += "\n원순위 1~5위 범위에서 실제 반환된 " + str(len(contexts)) + "개 후보의 첫 상세만 검토. 최종 답변은 생성·채점하지 않음."
            notes.append({"id": qid, "status": "검토 메모 있음", "note": note})
    require(found == expected, "Missing prespecified reviews")
    items.sort(key=lambda row: row["id"])
    notes.sort(key=lambda row: row["id"])
    classes = collections.Counter(row["semantic_classification"] for row in items)
    states = collections.Counter(c["observation_status"] for row in items for c in row["criteria"])
    require(sum(states.values()) == 68, "Original sample must retain all 68 criteria")
    summary = {"schema_version": "faq-semantic-review-summary-1", "recorded_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "status": "AI_EVIDENCE_REVIEW_COMPLETED", "reviewed_questions": 23,
        "selection": {"targeted": 12, "spaced": 11, "prespecified": True, "statistically_representative": False},
        "classifications": {key: classes[key] for key in CLASSES}, "criterion_observations": {key: states[key] for key in STATES},
        "evidence_validation": {"status": "PASS", "original_questions_verified": 23, "original_criteria_verified": 68,
            "original_top5_first_fetch_links": body_links, "unique_first_fetch_ids": len(fetch_ids),
            "linked_body_code_points_read": body_chars, "quote_occurrences_verified": quote_occurrences,
            "unique_quoted_spans_verified": len(spans), "network_calls": 0, "raw_records_changed": False},
        "provenance": {"question_dataset_sha256": digest(qa_bytes), "records": str(records_path),
            "records_file_sha256": digest(records_path.read_bytes()), "review_files": file_provenance,
            "assembler_sha256": digest(Path(__file__).read_bytes())},
        "human_review": "PENDING", "answer_correctness": "NOT_EVALUATED", "items": items,
        "limitations": ["사전 지정한 23문항의 AI 근거 검토이며 200문항의 정답률이나 일반화 성능으로 환산하지 않는다.",
            "추가 구간·다른 질문·미반환 원천 DB 본문으로 의미 판정을 채우지 않았다.",
            "본문의 사실·절차 근거와 생성하지 않은 답변의 단정·추가질문 행동을 구별한다. 행동 기준은 not_evaluated이며 원 평가요소는 보존한다.",
            "문서명 연도·본문 문자열 일치를 개인 자격이나 현행 법령의 확인값으로 사용하지 않는다."]}
    output.mkdir(parents=True, exist_ok=True)
    for filename, value in [("semantic-review-summary.json", summary), ("ai-review-notes.json", notes)]:
        (output / filename).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": summary["status"], "reviewed_questions": 23, "classifications": summary["classifications"],
        "criterion_observations": summary["criterion_observations"], "evidence_validation": summary["evidence_validation"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
