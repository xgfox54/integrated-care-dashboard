# 복지 매뉴얼 파싱본 반입과 MCP 조회

이 어댑터는 사용자가 지정한 [seoguipowelfare 저장소](https://gitlab.aigov.go.kr/memory365/seoguipowelfare)의 고정 커밋에서 검증한 Markdown과 재구축한 SQLite schema 6을 읽습니다. 기존 복지·정부24·예산·법령 자료에 매뉴얼 본문 근거를 추가합니다.

## 원천과 재현

- 원천 커밋: `65832bd273066c1db260ae14b57a6db396e35b05` (seoguipowelfare main, 2026-10-19 복지DB 7차 업데이트)
- 배포 고정 revision: `sgw-65832bd27306-v1`
- Markdown 문서 113개, 본문 구간 22,003개, 원천 노드 96,300개
- 랩탑 복지톡 DB와 문서 113개의 SHA-256이 일치합니다. 표를 보존하는 kordoc 4.0.7 변환본 110개, OCR이 필요한 문서의 4.21.3 변환본 2개, 시설 현황 1개를 사용합니다. 2026-10-19에 그냥드림 사업안내(2026.9월 기준)와 2026년 장사업무 안내 2개를 kordoc 4.0.7 변환본으로 교체했습니다([반영 기록](../../docs/qa/manual-corpus-update-20261019/README.md)). 비교 근거는 [표 구조 복원 감사 자료](../../docs/qa/manual-table-fidelity-20261012/source-comparison.json)에 있습니다.
- 저장소는 생성된 DB 바이너리를 추적하지 않습니다. 원천 indexer로 DB를 재구축하고, 별도 어댑터가 수록 문서·구간의 SHA-256을 대조합니다.

원천 파일 검증·재구축 절차와 전체 감사 결과는 [원천 감사 자료](../../docs/qa/manual-corpus-source-20261010/)에 있습니다. 재구축한 DB에서 배포용 팩을 만듭니다.

```bash
python scripts/manuals/build-corpus-pack.py \
  --source-db /absolute/path/to/verified/welfare.db \
  --source-root /absolute/path/to/pinned/repository \
  --source-directory source-md \
  --source-commit 65832bd273066c1db260ae14b57a6db396e35b05
```

`--source-root`에는 `--source-directory`로 지정한 폴더가 있어야 합니다. 기본값은 `source-md`입니다. 동일 revision의 기존 manifest가 있으면 `created_at`을 재사용합니다. 별도 재현에는 manifest의 시간을 `--created-at`으로 지정합니다. 적용된 revision의 내용이나 manifest를 덮어쓰지 말고, 후속 자료는 새 revision과 새 생성 시각으로 검토·배포해야 합니다.

결과는 `data/manual-corpus/{manifest,catalog,import-audit}.json`, 타입이 지정된 `lib/manuals/manifest.ts`, 비공개 소스 경로 `data/manual-corpus/assets/__manual_corpus/<revision>/batch-*.json`입니다. 전체 139개 배치이며 한 배치는 1 MiB·200행 이내입니다. 현재 팩은 본문·표·ID·순서·해시를 원천 그대로 보존합니다. 코드에 반입 manifest가 고정되어 있고 HTTP나 MCP 인수로 다른 파일·저장소·SQL을 지정할 수 없습니다.

평문 배치를 public으로 복사하지 않습니다. `node scripts/manuals/seal-corpus-assets.mjs`는 숨겨진 stdin의 `{"key":"<Base64 32-byte key>"}`를 받아 gzip 후 AES-256-GCM으로 암호화하고 모든 복호화 결과의 원문 SHA를 확인합니다. 키는 소스·파일·명령줄 인수에 넣지 않고 Sites의 `MANUAL_CORPUS_KEY` 런타임 비밀값으로 별도 설정합니다. 공개 배포물에는 `public/__manual_cipher/<revision>/<key_id>/batch-*.bin`의 암호문만 들어갑니다. 암호문 metadata는 `data/manual-corpus/encrypted-assets.json`에 있고 key_id는 키의 지문이며 키 자체가 아닙니다.

같은 코퍼스·키로 재실행하면 기존 암호문을 검증해 사용합니다. `--runtime`을 붙이면 Worker용 Web Crypto 로더 코드를 Node.js에서 실행해 139개를 복호화·압축해제하고 원문 해시와 대조합니다. 이는 실제 workerd 엔진 및 운영 반입 검증과 구분합니다. `npm run build`의 prebuild/postbuild 검사는 비밀값 없이 소스와 배포물의 평문 public 경로 부재 및 암호문 SHA를 확인하며, 불일치하면 빌드를 중단합니다.

실제 workerd 호환 검증은 `node scripts/manuals/workerd-asset-compat.mjs`로 실행합니다. HTTP 리스너와 외부 네트워크를 열지 않는 `workerd test`에서 합성 키·자산으로 Request 옵션, 실제 loader의 AES-GCM·gzip, 302·307 미추종 거부를 확인합니다. 운영 키나 D1을 사용하지 않습니다. Workers에서는 `redirect: "manual"`로 응답을 직접 검사하며, `error` 모드와 Node의 동작이 같다고 가정하지 않습니다.

## 출처와 연도 정규화

원천 indexer가 중간 H1 이후 `original_name`을 합본 이름으로 되돌리는 문제를 어댑터에서 보완합니다. Markdown의 명시적 `원본 파일:` 표기를 추적해 1,095개 구간의 내부 원문명을 복원하며, `upstream_original_name`에는 원래 값을 남깁니다. 교정 근거와 marker 줄 번호도 저장합니다.

합본 파일 연도와 내부 원문명 연도는 별도 필드입니다. `미표기`는 `null`로 정규화합니다. 혼합 원문 구간 또는 여러 연도가 표시된 내부 파일명은 단일 출처 연도를 부여하지 않습니다. `applicable_year`는 확인된 정답값이 없으므로 `null`입니다. 원천의 발행기관·관할·권위 표기도 검증 여부를 별도로 표시합니다.

본문에는 13,848개의 이미지 참조가 있으나 이미지 파일은 없습니다. 따라서 `image_content_available=false`입니다. 위치는 Markdown 줄과 제목 경로이며 PDF 물리 쪽수로 표시하지 않습니다. 시설 현황은 index/시설 목록 역할을 보존하고 금액·급여 자격 검색에서 감점합니다.

## 운영 반입

`drizzle/0110_manual_corpus.sql`은 D1 테이블·인덱스·FTS5·트리거만 생성하는 schema migration입니다. 데이터는 배포 후 `advanceBundledManuals`가 내부 `ASSETS` 바인딩으로 암호문을 읽고 서버 비밀값으로 복호화·압축해제해 한 배치씩 반입합니다. 키나 자산 바인딩이 없으면 반입하지 않습니다. 암호문의 크기·SHA, 인증 태그와 revision·경로·원문 해시를 묶은 AAD, 압축해제 크기 상한도 확인합니다.

일반 웹 접근과 `GET /api/manuals/status`는 응답 뒤 배경 작업을 이어갑니다. 이 상태 경로는 고정 작업의 진행 상태만 반환하며 외부 데이터를 받지 않습니다. `POST`는 허용하지 않습니다. MCP 요청은 읽기 전용 경로로 먼저 반환되어 수집을 유발하지 않습니다.

각 배치는 SHA-256·크기·ID·schema·본문 해시를 검증하고 D1 `batch()`의 원자적 트랜잭션으로 저장합니다. lease와 조건부 갱신으로 중복 작업을 막습니다. 오류 시 활성 자료는 유지하고 지수 백오프 후 해당 배치부터 재개합니다. 이전 코드의 지연 실행은 더 최신 공개본을 덮어쓸 수 없습니다. 각 SQL은 D1의 bind 한도 안에서 구성합니다.

진행률이 139/139에 도달한 다음 문서별 구간 수와 전체 113/22,003개를 검증해야 활성 revision이 바뀝니다. 반입 중인 STAGING 자료는 MCP에서 읽지 않습니다. 활성 매뉴얼은 통합 공개본의 `components.manuals`에 들어가며 MCP 검색·상세·출처 조회는 같은 공개본의 revision에 고정됩니다. 공개본에 매뉴얼이 없으면 최신 자료를 임의로 섞지 않습니다.

호스팅은 정적 파일을 Worker보다 먼저 제공하므로 로컬 `run_worker_first`에 의존하지 않습니다. 평문 경로 `/__manual_corpus/*`는 배포 파일에서 제거하며 외부 요청은 404여야 합니다. 암호문 파일의 다운로드는 가능하지만 복호화 키는 서버에만 있습니다. 배포 점검에서 평문 경로의 GET/HEAD/변형 URL 404, 내부 자산·비밀값 존재, 실제 DB 반입을 확인합니다. 공개 export에는 매뉴얼 revision과 출처 메타데이터만 들어가고 전체 본문은 포함되지 않습니다.

## MCP 계약

| 기능 | 사용 방법 |
| --- | --- |
| 통합 검색 | `search({query})`에서 `manual_section` 후보를 기존 자료와 함께 반환 |
| 매뉴얼 검색 | `search_manuals({query, limit, release_bundle_id?})`, 최대 20개 |
| 상세 본문 | `get_manual_section({section_id, offset?, limit?, release_bundle_id?})` |
| 범용 상세 | `fetch({id})`, `get_entity`, `get_sources`가 매뉴얼 ID를 지원 |
| 수록 상태 | `get_dataset_status`의 `data.manuals`와 공개본 component |

ID 형식은 `manual:<revision>:<section_id>`입니다. 임의 URL·파일 경로는 허용하지 않습니다. 상세는 한 번에 최대 8,000 Unicode 코드 포인트를 반환하고 `next_offset`으로 긴 표를 이어 읽습니다. 검색 발췌는 280자입니다. 원문은 신뢰하지 않은 인용 데이터로 취급하고 그 안의 명령을 실행하지 않습니다.

각 출처에는 고정 저장소 커밋 URL, 원천 파일, 내부 원문명, 교정 근거, Markdown 시작·끝 줄, 본문·문서 SHA-256을 담습니다. URL은 저장소 파싱본(`repository_parsed_copy`)이며 공식 원본 URL이나 검증된 자격 판정으로 표현하지 않습니다. 검색·상세 모두 금액·연도·개인 상황에 대한 최종 판정값은 만들지 않습니다.

검색은 한국어 공백·기호를 정규화한 trigram FTS를 사용합니다. 입력에서 긍정 질의어와 제외 조건을 구분하고, 사업명·세부 제목·본문 조건·목차/시설 목록 감점을 SQL의 후보 제한보다 먼저 계산합니다. 원문 질문의 일반 단어를 사용하며 FAQ ID·정답·평가 항목을 검색어에 주입하지 않습니다.

조사·서술형 어미와 숫자 단위의 정규화는 원문 단어, refiner 세부어, 하위 서비스와 fallback 핵심어에 공통 적용합니다. 질문의 나이·일수·금액은 원문에 똑같이 나타나야 하는 사실로 요구하지 않습니다. 짧은 별칭은 다른 복합어의 내부에서 사업명으로 인식하지 않으며, 제외된 사업 뒤에 남은 긍정 주제는 유지합니다.

등록 사업명이 없는 질의에서는 앞부분의 일반 맥락어 때문에 뒤의 구체적인 명사가 사라지지 않도록 긴 세부어도 보존합니다. 실제 고정 코퍼스의 출현 빈도를 한 번의 제한된 쿼리로 확인해 희소한 관찰 용어를 후보 조건으로 사용합니다. 필수어 후보는 핵심어와 그 핵심어를 포함해 길어진 세부어로 제한하며, 일반적인 뒤 문장의 세부어는 점수에만 사용합니다. 미출현 단편·일반 장소어를 제외하고 관찰된 긴 용어가 하나뿐이면 필수어로 사용하지 않아 짧은 한국어 주제 조합을 보존합니다. BM25는 최대 24점의 보조 점수로 반영합니다. 이들은 검색 순위 규칙이며 법적 사업 동일성이나 답변의 정답 판정이 아닙니다.

## 검증과 FAQ 평가

```bash
node --test lib/manuals-store.test.mjs lib/manuals-search.test.mjs lib/mcp-manuals.test.mjs lib/manuals-corpus-fidelity.test.mjs
node --test scripts/mcp/evaluate-golden-qa.test.mjs scripts/mcp/evaluate-faq-qa.test.mjs scripts/mcp/evaluate-manual-body.test.mjs
```

회귀 검증은 중단·재개, 만료 lease 경쟁, 원자적 rollback, 100 bind, 기존 공개본 보존, 원문명·연도 구분, 긴 표 이어 읽기, 후보 제한 이전 순위 계산과 MCP 연결을 확인합니다.

기본 평가셋은 첨부 Excel에서 추출한 `quality/faq_200_20261010.json`입니다. `quality/active-benchmark.json`이 이를 지정합니다. 200개 질문을 원문 그대로 보내고 원순위 1–5위의 복지·매뉴얼 후보만 상세 조회합니다. 수집·평가 계약과 이전 골든셋 명시 실행은 [FAQ 평가 안내](../mcp/GOLDEN_QA.md)를 따릅니다. 확정 답안이 제공되지 않은 문항의 답변 정확도는 `NOT_EVALUATED`로 남깁니다.
