import type { Metadata } from "next";

import { PageUsage } from "@/components/usage/page-usage";
import { UsageOptOut } from "@/components/usage/usage-opt-out";
import { USAGE_POLICY_VERSION } from "@/lib/usage/codes";

export const metadata: Metadata = {
  title: "이용통계 수집 안내 | 전국 통합돌봄 사업 총괄 대시보드",
  description: "이 사이트가 개인을 알아볼 수 없는 코드값으로만 모으는 이용통계의 목적, 항목, 보관기간, 제외 방법입니다.",
};

const COLLECTED = [
  "화면·탭 구분 코드(대시보드, 통합돌봄 WIKI, 복지제도100, 복지정보 관계성 지도, 복지뉴스, 복지예산, 복지통계, 복지정보MCP, 데이터 출처)와 처음 연 탭인지 직접 고른 탭인지",
  "열어 본 통합돌봄사업·복지제도의 등록 ID와 연 경로(검색 결과, 목록·지도, 비교 화면, 주소 직접 진입)",
  "검색 1회의 성공·실패, 결과 건수 구간(0건, 1건, 2~10건 …), 검색어가 등록된 사업명과 정확히 일치했는지와 그 사업 ID. 복지정보 관계성 지도 검색, 복지뉴스 제목 검색, 복지예산 세부사업명 검색은 성공·실패와 결과 건수 구간만 셉니다.",
  "직접 고른 조회 대상 지역·분류 코드(예: 부산광역시, 보건의료, 복지뉴스 분야·기관 유형, 복지예산 분야, 관계성 지도 가지). 이용자의 위치가 아니라 화면에서 고른 조건입니다.",
  "지자체 비교, CSV 생성, 주소 복사의 실행·성공·실패·취소와 걸린 시간",
  "WIKI의 복지제도100 바로가기, 관계성 지도 항목 선택, 복지뉴스 원문 보기, 복지예산 조회, 출처 링크의 클릭 횟수(연 외부 주소는 받지 않고 출처 링크만 기관 구분 코드를 받습니다)",
  "화면이 보이고 최근 60초 안에 조작이 있었던 시간(측정 활동시간)",
  "화면 폭 구분(좁은·중간·넓은 화면), 기능 응답시간, 등록된 오류 코드, 화면 표시 속도(LCP·CLS)",
  "중복 전송을 막는 임시 ID(한 번의 열람·검색·작업에만 쓰고 23시간 뒤 만료됩니다)",
];

const NOT_COLLECTED = [
  "검색어·검색 문장 원문과 그 해시값",
  "GPS·좌표, 접속 IP로 추정한 지역 등 이용자의 위치",
  "방문자를 계속 구분하는 ID, 광고 ID, 기기 지문, 원본 브라우저 정보(User-Agent), 정확한 화면 해상도",
  "전체 주소(URL)·질의 문자열·이전 페이지 주소",
  "입력값, 화면 내용, 오류 메시지 원문, 화면 녹화",
  "이름·이메일·연락처·관리자 계정과의 결합",
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-(length:--jeju-h2-size) font-extrabold text-(--jeju-text-strong)">{title}</h2>
      <div className="mt-2 space-y-2 text-(length:--jeju-text-base) leading-relaxed text-(--jeju-text-body)">{children}</div>
    </section>
  );
}

