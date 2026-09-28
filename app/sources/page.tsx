import { PageUsage } from "@/components/usage/page-usage";
import { readOfficialSyncStatus } from "@/lib/official-sync-status";
import { MOHW_INTEGRATED_CARE_URL } from "@/lib/official-source";

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

  return (
    <main className="mx-auto max-w-[900px] space-y-4 px-4 py-6 sm:px-6">
      <PageUsage page="sources" tab="sources" />
      <div>
        <h1 className="text-(length:--jeju-h1-size) leading-(--jeju-leading-tight) font-extrabold text-(--jeju-text-strong)">데이터 출처 및 현행화 방식</h1>
        <p className="mt-2 text-(length:--jeju-text-base) text-muted-foreground">
          저장소 파일에 의존하지 않고 공식 홈페이지와 공공 API에서 직접 수집합니다.
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
          서버는 매시간 현행화 필요 여부를 확인하고, 마지막 성공 수집이 24시간보다 오래되면
          자동 수집합니다. 변경 문서가 많으면 처리 한도 안에서 나눠 이어받으며, 관리자는
          관리자 화면에서 즉시 현행화를 실행할 수 있습니다.
        </p>
        <p>
          새 수집 결과는 D1 데이터베이스의 별도 실행 단위에 먼저 저장합니다. 기존 원본
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
            <dd className="inline font-bold tabular-nums text-(--jeju-text-strong)">{success?.serviceCount.toLocaleString("ko-KR") ?? "0"}건</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">공식 원문 </dt>
            <dd className="inline font-bold tabular-nums text-(--jeju-text-strong)">{success?.documentCount.toLocaleString("ko-KR") ?? "0"}건</dd>
          </div>
        </dl>
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
