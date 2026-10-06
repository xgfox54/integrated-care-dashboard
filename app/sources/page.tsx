import { PageUsage } from "@/components/usage/page-usage";
import { readOfficialSyncStatus } from "@/lib/official-sync-status";
import { MOHW_INTEGRATED_CARE_URL } from "@/lib/official-source";
import { getD1 } from "@/lib/d1";
import { integrationStatus, type DatasetStatus } from "@/lib/integrations/public";
import { CARE_DATASET_KEYS, CARE_RESOURCES_PUBLIC } from "@/lib/integrations/care-hold";

export const dynamic = "force-dynamic";

const PUBLIC_DATA_PORTAL = "https://www.data.go.kr";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-(length:--jeju-h2-size) font-extrabold text-(--jeju-text-strong)">{title}</h2>
      <div className="mt-2 space-y-2 text-(length:--jeju-text-base) leading-relaxed text-(--jeju-text-body)">{children}</div>
    </section>
  );
}

const LINK_CLASS = "font-bold text-primary underline underline-offset-4 hover:text-(--jeju-primary-hover)";

function formatMoment(value: string): string {
  if (!value) return "아직 성공한 수집 없음";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Seoul" }).format(
    new Date(value),
  );
}

export default async function SourcesPage() {
  let status = null;
  try {
    status = await readOfficialSyncStatus();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    status = null;
  }
  const success = status?.latestSuccess ?? null;
  let integrations: DatasetStatus[] = [];
  try {
    integrations = await integrationStatus(getD1());
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    integrations = [];
  }

  return (
    <main className="mx-auto max-w-[900px] space-y-4 px-4 py-6 sm:px-6">
      <PageUsage page="sources" tab="sources" />
      <div>
        <h1 className="text-(length:--jeju-h1-size) leading-(--jeju-leading-tight) font-extrabold text-(--jeju-text-strong)">데이터 출처 및 현행화 방식</h1>
        <p className="mt-2 text-(length:--jeju-text-base) text-muted-foreground">
          공식 홈페이지·공공 API·검토된 문서에서 수집합니다. 자료의 기준일과 수집일은 서로 다르며, 각 화면에 표시된 원문과 기준일을 함께 확인해 주세요.
        </p>
      </div>

      <Section title="공식 원문: 보건복지부">
        <p>
          보건복지부 의료·요양 등 지역돌봄 통합지원 게시판에서 통합 전 광주·전남
          개별 메뉴를 포함한 17개 서비스 메뉴판 목록을 확인합니다. 각 PDF의 보건복지부
          공식 미리보기 XML에서 표 본문을 읽어 사업명, 사업내용, 지원대상, 제공기관과
          사업구분을 구조화합니다. 지도는 현행 16개 광역단위에 맞춰 합산합니다.
        </p>
        <p>
          <a href={MOHW_INTEGRATED_CARE_URL} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            보건복지부 의료·요양 등 지역돌봄 통합지원
            <span className="sr-only">(새 창)</span>
          </a>
        </p>
      </Section>

      <Section title="통합돌봄 WIKI와 복지제도100">
        <p>
          통합돌봄 WIKI는 보건복지부 메뉴판의 지역별 사업을 설명합니다. 사업명이 정확히 일치하는 복지로 설명과 복지톡 사업안내를 보완 자료로 연결하고,
          확인된 보도자료는 발행기관·발행일·원문 링크와 함께 표시합니다. 신청조건을 원문에서 확인할 수 없으면 조건을 만들어 넣지 않습니다.
        </p>
        <p>
          복지제도100은 주요 제도와 중앙·지자체 복지서비스의 설명 및 업무 흐름을 보여 줍니다. 각 제도의 적용연도와 공식 근거를 확인해야 하며,
          과거 자료의 수집일이 최근이라는 이유로 그 내용을 2026년 기준으로 표시하지 않습니다.
          {" "}<a href="https://www.bokjiro.go.kr" target="_blank" rel="noreferrer" className={LINK_CLASS}>복지로 원문 확인</a>
        </p>
      </Section>

      <Section title="복지뉴스">
        <p>
          중앙부처·지자체·행정시군구와 정책브리핑의 공개 보도자료에서 제목, 발행기관, 게시일과 원문 주소를 수집합니다.
          기사 본문은 저장하지 않습니다. 수집 시점은 매일 한국시간 09·12·15·18시입니다. 서버에서 접근할 수 없는 경로는 승인된 수집 PC가 처리합니다.
        </p>
        <p>
          자동 복지 분류와 중복 판정을 거친 공개 자료를 표시합니다. 같은 제목을 하위 기관에서 재게시한 경우 확인된 광역 원문을 우선하며,
          전체 기관의 모든 보도자료를 빠짐없이 수집했다는 뜻은 아닙니다.
          {" "}<a href="https://www.korea.kr" target="_blank" rel="noreferrer" className={LINK_CLASS}>정책브리핑</a>
        </p>
      </Section>

      <Section title="복지예산">
        <p>
          <a href="https://www.lofin365.go.kr" target="_blank" rel="noreferrer" className={LINK_CLASS}>지방재정365</a>
          의 세부사업별 세출현황에서 공개 예산현액과 지출액을 받습니다. 전국 수치는 현재 공개된 범위의 합계이며, 지역마다 기준일이 다를 수 있습니다.
          통합돌봄은 사업명 대조와 분류 규칙에 따른 사회복지의 하위 분류로 사회복지 합계에 포함합니다.
        </p>
        <p>
          지자체 예산서의 본예산·추경 금액은 지방재정365의 기준일 예산현액과 구분합니다. 부서명은 공식 자료로 확인한 매칭만 표시하며,
          확인되지 않은 코드를 부서명으로 추정하지 않습니다. 행정시·행정구는 확인된 상위기관의 부서 범위로 조회하며 별도 지자체 합계에 중복 가산하지 않습니다.
        </p>
      </Section>

      <Section title="복지정보 관계성 지도">
        <p>
          공개된 사업·제도·지역·법령·보도자료·예산 사이의 확인된 연결을 시각화합니다.
          지도에 연결되어 있다는 사실만으로 신청 자격이나 예산의 실제 수혜관계가 확정되는 것은 아닙니다. 선택한 항목의 원문과 상세 화면에서 근거를 확인할 수 있습니다.
        </p>
      </Section>

      <Section title="문서 근거 사실">
        <p>
          지방자치단체 공고·안내 문서는 로컬 PC에서 파싱하고 사람이 원문과 대조한 항목만 묶어 올립니다. 서버가 형식·해시·근거 위치를 다시 검사하고,
          관리자가 원문 근거를 확인해 승인·활성화한 항목만 공개합니다. 파일 형식 지원과 개별 문서의 검증 완료 여부는 구분합니다.
        </p>
        <p>
          <a href="/documents" className={LINK_CLASS}>공개 중인 문서 근거 사실 보기</a>
        </p>
      </Section>

      <Section title="보완 확인: 공공데이터포털 API">
        <p>
          공공데이터포털의 지자체 복지서비스 목록 API에서 통합돌봄, 방문진료, 재택의료,
          방문간호, 병원동행, 식사·가사·이동·주거지원 등 관련 검색어를 페이지 끝까지
          조회합니다. 보건복지부 메뉴판과 지역·사업명이 일치하는 응답은 비어 있는 설명,
          지원대상, 제공기관을 보완하는 데 사용합니다.
        </p>
        <p>
          <a href={PUBLIC_DATA_PORTAL} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            공공데이터포털
            <span className="sr-only">(새 창)</span>
          </a>
        </p>
      </Section>

      <Section title="자동 현행화와 안전한 교체">
        <p>
          대시보드 자료는 요청 시 현행화 필요 여부를 확인하고, 마지막 성공 수집이 24시간보다 오래되면
          자동 수집을 이어갑니다. 변경 문서가 많으면 처리 한도 안에서 나눠 이어받으며, 관리자는
          관리자 화면에서 즉시 현행화를 실행할 수 있습니다.
        </p>
        <p>
          새 수집 결과는 기존 공개 자료와 분리해 먼저 저장합니다. 기존 원본
          저장소의 12,104건과 지역·사업명이 정확히 일치하는 항목은 더 정확하게 정리된 필드
          표기로 교정하고, 나머지 항목의 중분류와 사업구분도 원본 저장소에 존재하는 기준값으로
          정규화합니다. 어떤 사업을 수록할지는 보건복지부 원문이 결정하며, 사업 수·사업명
          일치율·주요 필드 채움률·분류값 검증을 모두 통과한 경우에만 화면을 교체합니다. 중간
          실패는 기존 정상 자료를 덮어쓰지 않습니다.
        </p>
        <dl className="grid gap-1 rounded-lg border border-border bg-(--jeju-surface-inset) px-3 py-2.5 text-(length:--jeju-text-sm)">
          <div>
            <dt className="inline text-muted-foreground">마지막 성공 </dt>
            <dd className="inline font-bold text-(--jeju-text-strong)">{formatMoment(success?.completedAt ?? "")}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">수록 사업 </dt>
            <dd className="inline font-bold tabular-nums text-(--jeju-text-strong)">{success ? success.serviceCount.toLocaleString("ko-KR") + "건" : "확인되지 않음"}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">공식 원문 </dt>
            <dd className="inline font-bold tabular-nums text-(--jeju-text-strong)">{success ? success.documentCount.toLocaleString("ko-KR") + "건" : "확인되지 않음"}</dd>
          </div>
        </dl>
      </Section>

      <Section title={CARE_RESOURCES_PUBLIC ? "외부 데이터 연계(지역 돌봄 수요·자원, 공식 혜택정보, 법령 근거)" : "외부 데이터 연계(공식 혜택정보, 법령 근거)"}>
        <p>
          아래 원천은 제공기관의 공개 API에서 받아 {CARE_RESOURCES_PUBLIC ? "지역 돌봄 자원 화면과 " : ""}위키 사업 상세에 씁니다. 사업과 정부24 서비스·법령의 연결은
          검토·승인된 연결만 공개합니다. 법령의 원천은 법제처 국가법령정보센터이며 적용 시점과 조문 근거를 함께 확인합니다.
        </p>
        <ul className="grid gap-2">
          {integrations.filter((row) => CARE_RESOURCES_PUBLIC || !CARE_DATASET_KEYS.has(row.dataset_key)).map((row) => (
            <li key={row.dataset_key} className="rounded-lg border border-border p-3">
              <a href={row.official_url} target="_blank" rel="noreferrer" className={LINK_CLASS}>{row.provider} · {row.dataset_name}<span className="sr-only">(새 창)</span></a>
              <span className="ml-2 text-(length:--jeju-text-sm) font-bold">{row.state_label}</span>
              <p className="text-(length:--jeju-text-sm) text-muted-foreground">{row.terms} · {row.update_cycle} · 마지막 성공 {row.last_success_at ? formatMoment(row.last_success_at) : "없음"}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="이용 안내">
        <p>
          이 대시보드는 전국 통합돌봄 관련 사업을 검색·비교하기 위한 업무 참고용입니다.
          실제 시행 여부와 지원기준은 연결된 보건복지부 및 해당 지방자치단체의 최신 원문을
          확인해야 합니다.
        </p>
      </Section>
    </main>
  );
}
