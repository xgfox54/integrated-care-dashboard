"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";

type Tone = "success" | "warning" | "danger" | "neutral" | "info";
interface SourceStatus { readonly dataset_key: string; readonly provider: string; readonly dataset_name: string; readonly official_url: string; readonly state: string; readonly state_label: string; readonly last_success_at: string | null; readonly last_message: string | null; readonly update_cycle: string }
interface SeriesPoint { readonly period: string; readonly value: string | null; readonly status: string; readonly unit: string | null; readonly basis: string }
interface DemandStat { readonly org_id: string; readonly tbl_id: string; readonly tbl_name: string; readonly purpose: string; readonly table_status: string; readonly item_label: string | null; readonly unit: string | null; readonly population_basis: string | null; readonly source_url: string; readonly series: readonly SeriesPoint[]; readonly state: string; readonly note: string | null }
interface Indicator { readonly label: string; readonly value: string | null; readonly unit: string; readonly formula: string; readonly numerator: { readonly label: string; readonly value: number | null; readonly basis_date: string | null; readonly source: string }; readonly denominator: { readonly label: string; readonly value: string | null; readonly period: string | null; readonly source: string }; readonly limitations: readonly string[]; readonly reason: string | null }
interface Demand { readonly region_id: string; readonly as_of: string; readonly legal_codes: number; readonly stats: readonly DemandStat[]; readonly institutions: { readonly count: number | null; readonly basis_date: string | null; readonly by_group: readonly { readonly group: string; readonly label: string; readonly count: number }[]; readonly state: string }; readonly indicators: readonly Indicator[]; readonly sources: readonly SourceStatus[] }
interface InstitutionCard { readonly institution_id: string; readonly admin_sym: string; readonly name: string; readonly service_types: readonly { readonly code: string; readonly name: string; readonly group: string }[]; readonly designated_on: string | null; readonly region_name: string | null; readonly last_seen_on: string | null }
interface InstitutionPage { readonly total: number | null; readonly items: readonly InstitutionCard[]; readonly state: string; readonly page: number; readonly page_size: number }
interface Detail { readonly institution_id: string; readonly admin_sym: string; readonly id_system: string; readonly name: string; readonly address: { readonly legal_dong: string | null; readonly detail: string | null; readonly post_no: string | null }; readonly tel: string | null; readonly designated_on: string | null; readonly registered_on: string | null; readonly services: readonly { readonly code: string; readonly name: string; readonly group_label: string; readonly presence: string }[]; readonly partners: readonly { readonly name: string; readonly from: string; readonly to: string | null; readonly state: string; readonly last_seen_on: string | null }[]; readonly detail_status: string; readonly sources: { readonly search: { readonly title: string; readonly url: string; readonly last_seen_on: string | null }; readonly detail: { readonly title: string; readonly url: string; readonly fetched_on: string | null } }; readonly notes: readonly string[] }

const STATE_TONE: Record<string, Tone> = { COLLECTED: "success", NOT_COLLECTED: "neutral", AUTH_REQUIRED: "warning", SOURCE_ERROR: "danger", LINK_UNVERIFIED: "warning", COLLECTING: "info" };
const STATE_LABEL: Record<string, string> = { COLLECTED: "수집됨", NOT_COLLECTED: "미수집", AUTH_REQUIRED: "미수집(인증키 필요)", SOURCE_ERROR: "원천 장애", LINK_UNVERIFIED: "연결 미확인", COLLECTING: "수집 중" };
const VALUE_STATUS: Record<string, string> = { NOT_AVAILABLE: "자료 없음(-)", SUPPRESSED: "비공개(x)", UNKNOWN: "미상", MISSING: "결측" };
const PARTNER_LABEL: Record<string, [string, Tone]> = { CURRENT: ["협약 중", "success"], EXPIRED: ["협약기간 종료", "neutral"], NOT_SEEN: ["원천 목록에서 빠짐", "warning"] };
const CARD = "rounded-xl border border-border bg-card p-5";
const H2 = "text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)";
const LINK = "font-bold text-primary underline-offset-4 hover:underline";

function regionLabel(id: string): string {
  const [sido, sigungu] = id.replace(/^region:/, "").split("|");
  return sigungu ? sido + " " + sigungu : sido ?? id;
}

