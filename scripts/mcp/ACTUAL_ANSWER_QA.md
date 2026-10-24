# 실제 ChatGPT 답변 평가 — 10개 분야 균등 50문항

이 평가는 검색계약 시험과 별개다. 10개 검색 분야에 신규 질문 5개씩 배정하고 실제 화면에 나온 답변을 사람이 근거와 대조한다. 원래 FAQ788 결과는 수정하거나 합산하지 않는다. 신규 문장 평가이며 과거와 자료 주제가 겹치므로 `NEW_PROMPTS_NOT_SOURCE_DISJOINT`로 표시한다.

## 실행

워크스페이스 루트 기준 질문 파일은 `outputs/mcp-improvements/answer-benchmark-questions.json`, 모델 제출용 파일은 `outputs/mcp-improvements/answer-benchmark-prompts.json`이다. 저장소 안의 동결본은 `scripts/mcp/fixtures/answer-benchmark-questions.json`이다. `question`만 모델에 전달한다. 정답 단서·기대 출처·루브릭은 모델에게 보내지 않는다.

기존 연결된 ChatGPT에서 5.6 Medium으로 일회성 답변을 생성한다. 예약 작업·API 키·LLM API 호출은 이 도구에 없다. 여러 질문을 한 대화에서 받아도 되지만 각 문항의 답변 구간을 정확히 분리하고 동일 답변 구간을 재사용하지 않는다. 질문·답변·모델 표시·대화 URL이 함께 남는 원래 화면 캡처(JSON DOM 추출 또는 UTF-8 텍스트)를 보존한다. 스크린샷만으로는 텍스트 대조가 불가능하므로 DOM/접근성 캡처를 함께 둔다.

저장소 `work/site`에서 다음을 실행한다. 모든 입력 증거 경로는 마지막 `EVIDENCE_ROOT`에 상대적이다.

```sh
node scripts/mcp/evaluate-actual-answers.mjs ../../outputs/mcp-improvements/answer-benchmark-questions.json ../../outputs/mcp-improvements/actual-answer-reviews.json ../../outputs/mcp-improvements/actual-answer-evaluation.json ../..
```

종료코드 0은 모든 분야와 전체 평균이 95% 이상, 1은 유효한 검토를 마쳤으나 점수 미달, 2는 누락·중복·불균형·해시/캡처/검토근거 오류다. 무효한 입력은 `actual_answer_accuracy: NOT_EVALUATED`로 기록한다. 분야당 5문항이므로 1개라도 틀리거나 미확정이면 그 분야는 80%여서 전체 평균이 98%여도 통과하지 못한다.

## 수동 검토 규칙

1. 검색 후보의 존재를 정답으로 인정하지 않는다. 원문 상세와 답변의 각 핵심 주장을 대조한다. 질문 파일의 `expected_evidence`는 직접 읽은 저장자료 위치이며, 과거 검색결과는 정답이나 현행정책 보증이 아니다. 파일 해시와 JSON 위치가 바뀌면 평가가 거부된다.
2. 각 문항의 네 기준(`answer_correctness`, `scope_and_time`, `citations_and_limits`, `case_specific`)을 모두 검토한다. 각 기준에 PASS/FAIL/SOURCE_UNRESOLVED, 20자 이상의 구체적인 판단 설명, 실제 답변 인용, 원문 증거 ID를 기록한다.
3. 금액·단위·지역·연도·조건·예외 누락, 잘못된 비교, 본문 미확인 추정, 검색공백을 0이나 사업부재로 확정한 경우는 FAIL이다. 원문이 모호하거나 필요한 근거를 확보하지 못하면 SOURCE_UNRESOLVED다. 답변이 근거부족을 올바르게 밝힌 경우는 질문의 목적과 확인된 출처 범위를 근거로 판단한다. 막연한 답변 회피를 자동 PASS로 처리하지 않는다.
4. 전체 기준이 PASS일 때만 CORRECT다. FAIL은 INCORRECT, FAIL 없이 미확정 기준이 있으면 SOURCE_UNRESOLVED다. 두 경우 모두 50개 분모에 포함한다. 증거 누락은 채점실패이며 문항을 빼고 점수를 만들지 않는다.
5. `source_evidence`에 실제 확인한 공식 원문/저장원문/조회상태 파일, 파일 SHA256, 출처 URL, 위치, 그 파일에서 확인되는 원문 인용, 확인시각을 기록한다. 검토자 주장만으로 출처 내용을 검증하지 않는다. 파일 내용과 인용의 일치를 평가기가 검사하지만 정책의 진실성은 자동 판정하지 않는다.
6. 화면에서 실제 도구 호출이 보이지 않으면 `tool_usage_visibility: NOT_VISIBLE`다. 호출 관찰을 주장하려면 해당 도구명이 있는 `tool_capture` 파일과 해시가 필요하다. 이 점수는 질문 분야의 답변 정확도이며 도구 호출 자체의 성공률이 아니다.

## 답변 기록 형식

`actual-answer-schema.mjs`가 정식 계약이다. `actual-answer-review-template.json`은 빈 필드와 PENDING이 있는 작업용 양식이므로 그대로는 평가에 통과하지 않는다. 문항별 레코드의 핵심 형태는 아래와 같다. 예시 값은 실제 증거가 아니다.

```json
{
  "observation_type": "actual_chatgpt_answer",
  "benchmark_id": "balanced-actual-answers-50-20261012",
  "case_id": "ANS-001", "domain": "search", "question_sha256": "질문 파일의 해시",
  "answer_text": "원래 캡처에 있는 해당 질문의 실제 답변 구간",
  "conversation_url": "https://chatgpt.com/c/실제대화ID",
  "turn_id": "실제메시지ID", "model_label": "5.6 Medium", "reasoning_effort": "medium",
  "captured_at": "2026-10-12T09:00:00Z",
  "capture": {"path": "outputs/mcp-improvements/captures/actual.json", "sha256": "파일SHA256"},
  "tool_usage_visibility": "NOT_VISIBLE",
  "source_evidence": [{"id": "source-1", "artifact": {"path": "outputs/mcp-improvements/sources/source.json", "sha256": "파일SHA256"}, "source_url": "https://공식출처", "locator": "페이지·행·표·절 등", "source_quote": "파일에서 확인한 실제 인용", "kind": "OFFICIAL_SOURCE", "checked_at": "2026-10-12T09:10:00Z"}],
  "review": {"reviewer": "검토자", "reviewed_at": "2026-10-12T09:15:00Z", "method": "MANUAL_SOURCE_COMPARISON", "criteria": [{"id": "answer_correctness", "verdict": "PASS", "explanation": "답변 주장과 원문 조건을 대조한 구체적인 설명을 20자 이상 기록", "answer_quote": "실제 답변의 인용", "source_evidence_ids": ["source-1"]}]}
}
```

위 예시는 기준 한 개만 보여 준다. 실제 기록에는 질문 파일의 모든 기준이 필요하다. 동일 대화·메시지의 여러 답변 구간은 허용하지만 같은 구간을 복사하여 여러 문항을 채점하면 거부된다. 출력 `review_basis: MANUAL_REVIEW_REPORTED`는 기록된 검토판정의 집계라는 한계를 보존한다.