export default function UsagePolicyPage() {
  return (
    <main className="mx-auto max-w-[900px] space-y-4 px-4 py-6 sm:px-6">
      <PageUsage page="usage_policy" tab="usage_policy" />
      <div>
        <h1 className="text-(length:--jeju-h1-size) leading-(--jeju-leading-tight) font-extrabold text-(--jeju-text-strong)">
          이용통계 수집 안내
        </h1>
        <p className="mt-2 text-(length:--jeju-text-base) text-muted-foreground">
          이용통계는 개인을 알아볼 수 없는 코드값만 날짜별 합계로 모으기 때문에 따로 동의 창을 띄우지 않습니다. 원하지
          않으면 아래에서 이 브라우저의 이용을 통계에서 뺄 수 있고, 빼도 사이트의 모든 기능을 그대로 쓸 수 있습니다.
        </p>
        <div className="mt-3">
          <UsageOptOut />
        </div>
      </div>

      <Section title="모으는 목적">
        <p>
          어떤 통합돌봄사업과 복지제도가 많이 조회·검색되는지, 어떤 기능이 쓰이고 어디서 오류가 나는지 합계로 파악해
          사이트를 개선하는 데만 씁니다. 조회 수는 사업의 효과나 수급자 수를 뜻하지 않습니다.
        </p>
      </Section>

      <Section title="모으는 것">
        <ul className="list-disc space-y-1 pl-5">
          {COLLECTED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      <Section title="모으지 않는 것">
        <ul className="list-disc space-y-1 pl-5">
          {NOT_COLLECTED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>
          대시보드가 내 지역 자료를 먼저 보여 주려고 쓰는 위치 확인(모바일 GPS 동의 또는 접속 IP)은 이용통계와 별개이며,
          그 결과를 이용통계에 남기지 않습니다.
        </p>
      </Section>

      <Section title="처리 방법">
        <p>
          기록은 이 사이트의 서버로만 보내며 외부 분석·광고 도구로 보내지 않습니다. 서버는 받은 즉시 정해진 코드인지 확인하고
          한국시간 날짜별 합계에 더합니다. 요청 원문은 저장하지 않습니다.
        </p>
        <p>
          통신 과정에서 서버는 접속 IP 같은 정보를 받게 되지만, 이 값을 이용통계에 저장하거나 지역을 추정하는 데 쓰지 않습니다.
          과도한 요청을 막기 위해 1분 동안 서버 메모리에서만 접속 횟수를 세고 저장하지 않습니다.
        </p>
        <p>
          이용통계용 쿠키나 방문자 ID는 만들지 않습니다. 브라우저 저장소에는 수집 설정 확인 결과(10분), 목록에서 상세로 옮겨 갈
          때의 경로 표시(1분 이내), 통계에서 빼기 선택(고른 경우만)만 둡니다.
        </p>
      </Section>

      <Section title="보관기간">
        <ul className="list-disc space-y-1 pl-5">
          <li>중복 전송을 막는 임시 ID와 처리 상태: 받은 뒤 23시간이 지나면 만료되어 재사용하지 않습니다. 이후 요청에 따른 정리 작업에서 삭제합니다. 요청이 없는 동안 실제 삭제는 늦어질 수 있습니다.</li>
          <li>날짜별 합계: 전년 같은 기간과 비교하기 위해 24개월 동안 보관한 뒤 지웁니다.</li>
        </ul>
      </Section>

      <Section title="통계에서 빼는 방법">
        <p>
          이 화면 위쪽의 「이 브라우저 이용을 통계에서 빼기」를 누르면 그 즉시 수집을 멈추고 아직 보내지 않은 기록과 임시
          연결값을 지웁니다. 이 선택은 이 브라우저에만 저장되며, 언제든 다시 포함할 수 있습니다. 브라우저 저장소를 지우면
          선택도 지워집니다.
        </p>
        <p>
          브라우저가 추적 거부 신호(Global Privacy Control 또는 Do Not Track)를 보내면 따로 고르지 않아도 모으지 않습니다.
          자동화 도구로 연 화면과 관리자로 로그인한 브라우저의 이용도 모으지 않습니다.
        </p>
        <p>
          이미 합계에 더해진 값에는 이용자를 구분하는 값이 없어 특정 이용자의 기록만 따로 찾을 수 없습니다. 임시 처리값은 23시간 뒤
          만료되며 이후 정리 작업에서 삭제됩니다. 문의나 요청은 화면 아래 오류 제보 주소로 보내 주세요.
        </p>
      </Section>

      <p className="text-(length:--jeju-text-sm) text-muted-foreground">안내 판: {USAGE_POLICY_VERSION}</p>
    </main>
  );
}
