# 의존성·실행환경 기록 (2026-10-04)

| 항목 | 값 |
|---|---|
| kordoc | 4.18.8, sha512-/rrl2vTfAwS2kb3Vn41TYjPsE4c7isgGvFMTthcmSD2gBnDQW5zGctYD3JxiLJ6ZkggGIoJZV5rVvrTBuFlhnw== |
| 대응 소스 | github.com/chrisryugj/kordoc gitHead 1d9bc7d651bdae070113f3f91c98f6291570fd47 (npm 레지스트리 표시값, 빌드 재현 미확인) |
| 라이선스 | MIT |
| 설치 프로필 | omit=optional, legacy-peer-deps (OCR·PDF 렌더·sharp·onnxruntime·transformers·puppeteer 미설치) |
| OS·CPU | Windows_NT 10.0.26200 x64, AMD Ryzen 5 7500F |
| Node·npm | v24.18.0 (C:\\Program Files\\nodejs\\node.exe), npm 11.16.0 |
| lockfile SHA-256 | 4e7c5733c4b43b3e9581d5f3c5fe18b003925b74e73ec50b050ec0b71ddbc460 (package-lock.json) |
| 설치 패키지 | 운영 119개(+ 시험용 @cfworker/json-schema 1개) |
| 운영 의존성 라이선스 | MIT 102, ISC 7, Apache-2.0 3, BSD-2/3 4, Python-2.0 1(argparse), (MIT OR GPL-3.0-or-later) 1(jszip, MIT 선택), (MIT AND Zlib) 1(pako) |
| npm audit (--omit=dev) | 0건 |
| 미설치 선택 의존성 | @huggingface/transformers, @hyzyla/pdfium, sharp·libvips(LGPL 포함), onnxruntime-node, @napi-rs/canvas 등 |

선택 의존성을 뺀 설치에서도 HWP/HWPX 파싱과 패키지 로딩이 되는지는 `npm test`(합성 HWPX + 실제 공개 HWPX 3건·HWP 5.x 1건)로 확인했다.

## 시험한 실제 공개 문서(원문은 저장소 밖 var/welfare-factory/raw/real)

| 문서 | 형식 | 결과 |
|---|---|---|
| 보건복지부 보도참고자료 「통합돌봄 현장 이끌 핵심인재 500명 키운다!」(list_no 1492120) | HWPX | STRUCTURE_VALIDATED, 표 7, 셀 47, 330ms |
| 보건복지부 보도자료(list_no 1492126, 복지급여 신청주의 개선) | HWPX 2.5MB | NEEDS_REVIEW(그림 6개 미판독), 표 13, 셀 156, 병합 가림 16 |
| 보건복지부 보도자료(list_no 1492142, 재가 생애말기 지원) | HWPX | NEEDS_REVIEW(그림 1개), 표 5 |
| 서귀포시 2025 자원재활용(폐지류 수거보상금) 수집자 등록 신청안내 | HWP 5.x | STRUCTURE_VALIDATED, 표 4, 셀 61, 병합 가림 64 |

네 문서 모두 kordoc 경고 0건, 네트워크 시도 0건, page_mode=layout. 실제 문서는 머리 셀 표시가 없어 header_basis=layout_hint_unconfirmed.

