# 복지정보MCP FAQ·골든 QA 운영 평가

**기본 평가셋은 첨부 Excel에서 원문 그대로 추출한 FAQ 200문항이다.** `quality/active-benchmark.json`이 선택한 `quality/faq_200_20261010.json`을 사용한다. 기존 `quality/golden_qa_v1.4.0.json`과 과거 실행 결과는 보존하며 `--golden`으로 명시적으로 선택할 수 있다.

매뉴얼 FAQ 1,173개를 추가한 129·매뉴얼 합계 1,961개 세트는 `--golden quality/faq-test-suite.json`으로 선택한다. 원문·출처·검수 상태와 실행 방법은 [매뉴얼 FAQ 테스트 세트 안내](../../quality/manual_faq_20261013.README.md)에 있다. 평가기 1.2.0은 200개를 넘는 FAQ 세트, 129 원문 상세 수집, 출처별 집계와 원문 답변 후보 보존을 지원한다. 원문 답변 후보의 의미 검수와 실제 GPT 답변 평가는 별도다.

평가기 1.1.1은 두 프로필을 구분한다. FAQ의 `faq_source_observation`은 호출·본문 구간·출처 위치와 연도 provenance를 관찰한다. 기존 `golden_retrieval`은 기대 사업명·파일명·숫자·연도 관찰 방식을 유지한다. 두 세트는 문항과 기대 기준이 다르므로 수치를 직접적인 성능 증감으로 비교하지 않는다.

질문은 `item.question`만 그대로 `search`에 전달한다. 줄바꿈과 공백을 보존하며 평가항목·오답 유형·출처 제목을 검색어에 추가하지 않는다. 제품 Query Refiner를 평가 코드에서 다시 사용하지 않는다.

## FAQ 원문과 평가 기준

원본 Excel은 `복지MCP_FAQ기반_질문200_20261010(1).xlsx`, SHA-256은 `b5932f71a874b0cc0f483e358d608aef361061f9694761feb0e4dc36ac8997d5`다. `질문200`과 `평가요소와출처` 두 시트의 8~207행을 ID로 연결했다. WFAQ-001~WFAQ-200 고유 질문 200개이며, 158개 질문의 실제 줄바꿈도 보존했다. 셀·행·질문 SHA와 원셀 값은 `quality/faq_200_20261010.provenance.json`에 있다.

출처는 보건복지상담센터 129 120문항·국민콜110 50문항·국민신문고 30문항이다. 원문 그룹 105개, URL 98개다. 파일의 확인 수준은 본문확인 170·제목확인 24·검색발췌확인 6으로, 파일 작성자의 표시이며 이번 실행의 재확인 결과가 아니다. 모든 문항은 현행 기준 재확인 `필요`로 표시돼 있다.

핵심 평가항목과 주요 오답 유형은 있지만 검증된 정답 본문·금액 정답표는 없다. 파일도 금액·조건의 현행성과 확정 정답은 별도 확인이 필요하다고 명시한다. FAQ의 기대 사업·문서·숫자·적용연도 판정은 `NOT_EVALUATED`, 해당 지표의 `count`와 `rate`는 null이며 0점으로 바꾸지 않는다. 최종 자연어 답변은 생성하거나 채점하지 않고 `answer_correctness:NOT_EVALUATED`, `human_review:PENDING`으로 유지한다.

## 기본 FAQ 실행

저장소 루트에서 Node.js로 실행한다.

```sh
node scripts/mcp/run-golden-qa.mjs \
  --endpoint https://integrated-care-national-dashboard.xgfox54.chatgpt.site/mcp \
  --output docs/qa/faq-200-20261010 \
  --concurrency 2
```

기본값은 active FAQ 전체 200문항이다. 시작 시 manifest의 데이터셋 ID·버전·개수·SHA·평가 프로필과 문항별 질문 SHA를 확인한다. `--limit 10`처럼 부분 실행하면 실제 선택 수를 표시하고 전체 200문항 완료로 처리하지 않는다. 실행마다 새 결과 폴더를 지정한다. 기존 `records.jsonl`은 덮어쓰지 않는다.

FAQ의 HTTP 및 이번 native 수집은 **검색 원순위 1~5위 내 허용된 복지사업·정부24·문서·manual_section만 상세 조회**한다. 예산·뉴스·기타 후보는 원순위에 남기고 6위 이후 후보를 끌어올리지 않는다. 같은 ID의 상세는 실행 안에서 재사용하지만 각 문항의 실제 상위 5위 후보와 연결한다. `manual:<revision>:<section_id>`를 매뉴얼 구간으로 인식한다.

