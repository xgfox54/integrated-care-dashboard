"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ServiceRow } from "@/lib/dataset";

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

function DetailField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="border-t border-border py-3 first:border-t-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-base whitespace-pre-line">{value}</dd>
    </div>
  );
}

export function DetailSheet({
  row,
  sourceLabel,
  dataAsOf,
  onClose,
}: {
  row: ServiceRow | null;
  sourceLabel: string;
  dataAsOf: string;
  onClose: () => void;
}) {
  const [lookup, setLookup] = useState<LookupState>(IDLE);
  const [lookupRowId, setLookupRowId] = useState<number | undefined>(row?.id);

  if (lookupRowId !== row?.id) {
    setLookupRowId(row?.id);
    setLookup(IDLE);
  }

  if (!row) return null;

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
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="text-lg leading-snug">{row.name || "사업 상세"}</SheetTitle>
          <SheetDescription>
            {[row.sido, row.sigungu].filter(Boolean).join(" ")} · 보건복지부 공식 메뉴판
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6">
          <dl>
            <DetailField label="시·도" value={row.sido} />
            <DetailField label="시·군·구" value={row.sigungu} />
            <DetailField label="대분류" value={row.category} />
            <DetailField label="중분류" value={row.subcategory} />
            <DetailField label="사업구분" value={row.type} />
            <DetailField label="지원대상" value={row.target} />
            <DetailField label="세부대상자" value={row.detailTarget} />
            <DetailField label="사업내용" value={row.description} />
            <DetailField label="제공기관" value={row.provider} />
            <DetailField label="서비스 ID" value={row.serial} />
            <DetailField label="자료 기준일" value={dataAsOf} />
            <DetailField label="불러온 위치" value={sourceLabel} />
          </dl>

          <div className="mt-5 rounded-lg border border-border bg-muted/40 p-3">
            <h3 className="text-base font-semibold">공공 API 최신 조회</h3>
            <p className="mt-1 text-sm text-muted-foreground">
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

            {lookup.message ? (
              <p className="mt-2 text-sm text-amber-800">{lookup.message}</p>
            ) : null}

            {lookup.phase === "done" && lookup.items.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                같은 이름으로 조회된 사업이 없습니다.
              </p>
            ) : null}

            {lookup.items.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {lookup.items.map((item) => (
                  <li key={item.servId || item.servNm} className="rounded-md border border-border bg-card p-2">
                    <p className="font-medium">{item.servNm}</p>
                    <p className="text-sm text-muted-foreground">
                      {[item.sidoNm, item.sggNm, item.jurOrgNm].filter(Boolean).join(" · ")}
                    </p>
                    {item.servDgst ? <p className="mt-1 text-sm">{item.servDgst}</p> : null}
                    {item.servDtlLink ? (
                      <a
                        href={item.servDtlLink}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-sm text-primary underline"
                      >
                        복지로 상세 페이지 열기
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            실제 시행 여부와 지원기준은 보건복지부 및 해당 지방자치단체 공식자료를 확인하세요.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
