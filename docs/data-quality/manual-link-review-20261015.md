# 매뉴얼 연결 재검토 2026-10-15

총 4054건, 사업 2224개. 제목·절 기준 연결 133건, 확인 후보 3921건.

39개 합본 키의 연결과 공개 MCP 113개 문서는 관리 단위가 다릅니다. 보관 원본 파싱 코퍼스 114개와 공개 MCP 113개는 서로 다른 판본·파일명 체계이며 1:1 대응을 검증하지 않았습니다. 1개 문서 누락을 뜻하지 않습니다. confirmed는 제목·절 규칙상 직접 설명 분류이며 내용 검수완료 표시가 아닙니다. QUOTE_TEXT_MATCH는 저장된 원본 파싱 쪽 텍스트와 발췌의 대조이며 PDF 화면·적용연도·사업 동일성 검증이 아닙니다. 표 좌표·각주 위치는 저장 필드가 없어 null입니다. 이전 보고서의 curated extra 제도명 누락을 수정하고 실제 웹/MCP가 쓰는 talkRefs만 집계했으므로 이전 합계와 단순 비교하지 마세요.

```json
{
  "generated_at": "2026-10-15T03:23:02.195Z",
  "links": 4054,
  "programs": 2224,
  "by_type": {
    "CANDIDATE 연결 후보": 3921,
    "C 종합안내서 설명": 114,
    "B 본문 직접 설명": 14,
    "A 전용 매뉴얼": 5
  },
  "confirmed": 133,
  "candidates": 3921,
  "manuals_referenced": 39,
  "by_provenance": {
    "PAGE_QUOTE": 3955,
    "CONTEXT": 10,
    "MISSING": 6,
    "DOCUMENT": 71,
    "OCR_REVIEW": 12
  },
  "by_parsed_page_status": {
    "QUOTE_TEXT_MATCH": 3967,
    "NO_QUOTE": 81,
    "MISSING": 6
  },
  "mcp_catalog_documents": 113,
  "mcp_catalog_revision": "sgw-8a8f0554c99e-v1",
  "original_documents": 114,
  "original_revision": "sgw-originals-c9444df0dbe4-v1",
  "named_programs": true,
  "note": "39개 합본 키의 연결과 공개 MCP 113개 문서는 관리 단위가 다릅니다. 보관 원본 파싱 코퍼스 114개와 공개 MCP 113개는 서로 다른 판본·파일명 체계이며 1:1 대응을 검증하지 않았습니다. 1개 문서 누락을 뜻하지 않습니다. confirmed는 제목·절 규칙상 직접 설명 분류이며 내용 검수완료 표시가 아닙니다. QUOTE_TEXT_MATCH는 저장된 원본 파싱 쪽 텍스트와 발췌의 대조이며 PDF 화면·적용연도·사업 동일성 검증이 아닙니다. 표 좌표·각주 위치는 저장 필드가 없어 null입니다. 이전 보고서의 curated extra 제도명 누락을 수정하고 실제 웹/MCP가 쓰는 talkRefs만 집계했으므로 이전 합계와 단순 비교하지 마세요."
}
```

행별 원본 파일·쪽 범위·발췌·파싱 문서 ID·대조 상태는 동명 JSON에 보존합니다. 원본 쪽과 표·각주를 직접 검토하지 않은 후보는 확정하지 않았습니다.
