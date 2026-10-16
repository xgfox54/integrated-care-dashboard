// 기본 카드와 상세 근거의 선택 경로. 후보는 승인 문서·공식 서비스·사업카드만 받는다.
// 질문 숫자, 예산서, 보도자료는 자격·급여 근거로 승격하지 않는다.
import type { DocFactRow } from "../imports/public.ts";
import { gov24FieldYearEvidence, type Gov24Service } from "./gov24.ts";
import { canonicalProgramRegion } from "./regions.ts";

const clean = (value: unknown): string | null => typeof value === "string" && value.trim() && value.trim() !== "-" ? value.trim() : null;
const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
const comparable = (value: string): string => value.normalize("NFKC").replace(/[\s·ㆍ.,()[\]「」『』]/g, "").toLowerCase();
type Field = "application_conditions" | "selection_criteria" | "application_method" | "application_period" | "required_documents" | "reception" | "contact" | "benefit" | "exclusion" | "operating_period" | "procedure" | "provider";
type SourceKind = "APPROVED_DOCUMENT" | "GOV24_DETAIL" | "GOV24_LIST" | "PROGRAM_CARD";
type YearStatus = "MATCHED" | "YEAR_UNCONFIRMED" | "YEAR_MISMATCH" | "MULTIPLE_YEARS_REVIEW_REQUIRED" | "CONFLICTING_FIELD_SCOPE_YEARS" | "FIELD_YEAR_METADATA_MISSING";
type ProgramStatus = "MATCHED" | "VERIFIED_LINK" | "MATCHED_NAME" | "UNIQUE_INPUT_SUBJECT" | "PROGRAM_MISMATCH" | "PROGRAM_UNCONFIRMED";
type RegionStatus = "MATCHED" | "ANCESTOR_SCOPE" | "NATIONAL_SCOPE" | "UNSPECIFIED_REQUEST" | "REGION_MISMATCH" | "REGION_UNCONFIRMED";

interface Candidate {
  field: Field;
  value: string;
  evidence_id: string;
  source_kind: SourceKind;
  rank: number;
  year: number | null;
  explicit_reference_years: number[];
  year_status: YearStatus;
  year_basis: string;
  program_id: string | null;
  program_name: string | null;
  program_status: ProgramStatus;
  region_id: string | null;
  region_status: RegionStatus;
  scope_text: string | null;
  statement_ids: string[];
  parts: { value: string; unit: string | null; predicate_id: string; statement_id: string }[];
  internal_conflict: boolean;
  applicability_confirmed: boolean;
}

interface EvidenceInput {
  readonly base: { readonly application_conditions: string | null; readonly application_method: string | null; readonly conditions_basis: string | null };
  readonly documents: readonly DocFactRow[];
  readonly services: readonly Gov24Service[];
  readonly requestedYear?: number | null;
  readonly currentYear?: number;
  /** Current implementation/docprog/gov24 entity; verified links may use different IDs and names. */
  readonly subjectId?: string | null;
  readonly programName?: string | null;
  /** Requested scope; distinct from the original scope of the base card. */
  readonly regionId?: string | null;
  /** Allow province/national evidence for a narrower requested region. Defaults to true. */
  readonly includeAncestorScope?: boolean;
  /** Original base-card scope. Missing/null stays unconfirmed, never copied from the request. */
  readonly baseRegionId?: string | null;
  readonly verifiedServiceIds?: readonly string[];
}

const documentFields: Record<string, Field> = {
  target_group: "application_conditions", eligibility: "selection_criteria", exclusion: "exclusion",
  benefit_item: "benefit", benefit_amount: "benefit", operating_period: "operating_period",
  application_period: "application_period", application_method: "application_method", application_place: "reception",
  required_documents: "required_documents", procedure: "procedure", provider: "provider",
};
const serviceFields = {
  application_conditions: "target", selection_criteria: "criteria", application_method: "apply_method",
  application_period: "apply_deadline", required_documents: "required_documents", reception: "reception",
  contact: "contact", benefit: "benefit",
} as const;
const fieldLabels: Record<Field, string> = {
  application_conditions: "지원대상", selection_criteria: "선정기준", application_method: "신청방법",
  application_period: "신청기간", required_documents: "구비서류", reception: "접수기관", contact: "문의처",
  benefit: "지원내용", exclusion: "제외·예외", operating_period: "지원기간", procedure: "지원절차", provider: "담당기관",
};

