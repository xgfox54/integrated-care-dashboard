# 로컬 문서 파싱·OCR 워커 (kordoc 4.18.13)

작업지시서 v5 §5.9~5.17의 로컬 문서 처리 워커. 이용 권한이 확인된 원문을 **로컬에서만** kordoc으로 파싱해 `welfare-document-v1` 산출물을 만든다. 사이트(Cloudflare Workers) 런타임이나 공개 MCP 요청 안에서 실행하지 않는다. 공개 웹·MCP 서버에는 임의 파일·URL 파싱 기능이 없으며, 원문·raw IR은 공개 DB·정적 자산에 올리지 않는다.

현재 프로필은 `document-ingest` 2.0.0, 어댑터는 `welfare-doc-adapter-2.0.0`, 계약 버전은 1.1.0이다. 기존 `hwp-ingest` 작업도 같은 프로필로 처리하며 요청한 ID를 manifest에 남긴다.

## 지원 형식과 검증 범위

확장자 대신 시그니처·컨테이너 내부 구조로 판별하고 kordoc의 판별 결과와 대조한다. 둘이 다르면 `FORMAT_AMBIGUOUS`로 거절하며, 확장자만 다르면 `WF_EXTENSION_MISMATCH` 검토 경고를 남긴다.

| 형식 | 현재 처리 경로 | 기존 검증 기록·한계 |
|---|---|---|
| HWP 5.x / HWPX | `parseHwp` / `parseHwpx` | 실제 표본 회귀·표 구조 대조 기록 있음. 경고·누락은 별도 검토 |
| HWP 3.x | `parseHwp3` | 표본 처리 기록은 있으나 EXPERIMENTAL. `STRUCTURE_VALIDATED`로 올리지 않음 |
| HWPML (`.hml`, `.hwpml`) | `parseHwpml` | 실제 표본 미검증 |
| PDF | `parsePdf`, 텍스트층 1차 → 필요 시 내장 OCR 2차 | 텍스트·혼합 실문서 기록 있음. 스캔은 PDF를 그림으로 만든 파생 표본만 확인 |
| PNG·JPEG·WebP | `parseImage`, 내장 OCR | 파생 PNG 기록 있음. 실제 촬영 이미지·JPEG·WebP 실표본 검증은 확인되지 않음 |
| DOCX | `parseDocx` | 공식 실제 표본의 바이트 일치·가시문단1537개 포함·44표1281셀 확인. 문단 순서·중복 횟수·레이아웃 미검증 |
| XLS(97-2003) | `parseXls` | 실제 표본 미검증 |
| XLSX | `parseXlsx` | 실제 표본28셀 XML 행·열 좌표 및 정규화값 대조. 형식 일반 정확도 인증 아님 |
| PPTX | `parsePptx` | 입력 판별·처리 경로 있음. 아래 보고서에 실표본 검증 기록 없음 |
| DOC·PPT(97-2003), 첨부 묶음 ZIP | 지원하지 않음 | `UNSUPPORTED_FORMAT`. 묶음은 별도로 풀어 개별 문서를 입력 |

검증 기록의 출처는 [2026-10-05 검증 보고서](../../docs/acceptance/KORDOC_4.18.13_VERIFICATION_2026-10-05.md)와 [형식별 기록](../../docs/corpus/kordoc-4.18.13/formats-eval.json)이다. README 현행화에서 실문서 평가를 재실행한 결과가 아니다. 현재 `quality.mjs`는 HWP 5.x·HWPX만 구조 통과 판정 대상으로 두며, 다른 형식은 파싱에 성공해도 원문 대조가 필요하다. 파싱 성공은 의미 추출 정확성이나 공개 승인을 뜻하지 않는다.

## 설치

추가 실제 표본 워커 검증은 [2026-10-06 잔여 검증 보고서](../../docs/acceptance/PARSER_REMAINDER_2026-10-06.md)에 기록했다. 실제 PDF의 지정한 3쪽 한 쪽은 텍스트층만 처리했으며 OCR을 실행하지 않았다. 구조화 결과의 검토 상태를 유지한다.

Node.js 22.13.0 이상이 필요하다. 설치 명령은 저장소 루트에서 시작한다.

```sh
cd factory/hwp-parser
npm ci
npm test
```

현재 `.npmrc`는 `legacy-peer-deps=true`, `save-exact=true`이며 `omit=optional` 설정은 없다. PDF·OCR 실행 의존성을 제외하는 설치로 설명하지 않는다. `parser-pin.json`에는 kordoc 4.18.13과 PDF·OCR 의존성(`pdfjs-dist`, `@hyzyla/pdfium`, `onnxruntime-node`, `sharp`)의 버전·무결성이 기록되어 있다. 워커는 kordoc 설치 버전 및 lockfile의 고정값을 대조하며 불일치하면 `PARSER_PIN_MISMATCH`로 중단한다.

