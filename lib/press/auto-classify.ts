import type { SqlDatabase } from "../sql-database.ts";
import { classifyTitle } from "./classify.ts";
import { AGENCY_WORDS, DICTIONARY_VERSION, PRESS_CATEGORIES } from "./dictionary.ts";

// 보도자료 복지·비복지 자동분류(운영자 요청 2026-10-06).
// 1) 제목 규칙(classify.ts)이 사전 버전이 바뀐 항목을 다시 분류한다(관리자 확정·학습 판정은 건드리지 않는다).
// 2) 규칙으로 정하지 못한 NEEDS_REVIEW 항목은 제목 글자 묶음(2글자)으로 학습한 판정(나이브 베이즈)이 본다.
//    학습 자료: 관리자가 확정한 항목(가중 5) + 제목 규칙으로 확정된 항목(가중 1). 학습 판정 결과는 다시 학습에 넣지 않는다.
//    확신(로그 승산)이 충분할 때만 확정하고(근거 auto_model, 점수 auto_score), 나머지는 추천값만 남겨 사람이 본다.
// 본문은 읽지 않는다. 관리자는 학습 판정 결과를 언제든 다시 확정할 수 있다(admin.ts reviewPressClassification).

export const AUTO_DECIDE_LOG_ODDS = 4;
const REVIEWER_WEIGHT = 5;
const MIN_TRAINING = 50;

export interface TitleModel {
  readonly counts: { readonly welfare: ReadonlyMap<string, number>; readonly other: ReadonlyMap<string, number> };
  readonly totals: { readonly welfare: number; readonly other: number };
  readonly docs: { readonly welfare: number; readonly other: number };
  readonly vocabulary: number;
  readonly signature: string;
}

/** 제목을 글자 2개 묶음과 2글자 이상 낱말로 나눈다. 기관 이름의 '복지'는 지운다. */
export function titleFeatures(title: string): string[] {
  const text = AGENCY_WORDS.reduce((value, word) => value.split(word).join(" "), title.toLowerCase()).replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  const words = text.split(/[^0-9a-z가-힣]+/).filter((word) => word.length >= 2);
  const grams: string[] = [];
  for (const word of words) for (let index = 0; index + 2 <= word.length; index += 1) grams.push(word.slice(index, index + 2));
  return [...new Set([...words.map((word) => "w:" + word), ...grams])];
}

export interface TrainingRow { readonly title: string; readonly welfare: boolean; readonly weight: number }

export function trainTitleModel(rows: readonly TrainingRow[], signature: string): TitleModel {
  const welfare = new Map<string, number>();
  const other = new Map<string, number>();
  const totals = { welfare: 0, other: 0 };
  const docs = { welfare: 0, other: 0 };
  const vocabulary = new Set<string>();
  for (const row of rows) {
    const target = row.welfare ? welfare : other;
    for (const feature of titleFeatures(row.title)) {
      target.set(feature, (target.get(feature) ?? 0) + row.weight);
      vocabulary.add(feature);
      if (row.welfare) totals.welfare += row.weight;
      else totals.other += row.weight;
    }
    if (row.welfare) docs.welfare += row.weight;
    else docs.other += row.weight;
  }
  return { counts: { welfare, other }, totals, docs, vocabulary: vocabulary.size, signature };
}

/** 복지일 로그 승산(양수면 복지 쪽). 학습 자료에 없던 글자 묶음은 무시한다. */
export function welfareLogOdds(model: TitleModel, title: string): number {
  let score = Math.log((model.docs.welfare + 1) / (model.docs.other + 1));
  const v = model.vocabulary + 1;
  for (const feature of titleFeatures(title)) {
    const w = model.counts.welfare.get(feature) ?? 0;
    const o = model.counts.other.get(feature) ?? 0;
    if (w === 0 && o === 0) continue;
    score += Math.log((w + 1) / (model.totals.welfare + v)) - Math.log((o + 1) / (model.totals.other + v));
  }
  return score;
}

/** 로그 승산을 0~100 복지 확률(%)로. 화면 추천 표시용. */
export function welfarePercent(logOdds: number): number {
  return Math.round(100 / (1 + Math.exp(-logOdds)));
}

const TRAINING_WHERE = "classification_status IN ('WELFARE', 'NON_WELFARE') AND classification_basis IN ('reviewer', 'title_rule')";

/** 학습 자료 수로 만든 학습 상태 표시. 자료가 늘거나 사전이 바뀌면 달라져 보류 항목을 다시 본다. */
async function modelSignature(db: SqlDatabase): Promise<{ readonly signature: string; readonly rows: number }> {
  const row = await db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN classification_basis = 'reviewer' THEN 1 ELSE 0 END) AS r FROM press_item WHERE " + TRAINING_WHERE)
    .first<{ n: number; r: number | null }>();
  const rows = Number(row?.n ?? 0);
  return { signature: "nb2:" + DICTIONARY_VERSION + ":" + rows + ":" + Number(row?.r ?? 0), rows };
}