function yearStatus(years: readonly number[], target: number): YearStatus {
  return years.length > 1 ? "MULTIPLE_YEARS_REVIEW_REQUIRED" : !years.length ? "YEAR_UNCONFIRMED" : years[0] === target ? "MATCHED" : "YEAR_MISMATCH";
}

function documentYear(row: DocFactRow, target: number) {
  const fieldYears = gov24FieldYearEvidence(row.value_text, target).explicit_reference_years;
  const scopeYears = gov24FieldYearEvidence(row.scope_text ?? "", target).explicit_reference_years;
  const titleYears = unique([
    ...gov24FieldYearEvidence(row.title, target).explicit_reference_years,
    // A document-title year may have a separator: "2026_사업안내". A bare numeric benefit is not a year.
    ...[...row.title.matchAll(/(?<!\d)((?:19|20)\d{2})(?=$|\s|[+_·.\-])/g)].map((match) => Number(match[1])),
  ]).sort();
  const scopeConflict = fieldYears.length > 0 && scopeYears.length > 0 && fieldYears.some((year) => !scopeYears.includes(year));
  const years = scopeConflict ? unique([...scopeYears, ...fieldYears]).sort() : fieldYears.length ? fieldYears : scopeYears.length ? scopeYears : titleYears;
  return {
    year: years.length === 1 ? years[0] : null,
    explicit_reference_years: years,
    year_status: scopeConflict ? "CONFLICTING_FIELD_SCOPE_YEARS" as const : yearStatus(years, target),
    year_basis: scopeConflict ? "FIELD_SCOPE_CONFLICT" : fieldYears.length ? "FIELD_TEXT" : scopeYears.length ? "STATEMENT_SCOPE" : titleYears.length ? "DOCUMENT_TITLE" : "UNCONFIRMED",
  };
}

function sourceRegion(sido: string, sigungu: string): string | null {
  if (sido === "전국") return "region:전국";
  if (!sido) return null;
  const normalized = canonicalProgramRegion(sido, sigungu);
  return "region:" + normalized.sido + (normalized.sigungu ? "|" + normalized.sigungu : "");
}

function regionStatus(source: string | null, requested: string | null, legacyProvince = false, includeAncestorScope = true): RegionStatus {
  if (!requested) return source ? "UNSPECIFIED_REQUEST" : "REGION_UNCONFIRMED";
  if (!source) return "REGION_UNCONFIRMED";
  if (source === requested && !legacyProvince) return "MATCHED";
  if (source === "region:전국") return includeAncestorScope ? "NATIONAL_SCOPE" : "REGION_MISMATCH";
  if (!legacyProvince && requested.startsWith(source + "|")) return includeAncestorScope ? "ANCESTOR_SCOPE" : "REGION_MISMATCH";
  // Province-wide or national requests do not turn a municipality's particular rules into common rules.
  return "REGION_MISMATCH";
}

function documentProgramStatus(row: DocFactRow, input: EvidenceInput, subjects: readonly string[]): ProgramStatus {
  if (input.subjectId) return input.subjectId === row.subject_id ? "MATCHED" : "PROGRAM_MISMATCH";
  if (input.programName) return comparable(input.programName) === comparable(row.subject_label) ? "MATCHED_NAME" : "PROGRAM_MISMATCH";
  return subjects.length === 1 ? "UNIQUE_INPUT_SUBJECT" : "PROGRAM_UNCONFIRMED";
}