요청 제한은 기본 25초, 추가 재시도는 기본 2회다. `--timeout-ms`, `--retries`, `--min-interval-ms`로 조절한다. 429 응답의 `Retry-After`를 따르며 60초를 초과하는 대기 요구는 오류로 남기고 해당 요청을 재시도하지 않는다. 실제 수집의 동시 수·간격·재시도 정책을 결과와 함께 기록한다.

HTTP 호출은 공개 읽기 도구만 허용하며 인증 헤더·토큰·쿠키를 보내지 않는다. 401/403이면 `BLOCKED_PRECHECK`를 남긴다. 2026-10-10 확인 시 운영 `/mcp`의 비인증 HTTP 요청은 401이었다. 실제 운영 검사는 승인된 native connector의 읽기 도구로 수집하고 아래 오프라인 경로로 평가한다.

## Native 원 응답 오프라인 평가

```sh
node scripts/mcp/run-golden-qa.mjs \
  --records-input /absolute/path/native-raw.jsonl \
  --output docs/qa/faq-200-native-20261010
```

이 모드는 네트워크 요청을 하지 않는다. 입력 JSONL에는 시작·종료 상태와 문항별 실제 MCP 원 응답을 넣는다. `dataset_status`, `integration_status`, `search.result`, `fetched[].result`는 `structuredContent` 또는 `content[].text`를 포함하는 MCP 응답이다. HTTP JSON-RPC 결과도 읽는다.

```json
{"kind":"status","phase":"start","at":"2026-10-10T00:00:00Z","dataset_status":{"structuredContent":{"release_bundle_id":"example"}},"integration_status":{"structuredContent":{"data":{"datasets":[]}}}}
{"kind":"record","id":"WFAQ-001","question":"기초생활보장 급여를 처음 신청하려면 어디에 가고 어떤 서류를 준비하나요?","search":{"arguments":{"query":"기초생활보장 급여를 처음 신청하려면 어디에 가고 어떤 서류를 준비하나요?"},"result":{"structuredContent":{"results":[]}}},"fetched":[],"attempts":[]}
{"kind":"status","phase":"end","at":"2026-10-10T00:01:00Z","dataset_status":{"structuredContent":{"release_bundle_id":"example"}},"integration_status":{"structuredContent":{"data":{"datasets":[]}}}}
```

위 JSON은 형식 설명용이며 실제 결과로 사용해서는 안 된다. 입력에서 빠진 문항은 `NOT_RUN`으로 남기고 중복 ID·알 수 없는 ID·원문과 다른 질문은 거절한다. FAQ의 실제 호출 기록에는 `search.arguments.query`가 필수이며 원문과 정확히 일치해야 한다. `NOT_RUN`·`BLOCKED_PRECHECK`는 실제 검색을 하지 않은 상태로 구분한다.

재시도는 한 문항의 `attempts`에 이전 원 응답을 보존하고 `search.result`에 최종 실제 응답을 넣는다. 같은 ID의 행을 중복 입력하지 않는다. 상세에는 실제 요청 `id`, 원 검색 `rank`, 응답을 기록한다. 다른 ID·순위의 상세나 6위 이후 상세를 상위 5위 근거로 집계하지 않고 연결 오류로 남긴다. source·metadata·본문은 원형으로 보존한다.

매뉴얼 `metadata.sources`의 저장소 경로·커밋·원본명·본문 구간 행 위치·제목·연도 출처와 검증 여부를 보존한다. `metadata.excerpt`의 offset·returned_chars·total_chars·next_offset·truncated도 기록한다. 파싱된 Markdown 행 위치를 PDF 물리 페이지로 바꾸거나 첫 상세 응답을 매뉴얼 전체 본문 확보로 해석하지 않는다.

평가기 1.1.1은 매뉴얼 카드의 문서명·내부 원문명·파일명 추정 연도·출처와 이어읽기 안내·경고를 실제 본문에서 제외한다. 메타데이터로 정확한 카드 프레임을 대조하고 Unicode `returned_chars`만 본문으로 읽는다. 프레임·본문 범위·footer가 맞지 않으면 카드 전체를 대신 읽지 않고 `body_present:null`, `MANUAL_CARD_FRAME_UNVERIFIED`로 남긴다. 수신 성공과 본문 해석 가능 여부를 구분한다.

### Native 수집 준비와 중단 복구

`collect-faq-native.mjs`는 실제 native 도구 어댑터를 주입받는 수집기다. 모듈을 읽거나 import하는 것만으로 운영 호출이 발생하지 않는다. `faq-native-journal.mjs`는 로컬 파일 준비·복구·압축만 수행하며 네트워크 기능이 없다.

