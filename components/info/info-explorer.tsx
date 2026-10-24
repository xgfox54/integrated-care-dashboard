"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import { ArrowRightIcon, CheckIcon, ChevronDownIcon } from "@/components/ui/jeju-icons";
import styles from "./info.module.css";

const FEATURES = [
  { title: "대시보드", href: "/", tag: "지역을 한눈에", description: "지도에서 지역을 고르고 통합돌봄 사업을 검색·비교합니다.", example: "우리 지역의 식사·이동 지원을 찾을 때", steps: "지도에서 시·도를 선택하고 시·군·구와 사업 분류를 좁혀 보세요. 검색 결과에서 사업을 확인하고 지자체 비교나 CSV·엑셀 내려받기로 업무 자료를 준비할 수 있습니다." },
  { title: "통합돌봄 WIKI", href: "/wiki", tag: "사업을 자세히", description: "사업별 대상, 제공기관, 사업내용과 출처를 읽습니다.", example: "민원인에게 서비스 내용을 바로 설명할 때", steps: "지역과 검색어로 사업을 찾은 뒤 상세 내용을 여세요. 대상·지원내용·제공기관을 함께 확인하고, 원문에 없는 신청 조건은 해당 기관에 추가로 확인하세요." },
  { title: "복지제도100", href: "/welfare100", tag: "제도를 비교하며", description: "주요 복지제도와 중앙부처·지자체 사업을 함께 탐색합니다.", example: "비슷한 지원제도 사이의 차이를 확인할 때", steps: "검색 옵션에서 지역·생애주기·가구상황 등을 선택하세요. 제도 상세의 지원 요약, 업무구조도, 한 장 캔버스를 살펴보고 필요한 제도를 비교해 보세요." },
  { title: "복지뉴스", href: "/news", tag: "공식 소식 확인", description: "기관과 기간별로 공식 보도자료를 찾아 원문으로 이동합니다.", example: "새로 발표된 돌봄 정책을 확인할 때", steps: "제목 검색어와 발행기관·게시 기간을 정해 검색하세요. 목록의 기관과 게시일을 확인하고 제목을 눌러 공식 원문을 읽으세요. 보도자료 발표와 실제 신청 시작일은 다를 수 있습니다." },
  { title: "복지예산", href: "/budget", tag: "재정 근거 확인", description: "사회복지·보건 분야의 재정 자료와 공개된 예산서 내역을 조회합니다.", example: "사업 설명에 예산 근거를 덧붙일 때", steps: "지역·기관·부서·회계·기준일을 정하고 ‘조회’를 누르세요. 예산현액과 집행액, 예산서의 편성 단계별 금액은 구분해서 읽고 단위와 기준일을 확인하세요." },
  { title: "복지통계", href: "/statistics", tag: "지역과 시점 비교", description: "지역 인구와 KOSIS·지표누리 통계를 찾아 추이를 살펴봅니다.", example: "지역의 돌봄 수요를 파악할 때", steps: "지도·대표지표 또는 통합 검색에서 통계를 고르세요. 지역 비교가 가능한 자료는 같은 항목·단위·기간으로 비교하고, 전국 수치와 지역 수치를 구별해 사용하세요." },
  { title: "복지정보MCP", href: "/welfaremcp", tag: "AI와 함께 탐색", description: "ChatGPT·Claude 같은 AI 도구에서 복지정보를 질문할 수 있게 연결합니다.", example: "여러 자료에서 근거를 모아 설명을 준비할 때", steps: "복지정보MCP 메뉴의 연결 안내를 따라 설정한 후 지역·궁금한 서비스·확인할 항목을 질문에 적으세요. 답변에 제시된 원문과 자료 기준일을 함께 확인하세요." },
  { title: "데이터 출처", href: "/sources", tag: "근거까지 확인", description: "자료가 어디에서 왔고 어떻게 갱신되는지 확인합니다.", example: "지금 보는 정보의 최신성을 점검할 때", steps: "자료별 공식 출처와 현행화 방식을 확인하세요. 자료의 기준일은 내용을 설명하는 시점이고, 수집일은 시스템이 가져온 시점이므로 서로 구별해 읽어야 합니다." },
] as const;