OCR을 사용하려면 **준비 단계에서만 네트워크를 허용**해 모델을 받아야 한다. 아래 명령은 저장소 루트에서 실행한다.

```sh
node factory/hwp-parser/src/prepare-models.mjs --root var/welfare-factory
```

모델 URL·기대 SHA-256은 설치된 kordoc 배포본에서 읽는다. PP-OCRv5 검출 모델·한국어 인식 모델·사전을 작업공간 `models/ppocr/`에 두고 `models/models-record.json`에 준비 기록을 남긴다. 문서 처리 시에는 파일 해시와 준비 기록을 확인하며 다운로드하지 않는다. 외부 OCR·LLM 제공자 함수와 수식 OCR(`formulaOcr`)은 사용하지 않는다.

## 실행

작업공간 루트(예: `<저장소>/var/welfare-factory`, git 제외) 아래에 원문을 두고 작업 명세를 만든다. `--root` 또는 `WELFARE_FACTORY_ROOT`로 루트를 지정해야 하며 자동 기본 경로는 없다. 아래 예시는 `var/welfare-factory/jobs/job-001.json`에 저장한다.

```json
{ "job_id": "job-001", "source_version_id": "sv-001", "input_ref": "raw/real/문서.hwpx",
  "expected_sha256": "<원문 SHA-256>", "profile_id": "document-ingest", "output_root": "parsed" }
```

저장소 루트에서 실행한다.

```sh
node factory/hwp-parser/src/run-job.mjs --job var/welfare-factory/jobs/job-001.json --root var/welfare-factory
```

부모(`run-job.mjs`)가 셸 없이 제한된 환경변수로 워커를 띄우고 네트워크 차단 모듈(`net-guard.mjs`)을 먼저 불러온다. 기본 600초를 넘으면 프로세스 트리를 끝낸다. 종료코드가 0이어도 job_id·원문 해시·계약 버전·산출물 해시를 모두 대조하며, 반환된 `status`가 검토·부분 처리·보호 문서 보류인지 별도로 확인해야 한다.

PDF는 `ocr:false`, `tables:true`, `removeHeaderFooter:true`로 먼저 읽는다. 텍스트층 부재·깨짐·그림 영역 등 OCR 후보가 있고 모델이 준비되어 있으며 후보가 60쪽 이내일 때 `ocr:true`로 다시 읽는다. 이 두 번째 호출은 선택한 문서 범위를 대상으로 하므로 **후보 쪽만 정확히 OCR하거나 실제 OCR 적용을 60쪽으로 강제하는 것은 아니다**. 모델 미준비·후보 상한 초과·OCR 실패 시 1차 결과와 미처리 경고를 남겨 검토로 넘긴다. 이미지는 모델 미준비 시 `FAILED`다.

PDF 작업에는 `"page_range": { "first": 10, "last": 20 }`처럼 범위를 지정할 수 있다. 범위 길이는 쪽 상한 이하여야 하며 결과는 문서 전체가 아닌 선언 범위로 표시된다. 범위 없이 300쪽을 넘는 PDF는 앞부분만 처리하고 `PARTIAL`로 남긴다. 작업 명세로 임의 파서 옵션·password·filePath·OCR 함수를 전달할 수 없다.

## 산출물 `parsed/<parse_id>/`

| 파일 | 내용 |
|---|---|
| manifest.json | 계약·파서 고정값·판별 형식·실제 옵션·프로필(options_hash)·OCR 모델/쪽 범위·파일별 해시·크기·content_digest |
| raw-ir.json | kordoc blocks/metadata/warnings(이미지 바이트·data URI 없음 검사) |
| document.json | 블록 순서·block_id·ir_pointer·쪽 모드·추출 방법·OCR 적용 쪽 |
| tables.jsonl | 논리 그리드: 소유 셀·span·가려진 칸 구분, header_paths, row_roles(합계), 각주 범위, value_state, 단위 정규화와 근거 |
| source-map.jsonl | 블록·표·셀 → IR 위치. 추출 방법에 따라 parsed_structural / pdf_page / pdf_page_bbox / ocr_page. 실제 쪽 대조 완료를 뜻하지 않음 |
| quality.json | 상태·경고 매핑(WF_*)·수량·자동 공개 불가 사유 |
| content.md | 검토 보조용 Markdown(사실 원장 아님) |