async function loadModel(db: SqlDatabase, signature: string): Promise<TitleModel> {
  const rows = (await db.prepare(
    "SELECT title, classification_status AS status, classification_basis AS basis FROM press_item WHERE " + TRAINING_WHERE,
  ).all<{ title: string; status: string; basis: string }>()).results;
  return trainTitleModel(
    rows.map((row) => ({ title: row.title, welfare: row.status === "WELFARE", weight: row.basis === "reviewer" ? REVIEWER_WEIGHT : 1 })),
    signature,
  );
}

export interface AutoClassifyResult {
  readonly reclassified: number;
  readonly modelChecked: number;
  readonly decidedWelfare: number;
  readonly decidedNonWelfare: number;
  readonly stillReview: number;
}

const publicStatusSql = "CASE WHEN public_status = 'WITHDRAWN' THEN public_status WHEN ? = 'WELFARE' THEN 'PUBLIC' ELSE 'HIDDEN' END";

/**
 * 배경 작업 한 차례: 사전 버전이 바뀐 규칙 분류 항목을 limit건까지 다시 분류하고,
 * 검토 대기 항목 중 아직 이 모델로 보지 않은 것을 limit건까지 학습 판정한다.
 */
export async function advanceAutoClassification(db: SqlDatabase, nowSeconds: number, limit = 200): Promise<AutoClassifyResult> {
  const stale = (await db.prepare(
    "SELECT item_id, title, classification_status AS status, categories FROM press_item " +
      "WHERE classification_basis IN ('title_rule', 'auto_model') AND dictionary_version <> ? LIMIT ?",
  ).bind(DICTIONARY_VERSION, limit).all<{ item_id: string; title: string; status: string; categories: string }>()).results;
  const updates = stale.map((row) => {
    const next = classifyTitle(row.title);
    return db.prepare(
      "UPDATE press_item SET classification_status = ?, categories = ?, classification_basis = 'title_rule', dictionary_version = ?, auto_score = NULL, auto_signature = '', " +
        "public_status = " + publicStatusSql + " WHERE item_id = ?",
    ).bind(next.status, JSON.stringify(next.categories), next.dictionaryVersion, next.status, row.item_id);
  });
  for (let index = 0; index < updates.length; index += 50) await db.batch(updates.slice(index, index + 50));

  const empty = { reclassified: stale.length, modelChecked: 0, decidedWelfare: 0, decidedNonWelfare: 0, stillReview: 0 };
  const { signature, rows } = await modelSignature(db);
  if (rows < MIN_TRAINING) return empty;
  const pending = (await db.prepare(
    // 새 사전으로 다시 분류된 항목만 본다(옛 사전 항목은 위 재분류가 먼저 정리한다).
    "SELECT item_id, title, categories FROM press_item WHERE classification_status = 'NEEDS_REVIEW' AND classification_basis = 'title_rule' AND dictionary_version = ? AND auto_signature <> ? LIMIT ?",
  ).bind(DICTIONARY_VERSION, signature, limit).all<{ item_id: string; title: string; categories: string }>()).results;
  if (pending.length === 0) return empty;
  const model = await loadModel(db, signature);
  let decidedWelfare = 0;
  let decidedNonWelfare = 0;
  const statements = pending.map((row) => {
    const score = welfareLogOdds(model, row.title);
    if (Math.abs(score) < AUTO_DECIDE_LOG_ODDS) {
      return db.prepare("UPDATE press_item SET auto_score = ?, auto_signature = ? WHERE item_id = ?").bind(score, model.signature, row.item_id);
    }
    const welfare = score > 0;
    if (welfare) decidedWelfare += 1;
    else decidedNonWelfare += 1;
    const known = new Set(PRESS_CATEGORIES.map((category) => category.code));
    const ruled = categoriesOf(row.categories).filter((code) => known.has(code));
    const categories = welfare ? (ruled.length ? ruled : ["other_welfare"]) : [];
    const status = welfare ? "WELFARE" : "NON_WELFARE";
    return db.prepare(
      "UPDATE press_item SET rule_classification_status = CASE WHEN rule_classification_status = '' THEN classification_status ELSE rule_classification_status END, " +
        "rule_categories = CASE WHEN rule_categories = '' THEN categories ELSE rule_categories END, classification_status = ?, categories = ?, classification_basis = 'auto_model', " +
        "auto_score = ?, auto_signature = ?, reviewed_at = ?, public_status = " + publicStatusSql + " WHERE item_id = ? AND classification_status = 'NEEDS_REVIEW'",
    ).bind(status, JSON.stringify(categories), score, model.signature, nowSeconds, status, row.item_id);
  });
  for (let index = 0; index < statements.length; index += 50) await db.batch(statements.slice(index, index + 50));
  return { reclassified: stale.length, modelChecked: pending.length, decidedWelfare, decidedNonWelfare, stillReview: pending.length - decidedWelfare - decidedNonWelfare };
}

function categoriesOf(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