const SCENARIOS = [
  { id: "meal", title: "혼자 사는 어르신의 식사 지원", question: "혼자 식사를 챙기기 어려운데, 우리 동네에 도움받을 곳이 있나요?", steps: ["대시보드에서 거주 지역을 고르고 ‘식사’ 등 필요한 서비스를 검색합니다.", "통합돌봄 WIKI에서 해당 사업의 대상·제공내용·기관을 확인합니다.", "현재 운영 여부와 신청 경로를 원문 또는 담당 기관에서 확인한 뒤 민원인에게 설명합니다."], links: [{ href: "/", label: "지역 사업 찾기" }, { href: "/wiki", label: "WIKI에서 상세 보기" }], tip: "상담 메모에는 사업명·제공기관·확인일을 함께 남기면 다음 상담에 다시 활용하기 좋습니다." },
  { id: "family", title: "가족 상황에 맞는 복지제도", question: "아이를 키우는 가정인데 어떤 지원을 찾아보면 좋을까요?", steps: ["복지제도100의 검색 옵션에서 생애주기·가구상황·지역을 선택합니다.", "관련 제도의 지원대상·지원내용·신청방법을 읽고, 비슷한 제도는 비교합니다.", "민원인의 상황과 제도별 요건을 대조할 항목을 정리하고 공식 신청·상담 창구로 안내합니다."], links: [{ href: "/welfare100", label: "복지제도 찾아보기" }], tip: "검색 결과는 상담 후보입니다. 소득·가구·중복지원 등 개별 조건을 확인해야 실제 지원 가능 여부를 판단할 수 있습니다." },
  { id: "local", title: "다른 지역의 운영 사례", question: "다른 시·군·구는 퇴원 후 돌봄을 어떻게 운영하나요?", steps: ["대시보드에서 비교할 지역과 사업 분야를 선택합니다.", "WIKI에서 사업내용·제공기관·대상을 비교하고 지역별 운영 차이를 정리합니다.", "복지뉴스에서 해당 기관의 최근 발표를 확인하고 원문 링크를 업무 자료에 함께 남깁니다."], links: [{ href: "/", label: "지자체 사업 비교" }, { href: "/news", label: "최근 공식 소식 보기" }], tip: "다른 지역의 사례가 우리 지역에도 적용되는 것은 아닙니다. 지역과 사업 기준연도를 함께 표시하세요." },
  { id: "planning", title: "사업계획에 필요한 근거", question: "우리 지역의 돌봄 수요와 관련 예산을 함께 살펴보고 싶어요.", steps: ["복지통계에서 인구·복지 지표를 찾고 같은 항목과 기간으로 지역 추이를 확인합니다.", "복지예산에서 지역·부서·기준일을 정해 조회하고 해당 사업과 예산서 내역을 살펴봅니다.", "통계의 단위·조사대상, 예산의 회계·편성 단계·기준일을 구분해 계획서에 인용합니다."], links: [{ href: "/statistics", label: "통계 근거 찾기" }, { href: "/budget", label: "예산 근거 찾기" }], tip: "사업명이 비슷하다는 이유로 자료를 같은 사업으로 합치지 말고 기관·연도·식별정보를 함께 확인하세요." },
] as const;