function serviceProgramStatus(service: Gov24Service, input: EvidenceInput, inferredName: string | null): ProgramStatus {
  if (input.subjectId === service.id) return "MATCHED";
  if (input.verifiedServiceIds?.includes(service.id) || input.verifiedServiceIds?.includes(service.service_id)) return "VERIFIED_LINK";
  const name = input.programName ?? inferredName;
  if (name) return comparable(name) === comparable(service.name) ? "MATCHED_NAME" : "PROGRAM_MISMATCH";
  return !input.subjectId && input.services.length === 1 && !input.documents.length ? "UNIQUE_INPUT_SUBJECT" : "PROGRAM_UNCONFIRMED";
}

const programApplies = (status: ProgramStatus): boolean => status !== "PROGRAM_MISMATCH" && status !== "PROGRAM_UNCONFIRMED";
const regionApplies = (status: RegionStatus): boolean => status !== "REGION_MISMATCH" && status !== "REGION_UNCONFIRMED";
const containsAmount = (candidate: Candidate): boolean => candidate.parts.some((part) => part.predicate_id === "benefit_amount")
  || /[\d,.]+\s*(?:(?:억|만|천|백|십)\s*)*원|[일이삼사오육칠팔구십백천만억]+\s*원|(?:지원금|급여액|본인부담금|한도금액|소득금액)[^\n]*\d|단위\s*[:：]?\s*(?:백만|천|만)?원/.test(candidate.value);

/** Same-source amount rows with the same dimensions and different values need review, not concatenation. */
function amountConflict(parts: readonly Candidate["parts"][number][]): boolean {
  const slots = new Map<string, string>();
  for (const part of parts) {
    if (part.predicate_id !== "benefit_amount") continue;
    const amountless = comparable(part.value.replace(/[\d,.]+\s*(?:(?:억|만|천|백|십)\s*)*원/g, "<금액>").replace(/^\s*[\d,.]+\s*$/, "<금액>"));
    const key = amountless + "|" + comparable(part.unit ?? "");
    const value = comparable(part.value);
    const previous = slots.get(key);
    if (previous !== undefined && previous !== value) return true;
    slots.set(key, value);
  }
  return false;
}

function validDocument(row: DocFactRow): boolean {
  // The loader exposes only approved active document facts. Reject explicitly incompatible inputs as well.
  const metadata = row as DocFactRow & { source_kind?: string; assertion_type?: string; review_status?: string };
  if (!row.subject_id?.startsWith("service:") && !row.subject_id?.startsWith("docprog:") && !row.subject_id?.startsWith("gov24_service:")) return false;
  if (!clean(row.source_version_id) || !clean(row.source_id) || !clean(row.reviewed_at)) return false;
  if (metadata.source_kind && !["PUBLIC_NOTICE", "PROGRAM_GUIDE", "ORDINANCE", "FORM"].includes(metadata.source_kind)) return false;
  if (metadata.assertion_type && metadata.assertion_type !== "document_field") return false;
  if (metadata.review_status && metadata.review_status !== "approved") return false;
  return true;
}