parse_id는 원문 SHA-256, kordoc 버전·무결성, options_hash, 어댑터·계약 버전, 형식, 사용한 OCR 모델 지문, 지정한 PDF 쪽 범위로 만든다. 같은 parse_id의 내용이 같으면 재사용하고 다르면 덮어쓰지 않는다(`PARSE_ID_CONFLICT`). 파서·OCR 모델·쪽 범위가 다른 결과는 별도 산출물로 남는다. 파서 실패·모델 미준비 등의 결과에는 manifest와 quality만 있을 수 있다.

## 상태

STRUCTURE_VALIDATED(구조 검증 통과, 공개 승인과 별개) / NEEDS_REVIEW(그림 미판독·검토 경고·구조 플래그) / PARTIAL(손상·부분 파싱 경고) / FAILED / UNSUPPORTED / REQUIRES_AUTHORIZED_COPY(암호·DRM). 표에 없는 새 경고는 WF_UNKNOWN_WARNING 검토.

## 보안·한계

- 입력: 작업공간 안 상대 경로만 허용하며 원문 SHA-256을 확인한다. 절대경로·`..`·입력 링크 탈출·HTML 오류 화면을 거절한다.
- ZIP 계열(HWPX·DOCX·XLSX·PPTX): 해제 전에 중앙 디렉터리로 항목 수·누적 해제 크기·경로 탈출·중복을 검사하고 ZIP64는 거절한다. CFB 압축 스트림 한도는 kordoc 내부 한도와 입력 크기 제한에 의존한다.
- 네트워크: `net-guard.mjs`의 **코드 수준 차단**(DNS·TCP·TLS·HTTP·fetch)과 `KORDOC_OFFLINE=1`을 사용한다. **운영체제 방화벽·컨테이너 수준 격리는 적용·검증하지 않았다.** 별도 프로세스 실행과 이 코드 차단을 OS 수준의 완전한 네트워크 격리로 보지 않는다.
- 메모리: V8 힙 한도와 별도로 워커가 RSS를 100ms 간격으로 확인해 초과 시 자체 종료한다. ONNX·PDFium 네이티브 메모리는 RSS에 포함되지만 이 감시는 OS가 강제하는 메모리 한도가 아니다.
- 파서에는 검증한 바이트만 넘기고 filePath·password·사용자 OCR 함수를 넘기지 않는다. 암호·DRM 문서는 우회하지 않고 보류한다. HWP5의 배포용(복사·편집 제한) 속성만 있는 문서는 현재 구현의 운영자 허용 정책에 따라 처리하되 보호 사실·출처 표시 경고를 남긴다.
- 그림 바이트·data URI는 산출물에 저장하지 않는다. 중첩 표·캡션에 남은 imageData도 제거하고 검사한다. OCR로 읽은 글자·숫자·날짜·금액은 사람이 대조하며 줄 신뢰도는 `not_provided_by_parser`, OCR 표의 정규화 값은 `ocr_needs_review`로 남긴다.
- 머리행은 원문 셀 표시(isHeader)와 그 세로 병합 이어짐만 인정한다. 표시가 없는 실제 문서는 `layout_hint_unconfirmed`로 남겨 템플릿 검토로 넘긴다.
- 실제 스캔의 기울기·잡음·도장, 촬영 이미지, 독립 정답을 사용한 새 문서 의미 추출은 충분히 검증되지 않았다. 기존 보고서에는 PDF 쪽 경계 문단 병합으로 위치가 틀리는 사례와 OCR 적용 쪽이 후보보다 넓어지는 사례도 있다. 자동 공개는 꺼져 있으며 사람 검토가 필요하다.

기본 상한은 `src/limits.mjs`의 워커 정책이며 kordoc의 공식 성능 보장값이 아니다.

| 항목 | 기본값·처리 |
|---|---|
| 원문 / 산출물 합계 검사 | 50 MiB / 64 MiB(manifest를 제외한 선언 파일) |
| ZIP 누적 해제 / 항목 수 | 256 MiB / 10,000개 |
| 문서 처리 시간 | 600초(OCR 포함), 초과 시 부모가 프로세스 트리 종료 |
| V8 힙 / RSS | 2,048 MiB / 3,072 MiB |
| PDF / OCR 후보 | 300쪽 / 60쪽 |
| 중첩 깊이 / 논리 셀 슬롯 | 32 / 200,000 |
| 같은 작업공간 동시 작업 | 2개 |

작업 명세의 `limits` 값은 기본값 이하여야 한다. 단, 현재 부모의 V8 실행 인자는 항상 `--max-old-space-size=2048`이며 작업별 `maxOldSpaceMb` 축소값을 반영하지 않는다.