const DATABASE = [
  { id: "official", title: "통합돌봄 사업", subtitle: "원문과 공개본을 함께 보관", body: "공식 문서에서 추출한 사업 정보를 수집 실행 단위의 스냅샷으로 저장합니다. 사업 내용뿐 아니라 어떤 문서에서 왔는지, 어느 공개본에 포함되는지를 연결합니다.", tables: ["official_sync_run — 수집 실행·버전", "official_service_snapshot — 실행별 사업 정보", "official_source_document — 공식 원문 정보"], relation: "수집 실행 → 사업 스냅샷 / 출처 문서", usage: "대시보드·WIKI와 통합 검색의 근거가 됩니다." },
  { id: "manual", title: "매뉴얼·상담 자료", subtitle: "문서와 설명 단락을 구분", body: "매뉴얼은 자료 묶음·문서·절로 나누어 검색합니다. 보건복지상담센터 129 FAQ와 정부24 서비스도 별도 자료로 관리합니다. 원문 쪽이나 조건이 확인되지 않으면 확인 필요 상태를 보존합니다.", tables: ["manual_corpus — 자료 묶음", "manual_document — 문서", "manual_section — 검색 가능한 절", "faq_129 / gov24_service — FAQ·서비스"], relation: "자료 묶음 → 문서 → 절 / FAQ·서비스 별도 관리", usage: "서비스 상세와 상담 질문에 대한 추가 근거를 찾습니다." },
  { id: "finance", title: "예산·검토 문서", subtitle: "사업, 금액, 증거를 분리", body: "사업의 식별정보와 날짜별 금액을 분리해 저장합니다. 별도 문서에서 추출한 내용은 문서·진술·근거 구조로 관리하므로 공개 재정 수치와 승인된 문서의 금액을 구별할 수 있습니다.", tables: ["fiscal_project — 세부사업", "fiscal_snapshot / fiscal_observation — 공개본·시점별 값", "doc_source / doc_statement / doc_evidence — 문서·내용·근거"], relation: "사업 → 시점별 값 / 검토 문서 → 내용 → 근거", usage: "복지예산 조회와 예산서 근거 확인에 사용합니다." },
  { id: "external", title: "뉴스·외부 데이터", subtitle: "출처와 수집 이력을 유지", body: "뉴스는 발행기관·수집처·기사 메타데이터를 분리하고 제목·게시일·원문 주소 중심으로 제공합니다. 외부 데이터는 데이터셋·수집 실행·레코드를 구분합니다. 통계는 각 자료의 지역·시점·단위를 유지한 저장 자료를 조회합니다.", tables: ["press_organization / press_source / press_item — 기관·수집처·기사", "ext_dataset / ext_run / ext_record — 외부 자료·실행·레코드"], relation: "출처 → 수집 실행 → 항목 / 통계의 시점·지역·단위 보존", usage: "새 소식을 추적하고 자료별 조건에 맞춰 통계를 비교합니다." },
  { id: "catalog", title: "복지제도 목록·요약", subtitle: "정적 JSON으로 빠르게 읽기", body: "복지제도100의 목록·검색 색인·제도별 설명과 사전 계산한 요약은 정적 JSON 자산도 함께 사용합니다. 자주 바뀌는 운영 자료를 저장하는 D1과 함께 구성해, 화면에 필요한 자료부터 읽도록 합니다.", tables: ["public/data/welfare100 — 제도별 JSON 자산", "index.json / index-lite.json / items — 목록·색인·상세 구조"], relation: "목록·색인 → 선택한 제도 상세", usage: "제도 탐색·비교·업무구조도 화면을 구성합니다." },
  { id: "release", title: "연결·공개 버전", subtitle: "검증된 연결과 이력 관리", body: "분야가 다른 자료의 연결과 공개 자료 묶음을 따로 관리합니다. 이름이 비슷한 후보와 검증된 연결을 구별하며, 자료별로 갱신 주기가 다르므로 모든 자료가 같은 날짜의 자료라고 가정하지 않습니다.", tables: ["cross_domain_link — 분야 간 연결", "platform_release_bundle — 공개 자료 묶음"], relation: "검증된 연결 + 공개본 선택 → 웹·MCP 조회", usage: "화면과 AI가 출처·버전을 확인하며 자료를 사용할 수 있게 합니다." },
] as const;

