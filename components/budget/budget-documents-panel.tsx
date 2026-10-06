"use client";

// 「예산서(편성 단계 문서)」 구획(작업지시서 v5 §22.7·22.10, T91·T104). 지방재정365 기준일 현액과 따로, 관리자가 승인한
// 예산서 원문의 편성 단계 금액·계층·부기·재원을 보여 준다. 두 값은 대조만 하고 서로 덮어쓰지 않는다.
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";

import { formatJoEok } from "./budget-format";

interface Revision {
  readonly document_revision_id: string;
  readonly title: string;
  readonly issuer: string;
  readonly fiscal_entity: { readonly fiscal_entity_id: string; readonly name: string | null } | null;
  readonly fiscal_year: string;
  readonly stage_label: string;
  readonly stage_basis: string;
  readonly account: { readonly code: string; readonly name: string };
  readonly scope: string;
  readonly amount_columns: readonly string[];
  readonly previous_column_label: string | null;
  readonly line_count: number;
  readonly server_checks: { readonly children_sum?: { match: number; mismatch: number; partial_listing?: number }; readonly funding_sum?: { match: number; partial: number }; readonly side_columns?: { match: number; mismatch: number }; readonly bugi_lines?: number };
  readonly source: { readonly page_url: string | null; readonly file_url: string | null; readonly retrieved_at: string; readonly parser: string; readonly extractor_version: string; readonly format: string };
}
interface Line {
  readonly budget_line_id: string;
  readonly line_no: number;
  readonly parent_line_no: number | null;
  readonly level: string;
  readonly level_label: string;
  readonly code: string | null;
  readonly name: string;
  readonly formula_text: string | null;
  readonly amount_thousand_krw: string | null;
  readonly amount_krw: string | null;
  readonly previous_amount_thousand_krw: string | null;
  readonly change_amount_thousand_krw: string | null;
  readonly funding: readonly { readonly label: string; readonly amount_thousand_krw: string }[];
  readonly evidence: { readonly page: number | null };
  readonly annotations: readonly string[];
  readonly api_comparison?: null | { readonly relation: string; readonly relation_label: string; readonly api: null | { readonly current_budget_krw: string | null; readonly reference_date: string; readonly department_code: string } };
}
interface Outline {
  readonly revision: Revision;
  readonly lines: readonly Line[];
  readonly api_comparison: null | { readonly basis: { readonly document: string; readonly api: string; readonly reference_dates: readonly string[]; readonly rule: string }; readonly counts: Readonly<Record<string, number>> };
}

const NUMBER = new Intl.NumberFormat("ko-KR");
const RELATION_TONE: Record<string, "success" | "warning" | "neutral" | "info"> = {
  same_within_display_rounding: "success", api_current_higher: "info", api_current_lower: "warning", not_found_in_api: "neutral", ambiguous_name_in_api: "neutral", api_amount_missing: "neutral",
};
/** 계층 깊이별 들여쓰기(rem). 부서 0 → 하위 산출항목 7. */
const DEPTH: Record<string, number> = { department: 0, policy: 1, unit: 2, detail_project: 3, object_group: 4, object: 5, item: 6, sub_item: 7 };
const indent = (level: string) => ({ paddingLeft: 0.75 + (DEPTH[level] ?? 0) * 0.85 + "rem" });

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

const thousand = (value: string | null) => (value === null ? "-" : value + "천원");

