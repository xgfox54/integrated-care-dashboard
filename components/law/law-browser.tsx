"use client";

import {
  BookOpenText,
  Building2,
  Check,
  ClipboardCheck,
  Copy,
  ExternalLink,
  FileSearch,
  Gavel,
  Landmark,
  LoaderCircle,
  Scale,
  Search,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type Mode = "search" | "text" | "annex" | "decision" | "research" | "analysis" | "ordinance";
type ToolName =
  | "search_law"
  | "get_law_text"
  | "get_annexes"
  | "search_decisions"
  | "legal_research"
  | "legal_analysis"
  | "ordinance_radar";

interface LawStatus {
  readonly configured?: boolean;
  readonly implementation?: string;
  readonly package_version?: string;
}

interface LawResponse {
  readonly ok?: boolean;
  readonly error?: string;
  readonly message?: string;
  readonly text?: string;
  readonly tool?: ToolName;
  readonly package_version?: string;
  readonly source?: string;
}

const MODES: readonly {
  readonly id: Mode;
  readonly label: string;
  readonly description: string;
  readonly icon: typeof Search;
}[] = [
  { id: "search", label: "법령 검색", description: "법령·자치법규·행정규칙", icon: Search },
  { id: "text", label: "조문 본문", description: "현행·과거 시행 조문", icon: BookOpenText },
  { id: "annex", label: "별표·서식", description: "법령 별표와 서식", icon: FileSearch },
  { id: "decision", label: "판례·결정례", description: "판례·해석례·행정심판", icon: Gavel },
  { id: "research", label: "종합 리서치", description: "법체계·처분근거·절차", icon: Landmark },
  { id: "analysis", label: "인용·적용 검증", description: "인용·시점·영향 검증", icon: ClipboardCheck },
  { id: "ordinance", label: "조례 정비", description: "상위법 개정 대조", icon: Building2 },
] as const;

const DECISION_DOMAINS = [
  ["precedent", "판례"],
  ["interpretation", "법령해석례"],
  ["admin_appeal", "행정심판례"],
  ["constitutional", "헌법재판소 결정례"],
  ["tax_tribunal", "조세심판례"],
  ["customs", "관세 심사·심판"],
  ["nts", "국세청 질의회신"],
  ["ftc", "공정거래위원회 의결"],
  ["pipc", "개인정보보호위원회 결정"],
  ["nlrc", "노동위원회 판정"],
  ["acr", "국민권익위원회 결정"],
] as const;

const RESEARCH_TASKS = [
  ["full_research", "종합 조사"],
  ["law_system", "법체계 확인"],
  ["action_basis", "처분·행정행위 근거"],
  ["dispute_prep", "불복·분쟁 준비"],
  ["amendment_track", "개정 경과 추적"],
  ["ordinance_compare", "조례 비교"],
  ["procedure_detail", "처리 절차 확인"],
] as const;

const ANALYSIS_MODES = [
  ["verify_citations", "문서 속 법령·판례 인용 검증"],
  ["cite_check", "판례의 후속 인용 확인"],
  ["applicable_law", "사건 시점 적용법 확인"],
  ["impact_map", "특정 조문 영향 관계"],
] as const;

const FIELD_CLASS =
  "min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-(length:--jeju-text-base) text-(--jeju-text-strong) outline-none placeholder:text-muted-foreground focus:border-primary focus:shadow-(--jeju-focus-ring)";
const LABEL_CLASS = "grid gap-1.5 text-(length:--jeju-text-sm) font-bold text-(--jeju-text-strong)";

function omitEmpty(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== "" && value !== undefined && value !== null),
  );
}

function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className={LABEL_CLASS}>
      <span>{label}</span>
      {children}
      {hint ? <span className="font-normal leading-relaxed text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function StatusBadge({ status }: { readonly status: LawStatus | null }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-(length:--jeju-text-sm) font-bold text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> 연결 확인 중
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-(length:--jeju-text-sm) font-bold",
        status.configured
          ? "border-(--jeju-secondary) bg-(--jeju-secondary-tint) text-(--jeju-secondary-strong)"
          : "border-(--jeju-orange) bg-(--jeju-orange-tint) text-(--jeju-text-strong)",
      )}
    >
      {status.configured ? <Check className="size-3.5" aria-hidden="true" /> : <Scale className="size-3.5" aria-hidden="true" />}
      내장형 v{status.package_version ?? "4.15.6"}
      {status.configured ? " · 사용 가능" : " · 인증값 미설정"}
    </span>
  );
}