const MCP_STEPS = [
  { id: "ask", title: "질문·도구 선택", subtitle: "AI 클라이언트", body: "이용자가 ChatGPT·Claude 등에 질문하면, AI가 필요한 MCP 도구를 선택합니다. MCP는 AI가 외부 자료를 정해진 형식으로 조회하도록 연결하는 규약입니다.", detail: "연결 경로: /chatgpt/mcp · /claude/mcp. Streamable HTTP로 요청을 주고받고, 서버는 요청별로 도구를 실행합니다." },
  { id: "plan", title: "검색 의도 정리", subtitle: "MCP 검색 계층", body: "search 요청은 사업·지역·연도·질문 의도를 정리한 검색 계획을 바탕으로 관련 자료를 찾습니다. 지역이나 기준연도를 질문에 넣으면 찾으려는 범위를 더 분명히 할 수 있습니다.", detail: "query_plan으로 검색 맥락을 정리하고 통합돌봄·복지제도·매뉴얼·FAQ 등 필요한 자료원을 조회합니다." },
  { id: "cache", title: "캐시·자료 조회", subtitle: "메모리 → D1 → 자료원", body: "재사용 가능한 검색은 메모리 캐시, D1 캐시 순서로 확인합니다. 유효한 결과가 없으면 자료원을 검색해 결과를 모읍니다. 민감한 정보가 감지된 질문은 검색 캐시를 건너뜁니다.", detail: "검색 캐시 유효기간은 기본 10분이며 D1 캐시 본문은 암호화합니다. 캐시 적중은 검색 결과 재사용을 뜻하며 자료 자체의 최신성을 보증하지 않습니다." },
  { id: "evidence", title: "상세·근거 확인", subtitle: "상세 조회 도구", body: "검색 결과는 후보입니다. AI는 상세 조회 도구로 대상·지원내용·신청방법과 근거를 추가로 확인할 수 있습니다. 자료가 부족하거나 서로 다르면 확인되지 않은 부분을 남겨 두어야 합니다.", detail: "예: fetch, get_welfare_context, get_manual_section, get_faq. 도구 결과에는 출처·기준 정보·주의사항 등을 함께 전달합니다." },
  { id: "answer", title: "설명·원문 안내", subtitle: "AI 답변과 이용자 확인", body: "AI가 조회한 근거를 바탕으로 설명을 구성합니다. 이용자는 답변의 출처와 날짜를 열어 보고 실제 상황에 맞는지 확인합니다. 사이트의 MCP는 정보 조회를 돕고 최종 수급자 선정이나 행정 처리를 대신하지 않습니다.", detail: "질문 예시: ‘서귀포시 식사지원 사업을 찾아 대상·지원내용·신청방법을 설명하고, 출처와 추가 확인이 필요한 조건도 알려줘.’" },
] as const;

function SectionHeading({ number, title, children }: { readonly number: string; readonly title: string; readonly children: ReactNode }) {
  return <header className={styles.sectionHeading}><span className={styles.eyebrow}>{number}</span><h2>{title}</h2><p>{children}</p></header>;
}

