"""JS(UTF-16)와 Python(코드포인트) 오프셋 일치 시험(작업지시서 v5 T62). 실행: python -m unittest discover -s factory/tests -p "test_*.py"."""
from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class OffsetParityTest(unittest.TestCase):
    def test_python_slices_match_js_slices_and_never_split_surrogates(self) -> None:
        raw = subprocess.run(["node", str(HERE / "fixtures" / "offsets" / "emit-spans.mjs")], capture_output=True, check=True).stdout.decode("utf-8")
        data = json.loads(raw)
        text = data["text"]
        self.assertIn("\n", text, "줄바꿈 보존")
        for maximum in {span["max"] for span in data["spans"]}:
            spans = [span for span in data["spans"] if span["max"] == maximum]
            for span in spans:
                piece = text[span["start_cp"]:span["end_cp"]]
                self.assertEqual(piece, span["js_slice"], span)
                piece.encode("utf-8")  # 대리쌍 가운데에서 잘렸으면 홀로 남은 대리 문자로 실패한다
            self.assertEqual("".join(text[s["start_cp"]:s["end_cp"]] for s in spans), text, "조각을 이으면 원문")
        for symbol in ["²", "≤", "≥", "𝑥", "😀", "₂", "−", "℃", "〈", "①"]:
            self.assertIn(symbol, text)


if __name__ == "__main__":
    unittest.main()