```sh
node scripts/mcp/faq-native-journal.mjs init \
  --directory /absolute/scratch/faq-native-20261010 \
  --run-id faq-native-20261010
```

준비 시 `ready`는 null이다. 배포·DB 활성화 확인 신호를 받은 뒤에만 해당 신호의 시각과 기대 manual revision·서버 버전·문서/구간 수를 `READY.json`에 기록한다. 시작 dataset/integration status 실제 응답을 확인하고, 기대 revision·버전·수록 수가 다르거나 읽을 수 있는 매뉴얼이 없으면 검색을 시작하지 않는다. native status의 매뉴얼 `PARTIAL`은 파싱본의 증거 한계 표시이며 활성 코퍼스가 없다는 뜻으로 바꾸지 않는다.

동시 호출은 2개, 배치 시작 간격은 4초이며 도구 오류가 있으면 8초로 늘린다. 전체 도구 호출에 분당 60개 상한을 적용한다. 한 대상은 처음 호출을 포함해 최대 3회 시도하며 15초·30초 대기와 응답의 `retry_after`를 따른다. 연속 실패 시 추가 휴지 시간을 둔다. 정상 빈 검색은 재시도 대상이 아니다.

각 호출은 `checkpoints/<순번>.started.json`을 먼저 저장한 뒤 실행하고, 실제 응답 또는 예외를 `<순번>.completed.json`으로 보존한다. 완료 파일을 회수하지 못한 시작 기록은 `NATIVE_RESULT_NOT_RECOVERED`로 명시한다. 이는 실제 전송·응답 여부가 확인되지 않은 기록이며, 응답 성공 건수에서 제외하고 재시도 횟수에는 포함한다. 원 응답, 도구 예외, 재시도 내역을 삭제하거나 최종 성공으로 덮어쓰지 않는다.

```sh
node scripts/mcp/faq-native-journal.mjs reconcile \
  --directory /absolute/scratch/faq-native-20261010 \
  --gzip-output docs/qa/faq-200-20261010
```

복구는 순번으로 모든 시작·완료 기록을 대조하여 `resume-state.json`, 문항당 최종 검색 하나와 원순위 상세 캐시를 연결한 `input-records.jsonl`, 전체 `raw-call-journal.jsonl`, `collection-audit.json`을 만든다. raw와 gzip을 모두 만들고 바이트 SHA를 기록한다. Git에는 큰 원응답의 `.jsonl.gz`를 저장하고 uncompressed 원응답은 수집 디렉터리에 유지한다. 수집된 `input-records.jsonl`을 위 오프라인 평가 명령에 전달한다. 최종 평가의 원응답 포함 `records.jsonl`도 같은 방식으로 압축해 보존한다.

## 출력과 상태

| 파일 | 내용 |
|---|---|
| `records.jsonl` | 원 질문·SHA·관찰 결과·원 응답·출처 위치·검수 필요 사유 |
| `summary.json` | 분모를 포함한 집계, 선택 데이터셋 ID·SHA·프로필, 실행 식별자 |
| `results.csv` | 원 질문 줄바꿈을 보존한 문항별 검토 목록 |
| `REPORT.md` | 지표 정의와 한계를 포함한 읽기용 보고서 |
| `latest.json` | 해당 실행 파일들의 상대 경로와 데이터셋 식별자 |

HTTP 모드는 `status-start.json`, `status-end.json`도 남긴다. FAQ의 종료 코드 0은 선택 문항의 검색 정상 응답·원문 입력 대조·상위 5위 허용 상세 첫 응답 수집이 완료됐다는 의미다. 결과가 없는 정상 검색도 정상 실행이며 답변 정답을 의미하지 않는다. 상세 미조회·연결 오류·일부 호출 오류·미실행·중단은 2, 실행 설정·입력 오류는 1이다. 기존 골든 프로필의 종료 코드 0은 종전대로 선택 문항의 검색 성공을 뜻한다.

`all_200_items_accounted_for`는 선택 데이터셋의 전체 200개 ID 집합 일치 여부다. `full_200_run`은 이를 충족하며 실제 검색 입력까지 확인된 실행인지 표시한다. `selected_collection_complete`와 `full_collection_complete`는 선택한 범위와 전체 200문항의 상세 첫 응답 수집 완결성을 구분한다. 어느 항목도 답변 정답 판정이 아니다.

### FAQ 관찰 지표

