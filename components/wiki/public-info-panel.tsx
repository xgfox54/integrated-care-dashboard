"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";

type Tone = "success" | "warning" | "danger" | "neutral" | "info";
interface Gov24Service { readonly service_id: string; readonly name: string; readonly org_name: string | null; readonly target: string | null; readonly criteria: string | null; readonly benefit: string | null; readonly apply_method: string | null; readonly apply_deadline: string | null; readonly required_documents: string | null; readonly reception: string | null; readonly contact: string | null; readonly online_url: string | null; readonly detail_url: string | null; readonly modified_at: string | null; readonly presence: string; readonly collected_on: string | null; readonly conflicts: readonly { readonly field: string; readonly gov24: string; readonly program: string }[] | null }
interface LawRef { readonly law_name: string; readonly law_kind: string | null; readonly version_id: string | null; readonly article: string | null; readonly promulgated_on: string | null; readonly effective_on: string | null; readonly query_date: string; readonly version_status: string; readonly article_status: string; readonly official_url: string; readonly upcoming_note: string | null }
interface Info { readonly gov24: { readonly state: string; readonly state_label: string; readonly pending_candidates: number; readonly last_collected_at: string | null; readonly services: readonly Gov24Service[] }; readonly legal_basis: { readonly state: string; readonly state_label: string; readonly pending_candidates: number; readonly references: readonly LawRef[]; readonly note: string } }

const TONE: Record<string, Tone> = { COLLECTED: "success", NOT_COLLECTED: "neutral", AUTH_REQUIRED: "warning", SOURCE_ERROR: "danger", LINK_UNVERIFIED: "warning", COLLECTING: "info" };
const VERSION: Record<string, string> = { CURRENT: "현행", FUTURE: "시행예정", PAST: "과거 시행본", REPEALED: "폐지", UNKNOWN: "확인 불가" };
const LINK = "font-bold text-primary underline-offset-4 hover:underline";

function Field({ label, value }: { readonly label: string; readonly value: string | null }) {
  if (!value) return null;
  return <div><dt className="font-bold">{label}</dt><dd className="whitespace-pre-line text-(--jeju-text-body)">{value}</dd></div>;
}

