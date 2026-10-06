# 12. LocalCrab 호환성(작업지시서 v5 §6.4, T34·T35)

## 결정

**어댑터 방식**을 채택했다. 상위 LocalCrab(OpenCrab) 9-Space 문법을 확장하지 않고, 복지 관계를 `claim/Claim`의 속성(`subject_id`·`predicate_id`·값·단위·범위·시점)으로 보존한다. 상위 문법에 Claim→개체 meta-edge가 없고 임의 관계를 허용하지 않으므로(`validate_edge`가 거절), `availableIn` 같은 관계를 `related_to`로 뭉개지 않기 위한 선택이다.

## 상위 재사용 범위(정확히)

- 고정 commit: `d34352cec9d99c755c1e891f811911461a460280`(2026-06-03, MIT). `factory/localcrab/pin.json`, 받기: `node factory/localcrab/fetch-upstream.mjs`(위치 `var/upstream/OpenCrab`, git 제외).
- 사용: `opencrab/grammar/manifest.py`·`validator.py`(모든 노드·관계 검사), `opencrab/stores/local_graph_store.py`(SQLite 그래프 저장).
- 사용 안 함: `ontology/builder.py`(neo4j·mongo 의존), `ontology/extractor.py`(Anthropic API 필요 → 기본 경로 금지), `opencrab.sh` SaaS, Chroma·BM25 검색.
- 이름만 LocalCrab으로 붙인 독자 구현이 아니다. 투영은 상위 검사기를 통과해야 저장되고, 저장·복원은 상위 저장소의 SQLite 테이블을 쓴다.

## 매핑

`ontology/v1/localcrab-mapping.json`. 사업(service:)·문서 정의 사업(docprog:)→`concept/Entity`, 발행기관 표기→`subject/Org`, 원문 버전→`resource/Document`, 근거 위치→`evidence/Evidence`, 사실→`claim/Claim`. 관계는 `Org owns Document`, `Document contains Evidence`, `Evidence supports Claim`.

## 왕복 검증

`Welfare 묶음 → LocalCrab 그래프 → Welfare`를 정규형(키 정렬 JSON)으로 비교한다. 근거의 소속 사실·문서는 속성이 아니라 관계 방향에서 되살린다.

- 합성 fixture(`factory/tests/fixtures/roundtrip/two-sources`: 원문 2, 사실 4, 근거 5 — 표 셀 위치, 한 사실의 근거 2개, 단위·범위, 제외조건): 손실 0.
- 실제 표본(서귀포시 공고 HWP5 → 사실 18, 근거 18): 노드 39·관계 37, 손실 0.
- 시험 5건(`python -m unittest discover -s factory/localcrab -p "test_*.py"`): 무손실 왕복, 상위 문법이 `concept→concept available_in`·`claim→concept`·역방향 `claim→evidence supports`를 거절, 근거 관계 삭제 검출, 범위 값 변경을 손실로 검출, 고정 commit 없으면 실행 거절.

## 형식 진실성(T35)

공개 반입 형식 `welfare-public-release-v2`는 이 프로젝트의 경량 형식이다. 공식 OpenCrab Pack(`opencrab-pack-v1`)이 아니며 Neo4j 검증을 실행하지 않았다. 반입 검사기는 `opencrab-pack-v1`을 `FORMAT_UNKNOWN`으로 거절한다.

## 한계

- 상위 `builder`의 자동 ID·타입 해석, Chroma 벡터·BM25 검색은 쓰지 않는다(의존성·외부 저장소).
- 공개 사이트는 LocalCrab에 실시간 질의하지 않는다. PC·LocalCrab이 꺼져도 공개 웹·MCP는 마지막 승인 자료로 동작한다.