export function BudgetDocumentsPanel({ entityId, regionEntityIds }: { readonly entityId: string; readonly regionEntityIds: readonly string[] | null }) {
  const [revisions, setRevisions] = useState<readonly Revision[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState("");
  const [outline, setOutline] = useState<{ readonly id: string; readonly data: Outline | null } | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, readonly Line[] | "loading" | "error">>({});
  const requests = useRef(new Map<string, AbortController>());

  useEffect(() => {
    let live = true;
    getJson<{ readonly revisions: readonly Revision[] }>("/api/budget/documents")
      .then((body) => { if (live) setRevisions(body.revisions); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  // 행정시·행정구도 해당 기관에 연결된 승인 문서만 보여 준다. 상위 기관 문서를 하위 기관 자료로 표시하지 않는다.
  const shown = useMemo(() => {
    const list = revisions ?? [];
    if (entityId) return list.filter((revision) => revision.fiscal_entity?.fiscal_entity_id === entityId);
    return regionEntityIds === null ? list : list.filter((revision) => regionEntityIds.includes(revision.fiscal_entity?.fiscal_entity_id ?? ""));
  }, [revisions, entityId, regionEntityIds]);
  const current = shown.find((revision) => revision.document_revision_id === picked)?.document_revision_id ?? shown[0]?.document_revision_id ?? "";

  useEffect(() => {
    const pending = requests.current;
    return () => { for (const controller of pending.values()) controller.abort(); pending.clear(); };
  }, [current]);

  useEffect(() => {
    if (!current) return;
    let live = true;
    getJson<Outline>("/api/budget/documents?revision=" + encodeURIComponent(current))
      .then((data) => { if (live) setOutline({ id: current, data }); }, () => { if (live) setOutline({ id: current, data: null }); });
    return () => { live = false; };
  }, [current]);

  const data = outline?.id === current ? outline.data : null;
  const loadingOutline = Boolean(current) && outline?.id !== current;
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const visible = (data?.lines ?? []).filter((line) => line.level !== "detail_project" || tokens.every((token) => line.name.includes(token)));
  const details = visible.filter((line) => line.level === "detail_project");

  async function toggle(line: Line) {
    const key = JSON.stringify([current, line.line_no]);
    if (open[key]) {
      requests.current.get(key)?.abort();
      requests.current.delete(key);
      setOpen((state) => { const next = { ...state }; delete next[key]; return next; });
      return;
    }
    const controller = new AbortController();
    requests.current.set(key, controller);
    setOpen((state) => ({ ...state, [key]: "loading" }));
    try {
      const body = await getJson<{ readonly lines: readonly Line[] }>("/api/budget/documents?revision=" + encodeURIComponent(current) + "&line=" + line.line_no, controller.signal);
      if (!controller.signal.aborted) setOpen((state) => ({ ...state, [key]: body.lines.slice(1) }));
    } catch {
      if (!controller.signal.aborted) setOpen((state) => ({ ...state, [key]: "error" }));
      else setOpen((state) => {
        if (state[key] !== "loading" || requests.current.has(key)) return state;
        const next = { ...state }; delete next[key]; return next;
      });
    } finally {
      if (requests.current.get(key) === controller) requests.current.delete(key);
    }
  }

  return (
    <section id="budget-documents" aria-labelledby="budget-documents-heading" className="scroll-mt-4 space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="budget-documents-heading" className="text-(length:--jeju-h2-size) font-extrabold text-(--jeju-text-strong)">예산서 상세내역</h2>
        <p className="text-(length:--jeju-text-sm) text-muted-foreground">위 세부사업 금액(지방재정365 기준일 예산현액)과 별도인 자료입니다.</p>
      </div>
      <p className="text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">
        자치단체가 공개한 예산서 원문에서 부서·정책·단위·세부사업·편성목·통계목·부기와 재원을 그대로 옮겼습니다. 금액은 그 문서의 편성 단계(본예산·추경 등) 값이며 단위는 원문 표시인 천원입니다. 관리자가 검산 결과를 확인하고 승인한 문서만 보입니다.
      </p>
      {failed ? <p role="alert" className="text-(length:--jeju-text-sm) text-(--jeju-danger)">예산서 목록을 불러오지 못했습니다.</p> : null}
      {!revisions && !failed ? <p className="flex items-center gap-2 text-(length:--jeju-text-sm) text-muted-foreground"><Spinner label="불러오는 중" />예산서 목록을 불러오는 중입니다.</p> : null}
      {revisions && shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-3 text-(length:--jeju-text-sm) text-muted-foreground">
          {entityId ? "선택한 기관에 연결된 예산서는 아직 공개되지 않았습니다." : regionEntityIds !== null ? "선택한 지역의 공개 예산서가 없습니다." : "아직 공개된 예산서가 없습니다."}
        </p>
      ) : null}
      {shown.length > 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor="budget-document-revision">예산서·부서 선택</Label>
          <NativeSelect id="budget-document-revision" className="w-full" value={current} onChange={(event) => setPicked(event.target.value)}>
          {shown.map((revision) => (
            <NativeSelectOption key={revision.document_revision_id} value={revision.document_revision_id}>
              {(revision.fiscal_entity?.name ?? revision.issuer) + " · " + revision.fiscal_year + "년 " + revision.stage_label + " · " + revision.title}
            </NativeSelectOption>
          ))}
          </NativeSelect>
        </div>
      ) : null}
      {loadingOutline ? <p className="flex items-center gap-2 text-(length:--jeju-text-sm) text-muted-foreground"><Spinner label="불러오는 중" />예산서 내용을 불러오는 중입니다.</p> : null}
      {data ? (
        <>
          <dl className="grid gap-x-6 gap-y-1 rounded-lg bg-(--jeju-surface-inset) p-3 text-(length:--jeju-text-sm) sm:grid-cols-[9rem_1fr]">
            <dt className="font-bold text-muted-foreground">문서</dt><dd>{data.revision.title}</dd>
            <dt className="font-bold text-muted-foreground">편성 단계</dt><dd><Badge variant="info">{data.revision.stage_label}</Badge> <span className="text-muted-foreground">근거: {data.revision.stage_basis}</span></dd>
            <dt className="font-bold text-muted-foreground">범위·회계</dt><dd>{data.revision.account.name} · {data.revision.scope}</dd>
            <dt className="font-bold text-muted-foreground">검산</dt>
            <dd>
              상위 금액 = 하위 합 {NUMBER.format(data.revision.server_checks.children_sum?.match ?? 0)}건 일치{data.revision.server_checks.children_sum?.partial_listing ? " · 바뀐 하위 항목만 실린 상위 " + NUMBER.format(data.revision.server_checks.children_sum.partial_listing) + "건(비교증감 합 일치)" : ""}{data.revision.server_checks.children_sum?.mismatch ? " · 불일치 " + data.revision.server_checks.children_sum.mismatch : ""}
              {" · "}재원 합 = 금액 {NUMBER.format(data.revision.server_checks.funding_sum?.match ?? 0)}건
              {data.revision.previous_column_label ? " · 금액 − " + data.revision.previous_column_label + " = 비교증감 " + NUMBER.format(data.revision.server_checks.side_columns?.match ?? 0) + "건" : ""}
              {" · "}부기 {NUMBER.format(data.revision.server_checks.bugi_lines ?? 0)}행
            </dd>
            <dt className="font-bold text-muted-foreground">원문</dt>
            <dd>
              {data.revision.source.page_url ? <a className="font-bold text-primary underline underline-offset-2" href={data.revision.source.page_url} target="_blank" rel="noopener noreferrer">자치단체 공개 화면</a> : "공개 화면 주소 없음"}
              {data.revision.source.file_url ? <> · <a className="font-bold text-primary underline underline-offset-2" href={data.revision.source.file_url} target="_blank" rel="noopener noreferrer">예산서 원문 PDF</a></> : null}
              {" · "}{data.revision.source.format} · 받은 날 {data.revision.source.retrieved_at.slice(0, 10)}
            </dd>
          </dl>
          {data.api_comparison ? (
            <div className="space-y-1 text-(length:--jeju-text-sm)">
              <p className="font-bold">지방재정365 예산현액과 대조(세부사업명 기준)</p>
              <p className="flex flex-wrap gap-1.5">
                {Object.entries(data.api_comparison.counts).map(([relation, count]) => (
                  <Badge key={relation} variant={RELATION_TONE[relation] ?? "neutral"}>{(data.lines.find((line) => line.api_comparison?.relation === relation)?.api_comparison?.relation_label ?? relation) + " " + NUMBER.format(count)}</Badge>
                ))}
              </p>
              <p className="text-(length:--jeju-text-xs) leading-relaxed text-muted-foreground">{data.api_comparison.basis.rule} 지방재정365 기준일 {data.api_comparison.basis.reference_dates.join(", ")}.</p>
            </div>
          ) : null}
          <div className="max-w-sm space-y-1">
            <Label htmlFor="budget-document-query">세부사업 찾기</Label>
            <Input id="budget-document-query" value={query} placeholder="예: 기초연금, 경로당" onChange={(event) => setQuery(event.target.value)} />
          </div>
          <p className="text-(length:--jeju-text-sm) text-muted-foreground" role="status">세부사업 {NUMBER.format(details.length)}건 · 세부사업을 누르면 편성목·통계목·부기·재원이 펼쳐집니다.</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-left text-(length:--jeju-text-sm)">
              <caption className="sr-only">예산서 계층별 금액</caption>
              <thead className="bg-(--jeju-surface-inset) text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">계층·이름</th>
                  <th className="px-3 text-right">예산서 금액</th>
                  <th className="px-3 text-right">{data.revision.previous_column_label ?? "앞 칸"}</th>
                  <th className="px-3 text-right">비교증감</th>
                  <th className="px-3 text-right">지방재정365 예산현액</th>
                  <th className="px-3">대조</th>
                </tr>
              </thead>
              <tbody>
                {visible.filter((line) => line.level === "detail_project" || tokens.length === 0).map((line) => {
                  const isDetail = line.level === "detail_project";
                  const children = open[JSON.stringify([current, line.line_no])];
                  return (
                    <LineRows key={line.budget_line_id} line={line} isDetail={isDetail} childrenRows={children} onToggle={() => void toggle(line)} />
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {outline?.id === current && !outline.data ? <p role="alert" className="text-(length:--jeju-text-sm) text-(--jeju-danger)">예산서 내용을 불러오지 못했습니다.</p> : null}
    </section>
  );
}

function LineRows({ line, isDetail, childrenRows, onToggle }: { readonly line: Line; readonly isDetail: boolean; readonly childrenRows: readonly Line[] | "loading" | "error" | undefined; readonly onToggle: () => void }) {
  const comparison = line.api_comparison;
  return (
    <>
      <tr className={"border-t border-(--jeju-hairline) align-top" + (isDetail ? "" : " bg-(--jeju-surface-inset)/60")}>
        <td className="py-2 pr-3" style={indent(line.level)}>
          <span className="mr-1.5 text-(length:--jeju-text-xs) text-muted-foreground">{line.level_label}</span>
          {isDetail ? (
            <button type="button" className="font-bold text-primary underline-offset-2 hover:underline" aria-expanded={Boolean(childrenRows)} onClick={onToggle}>{line.name}</button>
          ) : <span className="font-bold text-(--jeju-text-strong)">{line.name}</span>}
          {line.evidence.page ? <span className="ml-1.5 inline-block whitespace-nowrap text-(length:--jeju-text-xs) text-muted-foreground">PDF {line.evidence.page}쪽</span> : null}
          {line.funding.length ? <span className="block text-(length:--jeju-text-xs) text-muted-foreground">재원 {line.funding.map((item) => item.label + " " + item.amount_thousand_krw).join(" · ")}</span> : null}
        </td>
        <td className="px-3 py-2 text-right tabular-nums" title={thousand(line.amount_thousand_krw)}>{formatJoEok(line.amount_krw)}<span className="block text-(length:--jeju-text-xs) text-muted-foreground">{thousand(line.amount_thousand_krw)}</span></td>
        <td className="px-3 py-2 text-right tabular-nums">{thousand(line.previous_amount_thousand_krw)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{line.change_amount_thousand_krw ?? "-"}</td>
        <td className="px-3 py-2 text-right tabular-nums">{comparison?.api ? formatJoEok(comparison.api.current_budget_krw) : "-"}{comparison?.api ? <span className="block text-(length:--jeju-text-xs) text-muted-foreground">{comparison.api.reference_date} · 부서코드 {comparison.api.department_code}</span> : null}</td>
        <td className="px-3 py-2">{comparison ? <Badge variant={RELATION_TONE[comparison.relation] ?? "neutral"}>{comparison.relation_label}</Badge> : null}</td>
      </tr>
      {childrenRows === "loading" ? <tr><td colSpan={6} className="px-3 py-2"><Spinner label="불러오는 중" /></td></tr> : null}
      {childrenRows === "error" ? <tr><td colSpan={6} className="px-3 py-2 text-(--jeju-danger)">하위 행을 불러오지 못했습니다.</td></tr> : null}
      {childrenRows !== undefined && typeof childrenRows !== "string" ? childrenRows.map((child) => (
        <tr key={child.budget_line_id} className="border-t border-(--jeju-hairline) align-top text-(length:--jeju-text-xs)">
          <td className="py-1.5 pr-3" style={indent(child.level)}>
            <span className="mr-1.5 text-muted-foreground">{child.level_label}</span>
            {child.code ? <span className="mr-1 tabular-nums text-muted-foreground">{child.code}</span> : null}
            <span className={child.level === "item" ? "font-bold" : ""}>{child.name}</span>
            {child.evidence.page ? <span className="ml-1.5 inline-block whitespace-nowrap text-muted-foreground">PDF {child.evidence.page}쪽</span> : null}
            {child.formula_text ? <span className="block text-muted-foreground">산출식 {child.formula_text}</span> : null}
            {child.funding.length ? <span className="block text-muted-foreground">재원 {child.funding.map((item) => item.label + " " + item.amount_thousand_krw).join(" · ")}</span> : null}
            {child.annotations.length ? <span className="block text-muted-foreground">표시 {child.annotations.join(" · ")}</span> : null}
          </td>
          <td className="px-3 py-1.5 text-right tabular-nums">{thousand(child.amount_thousand_krw)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums">{thousand(child.previous_amount_thousand_krw)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums">{child.change_amount_thousand_krw ?? "-"}</td>
          <td className="px-3 py-1.5" />
          <td className="px-3 py-1.5" />
        </tr>
      )) : null}
    </>
  );
}
