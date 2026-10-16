"use client";

import { Button } from "@/components/ui/button";
import { DownloadIcon } from "@/components/ui/jeju-icons";
import { dashboardXlsxUrl } from "@/lib/dashboard-url";
import type { FilterState } from "@/lib/dataset";

type DownloadXlsxButtonProps = {
  readonly filters: FilterState;
  readonly totalCount: number;
  readonly onNotice: (message: string) => void;
};

export function DownloadXlsxButton({ filters, totalCount, onNotice }: DownloadXlsxButtonProps) {
  return (
    <Button variant="outline" size="sm" asChild>
      <a
        href={dashboardXlsxUrl(filters)}
        download
        onClick={(event) => {
          if (totalCount === 0) {
            event.preventDefault();
            onNotice("내려받을 검색 결과가 없습니다.");
            return;
          }
          onNotice("검색 결과 XLSX 파일 다운로드를 요청했습니다. 다운로드가 완료되면 파일을 열어 주세요.");
        }}
      >
        <DownloadIcon />
        검색결과 XLSX 다운로드
      </a>
    </Button>
  );
}
