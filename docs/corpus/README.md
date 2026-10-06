# 실제 공개 문서 코퍼스 평가 (정책브리핑 보건복지부 첨부)

작업지시서 v5 §18.5·T30·T52·T57·T76 평가 기록. 원문 파일은 저장소에 올리지 않고 `var/welfare-factory/raw/korea-kr/`(git 제외)에 둔다. 출처·SHA-256은 그 폴더의 `manifest.json`에 있다.

## 수집

- 출처: 정책브리핑 보도자료 목록 https://www.korea.kr/briefing/pressReleaseList.do 중 발행 부처가 보건복지부인 게시물(2026-09-23~10-02)
- robots.txt: `User-Agent: * / Allow: /` (2026-10-04 확인). 요청 간격 1초, 서비스 이름을 밝힌 User-Agent.
- 스크립트: `node scripts/corpus/collect-korea-kr.mjs <HWP/HWPX 문서 수>`
- 결과: 보도자료 32건, 첨부 71개(HWPX 34, PDF 36, ZIP 1). 엑셀 표본 1개는 지방재정365 공식 화면 내려받기(`var/welfare-factory/raw/samples/`).

## 평가 방법

- `node factory/corpus/eval-korea-kr.mjs`: 모든 첨부를 실제 파싱 워커(run-job, 네트워크 차단·격리 자식 프로세스)로 처리한다.
- 정답(표 구조): HWPX 원본 XML(`Contents/section*.xml`)의 `hp:tbl`·`hp:tc`·`cellAddr`·`cellSpan`·`hp:t`를 **kordoc 없이** 직접 읽은 값(`factory/corpus/hwpx-xml.mjs`). 파서 결과와 원본 표 ID로 맞춰 행·열 수, 셀 위치·병합, 셀 글자를 따로 센다.
- 의미 필드 정답(311필드)은 표 구조 평가와 분리해 factory/corpus/eval-semantic.mjs로 평가한다(아래 "의미 필드 평가"). 원문 인용이 들어 있어 전체 정답은 로컬 var/welfare-factory/golden/golden-semantic-korea-kr.json에만 두고, 저장소에는 인용 해시만 담은 docs/corpus/golden-semantic-korea-kr.index.json을 둔다.

## 결과 (어댑터 welfare-hwp-adapter-1.6.0, kordoc 고정 버전. 1.5.0과 같은 수치)

| 항목 | 값 |
|---|---|
| HWPX 34개 | 구조 검증 통과 15, 검토 필요 19(그림 미판독·누락 표 등), 실패 0 |
| PDF 36개·ZIP 1개·엑셀 1개 | 모두 UNSUPPORTED_FORMAT, 텍스트 추출 대체·파싱 결과 생성 없음 |
| 원본 표 399개 | 파서가 398개 출력(빠진 1개는 다른 표의 캡션 안 표) — 워커가 원본 XML 표 목록과 대조해 `WF_SOURCE_TABLE_NOT_EXTRACTED`로 검토 필요 처리 |
| 행·열 수 일치 | 398/398 |
| 셀 위치·병합 일치 | 8,495/8,495 (원본 셀 8,498 중 3개는 빠진 표의 셀) |
| 셀 글자 | 정확히 일치 8,460, 표시만 다름 32(`<sup>` 태그·자동 번호·그림 파일 이름), 기타 3(같은 원인의 복합 표시) |
| 중첩 표 | 원본 52개 모두 부모 셀 아래 중첩 표로 출력 |
| 처리 시간 | 중앙값 약 0.1초, 최대 약 0.7초(최대 파일 4.4MB) |

## 이번 평가로 고친 것

- 중첩 표 글자 중복(T57): kordoc은 부모 셀 text에 중첩 표 글자까지 평탄화해 넣는다. 어댑터 1.4.0부터 부모 셀에는 표가 아닌 블록 글자만 남기고(`NESTED_TABLE_TEXT_SEPARATED` 표시), 중첩 표 글자는 중첩 표에만 둔다.
- 누락 표 감지(T76): 어댑터 1.5.0부터 HWPX는 원본 XML 표 목록과 파서 결과를 대조해 빠진 표가 있으면 검토 필요로 돌린다.

## 한계

