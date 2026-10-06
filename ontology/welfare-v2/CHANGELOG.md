# welfare-v2 스키마 변경기록

## 2.1.0 (2026-10-05)

- 외부 데이터 연계 개체 추가: RegionCode, StatisticalTable·StatisticalObservation(KOSIS), CareProvider(ltc:)·CareServiceType, PublicBenefitService(gov24:), LegalProvision(law:).
- 관계 추가: codeMapsTo(적용기간·근거·검증 상태), observesRegion, providerLocatedIn, providesCareService, hasAgreementWith(협약기간), sameProgramAs·legalBasis(program_ext_link, 관리자 확인만 공개).
- 기존 개체·관계 의미와 ID는 그대로다. 공개 MCP 기존 17개 도구의 입력·출력은 바꾸지 않고 5개 도구를 더했다.

## 2.0.0 (2026-10-04)

- 재정 개체 추가: FiscalEntity(lofin:laf:), FiscalDepartment(lofin:dept:), FiscalProject(fp:), FiscalObservation(fo:). 정본은 fiscal_* 표이며 KG에 금액을 복제하지 않는다.
- 보도자료 개체: PressRelease(news:) 메타데이터 전용. NewsArticle·NewsPublisher는 민간 기사 미수집으로 NOT_COLLECTED.
- 연결: fiscalProjectFor(cross_domain_link). 이름 유사도·검증 매핑은 후보 생성에만 쓰고 관리자 검토 뒤 공개.
- 통합 공개본: platform_release_bundle(불변) + platform_active_bundle(CAS 포인터). MCP는 요청 시작 때 활성 공개본에 고정.
- 기존 core ID·predicate(located_in, classified_as, part_of, has_jurisdiction, issued_by, classified_as_topic) 의미 유지.
- 미구현: BudgetDocument/Revision/Line, FundingComponent, repostedBy, reposts/corrects/withdraws.

