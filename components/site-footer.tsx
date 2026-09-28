import { MailIcon } from "@/components/ui/jeju-icons";

const REPORT_EMAIL = "xgfox54@gmail.com";
const REPORT_HREF = `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent("[통합돌봄 대시보드] 오류 제보")}`;

export function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-(--jeju-shell-border) bg-card">
      <div className="mx-auto max-w-(--jeju-main-max-wide) space-y-2 px-4 py-6 text-(length:--jeju-text-sm) text-muted-foreground sm:px-6">
        <p className="flex items-start gap-2 rounded-(--jeju-radius) border border-border bg-(--jeju-surface-inset) px-3 py-2.5 text-(--jeju-text-body) print:hidden">
          <MailIcon className="mt-0.5 text-primary" />
          <span>
            <strong className="font-bold text-(--jeju-text-strong)">오류 제보</strong>
            <span className="mx-1.5 text-(--jeju-text-faint)" aria-hidden="true">|</span>
            사이트 버그나 사업 정보 오류를 발견하시면{" "}
            <a
              href={REPORT_HREF}
              className="font-bold text-primary underline underline-offset-2 hover:text-(--jeju-primary-hover)"
            >
              {REPORT_EMAIL}
            </a>
            으로 알려 주세요. 오류가 보인 화면 주소와 사업명을 함께 적어 주시면 빠르게 확인하겠습니다.
          </span>
        </p>
        <p>
          본 대시보드는 전국 통합돌봄 관련 사업현황을 빠르게 검색·비교하기 위한 업무 참고용
          자료입니다. 실제 사업 시행 여부, 지원대상, 지원기준 및 세부내용은 보건복지부 및 해당
          지방자치단체의 최신 공식자료를 반드시 확인하시기 바랍니다.
        </p>
        <p>
          사업 수는 수혜자 수, 예산 규모, 서비스 공급량을 의미하지 않습니다. 데이터 원 출처와
          이용 근거는 데이터 출처 화면에서 확인할 수 있습니다.
        </p>
        <p className="print:hidden">
          <a href="/usage-policy" className="text-(--jeju-text-body) underline underline-offset-2 hover:text-primary">
            이용통계 수집 안내
          </a>
        </p>
      </div>
    </footer>
  );
}
