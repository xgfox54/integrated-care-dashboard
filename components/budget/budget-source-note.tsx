export function BudgetSourceNote({ national = false }: { readonly national?: boolean }) {
  return (
    <p className="mt-3 rounded-lg border border-border bg-(--jeju-surface-inset) px-3 py-2.5 text-(length:--jeju-text-sm) leading-6 text-muted-foreground">
      위 금액은 행정안전부 <a className="font-bold text-primary underline underline-offset-2" href="https://www.lofin365.go.kr/" target="_blank" rel="noopener noreferrer">지방재정365</a>가 공개한 「세부사업별 세출현황」 자료를 가져와 합산한 값입니다.{" "}
      {national ? "선택한 분야의 최신 전국 합계이며, 아래 지역·기관·부서 등 조회 조건으로 바뀌지 않습니다." : "조회 조건을 바꾸면 그 조건에 맞는 세부사업만 다시 합산합니다."}
    </p>
  );
}
