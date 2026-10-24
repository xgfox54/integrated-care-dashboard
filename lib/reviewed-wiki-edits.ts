import type { SqlDatabase } from "./sql-database";

// 제보를 받아 공식자료와 대조한 사업 정보 보완. 관리자 위키 편집과 같은 표(wiki_edit)에 한 번만 기록한다.
// 기록 표시(app_setting)를 함께 남기므로 관리자가 나중에 고치거나 지운 값은 다시 덮어쓰지 않는다.
export interface ReviewedWikiEdit {
  readonly key: string;
  readonly serviceId: string;
  readonly sido: string;
  readonly sigungu: string;
  readonly name: string;
  readonly provider: string;
  readonly sourceTitle: string;
  readonly sourceUrl: string;
  readonly note: string;
}

export const REVIEWED_WIKI_EDITS: readonly ReviewedWikiEdit[] = [
  {
    key: "reviewed-wiki-edit:gangneung-home-care-provider-20261021",
    serviceId: "0083:1489622:1:1:2",
    sido: "강원특별자치도",
    sigungu: "강릉시",
    name: "재택의료센터",
    provider: "강릉의료원",
    sourceTitle: "보건복지부 보도자료 「장기요양 재택의료센터, 전국 195개소로 확대」(2025.7.)",
    sourceUrl: "https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&list_no=1486793&act=view",
    note:
      "2026-10-21 강릉의료원 재택의료센터 제보 반영. 보건복지부 강릉시 통합돌봄 서비스 메뉴판(2026.4.) 원문의 제공기관 표기는 '의료기관 보건소'임. " +
      "보건복지부 2025년 7월 보도자료의 재택의료센터 참여 지방의료원 명단에서 강릉시 신규 지정 기관 강릉의료원 확인. " +
      "강릉의료원 누리집 공공의료사업 안내(https://www.gnmc.or.kr/page/s0602e.php, 장기요양재택의료센터 시범사업, 문의 재택의료팀 033-610-1492)와 대조함.",
  },
];

export async function applyReviewedWikiEdits(
  db: SqlDatabase,
  nowSeconds = Math.floor(Date.now() / 1000),
  edits: readonly ReviewedWikiEdit[] = REVIEWED_WIKI_EDITS,
): Promise<number> {
  if (edits.length === 0) return 0;
  const applied = await db
    .prepare(`SELECT key FROM app_setting WHERE key IN (${edits.map(() => "?").join(", ")})`)
    .bind(...edits.map((edit) => edit.key))
    .all<{ readonly key: string }>();
  const done = new Set(applied.results.map((row) => row.key));
  const pending = edits.filter((edit) => !done.has(edit.key));
  if (pending.length === 0) return 0;
  await db.batch(pending.flatMap((edit) => [
    db.prepare(
      "INSERT INTO wiki_edit (service_id, sido, sigungu, name, provider, source_title, source_url, note, updated_at) " +
        "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM app_setting WHERE key = ?) " +
        "ON CONFLICT(service_id) DO NOTHING",
    ).bind(edit.serviceId, edit.sido, edit.sigungu, edit.name, edit.provider, edit.sourceTitle, edit.sourceUrl, edit.note, nowSeconds, edit.key),
    db.prepare("INSERT OR IGNORE INTO app_setting (key, value, updated_at) VALUES (?, ?, ?)").bind(edit.key, edit.serviceId, nowSeconds),
  ]));
  return pending.length;
}