function number(value: string | number | null): string {
  if (value === null || value === undefined || value === "") return "-";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : String(value);
}

function day(value: string | null): string {
  return value ? value.slice(0, 10) : "-";
}

function readQuery(name: string): string {
  if (typeof window === "undefined") return "";
  return new URL(window.location.href).searchParams.get(name) ?? "";
}

export function CareBrowser() {
  const [regions, setRegions] = useState<readonly string[]>([]);
  const [groups, setGroups] = useState<Readonly<Record<string, string>>>({});
  const [region, setRegion] = useState("");
  const [group, setGroup] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ readonly key: string; readonly demand: Demand; readonly institutions: InstitutionPage } | null>(null);
  const [failed, setFailed] = useState(false);
  const [detailId, setDetailId] = useState("");
  const [detail, setDetail] = useState<{ readonly id: string; readonly value: Detail | null } | null>(null);

  useEffect(() => {
    fetch("/api/care?regions=1", { cache: "no-store" })
      .then(async (response) => (await response.json()) as { regions: string[]; groups: Record<string, string> })
      .then((body) => {
        setRegions(body.regions);
        setGroups(body.groups);
        const wanted = readQuery("region");
        setRegion(body.regions.includes(wanted) ? wanted : body.regions.includes("region:서울특별시|종로구") ? "region:서울특별시|종로구" : body.regions[0] ?? "");
        setDetailId(readQuery("institution"));
      })
      .catch(() => setFailed(true));
  }, []);

  const key = region + "|" + group + "|" + query + "|" + page;
  useEffect(() => {
    if (!region) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ region, page: String(page) });
    if (group) params.set("group", group);
    if (query) params.set("q", query);
    fetch("/api/care?" + params.toString(), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("status " + response.status);
        return (await response.json()) as { demand: Demand; institutions: InstitutionPage };
      })
      .then((body) => { setData({ key, demand: body.demand, institutions: body.institutions }); setFailed(false); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    const url = new URL(window.location.href);
    url.searchParams.set("region", region);
    window.history.replaceState(null, "", url.toString());
    return () => controller.abort();
  }, [region, group, query, page, key]);

  useEffect(() => {
    if (!detailId) return;
    const controller = new AbortController();
    fetch("/api/care?institution=" + encodeURIComponent(detailId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => (response.ok ? ((await response.json()) as { institution: Detail }).institution : null))
      .then((value) => setDetail({ id: detailId, value }))
      .catch(() => { if (!controller.signal.aborted) setDetail({ id: detailId, value: null }); });
    return () => controller.abort();
  }, [detailId]);

  const sidos = useMemo(() => [...new Set(regions.map((id) => id.replace(/^region:/, "").split("|")[0] ?? ""))].filter(Boolean), [regions]);
  const currentSido = region.replace(/^region:/, "").split("|")[0] ?? "";
  const sigungus = regions.filter((id) => id.startsWith("region:" + currentSido + "|"));
  const current = data?.key === key ? data : null;
  const demand = current?.demand ?? null;
  const list = current?.institutions ?? null;
  const pages = list?.total ? Math.max(1, Math.ceil(list.total / list.page_size)) : 1;

  return (
    <div className="grid gap-4">
      <section className={CARD}>
        <h1 className="text-(length:--jeju-h1-size) leading-(--jeju-leading-tight) font-extrabold text-(--jeju-text-strong)">지역 돌봄 자원</h1>
        <p className="mt-2 max-w-3xl text-(length:--jeju-text-base) text-muted-foreground">국민건강보험공단 장기요양기관과 KOSIS 돌봄 수요 통계를 지역별로 보여 줍니다. 통계는 지역 규모를 비교하는 자료이며 실제 통합돌봄 신청자나 대상자 수가 아닙니다. 장기요양기관 수는 지정 기관 수이며 빈자리나 즉시 이용 가능 여부를 뜻하지 않습니다.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,14rem)]">
          <label className="grid gap-1 text-(length:--jeju-text-sm) font-bold">시·도
            <NativeSelect value={currentSido} onChange={(event) => { const next = regions.find((id) => id === "region:" + event.target.value) ?? regions.find((id) => id.startsWith("region:" + event.target.value + "|")) ?? ""; setRegion(next); setPage(1); }}>
              {sidos.map((sido) => <NativeSelectOption key={sido} value={sido}>{sido}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-(length:--jeju-text-sm) font-bold">시·군·구
            <NativeSelect value={region} onChange={(event) => { setRegion(event.target.value); setPage(1); }} disabled={!sigungus.length}>
              {regions.includes("region:" + currentSido) ? <NativeSelectOption value={"region:" + currentSido}>{currentSido} 전체</NativeSelectOption> : null}
              {sigungus.map((id) => <NativeSelectOption key={id} value={id}>{id.split("|")[1]}</NativeSelectOption>)}
            </NativeSelect>
          </label>
        </div>
        {demand ? (
          <ul className="mt-4 flex flex-wrap gap-2 text-(length:--jeju-text-sm)" aria-label="원천별 수집 상태">
            {demand.sources.map((source) => (
              <li key={source.dataset_key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">
                <a href={source.official_url} target="_blank" rel="noreferrer" className={LINK}>{source.provider} · {source.dataset_name}</a>
                <Badge variant={STATE_TONE[source.state] ?? "neutral"}>{source.state_label}</Badge>
                <span className="text-muted-foreground">{source.last_success_at ? "마지막 수집 " + day(source.last_success_at) : "수집 기록 없음"}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {!current && !failed ? <p className="flex items-center gap-2 text-muted-foreground"><Spinner label="불러오는 중" />불러오는 중입니다.</p> : null}
      {failed ? <p className="rounded-lg border border-border bg-card p-4 text-muted-foreground">지역 돌봄 자원을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.</p> : null}

      {demand ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {demand.indicators.map((indicator) => (
            <section key={indicator.label} className={CARD} aria-labelledby="indicator-heading">
              <h2 id="indicator-heading" className={H2}>{indicator.label}</h2>
              <p className="mt-2 text-(length:--jeju-text-2xl) font-extrabold text-(--jeju-text-strong)">{indicator.value ?? "계산하지 않음"}{indicator.value ? <span className="ml-1 text-(length:--jeju-text-base) font-bold text-muted-foreground">{indicator.unit}</span> : null}</p>
              {indicator.reason ? <p className="mt-1 text-(length:--jeju-text-sm) text-(--jeju-warning)">{indicator.reason}</p> : null}
              <dl className="mt-3 grid gap-2 text-(length:--jeju-text-sm)">
                <div><dt className="font-bold">산식</dt><dd className="text-muted-foreground">{indicator.formula}</dd></div>
                <div><dt className="font-bold">분자: {indicator.numerator.label}</dt><dd className="text-muted-foreground">{number(indicator.numerator.value)} · 기준일 {indicator.numerator.basis_date ?? "-"} · {indicator.numerator.source}</dd></div>
                <div><dt className="font-bold">분모: {indicator.denominator.label}</dt><dd className="text-muted-foreground">{number(indicator.denominator.value)} · 기준시점 {indicator.denominator.period ?? "-"} · {indicator.denominator.source}</dd></div>
              </dl>
              <ul className="mt-3 list-disc pl-5 text-(length:--jeju-text-sm) text-muted-foreground">{indicator.limitations.map((text) => <li key={text}>{text}</li>)}</ul>
            </section>
          ))}
          <section className={CARD} aria-labelledby="institution-count-heading">
            <h2 id="institution-count-heading" className={H2}>장기요양기관 {demand.institutions.count === null ? "" : number(demand.institutions.count) + "곳"}</h2>
            <p className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">기관기호 기준으로 셉니다. 한 기관이 여러 서비스를 하면 유형별 수에는 각각 들어가므로 유형별 합계가 기관 수보다 클 수 있습니다.{demand.institutions.basis_date ? " 기준일 " + demand.institutions.basis_date + "." : ""}</p>
            {demand.institutions.count === null ? <p className="mt-3"><Badge variant={STATE_TONE[demand.institutions.state] ?? "neutral"}>{STATE_LABEL[demand.institutions.state] ?? demand.institutions.state}</Badge></p> : (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant={group ? "outline" : "default"} size="sm" onClick={() => { setGroup(""); setPage(1); }}>전체</Button>
                {demand.institutions.by_group.map((entry) => (
                  <Button key={entry.group} variant={group === entry.group ? "default" : "outline"} size="sm" onClick={() => { setGroup(entry.group); setPage(1); }}>{entry.label} {number(entry.count)}</Button>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {demand ? (
        <section className={CARD} aria-labelledby="demand-heading">
          <h2 id="demand-heading" className={H2}>돌봄 수요 통계(KOSIS)</h2>
          <p className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">관리자가 통계표의 항목·분류·단위·주기·지역 범위를 확인한 표만 수집합니다. 결측·비공개 값은 0으로 바꾸지 않고 그대로 표시합니다.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {demand.stats.map((stat) => {
              const latest = [...stat.series].reverse().find((point) => point.value !== null) ?? stat.series.at(-1) ?? null;
              return (
                <article key={stat.org_id + stat.tbl_id} className="rounded-lg border border-border p-4">
                  <h3 className="font-bold text-(--jeju-text-strong)">{stat.item_label ?? stat.tbl_name}</h3>
                  <p className="mt-1 text-(length:--jeju-text-xs) text-muted-foreground">KOSIS {stat.org_id}/{stat.tbl_id} · {stat.tbl_name}</p>
                  {stat.table_status !== "VERIFIED" ? <p className="mt-2"><Badge variant="neutral">통계표 확인 전</Badge></p> : null}
                  {latest ? <p className="mt-2 text-(length:--jeju-text-xl) font-extrabold">{latest.value === null ? VALUE_STATUS[latest.status] ?? latest.status : number(latest.value)}<span className="ml-1 text-(length:--jeju-text-sm) text-muted-foreground">{latest.unit ?? stat.unit ?? ""} · {latest.period}</span></p> : <p className="mt-2"><Badge variant={STATE_TONE[stat.state] ?? "neutral"}>{STATE_LABEL[stat.state] ?? stat.state}</Badge></p>}
                  {stat.series.length > 1 ? <ol className="mt-2 grid gap-0.5 text-(length:--jeju-text-xs) text-muted-foreground">{stat.series.slice(-6).map((point) => <li key={point.period}>{point.period}: {point.value === null ? VALUE_STATUS[point.status] ?? point.status : number(point.value)}{point.basis.includes("합산") ? " (" + point.basis + ")" : ""}</li>)}</ol> : null}
                  {stat.table_status === "VERIFIED" ? <p className="mt-2 text-(length:--jeju-text-xs) text-muted-foreground">모집단: {stat.population_basis ?? "-"}</p> : stat.note ? <p className="mt-2 text-(length:--jeju-text-xs) text-muted-foreground">{stat.note}</p> : null}
                  <a href={stat.source_url} target="_blank" rel="noreferrer" className={LINK + " mt-2 inline-block text-(length:--jeju-text-sm)"}>KOSIS 원문</a>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {list ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section className={CARD} aria-labelledby="institution-list-heading">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 id="institution-list-heading" className={H2}>{regionLabel(region)} 장기요양기관 {list.state === "COLLECTED" && list.total !== null ? number(list.total) + "곳" : ""}{group && groups[group] ? " · " + groups[group] : ""}</h2>
              <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setQuery(draft.trim()); setPage(1); }}>
                <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="기관명" aria-label="기관명 검색" className="h-(--jeju-control-h) w-40 rounded-md border border-border px-2" />
                <Button type="submit" size="sm">찾기</Button>
              </form>
            </div>
            {list.state !== "COLLECTED" ? <p className="mt-3"><Badge variant={STATE_TONE[list.state] ?? "neutral"}>{STATE_LABEL[list.state] ?? list.state}</Badge> <span className="text-(length:--jeju-text-sm) text-muted-foreground">{list.state === "LINK_UNVERIFIED" ? "이 지역에 확정 연결된 행정코드가 없습니다." : "장기요양기관 자료를 아직 수집하지 않았습니다."}</span></p> : null}
            {list.state === "COLLECTED" && !list.items.length ? <p className="mt-3 text-muted-foreground">조건에 맞는 기관이 없습니다.</p> : null}
            <ul className="mt-3 divide-y divide-border">
              {list.items.map((item) => (
                <li key={item.institution_id}>
                  <button type="button" onClick={() => { setDetailId(item.institution_id); const url = new URL(window.location.href); url.searchParams.set("institution", item.institution_id); window.history.replaceState(null, "", url.toString()); }} className={"w-full py-2 text-left " + (detailId === item.institution_id ? "bg-(--jeju-primary-tint)" : "hover:bg-muted")}>
                    <span className="font-bold text-(--jeju-text-strong)">{item.name}</span>
                    <span className="ml-2 text-(length:--jeju-text-xs) text-muted-foreground">{item.region_name ?? ""} · 지정 {item.designated_on ?? "-"} · 확인 {item.last_seen_on ?? "-"}</span>
                    <span className="mt-1 flex flex-wrap gap-1">{item.service_types.map((service) => <Badge key={service.code} variant="outline">{service.name}</Badge>)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {list.total !== null && list.total > list.page_size ? (
              <div className="mt-3 flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</Button>
                <span className="text-(length:--jeju-text-sm)">{page} / {pages}</span>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>다음</Button>
              </div>
            ) : null}
          </section>
          <section className={CARD} aria-labelledby="institution-detail-heading" aria-live="polite">
            <h2 id="institution-detail-heading" className={H2}>기관 상세</h2>
            {!detailId ? <p className="mt-2 text-muted-foreground">목록에서 기관을 고르세요.</p> : null}
            {detailId && detail?.id !== detailId ? <p className="mt-2 flex items-center gap-2 text-muted-foreground"><Spinner label="불러오는 중" />불러오는 중입니다.</p> : null}
            {detail?.id === detailId && !detail.value ? <p className="mt-2 text-muted-foreground">이 기관 정보를 찾지 못했습니다.</p> : null}
            {detail?.id === detailId && detail.value ? <InstitutionDetail value={detail.value} /> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function InstitutionDetail({ value }: { readonly value: Detail }) {
  return (
    <div className="mt-2 grid gap-3 text-(length:--jeju-text-sm)">
      <p className="text-(length:--jeju-text-lg) font-extrabold text-(--jeju-text-strong)">{value.name}</p>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2 gap-y-1">
        <dt className="font-bold">기관기호</dt><dd>{value.admin_sym}</dd>
        <dt className="font-bold">주소</dt><dd>{[value.address.legal_dong, value.address.detail].filter(Boolean).join(" ") || "상세 미수집"}</dd>
        <dt className="font-bold">전화</dt><dd>{value.tel ?? "상세 미수집"}</dd>
        <dt className="font-bold">지정일</dt><dd>{value.designated_on ?? "-"}</dd>
      </dl>
      <div>
        <h3 className="font-bold">서비스 유형(원천 코드표)</h3>
        <ul className="mt-1 flex flex-wrap gap-1">{value.services.map((service) => <li key={service.code}><Badge variant={service.presence === "PRESENT" ? "outline" : "neutral"}>{service.code} {service.name}</Badge></li>)}</ul>
      </div>
      <div>
        <h3 className="font-bold">협약 의료기관</h3>
        {value.partners.length ? (
          <ul className="mt-1 grid gap-1">
            {value.partners.map((partner) => {
              const [label, tone] = PARTNER_LABEL[partner.state] ?? [partner.state, "neutral"];
              return <li key={partner.name + partner.from} className="flex flex-wrap items-center gap-2"><span>{partner.name}</span><span className="text-muted-foreground">{partner.from} ~ {partner.to ?? "기한 없음"}</span><Badge variant={tone}>{label}</Badge></li>;
            })}
          </ul>
        ) : <p className="text-muted-foreground">{value.detail_status === "NOT_COLLECTED" ? "상세 미수집" : "확인된 협약기관 없음"}</p>}
      </div>
      <div className="rounded-lg bg-muted p-3 text-(length:--jeju-text-xs) text-muted-foreground">
        <p>출처: <a href={value.sources.search.url} target="_blank" rel="noreferrer" className={LINK}>{value.sources.search.title}</a>(확인 {value.sources.search.last_seen_on ?? "-"}), <a href={value.sources.detail.url} target="_blank" rel="noreferrer" className={LINK}>{value.sources.detail.title}</a>(수집 {value.sources.detail.fetched_on ?? "미수집"})</p>
        <p className="mt-1">{value.id_system}</p>
        {value.notes.map((note) => <p key={note} className="mt-1">{note}</p>)}
      </div>
    </div>
  );
}