/** 사업 상세의 공식 혜택정보(정부24)와 법적 근거. 관리자가 확인한 연결만 내용을 보이고, 후보는 검토 대기 건수만 알린다. */
export function PublicInfoPanel({ implementationId }: { readonly implementationId: string }) {
  const [state, setState] = useState<{ readonly id: string; readonly info: Info | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/integrations/program?service=" + encodeURIComponent(implementationId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => (response.ok ? ((await response.json()) as Info) : null))
      .then((info) => setState({ id: implementationId, info }))
      .catch(() => { if (!controller.signal.aborted) setState({ id: implementationId, info: null }); });
    return () => controller.abort();
  }, [implementationId]);
  const current = state?.id === implementationId ? state : null;
  // 관리자가 같은 사업으로 확인한 정부24 서비스나 법령 근거가 있을 때만 보인다. 연결이 없거나 불러오지 못하면 칸 자체를 숨긴다
  // (「불러오지 못했습니다」「검토를 기다립니다」 같은 운영 상태는 이용자에게 필요 없음, 2026-10-06 전수점검).
  if (current && (!current.info || (!current.info.gov24.services.length && !current.info.legal_basis.references.length))) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="public-info-heading">
      <h3 id="public-info-heading" className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">공식 혜택정보와 법적 근거</h3>
      <p className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">정부24 공공서비스 정보와 법령 근거는 관리자가 같은 사업으로 확인한 연결만 보여 줍니다. 원천마다 기준일이 다르며 내용이 서로 다르면 덮어쓰지 않고 함께 표시합니다.</p>
      {!current ? <p className="mt-3 flex items-center gap-2 text-(length:--jeju-text-sm) text-muted-foreground"><Spinner label="불러오는 중" />불러오는 중입니다.</p> : null}
      {current && !current.info ? <p className="mt-3 text-(length:--jeju-text-sm) text-muted-foreground">공식 혜택정보를 불러오지 못했습니다.</p> : null}
      {current?.info ? (
        <div className="mt-4 grid gap-4 text-(length:--jeju-text-sm)">
          <div>
            <h4 className="flex items-center gap-2 font-extrabold">정부24 공공서비스 <Badge variant={TONE[current.info.gov24.state] ?? "neutral"}>{current.info.gov24.state_label}</Badge></h4>
            {!current.info.gov24.services.length ? <p className="mt-1 text-muted-foreground">{current.info.gov24.pending_candidates ? "같은 사업일 수 있는 정부24 서비스 " + current.info.gov24.pending_candidates + "건이 관리자 검토를 기다립니다." : current.info.gov24.state === "COLLECTED" || current.info.gov24.state === "LINK_UNVERIFIED" ? "확인된 정부24 서비스 연결이 없습니다." : "정부24 공공서비스 정보를 아직 수집하지 않았습니다."}</p> : null}
            {current.info.gov24.services.map((service) => (
              <article key={service.service_id} className="mt-2 rounded-lg border border-border p-3">
                <p className="font-bold text-(--jeju-text-strong)">{service.name} <span className="font-normal text-muted-foreground">· {service.org_name ?? ""} · 서비스ID {service.service_id}</span></p>
                <dl className="mt-2 grid gap-2">
                  <Field label="지원대상" value={service.target} />
                  <Field label="선정기준" value={service.criteria} />
                  <Field label="지원내용" value={service.benefit} />
                  <Field label="신청방법" value={service.apply_method} />
                  <Field label="신청기한" value={service.apply_deadline} />
                  <Field label="구비서류" value={service.required_documents} />
                  <Field label="접수기관" value={service.reception} />
                  <Field label="문의처" value={service.contact} />
                </dl>
                {service.conflicts?.length ? <p className="mt-2 rounded-md bg-(--jeju-warning-tint) p-2 text-(--jeju-warning)">보건복지부 사업안내와 내용이 다른 항목: {service.conflicts.map((conflict) => conflict.field).join(", ")}. 두 원천을 모두 확인하세요.</p> : null}
                {service.presence !== "PRESENT" ? <p className="mt-2 text-(--jeju-warning)">최근 정부24 목록에서 보이지 않았습니다(종료 여부 확인 전).</p> : null}
                <p className="mt-2 text-(length:--jeju-text-xs) text-muted-foreground">정부24 수정일시 {service.modified_at ?? "-"} · 수집 {service.collected_on ?? "-"} · {service.detail_url ? <a href={service.detail_url} target="_blank" rel="noreferrer" className={LINK}>정부24 원문</a> : "원문 주소 없음"}{service.online_url ? <> · <a href={service.online_url} target="_blank" rel="noreferrer" className={LINK}>온라인 신청</a></> : null}</p>
              </article>
            ))}
          </div>
          <div>
            <h4 className="flex items-center gap-2 font-extrabold">법적 근거 <Badge variant={TONE[current.info.legal_basis.state] ?? "neutral"}>{current.info.legal_basis.state_label}</Badge></h4>
            {!current.info.legal_basis.references.length ? <p className="mt-1 text-muted-foreground">{current.info.legal_basis.pending_candidates ? "법령 근거 후보 " + current.info.legal_basis.pending_candidates + "건이 관리자 검토를 기다립니다." : "확인된 법령 근거 연결이 없습니다."}</p> : null}
            <ul className="mt-2 grid gap-2">
              {current.info.legal_basis.references.map((ref) => (
                <li key={ref.law_name + (ref.article ?? "") + ref.query_date} className="rounded-lg border border-border p-3">
                  <a href={ref.official_url} target="_blank" rel="noreferrer" className={LINK}>{ref.law_name}{ref.article ? " " + ref.article : ""}</a>
                  <Badge variant={ref.version_status === "CURRENT" ? "success" : "warning"} className="ml-2">{VERSION[ref.version_status] ?? ref.version_status}</Badge>
                  <p className="mt-1 text-(length:--jeju-text-xs) text-muted-foreground">{ref.law_kind ?? ""} · 공포 {ref.promulgated_on ?? "-"} · 시행 {ref.effective_on ?? "-"} · 조회기준일 {ref.query_date} · 버전 {ref.version_id ?? "-"} · 조문 {ref.article_status === "EXISTS" ? "확인됨" : ref.article_status}</p>
                  {ref.upcoming_note ? <p className="mt-1 text-(length:--jeju-text-xs) text-(--jeju-warning)">{ref.upcoming_note}</p> : null}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-(length:--jeju-text-xs) text-muted-foreground">{current.info.legal_basis.note} 원천: 법제처 국가법령정보센터.</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
