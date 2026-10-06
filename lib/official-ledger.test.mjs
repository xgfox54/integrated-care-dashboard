// 원본 행 원장(T02·T49) 계산: 추출 = 반영 + 미해결 + 제외, 문서별 불일치 검출.
import assert from "node:assert/strict";
import test from "node:test";

import { buildSourceRowLedger, ledgerTotals } from "./official-ledger.ts";

const service = (serviceId, extra = {}) => ({ serviceId, sido: "강원특별자치도", sigungu: "강릉시", category: "돌봄", subcategory: "안부확인", name: "사업 " + serviceId, description: "", target: "", detailTarget: "", provider: "", type: "지자체", serial: "1", detailUrl: "", updatedDate: "", ...extra });

test("문서별로 추출 행을 반영·미해결·이유 있는 제외로 나누고 합이 맞는지 본다", () => {
  const fragment = service("0075:1:1:1:3");
  const rows = buildSourceRowLedger({
    documents: [{ documentId: "0075:1:1", extracted: 4, parsed: 3 }, { documentId: "0075:10:1", extracted: 1, parsed: 1 }],
    removedFragments: [fragment],
    finalServices: [service("0075:1:1:1:1"), service("0075:1:1:1:2", { subcategory: "" }), service("0075:10:1:1:1")],
  });
  assert.deepEqual(rows.find((row) => row.document_id === "0075:1:1"), { document_id: "0075:1:1", extracted: 4, mapped: 1, preserved_unresolved: 1, excluded_unparseable: 1, excluded_fragment: 1, traced: 2 });
  assert.equal(rows.find((row) => row.document_id === "0075:10:1").mapped, 1, "0075:1:1 접두가 0075:10:1 행을 가로채지 않음");
  const totals = ledgerTotals(rows);
  assert.equal(totals.balanced, true);
  assert.deepEqual(totals.excluded_with_reason, { UNPARSEABLE_ROW: 1, CONTINUATION_FRAGMENT: 1 });
  const broken = ledgerTotals([{ ...rows[0], mapped: 0 }]);
  assert.equal(broken.balanced, false);
  assert.deepEqual(broken.unbalanced_documents, ["0075:1:1"], "빠진 행이 있으면 그 문서를 짚는다");
});
