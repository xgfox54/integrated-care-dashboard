// 원천 레코드를 연계별 조회 표(행정코드·장기요양기관·정부24·KOSIS)에 반영한다. 조회 표도 행을 지우지 않고 presence만 바꾼다.
import type { SqlDatabase, SqlStatement } from "../sql-database.ts";
import { kosisValue, type RecordInput } from "./adapters.ts";
import { contentLinkForLegal, isoDate, legalLevel, isLegalCode } from "./region-codes.ts";

const LEGAL_SOURCE = "공공데이터포털 행정안전부_행정표준코드_법정동코드(15077871)";
const LEGAL_URL = "https://www.data.go.kr/data/15077871/openapi.do";

const v = (record: RecordInput, field: string): string | null => record.payload[field] ?? null;

function telOf(record: RecordInput): string | null {
  const parts = [v(record, "locTelNo_1"), v(record, "locTelNo_2"), v(record, "locTelNo_3")].filter((part): part is string => Boolean(part));
  return parts.length === 3 ? parts.join("-") : null;
}

export async function projectPage(db: SqlDatabase, datasetKey: string, runId: string, records: readonly RecordInput[], now: number, context: { readonly sym?: string; readonly kosis?: { readonly orgId: string; readonly tblId: string } } = {}): Promise<void> {
  const statements: SqlStatement[] = [];
  const retrievedAt = new Date(now * 1000).toISOString();
  for (const record of records) {
    if (datasetKey === "mois.legal_dong") {
      const code = v(record, "region_cd") ?? "";
      const name = v(record, "locatadd_nm") ?? "";
      if (!isLegalCode(code) || !name) continue;
      const level = legalLevel(code, name);
      statements.push(db.prepare("INSERT INTO region_code (code_type, code, valid_from, valid_to, name, level, parent_code, validity_status, source_title, source_url, retrieved_at, note) VALUES ('LEGAL_DONG', ?, ?, NULL, ?, ?, ?, 'API_PRESENT', ?, ?, ?, ?) ON CONFLICT(code_type, code, valid_from) DO UPDATE SET name = excluded.name, level = excluded.level, parent_code = excluded.parent_code, validity_status = 'API_PRESENT', source_title = excluded.source_title, source_url = excluded.source_url, retrieved_at = excluded.retrieved_at, note = excluded.note")
        .bind(code, isoDate(v(record, "adpt_de")) ?? "", name, level, v(record, "locathigh_cd"), LEGAL_SOURCE, LEGAL_URL, retrievedAt, v(record, "locat_rm")));
      const link = level === "EMD" || level === "RI" ? null : contentLinkForLegal(code, name);
      if (link) {
        statements.push(db.prepare("INSERT INTO region_code_map (map_id, from_type, from_code, to_type, to_code, relation, valid_from, valid_to, status, basis, basis_url, note, created_at) VALUES (?, 'LEGAL_DONG', ?, 'CONTENT_REGION', ?, ?, ?, NULL, ?, 'API_NAME_RULE', ?, ?, ?) ON CONFLICT(map_id) DO UPDATE SET relation = excluded.relation, status = CASE WHEN region_code_map.reviewed_at IS NULL THEN excluded.status ELSE region_code_map.status END, note = excluded.note")
          .bind("api:" + code + "->" + link.regionId, code, link.regionId, link.relation, isoDate(v(record, "adpt_de")), link.status, LEGAL_URL, link.note, now));
      }
    } else if (datasetKey === "nhis.ltc_search") {
      const sym = v(record, "longTermAdminSym") ?? "";
      const pttn = v(record, "adminPttnCd") ?? "";
      const sido = v(record, "siDoCd");
      const sgg = v(record, "siGunGuCd");
      statements.push(db.prepare("INSERT INTO ltc_institution (admin_sym, admin_nm, sido_cd, sgg_cd, sigungu_code, designated_on, registered_on, presence, first_seen_at, last_seen_at, search_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'PRESENT', ?, ?, ?) ON CONFLICT(admin_sym) DO UPDATE SET admin_nm = excluded.admin_nm, sido_cd = excluded.sido_cd, sgg_cd = excluded.sgg_cd, sigungu_code = excluded.sigungu_code, designated_on = excluded.designated_on, registered_on = excluded.registered_on, presence = 'PRESENT', last_seen_at = excluded.last_seen_at, search_run_id = excluded.search_run_id")
        .bind(sym, v(record, "adminNm") ?? "", sido, sgg, record.regionCode ?? null, isoDate(v(record, "longTermPeribRgtDt")), isoDate(v(record, "stpRptDt")), now, now, runId));
      statements.push(db.prepare("INSERT INTO ltc_institution_service (admin_sym, admin_pttn_cd, presence, first_seen_at, last_seen_at) VALUES (?, ?, 'PRESENT', ?, ?) ON CONFLICT(admin_sym, admin_pttn_cd) DO UPDATE SET presence = 'PRESENT', last_seen_at = excluded.last_seen_at").bind(sym, pttn, now, now));
    } else if (datasetKey === "nhis.ltc_detail") {
      const sym = context.sym ?? "";
      if (record.recordId.endsWith(":general")) {
        statements.push(db.prepare("UPDATE ltc_institution SET legal_dong_code = ?, hdong_cd = ?, post_no = ?, detail_addr = ?, tel = ? WHERE admin_sym = ?")
          .bind(record.regionCode ?? null, v(record, "HDongCd"), v(record, "hmPostNo"), v(record, "detailAddr"), telOf(record), sym));
      } else {
        statements.push(db.prepare("INSERT INTO ltc_partner (admin_sym, partner_name, agreement_from, agreement_to, presence, first_seen_at, last_seen_at, run_id) VALUES (?, ?, ?, ?, 'PRESENT', ?, ?, ?) ON CONFLICT(admin_sym, partner_name, agreement_from) DO UPDATE SET agreement_to = excluded.agreement_to, presence = 'PRESENT', last_seen_at = excluded.last_seen_at, run_id = excluded.run_id")
          .bind(sym, v(record, "yoyangNm") ?? "", isoDate(v(record, "adptFrDt")) ?? (v(record, "adptFrDt") ?? ""), isoDate(v(record, "adptToDt")), now, now, runId));
      }
    } else if (datasetKey === "mois.gov24_list") {
      statements.push(db.prepare("INSERT INTO gov24_service (service_id, name, org_name, org_code, org_type, user_type, field, support_type, purpose, target, criteria, benefit, apply_method, apply_deadline, reception, contact, detail_url, registered_at, modified_at, presence, first_seen_at, last_seen_at, list_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PRESENT', ?, ?, ?) ON CONFLICT(service_id) DO UPDATE SET name = excluded.name, org_name = excluded.org_name, org_code = excluded.org_code, org_type = excluded.org_type, user_type = excluded.user_type, field = excluded.field, support_type = excluded.support_type, purpose = excluded.purpose, target = excluded.target, criteria = excluded.criteria, benefit = excluded.benefit, apply_method = excluded.apply_method, apply_deadline = excluded.apply_deadline, reception = excluded.reception, contact = excluded.contact, detail_url = excluded.detail_url, registered_at = excluded.registered_at, modified_at = excluded.modified_at, presence = 'PRESENT', last_seen_at = excluded.last_seen_at, list_run_id = excluded.list_run_id")
        .bind(record.recordId, v(record, "서비스명") ?? "", v(record, "소관기관명"), v(record, "소관기관코드"), v(record, "소관기관유형"), v(record, "사용자구분"), v(record, "서비스분야"), v(record, "지원유형"), v(record, "서비스목적요약"), v(record, "지원대상"), v(record, "선정기준"), v(record, "지원내용"), v(record, "신청방법"), v(record, "신청기한"), v(record, "접수기관"), v(record, "전화문의"), record.officialUrl ?? null, v(record, "등록일시"), v(record, "수정일시"), now, now, runId));
    } else if (datasetKey === "mois.gov24_detail") { // gitleaks:allow 데이터셋 이름
      // 재조회 기준은 목록의 수정일시다(상세 응답의 수정일시가 목록과 달라도 같은 서비스를 다시 부르지 않게).
      const serviceId = record.recordId.replace(/:detail$/, "");
      statements.push(db.prepare("UPDATE gov24_service SET purpose = COALESCE(?, purpose), target = COALESCE(?, target), criteria = COALESCE(?, criteria), benefit = COALESCE(?, benefit), apply_method = COALESCE(?, apply_method), apply_deadline = COALESCE(?, apply_deadline), required_documents = ?, reception = COALESCE(?, reception), contact = COALESCE(?, contact), online_url = ?, laws = ?, ordinances = ?, admin_rules = ?, detail_status = 'COLLECTED', detail_modified_at = COALESCE(modified_at, ''), detail_fetched_at = ? WHERE service_id = ?")
        .bind(v(record, "서비스목적"), v(record, "지원대상"), v(record, "선정기준"), v(record, "지원내용"), v(record, "신청방법"), v(record, "신청기한"), v(record, "구비서류"), v(record, "접수기관명"), v(record, "문의처"), v(record, "온라인신청사이트URL"), v(record, "법령"), v(record, "자치법규"), v(record, "행정규칙"), now, serviceId));
    } else if (datasetKey === "kosis.stats" && context.kosis) {
      const value = kosisValue(v(record, "DT"));
      statements.push(db.prepare("INSERT INTO kosis_observation (org_id, tbl_id, itm_id, region_code, region_name, class2, class2_name, period, value, value_status, unit, source_changed_on, run_id, collected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(org_id, tbl_id, itm_id, region_code, class2, period) DO UPDATE SET region_name = excluded.region_name, class2_name = excluded.class2_name, value = excluded.value, value_status = excluded.value_status, unit = excluded.unit, source_changed_on = excluded.source_changed_on, run_id = excluded.run_id, collected_at = excluded.collected_at")
        .bind(context.kosis.orgId, context.kosis.tblId, v(record, "ITM_ID") ?? "", v(record, "C1") ?? "", v(record, "C1_NM"), v(record, "C2") ?? "", v(record, "C2_NM"), v(record, "PRD_DE") ?? "", value.value, value.status, v(record, "UNIT_NM"), v(record, "LST_CHN_DE"), runId, now));
    }
  }
  for (let index = 0; index < statements.length; index += 200) await db.batch(statements.slice(index, index + 200));
}