| 관찰 | 분모와 한계 |
|---|---|
| 검색 정상 응답·원문 SHA 일치 | 선택한 전체 문항 |
| 결과 있음·manual_section @1/@3/@5 | 정상 검색 문항. 후보의 의미적 관련성은 미평가 |
| 허용 상세 첫 응답 수집 완료 | 원순위 상위 5위 내 허용 후보가 있는 문항. 대상이 없는 문항을 완료로 세지 않음 |
| 매뉴얼 본문 존재·부분 본문 여부 | 매뉴얼 상세를 실제 받은 문항 |
| 상세 출처 URL·출처 위치 존재 | 허용 상세를 실제 받은 문항 |
| 원출처 URL·제목 일치 | 해당 출처 기준이 있는 정상 검색 문항. search/fetch의 명시적인 source 필드에서 관찰 |
| 본문 연도 언급·source 연도 provenance | 본문과 출처 메타데이터를 분리 기록. 적용연도 정답은 미평가 |
| 기대 사업·문서·숫자·적용연도·최종 답변 정확도 | 검증된 정답키 미제공. `NOT_EVALUATED`, rate null |

FAQ 작성일, 파일명에서 추정한 document/source year, 본문 연도 언급을 구분한다. `applicable_year:null`, `filename_inferred`, `physical_page_verified:false`, `authority_verified:false` 등의 원천 상태를 그대로 보존한다. source 연도 필드 존재는 값이 확정됐다는 뜻이 아니다. 같은 목록 URL을 여러 FAQ가 공유하므로 URL 일치만으로 특정 FAQ 답변을 확보했다고 단정하지 않는다.

각 문항에 평가항목·오답 유형·파일 작성자의 확인 수준·현행 기준 재확인 표시·검수 필요 사유를 남긴다. 별도 AI 의미 검토를 하는 경우에도 문항의 원순위 상위 5개에 연결된 실제 첫 상세 본문만 읽고, 직접 인용과 Unicode 위치를 기록한다. 다른 질문의 근거·원천 DB의 미반환 구간으로 판정을 채우지 않는다. 반환 근거의 판정은 `adequate_candidate`·`partial_evidence`·`unrelated`·`insufficient`로 구분하고, 평가요소의 관찰은 `covered`·`partial`·`not_observed`로 남긴다. 생성하지 않은 답변의 표현·단정 여부를 요구하는 요소는 `not_evaluated`이다. 이 메모는 사람 검수 완료나 200문항의 답변 정확도 평가로 합산하지 않는다. 잘못된 전제를 인용해 정정하는 답변을 단순 문자열 검출로 오답 처리하지 않는다.

시작·종료 공개본·서버 버전·정부24 revision·manual revision과 각 실제 search/fetch 식별자를 비교한다. 실행 중 하나라도 변경되면 `CHANGED_DURING_RUN`으로 기록한다. 개별 상세 서버 버전이 미노출이면 시작·종료 상태로 그 응답의 버전을 추정하지 않는다. 상세 캐시 연결 수와 실제 호출 횟수도 구분한다.

## AI 근거 검토 취합과 검토 Excel 재현

실제 첫 상세를 읽은 3개 검토 기록은 `scripts/mcp/assemble-faq-semantic-reviews.py`로 취합한다. 이 스크립트는 원질문·평가요소, 실제 상세 ID·원순위·호출 연결, 본문 SHA·Unicode 범위와 인용 위치를 대조하며, 검증되지 않은 메모를 완결된 결과로 내보내지 않는다. 2026-10-10 실행의 23문항 AI 메모는 `docs/qa/faq-200-20261010/ai-review-notes.json`에 있다. 이 메모가 없는 나머지 177문항에는 의미 검토 판정을 생성하지 않는다.

`scripts/mcp/build-faq-review-workbook.mjs`는 확정된 질문·원응답 포함 `records.jsonl.gz`·CSV·summary와 검토 메모를 읽어 `faq-200-results.xlsx`를 만든다. 같은 위치에 재생성하면 기존 결과 파일을 교체하므로 확정 실행 폴더의 기존 결과는 먼저 보존한다. 아래 명령은 ChatGPT의 기본 artifact runtime과 Spreadsheets 작성 도구를 사용할 수 있는 환경을 전제로 한다. 일반 Node.js만으로 필요한 패키지가 자동 설치되는 명령은 아니다.