export function LawBrowser() {
  const [mode, setMode] = useState<Mode>("search");
  const [status, setStatus] = useState<LawStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LawResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const [searchQuery, setSearchQuery] = useState("의료·요양 등 지역 돌봄의 통합지원에 관한 법률");
  const [lawId, setLawId] = useState("");
  const [mst, setMst] = useState("");
  const [article, setArticle] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [annexLawName, setAnnexLawName] = useState("");
  const [annexQuery, setAnnexQuery] = useState("");
  const [decisionDomain, setDecisionDomain] = useState("precedent");
  const [decisionQuery, setDecisionQuery] = useState("통합돌봄");
  const [researchTask, setResearchTask] = useState("full_research");
  const [researchQuery, setResearchQuery] = useState("의료·요양 통합지원 사업의 법적 근거와 지방자치단체의 역할");
  const [analysisMode, setAnalysisMode] = useState("verify_citations");
  const [analysisText, setAnalysisText] = useState("");
  const [caseNumber, setCaseNumber] = useState("");
  const [analysisLawName, setAnalysisLawName] = useState("");
  const [analysisArticle, setAnalysisArticle] = useState("");
  const [analysisDate, setAnalysisDate] = useState("");
  const [ordinanceName, setOrdinanceName] = useState("");
  const [ordinanceQuery, setOrdinanceQuery] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/law", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const body = (await response.json()) as LawStatus;
        if (active) setStatus(body);
      })
      .catch(() => {
        if (active) setStatus({ configured: false, package_version: "4.15.6" });
      });
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, []);

  const selectedMode = useMemo(() => MODES.find((item) => item.id === mode) ?? MODES[0], [mode]);

  function selectMode(nextMode: Mode) {
    if (nextMode === mode) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setResult(null);
    setCopied(false);
    setMode(nextMode);
  }

  function requestForMode(): { tool: ToolName; args: Record<string, unknown> } {
    switch (mode) {
      case "search":
        return { tool: "search_law", args: { query: searchQuery, display: 30 } };
      case "text":
        return {
          tool: "get_law_text",
          args: omitEmpty({ lawId: lawId.trim(), mst: mst.trim(), jo: article.trim(), efYd: effectiveDate.replaceAll("-", "") }),
        };
      case "annex":
        return {
          tool: "get_annexes",
          args: omitEmpty({ lawName: annexLawName.trim(), query: annexQuery.trim(), jo: article.trim(), date: effectiveDate.trim() }),
        };
      case "decision":
        return {
          tool: "search_decisions",
          args: omitEmpty({
            domain: decisionDomain,
            query: decisionQuery.trim(),
            display: 20,
            page: 1,
            options: decisionDomain === "precedent" ? { search: "both" } : undefined,
          }),
        };
      case "research":
        return { tool: "legal_research", args: { query: researchQuery.trim(), task: researchTask } };
      case "analysis":
        return {
          tool: "legal_analysis",
          args: omitEmpty({
            mode: analysisMode,
            text: analysisText.trim(),
            caseNumber: caseNumber.trim(),
            lawName: analysisLawName.trim(),
            jo: analysisArticle.trim(),
            date: analysisDate.trim(),
            includeMermaid: analysisMode === "impact_map",
          }),
        };
      case "ordinance":
        return {
          tool: "ordinance_radar",
          args: omitEmpty({ ordinanceName: ordinanceName.trim(), query: ordinanceQuery.trim() }),
        };
    }
  }

  function clientValidation(): string | null {
    if (mode === "search" && !searchQuery.trim()) return "검색할 법령명을 입력해 주세요.";
    if (mode === "text" && !lawId.trim() && !mst.trim()) return "법령 ID 또는 MST 중 하나를 입력해 주세요.";
    if (mode === "annex" && !annexLawName.trim()) return "별표·서식을 확인할 법령명을 입력해 주세요.";
    if (mode === "decision" && !decisionQuery.trim()) return "판례·결정례 검색어를 입력해 주세요.";
    if (mode === "research" && !researchQuery.trim()) return "조사할 법률 질문을 입력해 주세요.";
    if (mode === "analysis") {
      if (analysisMode === "verify_citations" && !analysisText.trim()) return "검증할 문서 또는 인용문을 입력해 주세요.";
      if ((analysisMode === "cite_check" || analysisMode === "applicable_law") && !caseNumber.trim()) return "사건번호를 입력해 주세요.";
      if (analysisMode === "applicable_law" && !analysisDate.trim()) return "사건 기준일을 입력해 주세요.";
      if (analysisMode === "impact_map" && (!analysisLawName.trim() || !analysisArticle.trim())) return "법령명과 조문을 입력해 주세요.";
    }
    if (mode === "ordinance" && !ordinanceName.trim() && !ordinanceQuery.trim()) return "조례명 또는 검색어를 입력해 주세요.";
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = clientValidation();
    if (validation) {
      setResult({ ok: false, error: "INVALID_INPUT", message: validation, text: validation });
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setCopied(false);
    setResult(null);
    try {
      const payload = requestForMode();
      const response = await fetch("/api/law", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      let body: LawResponse;
      try {
        body = (await response.json()) as LawResponse;
      } catch {
        body = { ok: false, error: "INVALID_RESPONSE", message: "서버 응답을 읽지 못했습니다." };
      }
      if (!response.ok && !body.text) body = { ...body, ok: false, text: body.message ?? `요청에 실패했습니다. (${response.status})` };
      setResult(body);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setResult({ ok: false, error: "NETWORK_ERROR", text: "법령정보 서버에 연결하지 못했습니다. 잠시 뒤 다시 확인해 주세요." });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }

  async function copyResult() {
    if (!result?.text) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5" aria-labelledby="law-tool-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="law-tool-heading" className="flex items-center gap-2 text-(length:--jeju-h2-size) font-extrabold text-(--jeju-text-strong)">
              <Scale className="size-6 text-primary" aria-hidden="true" />
              국가법령정보 통합 조회
            </h2>
            <p className="mt-1 max-w-3xl text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">
              외부 법령 MCP에 연결하지 않고 이 대시보드 서버가 법제처 국가법령정보 OPEN API를 직접 조회합니다.
              인증값은 서버에만 보관하며 브라우저에는 전달하지 않습니다.
            </p>
          </div>
          <StatusBadge status={status} />
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="tablist" aria-label="법령정보 조회 기능">
          {MODES.map((item) => {
            const Icon = item.icon;
            const selected = item.id === mode;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => selectMode(item.id)}
                className={cn(
                  "flex min-h-16 items-center gap-3 rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:shadow-(--jeju-focus-ring)",
                  selected
                    ? "border-primary bg-(--jeju-primary-tint) text-primary"
                    : "border-border bg-background text-(--jeju-text-body) hover:border-primary hover:bg-(--jeju-surface-inset)",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                <span>
                  <span className="block font-extrabold">{item.label}</span>
                  <span className="block text-(length:--jeju-text-xs) font-normal text-muted-foreground">{item.description}</span>
                </span>
              </button>
            );
          })}
        </div>

        <form className="mt-5 space-y-4" onSubmit={submit} aria-label={selectedMode.label}>
          {mode === "search" ? (
            <div className="grid gap-4 md:grid-cols-[1fr_180px]">
              <Field label="법령명 또는 핵심어" hint="현행 법령을 먼저 찾고, 없으면 자치법규와 행정규칙까지 확인합니다.">
                <input className={FIELD_CLASS} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} maxLength={2000} placeholder="예: 의료·요양 등 지역 돌봄의 통합지원에 관한 법률" />
              </Field>
              <div className="flex items-end">
                <button className="min-h-11 w-full rounded-lg bg-primary px-4 py-2 font-extrabold text-primary-foreground hover:bg-(--jeju-primary-hover) disabled:cursor-not-allowed disabled:opacity-60" disabled={loading}>
                  {loading ? "조회 중…" : "법령 검색"}
                </button>
              </div>
            </div>
          ) : null}

          {mode === "text" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="법령 ID" hint="법령 검색 결과의 lawId. MST와 둘 중 하나만 입력해도 됩니다.">
                  <input className={FIELD_CLASS} value={lawId} onChange={(event) => setLawId(event.target.value)} maxLength={300} placeholder="예: 014121" />
                </Field>
                <Field label="MST" hint="법령 검색 결과의 법령 일련번호입니다.">
                  <input className={FIELD_CLASS} value={mst} onChange={(event) => setMst(event.target.value)} maxLength={300} placeholder="예: 269971" />
                </Field>
                <Field label="조문(선택)" hint="비워 두면 전문을 조회합니다. 예: 제12조 또는 12">
                  <input className={FIELD_CLASS} value={article} onChange={(event) => setArticle(event.target.value)} maxLength={100} placeholder="제12조" />
                </Field>
                <Field label="시행 기준일(선택)" hint="해당 날짜에 시행 중이던 버전을 조회합니다.">
                  <input type="date" className={FIELD_CLASS} value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} />
                </Field>
              </div>
              <button className="min-h-11 rounded-lg bg-primary px-5 py-2 font-extrabold text-primary-foreground hover:bg-(--jeju-primary-hover) disabled:opacity-60" disabled={loading}>{loading ? "조회 중…" : "조문 조회"}</button>
            </>
          ) : null}

          {mode === "annex" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="법령명" hint="별표·서식이 포함된 정확한 법령명을 입력해 주세요.">
                  <input className={FIELD_CLASS} value={annexLawName} onChange={(event) => setAnnexLawName(event.target.value)} maxLength={2000} placeholder="예: 노인장기요양보험법 시행규칙" />
                </Field>
                <Field label="별표·서식 검색어(선택)" hint="번호나 제목 일부를 입력하면 결과를 좁힙니다.">
                  <input className={FIELD_CLASS} value={annexQuery} onChange={(event) => setAnnexQuery(event.target.value)} maxLength={2000} placeholder="예: 장기요양인정조사표" />
                </Field>
                <Field label="관련 조문(선택)">
                  <input className={FIELD_CLASS} value={article} onChange={(event) => setArticle(event.target.value)} maxLength={100} placeholder="제8조" />
                </Field>
                <Field label="기준일(선택)">
                  <input type="date" className={FIELD_CLASS} value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} />
                </Field>
              </div>
              <button className="min-h-11 rounded-lg bg-primary px-5 py-2 font-extrabold text-primary-foreground hover:bg-(--jeju-primary-hover) disabled:opacity-60" disabled={loading}>{loading ? "조회 중…" : "별표·서식 조회"}</button>
            </>
          ) : null}

          {mode === "decision" ? (
            <>
              <div className="grid gap-4 md:grid-cols-[260px_1fr]">
                <Field label="자료 유형">
                  <select className={FIELD_CLASS} value={decisionDomain} onChange={(event) => setDecisionDomain(event.target.value)}>
                    {DECISION_DOMAINS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field label="검색어" hint="사건명, 법령명, 쟁점 또는 사건번호를 입력할 수 있습니다.">
                  <input className={FIELD_CLASS} value={decisionQuery} onChange={(event) => setDecisionQuery(event.target.value)} maxLength={2000} placeholder="예: 재가급여 장기요양" />
                </Field>
              </div>
              <button className="min-h-11 rounded-lg bg-primary px-5 py-2 font-extrabold text-primary-foreground hover:bg-(--jeju-primary-hover) disabled:opacity-60" disabled={loading}>{loading ? "조회 중…" : "판례·결정례 검색"}</button>
            </>
          ) : null}

          {mode === "research" ? (
            <>
              <div className="grid gap-4 md:grid-cols-[260px_1fr]">
                <Field label="조사 유형">
                  <select className={FIELD_CLASS} value={researchTask} onChange={(event) => setResearchTask(event.target.value)}>
                    {RESEARCH_TASKS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field label="법률 질문" hint="법령 체계, 지자체 권한, 처분 근거, 절차 또는 개정 경과를 구체적으로 적어 주세요.">
                  <textarea className={cn(FIELD_CLASS, "min-h-28 resize-y")} value={researchQuery} onChange={(event) => setResearchQuery(event.target.value)} maxLength={2000} />
                </Field>
              </div>
              <button className="min-h-11 rounded-lg bg-primary px-5 py-2 font-extrabold text-primary-foreground hover:bg-(--jeju-primary-hover) disabled:opacity-60" disabled={loading}>{loading ? "분석 중…" : "종합 리서치 실행"}</button>
            </>
          ) : null}

          {mode === "analysis" ? (
            <>
              <Field label="검증 유형">
                <select className={FIELD_CLASS} value={analysisMode} onChange={(event) => setAnalysisMode(event.target.value)}>
                  {ANALYSIS_MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              {analysisMode === "verify_citations" ? (
                <Field label="검증할 문서 또는 인용문" hint="개인정보를 제거한 뒤 입력하세요. 법령명·조문·판례 사건번호의 실존 여부를 확인합니다.">
                  <textarea className={cn(FIELD_CLASS, "min-h-40 resize-y")} value={analysisText} onChange={(event) => setAnalysisText(event.target.value)} maxLength={50000} placeholder="예: 의료·요양 등 지역 돌봄의 통합지원에 관한 법률 제12조에 따라…" />
                </Field>
              ) : null}
              {analysisMode === "cite_check" || analysisMode === "applicable_law" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="사건번호">
                    <input className={FIELD_CLASS} value={caseNumber} onChange={(event) => setCaseNumber(event.target.value)} maxLength={2000} placeholder="예: 2024두12345" />
                  </Field>
                  {analysisMode === "applicable_law" ? (
                    <Field label="사건 기준일">
                      <input type="date" className={FIELD_CLASS} value={analysisDate} onChange={(event) => setAnalysisDate(event.target.value)} />
                    </Field>
                  ) : <div />}
                </div>
              ) : null}
              {analysisMode === "impact_map" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="법령명">
                    <input className={FIELD_CLASS} value={analysisLawName} onChange={(event) => setAnalysisLawName(event.target.value)} maxLength={2000} />
                  </Field>
                  <Field label="조문">
                    <input className={FIELD_CLASS} value={analysisArticle} onChange={(event) => setAnalysisArticle(event.target.value)} maxLength={100} placeholder="제12조" />
                  </Field>
                </div>
              ) : null}
              <button className="min-h-11 rounded-lg bg-primary px-5 py-2 font-extrabold text-primary-foreground hover:bg-(--jeju-primary-hover) disabled:opacity-60" disabled={loading}>{loading ? "검증 중…" : "검증 실행"}</button>
            </>
          ) : null}

          {mode === "ordinance" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="조례명(선택)" hint="정확한 조례명을 알면 입력합니다.">
                  <input className={FIELD_CLASS} value={ordinanceName} onChange={(event) => setOrdinanceName(event.target.value)} maxLength={2000} placeholder="예: 서귀포시 지역돌봄 통합지원 조례" />
                </Field>
                <Field label="검색어(선택)" hint="조례명을 모를 때 지역명과 핵심어를 입력합니다.">
                  <input className={FIELD_CLASS} value={ordinanceQuery} onChange={(event) => setOrdinanceQuery(event.target.value)} maxLength={2000} placeholder="예: 제주 통합돌봄" />
                </Field>
              </div>
              <button className="min-h-11 rounded-lg bg-primary px-5 py-2 font-extrabold text-primary-foreground hover:bg-(--jeju-primary-hover) disabled:opacity-60" disabled={loading}>{loading ? "대조 중…" : "조례 정비 점검"}</button>
            </>
          ) : null}
        </form>
      </section>

      {status && !status.configured ? (
        <div className="rounded-xl border border-(--jeju-orange) bg-(--jeju-orange-tint) p-4 text-(length:--jeju-text-sm) leading-relaxed text-(--jeju-text-strong)" role="status">
          운영 서버의 <code className="rounded bg-background px-1.5 py-0.5 font-bold">LAW_OC</code> 비밀값이 설정되기 전에는 실제 조회가 실행되지 않습니다.
          코드와 화면은 설치되어 있으며 인증값 등록 후 즉시 사용할 수 있습니다.
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-44 items-center justify-center rounded-xl border border-border bg-card" role="status" aria-live="polite">
          <div className="text-center text-muted-foreground">
            <LoaderCircle className="mx-auto size-8 animate-spin text-primary" aria-hidden="true" />
            <p className="mt-3 font-bold">법제처 원문을 확인하고 있습니다.</p>
          </div>
        </div>
      ) : null}

      {!loading && result ? (
        <section className={cn("rounded-xl border bg-card p-4 sm:p-5", result.ok === false ? "border-destructive/50" : "border-border")} aria-labelledby="law-result-heading">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div>
              <h2 id="law-result-heading" className="text-(length:--jeju-h2-size) font-extrabold text-(--jeju-text-strong)">조회 결과</h2>
              <p className="text-(length:--jeju-text-sm) text-muted-foreground">
                {result.ok === false ? "오류 또는 확인 필요" : selectedMode.label} · korean-law-mcp v{result.package_version ?? status?.package_version ?? "4.15.6"}
              </p>
            </div>
            <button type="button" onClick={copyResult} disabled={!result.text} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-(length:--jeju-text-sm) font-bold hover:bg-muted disabled:opacity-50">
              {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              {copied ? "복사됨" : "결과 복사"}
            </button>
          </div>
          <pre className="mt-4 max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-(--jeju-surface-inset) p-4 font-sans text-(length:--jeju-text-sm) leading-7 text-(--jeju-text-body)">
            {result.text ?? result.message ?? "결과가 없습니다."}
          </pre>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-(length:--jeju-text-sm) text-muted-foreground">
            <p>업무 참고용입니다. 적용 시점·조문·별표는 공식 원문에서 최종 확인해 주세요.</p>
            <a href="https://www.law.go.kr" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-primary underline underline-offset-4">
              국가법령정보센터 원문 <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </div>
        </section>
      ) : null}
    </div>
  );
}
