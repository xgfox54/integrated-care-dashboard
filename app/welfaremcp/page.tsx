import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PageUsage } from "@/components/usage/page-usage";
import { WelfareMcpCopy } from "@/components/welfaremcp-copy";
import {
  ArrowRightIcon, BuildingIcon, ChevronDownIcon, ExternalLinkIcon, FileIcon,
  InfoIcon, SearchIcon, UsersIcon,
} from "@/components/ui/jeju-icons";
import { PUBLIC_MCP_TOOL_NAMES } from "@/lib/mcp/contract";

export const metadata: Metadata = {
  title: "복지정보MCP · 소개와 설치 방법 | 전국 통합돌봄 사업 총괄 대시보드",
  description: "복지사업, 제도, 예산, 통계, 보도자료와 매뉴얼을 AI 대화에서 조회하는 복지정보MCP의 소개, ChatGPT·Claude·Perplexity·Gemini 연결 방법, 질문 예시를 안내합니다.",
  alternates: { canonical: "/welfaremcp" },
};

const MCP_URL = "https://integrated-care-national-dashboard.xgfox54.chatgpt.site/chatgpt/mcp";
const CLAUDE_MCP_URL = "https://integrated-care-national-dashboard.xgfox54.chatgpt.site/claude/mcp";
const CLAUDE_CODE_COMMAND = "claude mcp add --transport http welfare-mcp " + CLAUDE_MCP_URL;
const LINK_CLASS = "font-bold text-primary underline underline-offset-4 outline-none hover:text-(--jeju-primary-hover) focus-visible:shadow-(--jeju-focus-ring)";
const SECTION_TITLE = "text-(length:--jeju-h2-size) font-extrabold leading-(--jeju-leading-tight) text-(--jeju-text-strong)";

const CONNECTIONS = [
  { app: "ChatGPT", url: MCP_URL, auth: "인증없음(No authentication) · 로그인·인증키 불필요", guide: "#install", guideLabel: "ChatGPT 연결 방법", copyLabel: "ChatGPT 주소 복사" },
  { app: "Claude · Perplexity · Gemini", url: CLAUDE_MCP_URL, auth: "로그인 없음(No sign in) · 인증키 불필요", guide: "#claude", guideLabel: "연결 방법", copyLabel: "공용 주소 복사" },
] as const;

const CLAUDE_STEPS = [
  { title: "커넥터 메뉴 열기", body: <>claude.ai에 로그인한 뒤 <strong>Customize</strong>(사용자 지정) 메뉴에서 <strong>Connectors</strong>(커넥터)를 엽니다.</> },
  { title: "커스텀 커넥터 추가 누르기", body: <><strong>+ Add</strong>(추가)를 누르고 <strong>Add custom connector</strong>(커스텀 커넥터 추가)를 선택합니다.</> },
  { title: "이름과 주소 입력하기", body: <>이름은 <strong>복지정보MCP</strong>, 서버 주소(Remote MCP server URL)에는 위의 <strong>Claude용 주소</strong>를 붙여 넣고 <strong>Continue</strong>를 누릅니다. 주소는 <strong>/claude/mcp</strong>로 끝나야 합니다.</> },
  { title: "인증 방식 고르기", body: <>Authentication에서 <strong>No sign in</strong>(로그인 없음)을 고르고 <strong>Continue</strong>를 누릅니다. 별도 인증키나 Request headers는 필요하지 않습니다.</> },
  { title: "추가 완료하기", body: <><strong>Add</strong>를 누르면 커넥터 목록에 복지정보MCP가 Custom 표시와 함께 나타납니다.</> },
  { title: "대화에서 켜고 질문하기", body: <>새 대화 입력창 왼쪽 아래 <strong>＋</strong> → <strong>Connectors</strong>에서 복지정보MCP 스위치를 켭니다. 도구 사용 승인 창이 뜨면 허용하세요(모든 도구는 조회 전용입니다). 아래의 ‘처음 연결했다면’ 질문을 보내 자료 범위와 기준일이 나오면 연결이 끝난 것입니다.</> },
] as const;

