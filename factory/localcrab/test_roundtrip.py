"""Welfare → LocalCrab → Welfare 왕복 시험(작업지시서 v5 T34). 실행: python -m unittest discover -s factory/localcrab -p "test_*.py"."""
from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

import welfare_localcrab as adapter

FIXTURE = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "roundtrip" / "two-sources"


class RoundTripTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.upstream = adapter.load_upstream()
        cls.validator = cls.upstream[0]

    def setUp(self) -> None:
        self.work = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.work.name, "graph.db")
        self.records = adapter.read_pack(str(FIXTURE))

    def tearDown(self) -> None:
        self.work.cleanup()

    def test_lossless_roundtrip_keeps_type_direction_scope_condition_evidence(self) -> None:
        result = adapter.roundtrip(self.records, self.db, self.upstream)
        self.assertEqual(result["losses"], [])
        back = adapter.restore(self.db)
        amount = next(row for row in back["statements"] if row["predicate_id"] == "benefit_amount")
        self.assertEqual((amount["unit"], amount["scope_text"]), ("KRW/년", "기초생활수급 가구, 2026-11-01~2027-03-31"))
        self.assertTrue(any(row["predicate_id"] == "exclusion" for row in back["statements"]), "제외조건이 일반 관계로 뭉개지지 않음")
        two = [row for row in back["evidence"] if row["statement_id"] == next(s["statement_id"] for s in back["statements"] if s["predicate_id"] == "eligibility")]
        self.assertEqual(len(two), 2, "한 사실의 근거 2개가 모두 그 사실을 지지")
        cell = next(row for row in back["evidence"] if row["cell"])
        self.assertEqual((cell["ir_pointer"], cell["cell"], cell["physical_page_verified"]), ("/blocks/7/table/cells/2/1", "2:1", False))

    def test_upstream_grammar_rejects_squashing_welfare_relations(self) -> None:
        self.assertFalse(self.validator.validate_edge("concept", "concept", "available_in").valid)
        self.assertFalse(self.validator.validate_edge("claim", "concept", "about").valid, "Claim→개체 관계는 문법에 없어 subject_id 속성으로 둔다")
        self.assertFalse(self.validator.validate_edge("claim", "evidence", "supports").valid, "근거 방향은 evidence→claim만 허용")
        self.assertFalse(self.validator.validate_node("concept", "Claim").valid)
        self.assertTrue(self.validator.validate_edge("evidence", "claim", "supports").valid)

    def test_missing_or_reversed_evidence_edge_is_detected(self) -> None:
        adapter.project(self.records, self.db, self.upstream)
        connection = sqlite3.connect(self.db)
        connection.execute("DELETE FROM graph_edges WHERE relation = 'supports' AND rowid = (SELECT MIN(rowid) FROM graph_edges WHERE relation = 'supports')")
        connection.commit()
        connection.close()
        with self.assertRaisesRegex(ValueError, "EVIDENCE_EDGE_MISSING"):
            adapter.restore(self.db)

    def test_comparator_reports_changed_scope_as_loss(self) -> None:
        adapter.project(self.records, self.db, self.upstream)
        connection = sqlite3.connect(self.db)
        row = connection.execute("SELECT node_id, properties FROM graph_nodes WHERE node_type = 'Claim' LIMIT 1").fetchone()
        props = json.loads(row[1])
        props["welfare_record"]["scope_text"] = "바뀐 범위"
        connection.execute("UPDATE graph_nodes SET properties = ? WHERE node_type = 'Claim' AND node_id = ?", (json.dumps(props, ensure_ascii=False), row[0]))
        connection.commit()
        connection.close()
        before, after = adapter.canonical(self.records), adapter.canonical(adapter.restore(self.db))
        self.assertNotEqual(before["statements"], after["statements"])

    def test_pinned_commit_is_required(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "UPSTREAM_MISSING"):
            adapter.load_upstream(self.work.name)


if __name__ == "__main__":
    unittest.main()
