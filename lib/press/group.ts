// 관련 보도자료 묶음(작업지시서 v5 §23.10). 본문을 보관하지 않으므로 "같은 자료"로 확정하지 않고,
// 서로 다른 기관이 3일 안에 낸 정규화 제목이 같은 게시물만 관련 묶음(related)으로 잇는다. 개별 게시물·출처는 그대로 둔다.
import type { SqlDatabase } from "../sql-database.ts";

const LABEL_PREFIX = /^\s*(?:\[[^\]]{1,20}\]|【[^】]{1,20}】|<[^>]{1,20}>)\s*/;
const PUNCTUATION = /[\s"'“”‘’\x60.,·ㆍ…!?~\-–—_:;()[\]{}<>「」『』《》〈〉/\\|]+/g;
export const MIN_TITLE_KEY = 8;
export const GROUP_WINDOW_DAYS = 3;
export const GROUP_BASIS = "identical_normalized_title_within_3_days_different_publishers";

/** 앞머리 꼬리표([보도자료] 등)·문장부호·공백을 빼고 소문자로 맞춘 제목 열쇠. */
export function titleKey(title: string): string {
  let text = title.normalize("NFKC");
  for (let guard = 0; guard < 3 && LABEL_PREFIX.test(text); guard += 1) text = text.replace(LABEL_PREFIX, "");
  return text.toLowerCase().replace(PUNCTUATION, "");
}

/** 제목 열쇠가 비어 있는 게시물을 채우고, 묶일 짝을 찾아 같은 묶음 ID를 준다. 한 번에 정해진 개수만 처리한다. */
export async function assignRelatedGroups(db: SqlDatabase, limit = 200): Promise<{ readonly keyed: number; readonly linked: number }> {
  const missing = (await db.prepare("SELECT item_id, title FROM press_item WHERE title_key = '' LIMIT ?").bind(limit).all<{ item_id: string; title: string }>()).results;
  if (missing.length) {
    await db.batch(missing.map((row) => db.prepare("UPDATE press_item SET title_key = ? WHERE item_id = ?").bind(titleKey(row.title) || "-", row.item_id)));
  }
  const pairs = (await db.prepare(
    "SELECT a.item_id AS a_id, b.item_id AS b_id, a.related_group_id AS a_group, b.related_group_id AS b_group FROM press_item a JOIN press_item b " +
      "ON b.title_key = a.title_key AND b.item_id > a.item_id AND b.issued_by_org_id <> a.issued_by_org_id " +
      "WHERE length(a.title_key) >= ? AND a.published_date <> '' AND b.published_date <> '' " +
      "AND abs(julianday(a.published_date) - julianday(b.published_date)) <= ? " +
      "AND (a.related_group_id IS NULL OR b.related_group_id IS NULL OR a.related_group_id <> b.related_group_id) LIMIT ?",
  ).bind(MIN_TITLE_KEY, GROUP_WINDOW_DAYS, limit).all<{ a_id: string; b_id: string; a_group: string | null; b_group: string | null }>()).results;
  let linked = 0;
  for (const pair of pairs) {
    // 앞선 짝이 이미 묶음을 바꿨을 수 있으므로 지금 값을 다시 읽는다.
    const current = (await db.prepare("SELECT item_id, related_group_id FROM press_item WHERE item_id IN (?, ?)").bind(pair.a_id, pair.b_id).all<{ item_id: string; related_group_id: string | null }>()).results;
    const aGroup = current.find((row) => row.item_id === pair.a_id)?.related_group_id ?? null;
    const bGroup = current.find((row) => row.item_id === pair.b_id)?.related_group_id ?? null;
    if (aGroup && aGroup === bGroup) continue;
    const group = aGroup ?? bGroup ?? "rg:" + pair.a_id.slice(-24);
    const statements = [db.prepare("UPDATE press_item SET related_group_id = ? WHERE item_id IN (?, ?)").bind(group, pair.a_id, pair.b_id)];
    for (const other of [aGroup, bGroup]) {
      if (other && other !== group) statements.push(db.prepare("UPDATE press_item SET related_group_id = ? WHERE related_group_id = ?").bind(group, other));
    }
    await db.batch(statements);
    linked += 1;
  }
  return { keyed: missing.length, linked };
}

export interface PendingGroupMember {
  readonly related_group_id: string;
  readonly item_id: string;
  readonly title: string;
  readonly canonical_url: string;
  readonly published_date: string;
  readonly organization_name: string;
}

/** 확인 대기: 공개 구성원이 둘 이상이고 아직 같은 자료로 확정하거나 다른 자료로 판정하지 않은 관련 묶음. */
export async function readPendingRelatedGroups(db: SqlDatabase, limit = 20): Promise<PendingGroupMember[]> {
  return (await db.prepare(
    "SELECT i.related_group_id, i.item_id, i.title, i.canonical_url, i.published_date, o.name AS organization_name FROM press_item i JOIN press_source s ON s.source_id = i.source_id JOIN press_organization o ON o.organization_id = i.issued_by_org_id " +
      "WHERE i.related_group_id IN (SELECT g.related_group_id FROM press_item g JOIN press_source gs ON gs.source_id = g.source_id WHERE g.related_group_id IS NOT NULL AND g.public_status = 'PUBLIC' AND gs.approval_status = 'POLICY_APPROVED' AND gs.enabled = 1 " +
      "AND g.related_group_id NOT IN (SELECT related_group_id FROM press_duplicate_group) AND g.related_group_id NOT IN (SELECT related_group_id FROM press_related_review) GROUP BY g.related_group_id HAVING COUNT(*) >= 2 LIMIT ?) " +
      "AND i.public_status = 'PUBLIC' AND s.approval_status = 'POLICY_APPROVED' AND s.enabled = 1 ORDER BY i.related_group_id, i.published_date, i.item_id",
  ).bind(limit).all<PendingGroupMember>()).results;
}

/**
 * 관리자가 관련 묶음을 같은 보도자료로 확정한다(본문이 없어 지문 검증 대신 사람 확인). 원 발행 출처를 고르면 대표가 되고,
 * 고르지 않으면 이른 게시일 → ID 순으로 대표를 정한다. 개별 게시물·발행기관·Source는 그대로 둔다.
 */
export async function verifyDuplicateGroup(db: SqlDatabase, relatedGroupId: string, originalItemId: string | null, nowSeconds: number): Promise<string | null> {
  const members = (await db.prepare("SELECT item_id FROM press_item WHERE related_group_id = ? AND public_status = 'PUBLIC'").bind(relatedGroupId).all<{ item_id: string }>()).results.map((row) => row.item_id);
  if (members.length < 2) return null;
  if (originalItemId && !members.includes(originalItemId)) return null;
  const groupId = "dg:" + relatedGroupId.replace(/^rg:/, "");
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO press_duplicate_group (group_id, related_group_id, original_item_id, basis, verified_at) VALUES (?, ?, ?, 'reviewer_verified_same_release', ?)").bind(groupId, relatedGroupId, originalItemId, nowSeconds),
    db.prepare("UPDATE press_item SET duplicate_group_id = ? WHERE related_group_id = ? AND public_status = 'PUBLIC'").bind(groupId, relatedGroupId),
  ]);
  return groupId;
}

/** 제목만 같고 다른 자료(기관별 모집 공고 등)라고 판정한다. 묶음 확인 대기에서만 빠지고 관련 묶음 표시는 그대로 둔다. */
export async function rejectRelatedGroup(db: SqlDatabase, relatedGroupId: string, nowSeconds: number): Promise<void> {
  await db.prepare("INSERT OR REPLACE INTO press_related_review (related_group_id, decision, reviewed_at) VALUES (?, 'NOT_SAME_RELEASE', ?)").bind(relatedGroupId, nowSeconds).run();
}