const CLAUDE_TROUBLESHOOTING = [
  "주소가 /claude/mcp로 끝나는지 확인하세요.",
  "커넥터의 주소를 바꾸려면 Customize → Connectors에서 커넥터를 삭제(Remove)한 뒤 다시 추가해야 합니다.",
  "답변에 도구를 쓰지 않으면 입력창의 ＋ → Connectors에서 복지정보MCP가 켜져 있는지 확인하고, 질문에 ‘복지정보MCP로 찾아줘’를 덧붙여 보세요.",
  "‘요청이 너무 많습니다’(429)가 나오면 함께 쓰는 이용 한도를 넘은 것입니다. Retry-After에 표시된 시간 또는 1분 정도 뒤 다시 시도하세요.",
  "무료 요금제에서 커넥터 추가가 막히면 이미 다른 커스텀 커넥터 1개를 쓰고 있는지 확인하세요.",
] as const;

const CAPABILITIES = [
  { title: "복지·보건 통계", icon: SearchIcon, description: "보건복지부 통계를 찾고 연결된 공식 통계표의 연도별 수치, 단위, 결측·잠정치 표시와 원문을 조회합니다. 미연결 항목은 원문을 안내합니다.", href: "/statistics", link: "복지통계" },
  { title: "복지사업과 지원조건", icon: SearchIcon, description: "지역·대상별 통합돌봄 사업을 찾고 지원대상, 사업 내용과 확인된 근거를 조회합니다.", href: "/wiki", link: "통합돌봄 WIKI" },
  { title: "복지제도와 연결정보", icon: UsersIcon, description: "복지제도의 설명과 관련 사업·기관·지역 사이에 확인된 연결을 살펴봅니다.", href: "/welfare100", link: "복지제도100" },
  { title: "예산과 재정", icon: BuildingIcon, description: "공개 재정자료와 승인된 예산서에서 사업을 찾고, 자료별 기준일과 예산 단계를 확인합니다.", href: "/budget", link: "복지예산" },
  { title: "공식 보도자료", icon: FileIcon, description: "수집된 복지 보도자료의 제목, 발행기관, 게시일과 원문 링크를 검색합니다.", href: "/news", link: "복지뉴스" },
  { title: "복지 매뉴얼 본문", icon: SearchIcon, description: "반입된 매뉴얼의 본문을 검색하고, 해당 구간과 출처를 함께 확인합니다. 제공 범위는 자료 상태에 따라 달라집니다.", href: "/sources", link: "자료 범위와 출처" },
] as const;

const EXAMPLES = [
  { label: "복지통계 시계열 조회", text: "복지통계에서 국민기초생활보장 수급자 수의 2021~2025년 추이를 보여줘. 단위, 잠정치 여부, 원문과 확인일을 함께 알려줘." },
  { label: "처음 연결했다면", text: "복지정보MCP에 현재 수록된 자료의 범위와 기준일, 조회할 수 없는 항목을 알려줘." },
  { label: "지역별 사업 조사", text: "서귀포시에서 시행하는 통합돌봄 사업을 찾아서 지원대상, 사업 내용, 담당기관과 출처를 정리해줘." },
  { label: "예산 근거 확인", text: "2026년 통합돌봄 관련 예산서 사업을 찾아줘. 지역, 본예산·추경 구분, 금액 단위와 원문 근거를 함께 보여줘." },
  { label: "보도자료 동향 파악", text: "최근 7일 동안 수집된 공식 통합돌봄 보도자료를 지역별로 정리하고, 발행기관·게시일·원문 링크를 달아줘." },
  { label: "매뉴얼 근거 찾기", text: "수록된 복지 매뉴얼에서 통합돌봄 대상자 발굴 절차를 찾아줘. 문서명과 적용연도, 해당 본문 구간을 함께 보여줘." },
] as const;

function ExternalLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${LINK_CLASS} inline-flex items-center gap-1.5`}>
      {children}<ExternalLinkIcon className="size-4" /><span className="sr-only">(새 창)</span>
    </a>
  );
}

export default function WelfareMcpPage() {
  return (
    <main className="mx-auto max-w-[1120px] space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      <PageUsage page="welfaremcp" tab="welfaremcp" />

      <section aria-labelledby="mcp-title" className="overflow-hidden rounded-(--jeju-radius-lg) border border-(--jeju-shell-border) bg-card">
        <div aria-hidden="true" className="h-1 bg-[linear-gradient(90deg,var(--jeju-blue)_0_34%,var(--jeju-green)_34%_67%,var(--jeju-orange)_67%)]" />
        <div className="grid gap-7 p-5 sm:p-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <p className="text-(length:--jeju-text-sm) font-bold tracking-wide text-primary">Korean Welfare MCP</p>
            <h1 id="mcp-title" className="mt-2 text-(length:--jeju-h1-size) font-extrabold leading-(--jeju-leading-tight) text-(--jeju-text-strong)">복지정보MCP</h1>
            <p className="mt-4 text-(length:--jeju-text-lg) font-bold text-(--jeju-text-strong)">복지정보를 AI 대화에서, 근거와 함께.</p>
            <p className="mt-2 leading-relaxed text-(--jeju-text-body)">
              대시보드의 복지사업·제도·예산·통계·보도자료와 매뉴얼을 AI가 조회할 수 있도록 연결합니다.
              평소 쓰는 말로 질문하고, 출처와 기준일을 함께 확인하세요.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-(length:--jeju-text-sm) font-bold">
              <span className="rounded-full bg-(--jeju-primary-tint) px-3 py-1 text-primary">공개 도구 {PUBLIC_MCP_TOOL_NAMES.length}개</span>
              <span className="rounded-full bg-(--jeju-green-light) px-3 py-1 text-(--jeju-secondary-strong)">조회 전용</span>
              <span className="rounded-full bg-(--jeju-surface-inset) px-3 py-1 text-(--jeju-text-body)">출처·기준일 확인</span>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href="#install" className="inline-flex min-h-(--jeju-control-h) items-center justify-center gap-2 rounded-(--jeju-radius) bg-primary px-5 py-3 font-bold text-primary-foreground outline-none hover:bg-(--jeju-primary-hover) focus-visible:shadow-(--jeju-focus-ring)">
                ChatGPT 설치 방법<ArrowRightIcon />
              </a>
              <a href="#claude" className="inline-flex min-h-(--jeju-control-h) items-center justify-center gap-2 rounded-(--jeju-radius) border border-primary bg-card px-5 py-3 font-bold text-primary outline-none hover:bg-(--jeju-primary-tint) focus-visible:shadow-(--jeju-focus-ring)">
                Claude · Perplexity · Gemini 연결<ArrowRightIcon />
              </a>
            </div>
          </div>
          <aside aria-label="MCP 연결 정보" className="min-w-0 rounded-(--jeju-radius-lg) border border-border bg-(--jeju-surface-inset) p-5 sm:p-6">
            <h2 className="font-extrabold text-(--jeju-text-strong)">연결할 서버 주소</h2>
            <p className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">사용하는 AI 앱에 맞는 주소를 복사해 등록하세요. 조회할 수 있는 자료와 도구는 같습니다.</p>
            {CONNECTIONS.map((item) => (
              <div key={item.app} className="mt-4 border-t border-border pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-extrabold text-(--jeju-text-strong)">{item.app}</h3>
                  <a href={item.guide} className={`${LINK_CLASS} text-(length:--jeju-text-sm)`}>{item.guideLabel}</a>
                </div>
                <code className="my-3 block select-all break-all rounded-(--jeju-radius) border border-border bg-card p-3 text-(length:--jeju-text-sm) leading-relaxed text-(--jeju-text-strong)">{item.url}</code>
                <dl className="mb-3 grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 text-(length:--jeju-text-sm)">
                  <dt className="text-muted-foreground">인증</dt><dd>{item.auth}</dd>
                </dl>
                <WelfareMcpCopy value={item.url} label={item.copyLabel} />
              </div>
            ))}
            <p className="mt-4 border-t border-border pt-4 text-(length:--jeju-text-sm) text-muted-foreground">ChatGPT 주소는 <strong>/chatgpt/mcp</strong>, Claude·Perplexity·Gemini 공용 주소는 <strong>/claude/mcp</strong>로 끝납니다. 사용하는 앱에 맞는 주소를 등록하세요. 웹페이지를 여는 주소가 아니라 AI 앱에 등록하는 연결 주소입니다.</p>
          </aside>
        </div>
      </section>

      <nav aria-label="복지정보MCP 안내 목차" className="flex flex-wrap gap-x-6 gap-y-2 border-b border-border pb-4 text-(length:--jeju-text-sm)">
        <a href="#overview" className={LINK_CLASS}>MCP 소개</a>
        <a href="#install" className={LINK_CLASS}>ChatGPT 연결</a>
        <a href="#claude" className={LINK_CLASS}>Claude · Perplexity · Gemini 연결</a>
        <a href="#examples" className={LINK_CLASS}>질문 예시</a>
        <a href="#help" className={LINK_CLASS}>자주 묻는 질문</a>
      </nav>

      <section id="overview" aria-labelledby="overview-title" className="scroll-mt-6">
        <h2 id="overview-title" className={SECTION_TITLE}>복지정보MCP로 무엇을 할 수 있나요?</h2>
        <p className="mt-3 max-w-[80ch] leading-relaxed text-(--jeju-text-body)">
          MCP(Model Context Protocol)는 AI 앱이 외부의 자료와 기능을 사용할 수 있게 연결하는 표준입니다.
          복지정보MCP를 연결하면 AI가 질문에 필요한 조회 도구를 호출하고, 대시보드에서 제공하는 자료를 바탕으로 답변을 구성합니다.
          <span className="ml-1"><ExternalLink href="https://developers.openai.com/api/docs/guides/custom-mcp-server">MCP 연결 공식 안내</ExternalLink></span>
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ title, icon: Icon, description, href, link }) => (
            <article key={title} className="flex flex-col rounded-(--jeju-radius-lg) border border-border bg-card p-5">
              <span className="mb-4 flex size-10 items-center justify-center rounded-(--jeju-radius) bg-(--jeju-primary-tint) text-primary"><Icon /></span>
              <h3 className="font-extrabold text-(--jeju-text-strong)">{title}</h3>
              <p className="mb-4 mt-2 flex-1 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">{description}</p>
              <div className="text-(length:--jeju-text-sm)">
                {href.startsWith("https:") ? <ExternalLink href={href}>{link}</ExternalLink> : <a href={href} className={LINK_CLASS}>{link}<span aria-hidden="true"> →</span></a>}
              </div>
            </article>
          ))}
        </div>
        <p className="mt-3 text-(length:--jeju-text-sm) text-muted-foreground">공개된 자료만 조회합니다. 신청 접수나 개인정보 변경을 처리하지 않으며, 자료가 없는 항목은 확인할 수 없다고 안내합니다.</p>
      </section>

      <section id="install" aria-labelledby="install-title" className="scroll-mt-6 rounded-(--jeju-radius-lg) border border-border bg-card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="mb-1 text-(length:--jeju-text-sm) font-bold text-primary">ChatGPT 연결 안내</p>
            <h2 id="install-title" className={SECTION_TITLE}>처음부터 차근차근 설치하기</h2>
          </div>
          <span className="rounded-full bg-(--jeju-surface-inset) px-3 py-1 text-(length:--jeju-text-sm) text-muted-foreground">웹 화면 기준</span>
        </div>
        <p className="mt-3 leading-relaxed text-(--jeju-text-body)">ChatGPT에 로그인한 뒤 아래 순서로 연결하세요. 복지정보MCP는 공개 자료만 조회하므로 인증 방식은 <strong>인증없음</strong>으로 등록하며, 별도 로그인이나 인증키가 필요하지 않습니다. 계정과 소속 워크스페이스의 정책에 따라 메뉴 표시나 설치 권한이 다를 수 있습니다.</p>
        <div className="mt-5 flex gap-3 rounded-(--jeju-radius) bg-(--jeju-primary-tint) p-4 text-(length:--jeju-text-sm) leading-relaxed">
          <InfoIcon className="mt-0.5 text-primary" />
          <p><strong className="text-primary">예전에 OAuth 방식으로 등록했다면</strong><br />복지정보MCP는 이제 로그인 없이 연결합니다. 예전 주소(<strong>/mcp</strong>로 끝나는 주소)와 OAuth 방식은 더 이상 쓰지 않습니다. 예전에 만든 플러그인(‘전국 통합돌봄 사업 총괄 대시보드’라는 이름으로 보일 수 있음)은 삭제한 뒤, 아래 순서대로 새 주소와 <strong>인증없음</strong> 설정으로 다시 등록하세요.</p>
        </div>
        <ol className="mt-6 space-y-6">
          {[
            { title: "플러그인 메뉴 열기", body: <>ChatGPT의 <strong>플러그인(Plugins)</strong>을 엽니다. 추가(<strong>＋</strong>) 버튼에서 <strong>Add custom MCP server</strong>(사용자 지정 MCP 서버 추가)를 선택합니다.</> },
            { title: "이름과 서버 주소 입력하기", body: <>이름은 <strong>복지정보MCP</strong>로 입력하고, <strong>Connection → Server URL</strong>에 이 페이지 위쪽의 서버 주소를 붙여 넣습니다. 주소는 <strong>https://</strong>로 시작하고 <strong>/chatgpt/mcp</strong>로 끝납니다.</> },
            { title: "인증없음으로 설정하고 플러그인 만들기", body: <>인증 방식(Authentication)은 <strong>인증없음</strong>(No authentication)으로 설정합니다. OAuth는 선택하지 마세요. 공개 자료만 조회하므로 로그인, 클라이언트 ID, 인증키 같은 값을 넣을 필요가 없습니다. 설정을 확인한 뒤 <strong>Create as a plugin</strong>(플러그인으로 만들기)을 누릅니다.</> },
            { title: "생성한 플러그인 설치하기", body: <>개인 또는 워크스페이스 목록에서 방금 만든 플러그인을 열고 <strong>설치(Install)</strong>를 선택합니다. 로그인 단계 없이 바로 설치됩니다. 플러그인을 만든 다음 설치까지 마쳐야 대화에서 사용할 수 있습니다.</> },
            { title: "새 대화에서 선택하고 질문하기", body: <>설치 후 <strong>새 대화</strong>를 시작합니다. 입력창에서 <strong>@</strong>를 입력하고 설치한 플러그인을 선택한 뒤, 아래의 ‘처음 연결했다면’ 질문을 보내세요. 자료 범위와 기준일을 조회한 응답이 나오면 연결을 확인할 수 있습니다.</> },
          ].map((step, index) => (
            <li key={step.title} className="flex gap-4">
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--jeju-primary-tint) text-(length:--jeju-text-sm) font-extrabold text-primary">{index + 1}</span>
              <div className="min-w-0 pt-0.5">
                <h3 className="font-extrabold text-(--jeju-text-strong)">{step.title}</h3>
                <p className="mt-1.5 text-(length:--jeju-text-sm) leading-relaxed text-(--jeju-text-body)">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-(length:--jeju-text-sm)">
          <ExternalLink href="https://developers.openai.com/api/docs/guides/custom-mcp-server">서버 추가 공식 안내</ExternalLink>
          <ExternalLink href="https://learn.chatgpt.com/docs/plugins">플러그인 설치·사용 안내</ExternalLink>
        </div>
      </section>

      <section id="claude" aria-labelledby="claude-title" className="scroll-mt-6 rounded-(--jeju-radius-lg) border border-border bg-card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="mb-1 text-(length:--jeju-text-sm) font-bold text-primary">Claude · Perplexity · Gemini 연결 안내</p>
            <h2 id="claude-title" className={SECTION_TITLE}>Claude · Perplexity · Gemini에서 사용하기</h2>
          </div>
          <span className="rounded-full bg-(--jeju-surface-inset) px-3 py-1 text-(length:--jeju-text-sm) text-muted-foreground">로그인 없이 연결</span>
        </div>
        <p className="mt-3 leading-relaxed text-(--jeju-text-body)">
          Claude·Perplexity·Gemini는 로그인 없이 연결하는 공용 주소 <strong>/claude/mcp</strong>를 사용합니다. Perplexity와 Gemini에서도 이 주소로 커넥터를 등록해 연결할 수 있습니다. 조회할 수 있는 자료와 도구는 ChatGPT 연결과 같습니다.
          Claude에서 커넥터를 한 번 추가하면 같은 Claude 계정의 웹, 데스크톱 앱, 모바일 앱에서 함께 쓸 수 있습니다. 무료 요금제는 커스텀 커넥터를 1개까지 추가할 수 있습니다.
        </p>
        <div className="mt-5 rounded-(--jeju-radius-lg) border border-border bg-(--jeju-surface-inset) p-4 sm:p-5">
          <code className="block select-all break-all rounded-(--jeju-radius) border border-border bg-card p-3 text-(length:--jeju-text-sm) leading-relaxed text-(--jeju-text-strong)">{CLAUDE_MCP_URL}</code>
          <div className="mt-3"><WelfareMcpCopy value={CLAUDE_MCP_URL} label="공용 MCP 주소 복사" /></div>
          <dl className="mt-4 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-(length:--jeju-text-sm)">
            <dt className="text-muted-foreground">이름</dt><dd className="font-bold">복지정보MCP</dd>
            <dt className="text-muted-foreground">인증</dt><dd><strong>No sign in</strong>(로그인 없음)</dd>
            <dt className="text-muted-foreground">연결 방식</dt><dd>원격 MCP(Streamable HTTP)</dd>
          </dl>
        </div>

        <h3 className="mt-7 text-(length:--jeju-text-lg) font-extrabold text-(--jeju-text-strong)">Perplexity · Gemini에서 연결하기</h3>
        <p className="mt-2 text-(length:--jeju-text-sm) leading-relaxed text-(--jeju-text-body)">
          사용 중인 서비스의 커넥터 또는 MCP 서버 추가 화면에서 이름은 <strong>복지정보MCP</strong>, 서버 주소는 위의 <strong>/claude/mcp</strong> 공용 주소로 등록하세요.
          인증 방식 선택란이 있으면 <strong>로그인 없음(No sign in)</strong>을 선택합니다. 별도 인증키는 필요하지 않습니다.
          등록 후 새 대화에서 복지정보MCP 커넥터를 선택하거나 켜고, 아래의 ‘처음 연결했다면’ 질문으로 자료 조회를 확인하세요. 메뉴 이름과 제공 여부는 서비스·계정에 따라 다를 수 있습니다.
        </p>

        <h3 className="mt-7 text-(length:--jeju-text-lg) font-extrabold text-(--jeju-text-strong)">Claude 개인 요금제(Free·Pro·Max)에서 추가하기</h3>
        <ol className="mt-4 space-y-6">
          {CLAUDE_STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-4">
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--jeju-primary-tint) text-(length:--jeju-text-sm) font-extrabold text-primary">{index + 1}</span>
              <div className="min-w-0 pt-0.5">
                <h4 className="font-extrabold text-(--jeju-text-strong)">{step.title}</h4>
                <p className="mt-1.5 text-(length:--jeju-text-sm) leading-relaxed text-(--jeju-text-body)">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-7 grid gap-3 lg:grid-cols-2">
          <div className="rounded-(--jeju-radius-lg) border border-border p-4 sm:p-5">
            <h3 className="font-extrabold text-(--jeju-text-strong)">Team·Enterprise 요금제라면</h3>
            <p className="mt-2 text-(length:--jeju-text-sm) leading-relaxed text-(--jeju-text-body)">
              조직 관리자(Owner·Primary Owner)가 먼저 <strong>Organization settings → Connectors → Add → Custom → Web</strong>에서 같은 이름과 주소로 커넥터를 추가하고, Authentication은 <strong>No sign in</strong>으로 둡니다.
              구성원은 <strong>Customize → Connectors</strong> 목록에서 복지정보MCP를 찾아 <strong>Connect</strong>를 누르면 됩니다. 별도 요청 헤더나 인증키는 필요하지 않습니다.
            </p>
          </div>
          <div className="rounded-(--jeju-radius-lg) bg-(--jeju-primary-tint) p-4 text-(length:--jeju-text-sm) leading-relaxed sm:p-5">
            <h3 className="flex items-center gap-2 font-extrabold text-primary"><InfoIcon />제공 자료와 이용 한도</h3>
            <p className="mt-2">법령·판례·조문 조회는 현재 MCP에서 제공하지 않습니다. 복지사업·매뉴얼·FAQ·예산·통계·보도자료는 그대로 조회할 수 있습니다.</p>
            <p className="mt-2">Claude·Perplexity·Gemini 공용 주소 연결에는 인증키가 필요하지 않습니다. 기존 apikey 헤더나 ?oc=가 있다면 제거해도 됩니다. 한도는 출구 IP당 분당 120회, Claude 경로 전체 분당 300회이며 도구 호출만 셉니다. 여러 이용자가 같은 출구 IP를 쓰면 한도를 함께 사용합니다.</p>
          </div>
        </div>

        <h3 className="mt-7 font-extrabold text-(--jeju-text-strong)">Claude Code에서 연결하기</h3>
        <p className="mt-1.5 text-(length:--jeju-text-sm) leading-relaxed text-(--jeju-text-body)">터미널에서 아래 명령을 실행합니다. 별도 인증키는 필요하지 않습니다.</p>
        <code className="my-3 block select-all break-all rounded-(--jeju-radius) border border-border bg-(--jeju-surface-inset) p-3 text-(length:--jeju-text-sm) leading-relaxed text-(--jeju-text-strong)">{CLAUDE_CODE_COMMAND}</code>
        <WelfareMcpCopy value={CLAUDE_CODE_COMMAND} label="Claude Code 명령 복사" />

        <h3 className="mt-7 font-extrabold text-(--jeju-text-strong)">Claude에서 연결이 안 될 때</h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-(length:--jeju-text-sm) leading-relaxed text-(--jeju-text-body)">
          {CLAUDE_TROUBLESHOOTING.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-(length:--jeju-text-sm)">
          <ExternalLink href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp">Claude 커스텀 커넥터 공식 안내</ExternalLink>
          <span className="text-muted-foreground">Claude 안내 확인일: 2026년 10월 11일</span>
        </div>
      </section>

      <section id="examples" aria-labelledby="examples-title" className="scroll-mt-6">
        <h2 id="examples-title" className={SECTION_TITLE}>복사해서 바로 질문해 보세요</h2>
        <p className="mt-3 text-(--jeju-text-body)">플러그인을 선택한 대화에 붙여 넣으세요. 지역·연도·사업명을 바꾸고, 출처와 기준일을 함께 요청하면 비교하기 쉽습니다.</p>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {EXAMPLES.map((example) => (
            <article key={example.label} className="flex flex-col rounded-(--jeju-radius-lg) border border-border bg-card p-5">
              <h3 className="text-(length:--jeju-text-sm) font-bold text-primary">{example.label}</h3>
              <p className="mb-4 mt-3 flex-1 select-text leading-relaxed text-(--jeju-text-strong)">{example.text}</p>
              <WelfareMcpCopy value={example.text} label={`${example.label} 질문 복사`} />
            </article>
          ))}
        </div>
        <p className="mt-3 text-(length:--jeju-text-sm) text-muted-foreground">질문 예시는 사용법을 보여 줍니다. 해당 지역·연도의 자료가 수록되어 있어야 결과를 제공할 수 있습니다.</p>
      </section>

      <section id="help" aria-labelledby="help-title" className="scroll-mt-6">
        <h2 id="help-title" className={SECTION_TITLE}>연결과 이용이 궁금할 때</h2>
        <div className="mt-5 divide-y divide-border overflow-hidden rounded-(--jeju-radius-lg) border border-border bg-card">
          {[
            { title: "플러그인이나 서버 추가 메뉴가 보이지 않아요.", body: <>로그인한 계정과 워크스페이스를 확인하고, 설치 권한이 있는지 관리자에게 문의하세요. 공유받은 플러그인이 개인·공유 목록에 있는지도 확인해 주세요. 설치 직후 기존 대화에 보이지 않으면 새 대화를 열고 @로 다시 선택합니다.</> },
            { title: "별도 프로그램이나 인증키를 준비해야 하나요?", body: <>필요하지 않습니다. 원격 서버를 연결하므로 로컬 서버 프로그램도 필요 없습니다. ChatGPT는 /chatgpt/mcp 주소를 <strong>인증없음</strong>(No authentication)으로, Claude·Perplexity·Gemini는 /claude/mcp 공용 주소를 로그인 없음(No sign in)으로 연결하면 됩니다. 법령정보 기능은 현재 MCP에서 제공하지 않습니다.</> },
            { title: "인증 오류가 뜨거나 도구가 보이지 않아요.", body: <>플러그인 설정에서 서버 주소와 인증 방식이 <strong>인증없음</strong>으로 되어 있는지 확인하세요. 주소가 /chatgpt/mcp로 끝나는지도 확인하세요. 예전 /mcp 주소나 OAuth로 만든 플러그인은 삭제한 뒤 인증없음으로 다시 만들어야 합니다. 도구 목록이 갱신되지 않으면 Refresh(새로고침) 후 새 대화에서 다시 선택하고, 시간 초과나 429가 나오면 잠시 뒤 다시 시도해 주세요. 브라우저에서 MCP 주소를 여는 것만으로는 연결 여부를 확인할 수 없습니다.</> },
            { title: "답변을 업무에 활용할 때 무엇을 확인하나요?", body: <>사업의 적용연도·지역·지원조건과 원문을 함께 확인하세요. 예산서의 본예산·추경과 재정자료의 기준일 예산현액은 서로 구분해야 합니다. 법령은 시행일과 해당 조문을 확인하고, 자료가 없으면 다른 연도나 지역의 내용을 대신 적용하지 마세요. 질문에는 주민등록번호 등 개인 식별정보를 넣지 마세요.</> },
            { title: "다른 AI 앱에서도 연결할 수 있나요?", body: <>Claude뿐 아니라 Perplexity와 Gemini에서도 위의 공용 주소(/claude/mcp)로 연결할 수 있습니다. 그 밖의 앱도 원격 MCP(Streamable HTTP)를 지원하면 같은 주소를 로그인 없이 등록할 수 있습니다. 실제 설정 과정은 앱의 공식 안내와 계정 권한에 따라 달라집니다.</> },
          ].map((item) => (
            <details key={item.title} className="group">
              <summary className="flex min-h-(--jeju-control-h) cursor-pointer list-none items-center justify-between gap-4 p-5 font-bold text-(--jeju-text-strong) outline-none hover:bg-(--jeju-surface-inset) focus-visible:shadow-(--jeju-focus-ring) [&::-webkit-details-marker]:hidden">
                {item.title}<ChevronDownIcon className="transition-transform group-open:rotate-180" />
              </summary>
              <p className="px-5 pb-5 text-(length:--jeju-text-sm) leading-relaxed text-(--jeju-text-body)">{item.body}</p>
            </details>
          ))}
        </div>
        <p className="mt-4 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">
          설치 안내 확인일: 2026년 10월 14일 · 메뉴 이름과 제공 범위는 서비스 업데이트에 따라 달라질 수 있습니다.
          <span className="ml-1"><ExternalLink href="https://developers.openai.com/plugins/deploy/connect-chatgpt">연결·도구 새로고침 공식 안내</ExternalLink></span>
        </p>
      </section>

      <aside className="flex flex-wrap items-center justify-between gap-4 rounded-(--jeju-radius-lg) border border-(--jeju-shell-border) bg-(--jeju-surface-inset) p-5">
        <div>
          <h2 className="font-extrabold text-(--jeju-text-strong)">답변의 근거도 함께 살펴보세요</h2>
          <p className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">자료별 출처·현행화 방식과 수록 범위는 데이터 출처에서 안내합니다.</p>
        </div>
        <a href="/sources" className={`${LINK_CLASS} inline-flex items-center gap-2`}>데이터 출처 보기<ArrowRightIcon /></a>
      </aside>
    </main>
  );
}
