import type { Metadata } from "next";
import type { ReactNode } from "react";

import { UsageOptOut } from "@/components/usage/usage-opt-out";

export const metadata: Metadata = {
  title: "개인정보처리방침 | 전국 통합돌봄 사업 총괄 대시보드",
  description: "대시보드가 처리하는 정보, 목적과 보관기간, 쿠키·브라우저 저장소, 이용자의 권리와 문의 방법을 안내합니다.",
  alternates: { canonical: "/privacy" },
};

const SECTIONS = [
  ["scope", "운영 주체와 적용 범위"],
  ["processing", "처리하는 정보와 보관기간"],
  ["browser", "쿠키·브라우저 저장소와 거부 방법"],
  ["providers", "제3자 제공·처리위탁·국외 처리"],
  ["protection", "파기와 보호 조치"],
  ["rights", "이용자와 법정대리인의 권리"],
  ["contact", "문의와 권리 구제"],
  ["changes", "방침의 변경"],
] as const;

const PROCESSING = [
  {
    name: "검색·자료 조회",
    information: "입력한 검색어, 선택한 지역·분야, 조회할 사업·제도 ID를 요청 처리에 사용합니다. 일반 검색어 원문을 이용통계에 저장하지 않습니다.",
    period: "요청 처리 동안 사용합니다. 선택한 검색 조건과 마지막으로 본 주소·스크롤 위치는 이전 화면 복원을 위해 해당 브라우저 탭에 남을 수 있습니다.",
  },
  {
    name: "이용통계",
    information: "화면·사업·제도·조회 조건의 코드, 클릭·검색 결과 건수 구간, 응답시간과 오류 코드를 합계로 집계합니다. 이름·이메일·검색어 원문·IP·GPS 좌표를 이용통계에 저장하지 않습니다.",
    period: "중복 전송 방지용 임시 ID는 23시간 뒤 만료됩니다. 일별 합계는 731일을 기준으로 정리합니다. 삭제는 이후 수집 요청이나 정리 작업에서 실행되므로 요청이 없는 동안 실제 삭제가 늦어질 수 있습니다.",
  },
  {
    name: "지역 자료 먼저 보기",
    information: "자동 지역 선택에는 호스팅 서비스가 접속 IP에서 추정해 제공하는 시·도 정보를 사용합니다. ‘현재 위치로 보기’에서 위치 권한을 허용하면 GPS 좌표로 시·도를 판단합니다. GPS 좌표는 기기 안에서만 사용하고 사이트 서버로 보내지 않습니다.",
    period: "자동 추정 지역은 현재 화면에서 사용합니다. GPS로 판단한 시·도 이름은 해당 탭에 최대 30분간 유효한 값으로 보관합니다. 만료된 값은 사용하지 않으며 탭의 저장소를 지우면 삭제됩니다.",
  },
  {
    name: "과도한 요청 방지와 오류 확인",
    information: "인터넷 접속 주소(IP)를 시간 구간별 일방향 변환값(해시)으로 바꾼 요청 횟수·만료시각을 처리합니다. 일부 자료 조회 기능에서는 이 값을 데이터베이스에 보관합니다. 앱 오류 기록에는 시각·요청 ID·경로·상태·오류 종류를 남기며 질문·검색어 원문이나 인증정보를 넣지 않도록 제한합니다.",
    period: "일반 API의 요청 제한값은 1분 단위로 만료됩니다. 만료 후 5분이 지난 값은 정리 작업의 삭제 대상이 됩니다. 관리자 로그인 실패 제한값은 15분 동안 사용합니다. 정리 작업이 실행되지 않으면 만료된 값의 실제 삭제가 늦어질 수 있습니다.",
  },
  {
    name: "AI 서비스의 자료 조회 연결 기능(MCP)",
    information: "연결 서비스가 보낸 질문·조회 조건으로 공개 자료를 검색합니다. 호출 기록에는 질문 원문 대신 질문 비교용 해시값, 제한된 지역·기간 조건, 참조 자료 ID와 처리 결과를 기록합니다. 해시값을 쓴다는 이유만으로 모든 정보가 익명이라고 보지는 않습니다.",
    period: "호출 추적 기록은 14일, 시간대별 호출 합계는 90일을 기준으로 정리합니다. 재사용하는 검색 결과는 암호화해 10분간 유효한 값으로 저장합니다. 감지된 개인정보가 있는 질문은 검색 결과 캐시를 건너뛰지만, 개인정보 감지가 모든 입력을 찾아내는 것은 아닙니다.",
  },
  {
    name: "이메일 문의·오류 제보",
    information: "직접 보낸 이메일 주소, 이름을 적은 경우 그 이름, 문의 내용과 첨부파일을 문의 확인·답변에 사용합니다. 주민등록번호, 대상자의 건강정보·복지 상담기록 등 불필요한 개인정보는 보내지 마세요.",
    period: "문의 확인·답변이 끝나고 더 이상 보관할 필요가 없으면 운영자가 이메일과 첨부파일을 지체 없이 삭제합니다. 법령에 따른 보존 의무나 분쟁 대응 등 별도 보관 사유가 있으면 필요한 항목·사유·기간을 요청자에게 안내하고 그 범위에 한정해 보관합니다. 이메일은 사이트의 데이터베이스 정리 작업으로 자동 삭제되지 않습니다.",
  },
] as const;