function Destination({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return <a className={styles.destination} href={href}>{children}<ArrowRightIcon aria-hidden="true" className="size-4 shrink-0" /></a>;
}

function Choice({ selected, onClick, controls, title, subtitle }: { readonly selected: boolean; readonly onClick: () => void; readonly controls: string; readonly title: string; readonly subtitle?: string }) {
  return <button type="button" className={styles.choice} aria-pressed={selected} aria-controls={controls} onClick={onClick}><span><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span><CheckIcon aria-hidden="true" className={selected ? "size-5 shrink-0" : "invisible size-5 shrink-0"} /></button>;
}

export function InfoExplorer() {
  const [scenario, setScenario] = useState<(typeof SCENARIOS)[number]>(SCENARIOS[0]);
  const [database, setDatabase] = useState<(typeof DATABASE)[number]>(DATABASE[0]);
  const [mcp, setMcp] = useState<(typeof MCP_STEPS)[number]>(MCP_STEPS[0]);

  return (
    <div className={styles.info}>
      <section className={styles.hero} aria-labelledby="info-title">
        <div>
          <p className={styles.eyebrow}>전국 통합돌봄 사업 총괄 대시보드</p>
          <h1 id="info-title">시스템 소개</h1>
          <p className={styles.lead}>전국 지자체 돌봄사업부터 대한민국 복지 제도까지,<br />데이터로 복지 현장을 뒷받침하는 통합 대시보드.</p>
          <p>전국 243개 지방자치단체의 돌봄 사업, 복지제도, 예산과 통계를 한곳에서 찾고 비교하는 종합 복지정보 제공 플랫폼입니다.<br />현장 민원 응대, 복지서비스 연계, 보고서 작성 등 다양하게 활용해보세요.</p>
          <div className={styles.links}><Destination href="#cases">상담 사례로 시작하기</Destination><a href="#features">전체 기능 둘러보기</a></div>
        </div>
        <aside className={styles.fieldNote}>
          <span className={styles.eyebrow}>읍·면·동 현장에서</span>
          <h2>찾아서, 확인하고, 설명합니다.</h2>
          <p>실제 읍·면·동 민원 현장에서도 담당자가 이 사이트를 활용해 민원인이 궁금해하는 서비스 정보를 바로 찾아 설명하는 등 민원업무에 유용하게 사용하고 있습니다.</p>
          <ol><li><b>01</b> 지역과 필요한 서비스 찾기</li><li><b>02</b> 대상·지원내용·출처 확인하기</li><li><b>03</b> 신청·상담 창구 안내하기</li></ol>
        </aside>
        <figure className={styles.introVideo}>
          <video controls playsInline preload="metadata" poster="/media/system-intro-poster.jpg" aria-label="전국 통합돌봄 사업 총괄 대시보드 소개 영상">
            <source src="/video/system-intro.mp4?v=20261023" type="video/mp4" />
          </video>
          <figcaption>소개 영상 · 50초 · 재생 버튼을 누르면 배경음악과 함께 재생됩니다.</figcaption>
        </figure>
      </section>

      <nav className={styles.jumpNav} aria-label="시스템 소개 목차"><a href="#features">01 기능 안내</a><a href="#cases">02 활용 사례</a><a href="#database">03 DB 구조</a><a href="#mcp">04 MCP 구조</a></nav>

      <section id="features" className={styles.section} aria-labelledby="features-title">
        <div id="features-title"><SectionHeading number="01 · 기능 안내" title="무엇을 찾고 싶으신가요?">블록을 펼치면 사용 방법과 메뉴 바로가기가 나옵니다.</SectionHeading></div>
        <div className={styles.featureGrid}>{FEATURES.map((feature) => <details key={feature.href} className={styles.feature}><summary><span className={styles.eyebrow}>{feature.tag}</span><span className={styles.featureTitle}>{feature.title}<ChevronDownIcon aria-hidden="true" className="size-5 shrink-0" /></span><span>{feature.description}</span></summary><div className={styles.featureBody}><h3>{feature.example}</h3><p>{feature.steps}</p><Destination href={feature.href}>{feature.title} 이용하기</Destination></div></details>)}</div>
      </section>

      <section id="cases" className={styles.section} aria-labelledby="cases-title">
        <div id="cases-title"><SectionHeading number="02 · 활용 사례" title="질문에 맞춰 따라 해 보세요">아래는 이용 방법을 설명하기 위한 예시입니다. 사례를 고르면 확인 순서가 바뀝니다.</SectionHeading></div>
        <div className={styles.explorer}><div className={styles.choices} role="group" aria-label="상담 사례 선택">{SCENARIOS.map((item) => <Choice key={item.id} title={item.title} selected={scenario.id === item.id} controls="case-panel" onClick={() => setScenario(item)} />)}</div><article id="case-panel" className={styles.panel} aria-label="선택한 상담 사례" aria-live="polite" aria-atomic="true"><p className={styles.eyebrow}>사용 예시 · {scenario.title}</p><h3 className={styles.question}>{scenario.question}</h3><ol className={styles.steps}>{scenario.steps.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}</ol><p className={styles.tip}>{scenario.tip}</p><div className={styles.links}>{scenario.links.map((link) => <Destination key={link.href} href={link.href}>{link.label}</Destination>)}</div></article></div>
      </section>

      <section id="database" className={styles.section} aria-labelledby="database-title">
        <div id="database-title"><SectionHeading number="03 · DB 구성과 구조" title="자료의 내용과 근거를 함께 연결합니다">Cloudflare D1(SQLite 기반 데이터베이스)과 정적 JSON 자료를 함께 사용합니다. 아래 연결은 이해를 돕기 위한 논리 구조입니다.</SectionHeading></div>
        <ol className={styles.pipeline} aria-label="데이터 구성 과정"><li>공식 원문 수집</li><li>정규화·검토</li><li>분야별 저장</li><li>공개본 선택</li><li>웹·MCP 조회</li></ol>
        <div className={styles.explorer}><div className={styles.choices} role="group" aria-label="데이터 구조 선택">{DATABASE.map((item) => <Choice key={item.id} title={item.title} subtitle={item.subtitle} selected={database.id === item.id} controls="database-panel" onClick={() => setDatabase(item)} />)}</div><article id="database-panel" className={styles.panel} aria-label="선택한 데이터 구조" aria-live="polite" aria-atomic="true"><p className={styles.eyebrow}>{database.subtitle}</p><h3>{database.title}</h3><p>{database.body}</p><p className={styles.relation}>{database.relation}</p><h4>주요 저장 구조</h4><ul className={styles.tableNames}>{database.tables.map((table) => <li key={table}>{table}</li>)}</ul><p className={styles.tip}>{database.usage}</p></article></div>
        <details className={styles.note}><summary>자료를 읽을 때 함께 확인할 3가지<ChevronDownIcon aria-hidden="true" className="size-5 shrink-0" /></summary><ul><li><strong>출처:</strong> 정리된 설명과 공식 원문을 구별합니다.</li><li><strong>시점:</strong> 기준연도·기준일과 시스템 수집일을 구별합니다.</li><li><strong>확인 범위:</strong> 원문에 없는 조건과 불확실한 쪽 번호를 임의로 채우지 않습니다.</li></ul><Destination href="/sources">자료별 출처와 현행화 방식 보기</Destination></details>
      </section>

      <section id="mcp" className={styles.section} aria-labelledby="mcp-title">
        <div id="mcp-title"><SectionHeading number="04 · MCP 구조" title="AI가 근거를 찾아 설명하는 과정">MCP(Model Context Protocol)는 AI와 이 사이트의 조회 도구를 잇는 연결 규약입니다. 단계별 블록을 눌러 흐름을 살펴보세요.</SectionHeading></div>
        <div className={styles.mcpChoices} role="group" aria-label="MCP 처리 단계 선택">{MCP_STEPS.map((item, index) => <Choice key={item.id} title={`${index + 1}. ${item.title}`} subtitle={item.subtitle} selected={mcp.id === item.id} controls="mcp-panel" onClick={() => setMcp(item)} />)}</div>
        <article id="mcp-panel" className={styles.panel} aria-label="선택한 MCP 처리 단계" aria-live="polite" aria-atomic="true"><p className={styles.eyebrow}>{mcp.subtitle}</p><h3>{mcp.title}</h3><p>{mcp.body}</p><p className={styles.tip}>{mcp.detail}</p></article>
        <div className={styles.footerBlock}><div><h3>질문은 구체적으로, 설명은 근거와 함께</h3><p>지역 · 서비스 · 궁금한 조건을 적고 출처와 기준일까지 요청해 보세요.</p></div><Destination href="/welfaremcp">MCP 연결 방법 보기</Destination></div>
      </section>
    </div>
  );
}