/** 완전 수집 뒤 조회 표의 presence를 원천 레코드와 맞춘다. */
export async function projectNotSeen(db: SqlDatabase, datasetKey: string, scopeKey: string, startedAt: number): Promise<void> {
  if (datasetKey === "nhis.ltc_search" && scopeKey.startsWith("sido:")) {
    const sido = scopeKey.slice(5);
    await db.batch([
      db.prepare("UPDATE ltc_institution_service SET presence = 'NOT_SEEN' WHERE last_seen_at < ? AND admin_sym IN (SELECT admin_sym FROM ltc_institution WHERE sido_cd = ?)").bind(startedAt, sido),
      db.prepare("UPDATE ltc_institution SET presence = 'NOT_SEEN' WHERE sido_cd = ? AND last_seen_at < ?").bind(sido, startedAt),
    ]);
  } else if (datasetKey === "mois.gov24_list") {
    await db.prepare("UPDATE gov24_service SET presence = 'NOT_SEEN' WHERE last_seen_at < ?").bind(startedAt).run();
  } else if (datasetKey === "mois.legal_dong") {
    await db.prepare("UPDATE region_code SET validity_status = 'API_NOT_SEEN' WHERE code_type = 'LEGAL_DONG' AND validity_status = 'API_PRESENT' AND code IN (SELECT record_id FROM ext_record WHERE dataset_key = 'mois.legal_dong' AND presence = 'NOT_SEEN')").run();
  }
}

/** 한 기관의 협약기관 목록을 모두 받았을 때, 이번에 없는 협약 관계를 표시한다(종료일이 지난 것과 구분해 화면에 보인다). */
export async function partnersNotSeen(db: SqlDatabase, sym: string, startedAt: number): Promise<void> {
  await db.prepare("UPDATE ltc_partner SET presence = 'NOT_SEEN' WHERE admin_sym = ? AND last_seen_at < ?").bind(sym, startedAt).run();
}