```sh
faq_repo="/workspace/scratch/a0d19c106f04/dashboard"
faq_xlsx_tmp="$(mktemp -d "${TMPDIR:-/tmp}/faq200-xlsx.XXXXXX")"

ln -s "$CODEX_PRIMARY_RUNTIME_NODE_MODULES" "$faq_xlsx_tmp/node_modules"
cp "$faq_repo/scripts/mcp/build-faq-review-workbook.mjs" "$faq_xlsx_tmp/builder.mjs"

"$CODEX_PRIMARY_RUNTIME_NODE" \
  /root/.codex/skills/builtins/spreadsheets/container_tools/mark_artifact_operation_started.mjs \
  --operation-kind create \
  --expected-output-count 1 \
  --output-format xlsx

"$CODEX_PRIMARY_RUNTIME_NODE" "$faq_xlsx_tmp/builder.mjs" \
  --repo "$faq_repo" \
  --review-notes docs/qa/faq-200-20261010/ai-review-notes.json \
  --author
```

작성 시작 marker는 새 작성 작업마다 첫 생성 전에 한 번만 실행한다. 빌더의 수치 검증과 재수입 검증 이후 새로 만든 두 시트의 렌더 결과를 직접 확인해야 한다. 자동 실행 결과만으로 `workbook-build-audit.json`의 시각 검수를 완료 처리하지 않는다. 최종 기록에는 원질문 200개 대조, 수식 오류 0개, 요약 집계, 부분 본문·검색 재시도 표시, AI 검토 23개와 사람 검수 `PENDING`의 구분을 남긴다. 실제 2026-10-10 최종 생성 명령과 7개 화면의 검수 범위·해시는 해당 감사 파일에 보존했다.

## 기존 골든 1.4.0 호환

```sh
node scripts/mcp/run-golden-qa.mjs \
  --golden quality/golden_qa_v1.4.0.json \
  --records-input /absolute/path/previous-golden-native-raw.jsonl \
  --output docs/qa/golden-qa-reanalysis
```

기존 골든의 HTTP 실행기는 반환 결과 앞 5개를 조회한다. 과거 2026-10-10 골든 native 수집은 허용 사업·문서 후보를 검색 순서대로 최대 5개 선택한 별도 정책이었다. 과거 결과를 재분석할 때 해당 실행의 정책과 원 응답을 보존하며 이번 FAQ의 원순위 1~5위 정책을 소급 적용하지 않는다.

`program_recall_at`은 기대 업무영역의 독립 별칭이 복지사업 후보 제목에 나타나는지 관찰한다. 평가기 1.0.1에서 정한 기존 경로는 fetch 상세 제목이 있으면 검색 제목보다 먼저 사용한다. `document_recall_at`은 기대 파일명이 실제 출처에 나타나는지 확인한다. 예산서 행과 보도자료는 제외한다. 두 지표 모두 의미적 정답 판정이 아니다.

이전 골든의 2026-10-10 사후 실행은 상세 제목 우선 관찰이 @1/@3/@5 각각 182/200, 별도 검색 제목만의 관찰은 각각 180/200이었다. 차이는 Q175·Q176의 기대 금액이 없는 포괄적인 상세 제목 `긴급복지`가 별칭에 일치한 결과다. 이번 FAQ 평가 결과와 혼합하지 않는다. 해당 과거 폴더의 `RUN_NOTES.md`, `collection-audit.json`, `search-title-observation.json`을 함께 확인한다.

기존 골든의 숫자·연도는 기대 업무의 fetch 본문에서만 관찰한다. 질문·생성/수정일·출처 URL/제목의 연도는 적용연도 관찰에 포함하지 않는다. 원 골든의 숫자 명세는 8문항이므로 숫자 지표 분모는 8이다. 숫자 존재만으로 가구원수·단위·적용시점·예외의 정확성을 확정하지 않는다. `must_not_include`는 정정 문장 오판을 막기 위해 관찰만 기록한다.

원 골든셋은 [공개 GitLab 원본](https://gitlab.aigov.go.kr/memory365/seoguipowelfare/-/raw/main/quality/golden_qa_v1.4.0.json)에서 회수한 1.4.0이다. 원본 정답을 제품 검색 결과나 금액 생성에 사용하지 않는다. 실행 결과에는 선택한 파일의 SHA-256을 기록한다.

## 로컬 검증

```sh
node --test scripts/mcp/evaluate-golden-qa.test.mjs scripts/mcp/evaluate-faq-qa.test.mjs scripts/mcp/evaluate-manual-body.test.mjs scripts/mcp/collect-faq-native.test.mjs
```

FAQ 원문·SHA·ID·기존 골든 선택, 기대값 미제공 처리, 원순위 6위 배제, 상세 ID/순위 오류, source 위치·추정 연도·부분 본문, 버전 변경, 오프라인 입력과 HTTP 모의 응답 경로를 검증한다. native 수집 테스트는 READY 차단, 동시 수·전송 간격, bounded retry, 미회수 호출 복구, gzip 바이트 일치를 검증한다. 로컬 테스트는 운영 MCP를 호출하지 않는다.