- HWP5(바이너리)는 원본 XML이 없어 같은 방식의 독립 정답을 만들지 않았다. 실제 HWP5 표본은 기존 1건(서귀포시 공고)뿐이다.
- 한컴 DRM(문서 보안)·배포용 문서 실표본은 없다. HWP3와 암호 문서는 아래 "형식 판별·보호 문서 실표본"에서 확인했다.
- 표본은 한 부처의 보도자료 첨부라 공고·예산서·조례 같은 문서 유형의 대표성은 없다.

## 의미 필드 평가 (T76)

정답은 HWPX 원본 XML을 kordoc 없이 factory/corpus/hwpx-text.mjs로 문단·셀 단위로 읽고, 사람이 원문을 읽어 값·소속 사업·근거 위치(예: `s0:p12`, `s0:t<표ID>:행,열`)·원문 인용을 적었다. 파서 결과와 변환 PDF는 쓰지 않았고, 인용 311개는 모두 원본 XML 글자와 기계 대조해 확인했다.

| 항목 | 값 |
|---|---|
| 정답 | 24개 문서, 40개 사업, 311필드 |
| 필드 종류 | 기관 70, 지역 35, 지원대상 30, 사업명 29, 시행일 27, 지원내용 25, 주기·기간 20, 규모 19, 금액 16, 예외 16, 적용범위 9, 법적근거 8, 신청방법 7 |
| 근거 추적 | 311/311(100%): 정답 인용이 파서 결과 글자(문단·표 셀)에 그대로 남아 있음 |
| 공고문 규칙 후보(`extractCandidates`) | 후보 0건, 재현율 0%: '항목: 값' 줄과 신청자격 절 글머리를 찾는 규칙이라 보도자료에는 맞지 않음 |
| 보도자료 규칙 후보(`extractPressCandidates`) | 후보 1,760건, 재현율 74.3%, 정밀도 14.3%(필드 종류가 같고 정답 인용을 포함해야 맞은 것으로 셈) |

작업지시서 목표(복지 필드 정밀도·재현율 각 98% 이상)에는 크게 못 미친다. 그래서 문서에서 뽑은 후보는 자동으로 공개하지 않고, 사람이 검토해 승인한 것만 묶음에 들어가는 지금 방식을 유지한다. 보도자료 규칙은 같은 문단을 여러 필드 후보로 내는 검토 보조용이며, 기관 이름 규칙 한 번을 이 정답을 보고 넓혔다(재현율 65.0% → 74.3%). 따로 떼어 둔 평가 표본이 없으므로 이 수치는 새 문서에서 더 낮을 수 있다.

## 형식 판별·보호 문서 실표본 (T52·T69)

공개 저장소 edwardkim/rhwp(MIT, 커밋 680111ec)에서 표본 8개를 scripts/corpus/collect-rhwp-samples.mjs로 받아 var/welfare-factory/raw/public-samples/rhwp(git 제외)에 두고, 실제 워커로 돌렸다(node factory/corpus/eval-protected.mjs → docs/corpus/protected-format-eval.json). 비밀번호는 넣지 않았다.

| 표본 | 파일 머리 | 판별 형식 | 결과 |
|---|---|---|---|
| HWP3 일반 3개(hwp3-sample, SO-SUEOP, hwp3-table-caption) | `HWP Document File V3.00` | hwp3 | NEEDS_REVIEW(문단 97·939·2개). HWP3는 시험 단계라 구조 검증 통과로 올리지 않음(WF_HWP3_EXPERIMENTAL) |
| HWP3 암호 | 같음 | hwp3 | REQUIRES_AUTHORIZED_COPY(파서 ENCRYPTED) |
| HWP5 암호 | CFB(d0cf11e0) | hwp | REQUIRES_AUTHORIZED_COPY(파서 ENCRYPTED) |
| HWPX 암호 | ZIP(504b0304) | hwpx | REQUIRES_AUTHORIZED_COPY(파서 ENCRYPTED) |
| HWP5 비보호 대조 | CFB | hwp | NEEDS_REVIEW(문단 356개) |
| 확장자 .hwp인 빈 문서(blank_hwpx.hwp) | CFB | hwp | NEEDS_REVIEW(문단 0개, 빈 정상 문서로 처리하지 않음) |

어댑터 1.6.0부터 HWP3를 파일 머리로 따로 판별한다. 1.5.0까지는 HWP3를 "HWP/HWPX 시그니처가 아님"으로만 거절해 HTML 오류 응답과 구분되지 않았다. 한컴 DRM(문서 보안)·배포용 문서는 공개 라이선스가 분명한 실표본을 찾지 못했다.
