// 목록이 긴 제목을 "…"로 줄여 보여 주는 게시판(창녕군 뉴스 첫 화면, 대구 남구, 새올 등)의 제목을 원문 화면에서 보완한다(운영자 요청 2026-10-09).
// 원문에서는 줄인 제목으로 시작하는 더 긴 글자 한 줄만 꺼낸다. 본문·담당자는 읽거나 저장하지 않는다.
import { sha256Hex } from "./normalize.ts";
import { cleanText } from "./rss.ts";
import type { SqlDatabase } from "../sql-database.ts";
import { isExcludedPressTitle, withdrawExcludedPressItems } from "./title-exclusions.ts";

export const TRUNCATED_TITLE = /(?:\.{2,}|…|⋯)\s*$/;
/** 한 원문에서 제목을 찾지 못하면 이만큼만 다시 시도한다. */
export const MAX_TITLE_ATTEMPTS = 3;
const RETRY_SECONDS = 6 * 60 * 60;
const MAX_TITLE_CHARS = 300;
const MIN_PREFIX_CHARS = 6;

export function isTruncatedTitle(title: string): boolean {
  return TRUNCATED_TITLE.test(title);
}

const compact = (value: string): string => value.replace(/\s+/g, "");

function prefixOf(title: string): string {
  return title.replace(TRUNCATED_TITLE, "").trim();
}

/** 저장된 전체 제목이 줄인 제목을 이어 쓴 것인지. 같은 글을 다시 수집할 때 줄인 제목으로 되돌리지 않기 위해 쓴다. */
export function completesTitle(full: string, truncated: string): boolean {
  const prefix = compact(prefixOf(truncated));
  const whole = compact(full);
  return prefix.length >= MIN_PREFIX_CHARS && whole.length > prefix.length && whole.startsWith(prefix) && !isTruncatedTitle(full);
}

/**
 * 원문 화면에서 줄인 제목으로 시작하는 가장 짧은 전체 제목을 찾는다. 후보는 태그 사이 글자, title·value·content 속성,
 * 그리고 <title>의 "제목 | 기관명"에서 앞부분이다. 찾지 못하면 null.
 */
export function extractFullTitle(html: string, truncated: string): string | null {
  if (compact(prefixOf(truncated)).length < MIN_PREFIX_CHARS) return null;
  const raw: string[] = [];
  for (const match of html.matchAll(/>([^<>]{6,600})</g)) raw.push(match[1] ?? "");
  for (const match of html.matchAll(/\b(?:title|value|content)\s*=\s*(?:"([^"]{6,600})"|'([^']{6,600})')/gi)) raw.push(match[1] ?? match[2] ?? "");
  const candidates = raw.flatMap((value) => {
    const text = cleanText(value);
    const head = text.split(/\s[|<>:–-]\s/)[0] ?? text;
    return head === text ? [text] : [text, head.trim()];
  });
  const found = candidates.filter((text) => text.length <= MAX_TITLE_CHARS && completesTitle(text, truncated)).sort((left, right) => left.length - right.length);
  return found[0] ?? null;
}

export interface TruncatedItem {
  readonly item_id: string;
  readonly canonical_url: string;
  readonly title: string;
}

/** 이 Source에서 제목 끝이 줄임표인 글(시도 한도 안, 최근에 시도하지 않은 글). 최신 글부터. */
export async function readTruncatedItems(db: SqlDatabase, sourceId: string, limit: number, nowSeconds: number): Promise<TruncatedItem[]> {
  const result = await db.prepare(
    "SELECT i.item_id, i.canonical_url, i.title FROM press_item i LEFT JOIN press_title_fix f ON f.item_id = i.item_id " +
      "WHERE i.source_id = ? AND (i.title LIKE '%..' OR i.title LIKE '%…' OR i.title LIKE '%⋯') AND i.public_status <> 'WITHDRAWN' " +
      "AND COALESCE(f.attempts, 0) < ? AND COALESCE(f.last_at, 0) <= ? ORDER BY i.discovered_at DESC, i.item_id LIMIT ?",
  ).bind(sourceId, MAX_TITLE_ATTEMPTS, nowSeconds - RETRY_SECONDS, limit).all<TruncatedItem>();
  return result.results.filter((item) => isTruncatedTitle(item.title));
}

/** 다시 수집한 목록의 줄인 제목이 저장된 전체 제목을 덮지 않도록, 저장 제목을 읽는다. */
export async function readStoredTitles(db: SqlDatabase, itemIds: readonly string[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  for (let start = 0; start < itemIds.length; start += 50) {
    const chunk = itemIds.slice(start, start + 50);
    const rows = await db.prepare("SELECT item_id, title FROM press_item WHERE item_id IN (" + chunk.map(() => "?").join(", ") + ")").bind(...chunk).all<{ item_id: string; title: string }>();
    for (const row of rows.results) titles.set(row.item_id, row.title);
  }
  return titles;
}

/** 원문에서 찾은 전체 제목을 저장한다. 그 사이 제목이 바뀌었으면 건드리지 않는다. 찾지 못했으면 시도 횟수만 올린다. */
export async function recordTitleAttempt(db: SqlDatabase, item: TruncatedItem, full: string | null, nowSeconds: number): Promise<void> {
  const mark = db.prepare(
    "INSERT INTO press_title_fix (item_id, attempts, last_at, status) VALUES (?, 1, ?, ?) " +
      "ON CONFLICT(item_id) DO UPDATE SET attempts = press_title_fix.attempts + 1, last_at = excluded.last_at, status = excluded.status",
  ).bind(item.item_id, nowSeconds, full ? "COMPLETED" : "NOT_FOUND");
  if (!full) {
    await mark.run();
    return;
  }
  await db.batch([
    db.prepare("UPDATE press_item SET title = ?, title_hash = ?, title_version = title_version + 1 WHERE item_id = ? AND title = ?")
      .bind(full, (await sha256Hex(full)).slice(0, 32), item.item_id, item.title),
    mark,
  ]);
  if (isExcludedPressTitle(full)) await withdrawExcludedPressItems(db, nowSeconds);
}

