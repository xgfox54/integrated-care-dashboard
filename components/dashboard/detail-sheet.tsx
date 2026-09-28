"use client";

import { useEffect, useState } from "react";

import { DetailList, DetailPanel } from "@/components/jeju-detail-panel";
import { Button } from "@/components/ui/button";
import { ExternalLinkIcon } from "@/components/ui/jeju-icons";
import { serviceWikiKey, type ServiceRow } from "@/lib/dataset";
import type { ViewRoute } from "@/lib/usage/codes";
import { newUsageId, usageEntityClose, usageEntityOpen } from "@/lib/usage/track";

interface WelfareLookupItem {
  servId: string;
  servNm: string;
  jurOrgNm: string;
  servDgst: string;
  sidoNm: string;
  sggNm: string;
  servDtlLink: string;
}

interface LookupState {
  phase: "idle" | "loading" | "done" | "unconfigured" | "error";
  items: WelfareLookupItem[];
  message: string;
}

const IDLE: LookupState = { phase: "idle", items: [], message: "" };

/**
 * 사업 상세 — 제주 디자인 상세 보기 사이드 패널(DetailPanel). 표의 "보기" 버튼처럼 상태로 열어도
 * 닫히면 연 버튼으로 포커스가 돌아가고, 열린 채 인쇄하면 패널 내용만 나온다.
 */
export function DetailSheet({
  row,
  usage,
  sourceLabel,
  dataAsOf,
  onClose,
}: {
  row: ServiceRow | null;
  /** 상세를 연 경로(이용통계). */
  usage: { route: ViewRoute; search?: string };
  sourceLabel: string;
  dataAsOf: string;
  onClose: () => void;
}) {
  if (!row) return null;
  return (
    <DetailPanel
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={row.name || "사업 상세"}
      description={`${[row.sido, row.sigungu].filter(Boolean).join(" ")} · 보건복지부 공식 메뉴판`}
    >
      <DetailBody key={row.id} row={row} usage={usage} sourceLabel={sourceLabel} dataAsOf={dataAsOf} />
    </DetailPanel>
  );
}

function DetailBody({
  row,
  usage,
  sourceLabel,
  dataAsOf,
}: {
  row: ServiceRow;
  usage: { route: ViewRoute; search?: string };
  sourceLabel: string;
  dataAsOf: string;
}) {
  const [lookup, setLookup] = useState<LookupState>(IDLE);
  // 상세 한 번 열기 = 열람 1회. 닫았다가 다시 열면 새 열람이다.
  const [viewId] = useState(() => newUsageId());
  useEffect(() => {
    usageEntityOpen(viewId, "care_program", serviceWikiKey(row), usage.route, usage.search);
    return () => usageEntityClose(viewId);
  }, [viewId, row, usage.route, usage.search]);

  const fields: { label: string; value: string }[] = [
    { label: "시·도", value: row.sido },
    { label: "시·군·구", value: row.sigungu },
    { label: "대분류", value: row.category },
    { label: "중분류", value: row.subcategory },
    { label: "사업구분", value: row.type },
    { label: "지원대상", value: row.target },
    { label: "세부대상자", value: row.detailTarget },
    { label: "사업내용", value: row.description },
    { label: "제공기관", value: row.provider },
    { label: "서비스 ID", value: row.serial },
    { label: "자료 기준일", value: dataAsOf },
    { label: "불러온 위치", value: sourceLabel },
  ].filter((field) => Boolean(field.value));

  const runLookup = async () => {
    setLookup({ phase: "loading", items: [], message: "" });
    try {
      const response = await fetch(`/api/gov/search?q=${encodeURIComponent(row.name)}`);
      const payload = (await response.json()) as {
        configured?: boolean;
        items?: WelfareLookupItem[];
        error?: string;
        resultMsg?: string;
      };
      if (response.status === 409 || payload.configured === false) {
        setLookup({
          phase: "unconfigured",
          items: [],
          message: "공공데이터포털 인증키가 등록되지 않았습니다. 관리자 화면에서 등록하세요.",
        });
        return;
      }
      if (!response.ok) {
        setLookup({
          phase: "error",
          items: [],
          message: payload.error ?? payload.resultMsg ?? "조회에 실패했습니다.",
        });
        return;
      }
      setLookup({ phase: "done", items: payload.items ?? [], message: "" });
    } catch (error) {
      setLookup({
        phase: "error",
        items: [],
        message: error instanceof Error ? error.message : "조회에 실패했습니다.",
      });
    }
  };

  return (
    <div className="pb-6">
      <DetailList items={fields.map((field) => ({ label: field.label, value: <span className="whitespace-pre-line">{field.value}</span> }))} />

      <div className="mt-5 rounded-lg border border-border bg-(--jeju-surface-inset) p-3 print:hidden">
        <h3 className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">공공 API 최신 조회</h3>
        <p className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">
          공공데이터포털 지자체 복지서비스 API에서 같은 이름의 최신 응답을 다시 조회합니다.
          결과의 서비스 ID와 시행기관을 함께 확인하세요.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={lookup.phase === "loading" || !row.name}
          onClick={runLookup}
        >
          {lookup.phase === "loading" ? "조회 중" : "공공 API에서 다시 찾기"}
        </Button>

        <div role="status" aria-live="polite">
          {lookup.message ? (
            <p className="mt-2 text-(length:--jeju-text-sm) font-bold text-(--jeju-warning)">{lookup.message}</p>
          ) : null}
          {lookup.phase === "done" && lookup.items.length === 0 ? (
            <p className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">
              같은 이름으로 조회된 사업이 없습니다.
            </p>
          ) : null}
        </div>

        {lookup.items.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {lookup.items.map((item) => (
              <li key={item.servId || item.servNm} className="rounded-lg border border-border bg-card p-2.5">
                <p className="font-bold text-(--jeju-text-strong)">{item.servNm}</p>
                <p className="text-(length:--jeju-text-sm) text-muted-foreground">
                  {[item.sidoNm, item.sggNm, item.jurOrgNm].filter(Boolean).join(" · ")}
                </p>
                {item.servDgst ? <p className="mt-1 text-(length:--jeju-text-sm)">{item.servDgst}</p> : null}
                {item.servDtlLink ? (
                  <a
                    href={item.servDtlLink}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-(length:--jeju-text-sm) font-bold text-primary underline"
                  >
                    복지로 상세 페이지 열기
                    <ExternalLinkIcon />
                    <span className="sr-only">(새 창)</span>
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <p className="mt-4 text-(length:--jeju-text-sm) text-muted-foreground">
        실제 시행 여부와 지원기준은 보건복지부 및 해당 지방자치단체 공식자료를 확인하세요.
      </p>
    </div>
  );
}
