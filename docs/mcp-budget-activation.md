# Korean Welfare MCP — 예산 포함 공개 버전 1.1.0

## 제공 범위

기존 사이트의 `/mcp` 서버와 Sites 관리 연결을 유지한다. 공개 도구는 21개이며, 기존 복지·출처·보도자료·외부 연계 조회 15개에 재정·예산서 조회 6개를 제공한다. 별도의 서버, 로컬 stdio 서버 또는 데이터 사본을 만들지 않는다.

| 도구 | 제공 내용 |
|---|---|
| `get_fiscal_catalog` | 재정주체·부서·회계·분류·가용 기준일·예산서 문서 단계·부서 이력 |
| `find_budget_projects` | 재정사업 메타데이터, 검증된 금액, 조건별 검증 부분 합계 |
| `get_budget_execution` | 사업별 예산현액·누적 공개 지출액·집행률·기준일 |
| `compare_budget_periods` | 검증된 관측 기간 비교, 본예산·추경 문서 단계 비교 |
| `search_budget_lines` | 연도·기관·발행지역·단계·문서·계층별 세부사업·부기 검색 |
| `get_budget_breakdown` | 선택한 예산서 행과 하위 편성목·통계목·부기·산출식·재원·근거 |

기존 `search`와 `fetch`도 예산서 행(`bl-…`)을 지원한다. `search`의 기존 `{results:[{id,title,url}]}` 형식과 `fetch`의 카드 형식을 유지한다. `get_sources(subject_type="budget_line")`로 문서 원문, SHA-256, 파싱 위치를 확인한다.

## 금액 제공 규칙

- 지방재정365는 현재 `PUBLISHED`인 snapshot에 속해야 한다.
- 같은 수집 실행·기준일의 공식 화면 대조 기록이 있어야 한다. snapshot 완전 수집, 불일치 0, API에만 있는 행 0, 대조 행 수가 양수이고 snapshot 행 수 이상, 금액 6개 필드의 유효 대조를 확인한다.
- 위 조건과 원 단위를 확인하지 못한 관측은 사업명·ID·기준일·출처는 제공하고 금액·재원·원값·차액·집행률을 `null`로 표시한다. `null`은 0원이 아니다.
- `include_summary=true`는 검증된 행만 포함한 부분 합계다. `matching_rows`, `included_rows`, `excluded_rows`, `aggregation_scope`를 확인한다. 기준일이 다르거나 확인되지 않았거나 동일 사업 관측이 겹치면 합계는 제공하지 않는다.
- 검증 완료는 해당 공식 공개 관측의 대조 결과이며 실시간 내부 장부·최종 수혜기관 집행 확인이 아니다.

예산서는 `budget_active_revision`에 있는 승인 반입을 독립적으로 제공한다. 재정 API 단위 미검증 때문에 승인 문서까지 숨기지 않는다. 문서 금액은 그 편성 단계의 원문 값으로, API 예산현액을 대신하지 않는다. 문서 표시 금액(천원)과 원 환산값은 각각 유지한다. `server_checks`, `checks`, `annotations`로 부분 수록과 검산 상태를 구분한다. 승인 반입이 모든 산출식의 검산 완료를 뜻하지 않는다.

## 공개본과 근거

공통 응답 schema 2.0에 `components.budget_documents`가 추가된다. 통합 공개본에는 `(import_id, revision_id)` 쌍을 고정한다. 예산서가 바뀌면 새 공개본과 커서가 필요하며 현재 활성 상태도 확인하므로 철회된 구판은 즉시 제외된다. 최초 배포 직후 기존 공개본에 이 구성요소가 없다면 빈 pin으로 처리한다. 기존 배경 공개본 갱신 후 새 문서 구성요소가 제공된다.

예산서 원문 위치는 파싱 결과의 page/table/block/row이며 실제 인쇄 쪽수 확인을 뜻하지 않는다. `physical_page_verified=false`를 유지한다. 문서의 상위 총액·하위 행·재원은 계층 설명이므로 중복 합산하지 않는다. 재정사업과 예산서를 이름으로 연결한 항목은 `CANDIDATE_NAME_MATCH`로 표시하고 동일 사업이라고 확정하지 않는다.

숫자 부서코드는 `fiscal_entity_id`와 함께 지정한다. 전체 부서 ID(`lofin:dept:<기관코드>:<부서코드>`)를 사용하면 기관을 고정하며 다른 기관의 부서 ID와 섞인 요청은 거절한다. 원천 부서코드와 연도 이력을 유지하며 부서명·신설·폐지·이관을 추정하지 않는다.

## 조회 예시

먼저 `get_dataset_status({})`에서 제공 범위와 공개본을 확인한다. ID는 응답에서 받아 후속 도구에 전달한다.

```json
{"name":"search_budget_lines","arguments":{"query":"청년","fiscal_year":2026,"issuer_sido":"충청남도","limit":20}}
```

```json
{"name":"get_fiscal_catalog","arguments":{"catalog_type":"budget_document","fiscal_year":2026,"limit":20}}
```

`get_budget_breakdown`에는 위 검색 결과의 `budget_line_id`와 `document_revision_id`를 전달한다. `next_cursor`가 있으면 같은 조건을 유지하여 이어서 조회한다. `root`는 기준 행이고 `lines`에는 해당 행과 하위 행이 들어가므로 `root` 금액을 다시 더하지 않는다.

기존 검색 클라이언트는 `search({"query":"청년인턴"})` 결과의 `bl-…` ID를 `fetch`에 전달할 수 있다.

## 검증과 배포

관련 시험은 실제 SQLite 마이그레이션, 실제 JSON-RPC 요청, 공식 MCP SDK 클라이언트를 사용한다.

```bash
node --test --test-timeout=20000 lib/mcp-server.test.mjs lib/budget-documents.test.mjs lib/fiscal-query-page.test.mjs lib/platform-rollback.test.mjs lib/fiscal-department-history.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

시험 범위에는 21개 도구 등록·호환성, 원값 포함 미검증 금액 차단, 유효 검증/불일치/검증 행 0, 부서 기관 충돌, 날짜 혼합·중복 합계, API 없이 독립 문서 조회, 문서 교체·철회·커서 변경, 문서 200개 이후 목록 및 1,500행 초과 산출내역이 포함된다.

배포는 기존 프로젝트의 Sites source helper로 검사·build·commit/push·archive를 수행한 뒤 saved version을 발행한다. SDK 1.32.0과 기존 전송·Origin·Sites 인증·요청 제한을 유지한다. DB 마이그레이션이나 기존 원본 데이터 수정은 필요하지 않다.

배포 완료와 MCP 연결 확인은 구분한다. 활성화 검수는 `get_dataset_status → search_budget_lines → get_budget_breakdown → get_sources`의 실제 원격 호출로 수행한다. 기존 검색 클라이언트의 `search → fetch`도 확인한다. 새로운 plugin이나 로컬 MCP 연결을 중복 생성하지 않는다.