export function resolveProgramEvidence(input: EvidenceInput) {
  const requested = input.requestedYear ?? null;
  const current = input.currentYear ?? new Date(Date.now() + 9 * 3600000).getUTCFullYear();
  const targetYear = requested ?? current;
  const documents = input.documents.filter(validDocument);
  const subjects = unique(documents.map((row) => row.subject_id));
  const names = unique([...documents.map((row) => row.subject_label), ...input.services.map((service) => service.name)].map((value) => clean(value)).filter((value): value is string => Boolean(value)));
  const inferredName = names.length === 1 ? names[0] : null;
  const documentRegions = unique(documents.map((row) => sourceRegion(row.subject_sido, row.subject_sigungu)).filter((value): value is string => Boolean(value)));
  const requestedRegion = input.regionId ?? (subjects.length === 1 && documentRegions.length === 1 ? documentRegions[0] : null);
  const includeAncestorScope = input.includeAncestorScope ?? true;
  const baseRegion = input.baseRegionId ?? null;
  const candidates: Candidate[] = [];
  const sourceGroups = new Map<string, { candidate: Candidate; rows: DocFactRow[] }>();
  for (const row of documents) {
    const field = documentFields[row.predicate_id];
    const value = clean(row.value_text);
    if (!field || !value) continue;
    const year = documentYear(row, targetYear);
    const region = sourceRegion(row.subject_sido, row.subject_sigungu);
    // A free-text scope is part of the grouping identity, including table row dimensions and exceptions.
    const key = JSON.stringify([field, row.import_id, row.source_id, row.source_version_id, row.subject_id, region, comparable(row.scope_text ?? ""), year.explicit_reference_years, year.year_status]);
    let group = sourceGroups.get(key);
    if (!group) {
      const pStatus = documentProgramStatus(row, input, subjects);
      const rStatus = regionStatus(region, requestedRegion, false, includeAncestorScope);
      group = { candidate: {
        field, value: "", evidence_id: "doc:" + row.source_version_id, source_kind: "APPROVED_DOCUMENT", rank: 10,
        ...year, program_id: row.subject_id, program_name: row.subject_label, program_status: pStatus,
        region_id: region, region_status: rStatus, scope_text: clean(row.scope_text), statement_ids: [], parts: [],
        internal_conflict: false, applicability_confirmed: programApplies(pStatus) && regionApplies(rStatus) && year.year_status === "MATCHED",
      }, rows: [] };
      sourceGroups.set(key, group);
    }
    group.rows.push(row);
  }
  for (const { candidate, rows } of sourceGroups.values()) {
    rows.sort((a, b) => (a.document_order ?? Number.MAX_SAFE_INTEGER) - (b.document_order ?? Number.MAX_SAFE_INTEGER) || a.statement_id.localeCompare(b.statement_id));
    candidate.parts = rows.map((row) => ({ value: row.value_text.trim(), unit: clean(row.unit), predicate_id: row.predicate_id, statement_id: row.statement_id }));
    candidate.statement_ids = unique(rows.map((row) => row.statement_id));
    candidate.value = unique(candidate.parts.map((part) => part.value + (part.unit && !part.value.includes(part.unit) ? " (단위: " + part.unit + ")" : ""))).join("\n");
    candidate.internal_conflict = amountConflict(candidate.parts);
    candidates.push(candidate);
  }
  for (const service of input.services) {
    if (service.presence !== "PRESENT" || !["GOV24_SERVICE_DETAIL", "GOV24_SERVICE_LIST"].includes(service.source.kind)) continue;
    const pStatus = serviceProgramStatus(service, input, inferredName);
    const rStatus = regionStatus(service.publisher_scope.region_id, requestedRegion, service.publisher_scope.level === "legacy_province", includeAncestorScope);
    for (const [field, property] of Object.entries(serviceFields) as [keyof typeof serviceFields, (typeof serviceFields)[keyof typeof serviceFields]][]) {
      const value = clean(service[property]);
      if (!value || /^(?:직접입력|직접 입력)$/.test(value)) continue;
      // Missing field metadata cannot inherit an application-deadline year or service-wide summary year.
      const metadata = service.field_year_evidence?.[property];
      const years = metadata ? unique(metadata.explicit_reference_years).sort() : [];
      const status: YearStatus = metadata ? yearStatus(years, targetYear) : "FIELD_YEAR_METADATA_MISSING";
      const detail = service.detail_status === "COLLECTED";
      candidates.push({
        field, value, evidence_id: service.source.evidence_id, source_kind: detail ? "GOV24_DETAIL" : "GOV24_LIST", rank: detail ? 20 : 30,
        year: years.length === 1 ? years[0] : null, explicit_reference_years: years, year_status: status, year_basis: "FIELD_YEAR_EVIDENCE:" + property,
        program_id: service.id, program_name: service.name, program_status: pStatus, region_id: service.publisher_scope.region_id,
        region_status: rStatus, scope_text: null, statement_ids: [], parts: [], internal_conflict: false,
        applicability_confirmed: programApplies(pStatus) && regionApplies(rStatus) && status === "MATCHED",
      });
    }
  }
  const baseIsPermitted = !/user[_ -]?(?:input|query)|question|budget|fiscal|press|news|예산|보도자료|뉴스|사용자\s*(?:질문|입력)/i.test(input.base.conditions_basis ?? "");
  if (baseIsPermitted) for (const field of ["application_conditions", "application_method"] as const) {
    const value = clean(input.base[field]);
    if (!value) continue;
    candidates.push({ field, value, evidence_id: "program_card", source_kind: "PROGRAM_CARD", rank: 40,
      year: null, explicit_reference_years: [], year_status: "YEAR_UNCONFIRMED", year_basis: "UNCONFIRMED",
      program_id: input.subjectId ?? null, program_name: input.programName ?? inferredName, program_status: "UNIQUE_INPUT_SUBJECT",
      region_id: baseRegion, region_status: regionStatus(baseRegion, requestedRegion, false, includeAncestorScope), scope_text: null,
      statement_ids: [], parts: [], internal_conflict: false, applicability_confirmed: false,
    });
  }
  const selected: Partial<Record<Field, string | null>> = {};
  const resolution: {
    field: Field; status: string; evidence_id: string | null; source_kind: SourceKind | null; year: number | null;
    year_status: string; selected: Candidate | null; pending_candidate: Candidate | null; pending_candidates: Candidate[];
    final_authority: boolean; alternatives: Candidate[];
  }[] = [];
  const conflicts: { field: Field; selected_source: string | null; resolution: string; evidence_ids: string[] }[] = [];
  for (const field of Object.keys(fieldLabels) as Field[]) {
    const own = candidates.filter((candidate) => candidate.field === field);
    const inScope = own.filter((candidate) => programApplies(candidate.program_status) && regionApplies(candidate.region_status));
    const eligible = inScope.filter((candidate) => candidate.year_status === "MATCHED" || requested === null && candidate.year_status === "YEAR_UNCONFIRMED" && !containsAmount(candidate))
      .sort((a, b) => Number(b.year_status === "MATCHED") - Number(a.year_status === "MATCHED") || a.rank - b.rank || a.evidence_id.localeCompare(b.evidence_id));
    const best = eligible[0];
    const tied = best ? eligible.filter((candidate) => candidate.rank === best.rank && candidate.year_status === best.year_status) : [];
    const distinct = new Set(tied.map((candidate) => comparable(candidate.value)));
    // Different scopes must not be coalesced, even if their source ID happens to be the same.
    const distinctScopes = new Set(tied.map((candidate) => comparable(candidate.scope_text ?? "")));
    const unresolved = tied.some((candidate) => candidate.internal_conflict) || distinct.size > 1 || distinctScopes.size > 1;
    const chosen = best && !unresolved ? best : null;
    selected[field] = chosen?.value ?? null;
    const pending = chosen?.year_status === "MATCHED" ? [] : inScope.filter((candidate) => candidate.year_status === "YEAR_UNCONFIRMED" || candidate.year_status === "FIELD_YEAR_METADATA_MISSING" || unresolved && tied.includes(candidate)).sort((a, b) => a.rank - b.rank);
    const status = unresolved ? "UNRESOLVED_CONFLICT" : chosen ? chosen.year_status === "MATCHED" ? "SELECTED" : "SELECTED_YEAR_UNCONFIRMED" : own.length ? "APPLICABILITY_UNCONFIRMED" : "EVIDENCE_MISSING";
    resolution.push({ field, status, evidence_id: chosen?.evidence_id ?? null, source_kind: chosen?.source_kind ?? null, year: chosen?.year ?? null,
      year_status: chosen?.year_status ?? (own.length ? "NOT_SELECTED" : "UNKNOWN"), selected: chosen,
      pending_candidate: pending[0] ?? null, pending_candidates: pending, final_authority: chosen?.applicability_confirmed ?? false, alternatives: own });
    if (unresolved) conflicts.push({ field, selected_source: null, resolution: "REVIEW_REQUIRED", evidence_ids: unique(tied.map((candidate) => candidate.evidence_id)) });
    else if (chosen && own.some((candidate) => comparable(candidate.value) !== comparable(chosen.value))) conflicts.push({ field, selected_source: chosen.evidence_id, resolution: "MORE_APPLICABLE_OR_DETAILED_SOURCE_SELECTED", evidence_ids: unique(own.map((candidate) => candidate.evidence_id)) });
  }
  const target = resolution.find((item) => item.field === "application_conditions");
  const unknowns = resolution.filter((item) => !selected[item.field] || !item.final_authority).map((item) => fieldLabels[item.field] + ": " + (
    item.status === "UNRESOLVED_CONFLICT" ? "같은 우선순위의 근거가 충돌하여 확정하지 않았습니다."
      : item.status === "SELECTED_YEAR_UNCONFIRMED" ? "원문 설명은 제공하지만 적용연도는 확인되지 않았습니다."
        : item.status === "APPLICABILITY_UNCONFIRMED" ? "요청 사업·지역·연도에 적용되는 근거를 확인하지 못했습니다."
          : "현재 수록된 근거로 확인되지 않았습니다."));
  const selectedCount = resolution.filter((item) => item.selected).length;
  const confirmedCount = resolution.filter((item) => item.final_authority).length;
  const missingCount = resolution.filter((item) => item.status === "EVIDENCE_MISSING").length;
  const hasOfficialCandidates = candidates.some((candidate) => candidate.source_kind !== "PROGRAM_CARD");
  const overallStatus = conflicts.some((item) => item.resolution === "REVIEW_REQUIRED") ? "REVIEW_REQUIRED"
    : !candidates.length ? "EVIDENCE_MISSING" : !selectedCount ? "APPLICABILITY_UNCONFIRMED"
      : !hasOfficialCandidates ? "SUMMARY_ONLY" : "PARTIAL_EVIDENCE";
  return {
    eligibility: {
      application_conditions: selected.application_conditions ?? null, selection_criteria: selected.selection_criteria ?? null,
      conditions_basis: target?.source_kind === "PROGRAM_CARD" ? input.base.conditions_basis : target?.source_kind ?? null,
      application_method: selected.application_method ?? null, application_period: selected.application_period ?? null,
      required_documents: selected.required_documents ?? null, reception: selected.reception ?? null, contact: selected.contact ?? null,
      exceptions: selected.exclusion ? [selected.exclusion] : [], operating_period: selected.operating_period ?? null,
      procedure: selected.procedure ?? null, provider: selected.provider ?? null, unknowns, personal_determination: false,
    },
    benefit: selected.benefit ?? null,
    evidence_resolution: {
      policy: "same_program_and_scope_then_effective_year_then_approved_document_gov24_detail_gov24_list_program_card",
      requested_year: requested, current_year: current, effective_target_year: targetYear, requested_region_id: requestedRegion,
      include_ancestor_scope: includeAncestorScope, base_region_id: baseRegion,
      subject_id: input.subjectId ?? null, program_name: input.programName ?? inferredName, fields: resolution, conflicts,
      status: overallStatus, selected_field_count: selectedCount, confirmed_field_count: confirmedCount, missing_field_count: missingCount,
      complete: false, human_review: "PENDING", no_personal_determination: true,
    },
    warnings: [
      ...(conflicts.length ? ["출처별 차이를 evidence_resolution에 기록했습니다. 선택 근거와 미해결 충돌을 확인하세요."] : []),
      ...(resolution.some((item) => item.status === "SELECTED_YEAR_UNCONFIRMED") ? ["연도 미지정 조회에서 제공한 일부 원문 설명은 적용연도가 미확인입니다. 수정일을 시행연도로 간주하거나 자격을 확정하지 마세요."] : []),
      ...(resolution.some((item) => item.pending_candidates.length && !item.selected) ? ["적용연도가 확인되지 않은 근거는 pending_candidate로 남겼습니다. 요청 연도의 확정 근거로 사용하지 마세요."] : []),
      ...(input.documents.length !== documents.length ? ["승인 문서 사실로 확인되지 않은 입력은 자격·금액 근거 후보에서 제외했습니다."] : []),
    ],
  };
}