function Section({ id, title, children }: { readonly id: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-6 rounded-xl border border-border bg-card p-5 sm:p-6">
      <h2 id={`${id}-heading`} className="text-(length:--jeju-h2-size) font-extrabold text-(--jeju-text-strong)">{title}</h2>
      <div className="mt-3 space-y-3 text-(length:--jeju-text-base) leading-relaxed text-(--jeju-text-body)">{children}</div>
    </section>
  );
}

const LINK_CLASS = "rounded text-primary underline underline-offset-2 outline-none hover:text-(--jeju-primary-hover) focus-visible:shadow-(--jeju-focus-ring)";

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-(--jeju-main-max) space-y-4 px-4 py-6 sm:px-6">
      <header className="space-y-3">
        <h1 className="text-(length:--jeju-h1-size) leading-(--jeju-leading-tight) font-extrabold text-(--jeju-text-strong)">개인정보처리방침</h1>
        <p className="text-(length:--jeju-text-base) leading-relaxed text-(--jeju-text-body)">전국 통합돌봄 사업 총괄 대시보드에서 처리하는 정보와 이용자가 선택할 수 있는 방법을 안내합니다. 일반 자료 조회에는 회원가입이 필요하지 않습니다.</p>
        <p className="text-(length:--jeju-text-sm) text-muted-foreground">시행일: 2026년 10월 24일</p>
        <div className="rounded-xl border border-border bg-(--jeju-surface-inset) p-4 text-(length:--jeju-text-sm) leading-relaxed text-(--jeju-text-body)">
          <p className="font-bold text-(--jeju-text-strong)">운영 주체: 개인 운영</p>
          <p className="mt-1">개인정보 문의 담당자: 사이트 운영자</p>
          <p className="mt-1">문의 주소: <a href="mailto:xgfox54@gmail.com" className={LINK_CLASS}>xgfox54@gmail.com</a></p>
          <p className="mt-2">이 사이트는 서귀포시 소속 직원의 개인 개발·업무 활용 사례입니다. 서귀포시 공식 사이트가 아닙니다.</p>
        </div>
      </header>

      <nav aria-label="개인정보처리방침 목차" className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-extrabold text-(--jeju-text-strong)">목차</h2>
        <ol className="mt-3 grid gap-2 text-(length:--jeju-text-sm) sm:grid-cols-2">
          {SECTIONS.map(([id, title], index) => <li key={id}><a href={`#${id}`} className={LINK_CLASS}>{index + 1}. {title}</a></li>)}
        </ol>
      </nav>

      <Section id="scope" title="1. 운영 주체와 적용 범위">
        <p>이 방침은 이 대시보드 웹사이트와 사이트가 제공하는 공개 자료 조회·AI 연결 기능에 적용합니다. 보도자료·법령·공식 자료의 원문 링크로 이동하면 해당 기관의 개인정보처리방침이 적용됩니다.</p>
        <p>운영 주체는 ‘개인 운영’이며 개인정보 문의 담당자는 ‘사이트 운영자’입니다. 개인정보 관련 문의와 권리 요청은 아래 문의 주소로 보내 주세요.</p>
        <p>이 사이트는 공개된 복지 정보를 찾는 참고용 서비스입니다. 실제 대상자의 이름·주민등록번호·연락처·상세 건강정보를 검색창이나 AI 연결 질문에 입력하지 마세요.</p>
        <p>사업·제도·보도자료 등 공개 자료의 출처와 기준일은 각 자료에서 확인하도록 제공합니다. 공개 자료에 표시된 개인정보의 정정·삭제 요청도 문의 주소로 보내 주세요. 원기관 자료의 변경이 필요한 경우 해당 기관과의 확인 절차를 안내합니다.</p>
      </Section>

      <Section id="processing" title="2. 처리하는 정보와 보관기간">
        <p>자료 조회 요청에 응답하고, 선택한 지역의 자료를 보여 주며, 이용통계로 서비스를 개선하고, 부정 이용 방지·관리자 인증·문의 답변을 위해 아래 정보를 처리합니다. 별도 동의가 필요한 정보를 처리할 때는 해당 기능에서 목적·항목·기간을 안내하고 필요한 절차를 진행합니다.</p>
        <dl className="space-y-4">
          {PROCESSING.map((item) => <div key={item.name} className="border-t border-border pt-4">
            <dt className="font-bold text-(--jeju-text-strong)">{item.name}</dt>
            <dd className="mt-1">{item.information}</dd>
            <dd className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground"><span className="font-bold">보관·삭제: </span>{item.period}</dd>
          </div>)}
        </dl>
        <p>보관기간에 관한 설명은 사이트 코드의 만료·정리 기준입니다. 호스팅 사업자의 접속·보안 기록과 이메일 보관은 아래 외부 서비스 항목을 함께 확인해야 합니다.</p>
        <a href="/usage-policy" className={LINK_CLASS}>이용통계 수집 항목과 제외 방법 자세히 보기</a>
      </Section>

      <Section id="browser" title="3. 쿠키·브라우저 저장소와 거부 방법">
        <p>쿠키와 브라우저 저장소는 로그인 상태나 선택한 설정을 기기에 기억하는 데 사용하는 기능입니다. 아래 설명은 사이트가 직접 구현한 기능을 기준으로 하며, 호스팅 사업자의 별도 처리는 다음 항목에서 안내합니다.</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>사이트가 구현한 이용통계에는 광고·방문자 추적용 쿠키를 사용하지 않습니다. 관리자 로그인에는 보안 세션 쿠키를 사용하며 기본 유효기간은 8시간입니다.</li>
          <li>브라우저 저장소에는 통계 제외 선택, 수집 설정 확인 결과, 이전 메뉴의 주소·스크롤 위치, 위치 선택 결과와 일부 화면 설정을 보관합니다. 통계 제외 선택은 직접 바꾸거나 브라우저 저장소를 지울 때까지 유지됩니다.</li>
          <li>페이지의 검색 조건은 주소와 브라우저 방문기록에 남을 수 있습니다. 공용 기기에서는 이용 후 방문기록과 사이트 데이터를 확인해 지울 수 있습니다.</li>
          <li>스크립트·스타일·공개 자료의 일부는 다시 불러오는 시간을 줄이기 위해 기기에 캐시합니다. 브라우저의 사이트 데이터 삭제 기능으로 지울 수 있습니다.</li>
          <li>위치 권한은 브라우저의 사이트 설정에서 허용·차단할 수 있습니다. 위치를 허용하지 않아도 지역을 직접 골라 조회할 수 있습니다. 쿠키를 막으면 관리자 로그인은 제한될 수 있습니다.</li>
        </ul>
        <p>아래에서 이 브라우저의 이용통계 수집을 제외할 수 있습니다. Global Privacy Control 또는 Do Not Track 신호를 보내는 브라우저도 제외합니다. 이 선택은 접속 보안 처리나 직접 보낸 이메일까지 중단하는 기능은 아닙니다.</p>
        <UsageOptOut />
      </Section>

      <Section id="providers" title="4. 제3자 제공·처리위탁·국외 처리">
        <p>이 사이트의 이용정보를 판매하거나 광고 목적으로 외부에 제공하지 않습니다. 별도 동의나 법령상 근거가 필요한 제3자 제공이 발생하면 제공받는 자·목적·항목·기간과 필요한 절차를 안내합니다.</p>
        <p>호스팅·네트워크·저장소와 이메일 서비스는 다음 외부 사업자를 사용합니다. 외부 서비스에 맡기는 처리와 외부 사업자가 자신의 방침에 따라 처리하는 범위는 구분해 확인해야 합니다.</p>
        <dl className="space-y-3">
          <div><dt className="font-bold">OpenAI · Sites</dt><dd>웹사이트 배포·접속 전달과 서비스 운영에 사용합니다. 접속 IP, 요청 주소·시각과 통신에 필요한 정보가 접속 과정에서 처리될 수 있습니다.</dd></div>
          <div><dt className="font-bold">Cloudflare · Workers·D1</dt><dd>사이트 요청 처리·보안·데이터 저장에 사용합니다. 위에서 설명한 서비스 요청과 사이트 데이터가 처리됩니다.</dd></div>
          <div><dt className="font-bold">Google · Gmail</dt><dd>문의 이메일 수신·답변에 사용합니다. 이용자가 이메일을 보내면 발신 주소, 메일 내용·첨부파일 등이 이메일 서비스를 통해 처리됩니다.</dd></div>
        </dl>
        <p>사업자별 일반 정책은 다음 링크에서 확인할 수 있습니다. 이 링크만으로 사이트 운영자의 고지 의무를 대신하지 않습니다.</p>
        <ul className="list-disc space-y-2 pl-5">
          <li><a href="https://openai.com/policies/privacy-policy/" className={LINK_CLASS}>OpenAI 개인정보처리방침</a></li>
          <li><a href="https://www.cloudflare.com/privacypolicy/" className={LINK_CLASS}>Cloudflare 개인정보처리방침</a></li>
          <li><a href="https://policies.google.com/privacy?hl=ko" className={LINK_CLASS}>Google 개인정보처리방침</a></li>
        </ul>
        <p>ChatGPT 등 별도 AI 서비스에서 이 사이트의 연결 기능을 이용하면 질문은 해당 AI 서비스에도 전달됩니다. 해당 서비스가 질문을 저장·이용하는 방식은 그 서비스의 계정 설정과 방침을 확인하세요.</p>
      </Section>

      <Section id="protection" title="5. 파기와 보호 조치">
        <p>기간이 만료된 데이터베이스 기록은 정리 작업에서 삭제합니다. 요청 처리나 다음 로그인에 따라 정리하는 항목은 위 보관기간 설명을 따릅니다. 브라우저 저장소는 해당 브라우저의 사이트 데이터 삭제 기능으로 지울 수 있습니다. 문의 이메일은 처리 목적이 끝나면 운영자가 메일함·첨부파일을 확인해 삭제합니다.</p>
        <p>사이트는 HTTPS 통신, 관리자 인증과 접근 제한, 비밀번호·세션 토큰의 해시 처리, 인증키와 검색 결과 캐시의 암호화, 입력 검증과 요청 횟수 제한을 사용합니다. 오류 기록에는 개인정보와 인증정보가 들어가지 않도록 항목을 제한하고 가림 처리를 적용합니다.</p>
        <p>법령에 따라 별도로 보관해야 할 정보가 발생하면 그 항목·근거·기간을 구분해 안내합니다. 전자 기록은 삭제 등 재사용을 막는 방법으로 파기하고, 종이 자료를 출력한 경우에는 분쇄 등으로 식별할 수 없게 파기합니다.</p>
      </Section>

      <Section id="rights" title="6. 이용자와 법정대리인의 권리">
        <p>자신의 개인정보에 대한 열람, 정정·삭제, 처리정지, 동의 철회를 문의 주소로 요청할 수 있습니다. 법정대리인이나 위임받은 대리인도 요청할 수 있으며, 요청자와 대상 정보의 관계를 확인하는 데 필요한 최소한의 자료를 안내합니다.</p>
        <p>법령에 따른 제한 사유가 있으면 해당 사유를 설명합니다. 개인을 구별하는 값이 남지 않은 통계 합계에서는 특정 이용자의 기록만 따로 찾아 삭제하지 못할 수 있습니다.</p>
        <p>만 14세 미만 아동을 위한 회원가입이나 상담 접수 기능은 운영하지 않습니다. 아동의 개인정보를 별도로 수집하는 기능을 도입하면 법정대리인 동의와 권리 행사 방법을 먼저 안내합니다.</p>
      </Section>

      <Section id="contact" title="7. 문의와 권리 구제">
        <p>개인정보 문의 및 고충 처리 담당자: 사이트 운영자</p>
        <p>문의 주소: <a href="mailto:xgfox54@gmail.com?subject=%5B%ED%86%B5%ED%95%A9%EB%8F%8C%EB%B4%84%20%EB%8C%80%EC%8B%9C%EB%B3%B4%EB%93%9C%5D%20%EA%B0%9C%EC%9D%B8%EC%A0%95%EB%B3%B4%20%EB%AC%B8%EC%9D%98" className={LINK_CLASS}>xgfox54@gmail.com</a></p>
        <p>메일 제목에 ‘개인정보 문의’를 적고 관련 화면 주소, 요청 내용, 답변받을 연락처만 보내 주세요. 추가 확인이 필요한 경우 안내하겠습니다.</p>
        <p>외부 신고·상담 절차는 <a href="https://www.privacy.go.kr/" className={LINK_CLASS}>개인정보 포털</a>에서 확인할 수 있습니다.</p>
      </Section>

      <Section id="changes" title="8. 방침의 변경">
        <p>이 방침은 2026년 10월 24일부터 적용합니다. 처리 항목·목적·보관기간·수탁자 등이 바뀌면 이 페이지에 변경 내용과 시행일을 안내합니다. 추가 동의가 필요한 변경은 별도 동의 절차를 마련합니다. 이전 방침이 생기면 변경 이력과 함께 확인할 수 있도록 제공합니다.</p>
      </Section>
    </main>
  );
}
