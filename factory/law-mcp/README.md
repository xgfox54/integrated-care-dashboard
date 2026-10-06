# 법령 근거 로컬 수집기(factory/law-mcp)

korean-law-mcp 4.15.5를 이 PC에서 stdio MCP 서버로 띄워 법제처 국가법령정보 OPEN API를 조회하고, 사업 법령 인용의 근거 후보 묶음(welfare-law-bundle-1)을 만든다. 서버(Sites Worker)는 로컬 프로세스를 실행할 수 없으므로 법제처를 직접 부르지 않고, 관리자가 이 묶음을 /admin/integrations에서 올린다.

- 고정 버전: korean-law-mcp 4.15.5(package-lock.json, .npmrc save-exact·ignore-scripts). kordoc 4.18.2는 이 패키지 안에서만 쓴다.
- 실제 프로토콜 기록: docs/protocol-4.15.5.json(initialize·tools/list, 인증값 없이 확인). 공개 도구 10개 중 search_law, get_law_text, legal_analysis만 호출한다. README의 내부 함수 이름을 도구로 가정하지 않는다.
- 차단 우회 금지: src/no-antibot.mjs가 서버 프로세스의 전역 fetch를 감싸, 법제처 JS 차단 페이지(location.assign)를 403으로 바꾼다. korean-law-mcp의 law-antibot 우회 경로(NOTICE의 라이선스 미표시 참조 구현)가 실행되지 않으며, 차단이 생기면 묶음에 BLOCKED로 남고 수집을 멈춘다.
- 인증값: LAW_OC 환경변수로만 넘기고, 서버 프로세스에도 PATH 등 최소 환경만 전달한다. 묶음·로그에 OC나 요청 주소를 남기지 않는다.
- 저장: 법령명·법령ID·MST·조문·공포일·시행일·조회기준일·원문 링크·조문 본문 SHA-256만 묶음에 넣는다(본문 미저장).

## 사용

    cd factory/law-mcp
    npm ci
    npm test                      # 파서·차단 감시·묶음 형식·실제 서버 initialize/tools/list(인증값 없이)
    npm run protocol              # docs/protocol-<버전>.json 다시 기록
    LAW_OC=<발급 인증값> node src/collect.mjs --candidates <후보.json> --out ../../var/law-bundles --query-date 2026-10-05 --limit 50

후보 목록은 관리자 화면 「후보 목록 받기」(확정된 사업–정부24 연결의 법령·자치법규·행정규칙 필드)에서 받는다. 인증값이 없으면 각 항목이 AUTH_MISSING으로 기록된 묶음이 만들어지며, 반입해도 연결은 생기지 않는다.

## 라이선스

LICENSE는 MIT지만 NOTICE에 라이선스가 표시되지 않은 제3자 구현(LexLink-ko-mcp)을 참고한 모듈이 있다고 적혀 있다. 이 수집기는 패키지를 재배포하지 않고(node_modules는 Git 제외) 해당 경로를 실행하지 않는다. 공개 배포·재배포는 원저작자 허락이나 모듈 제거판 확인 전까지 보류한다. 의존성 라이선스 집계는 docs/integrations/README.md 7절.
