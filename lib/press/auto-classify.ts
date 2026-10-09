import type { SqlDatabase } from "../sql-database.ts";
import { classifyTitle } from "./classify.ts";
import { AGENCY_WORDS, DICTIONARY_VERSION, PRESS_CATEGORIES } from "./dictionary.ts";

// 보도자료 복지·비복지 자동분류(운영자 요청 2026-10-06, 2026-10-09 D-01·D-02 보완).
// 1) 제목 규칙(classify.ts)이 사전 버전이 바뀐 항목을 다시 분류한다(관리자 확정·학습 판정은 건드리지 않는다).
// 2) 규칙으로 정하지 못한 NEEDS_REVIEW 항목은 제목 글자 묶음(2글자)으로 학습한 판정(나이브 베이즈)이 본다.
//    학습 자료: 관리자가 확정한 항목(가중 5) + 제목 규칙으로 확정된 항목(가중 1). 학습 판정 결과(auto_model)는 다시 학습에 넣지 않는다.
//    같은 보도자료(중복 묶음)·같은 제목은 한 그룹으로 세어 독립 학습량을 부풀리지 않는다. 그룹 안 판정이 엇갈리면 학습에서 빼고 따로 센다.
//    확정 조건(D-01): 복지·비복지 각각 독립 그룹이 최소 표본 이상, 제목의 알려진 특징이 최소 개수·비율 이상, 전체 점수와 제목 근거 점수(사전확률 제외)가
//    모두 임계값 이상이고 방향이 같을 때만. 아니면 보류 사유(auto_reason)를 남기고 NEEDS_REVIEW로 둔다.
//    모델 식별자(D-02): 사전 버전·특징 추출 버전·설정 지문·학습자료 판본(press_training_revision, DB 트리거가 학습 내용이 바뀔 때마다 올림).
// 본문은 읽지 않는다. 관리자는 학습 판정 결과를 언제든 다시 확정할 수 있다(admin.ts reviewPressClassification).

/** 자동확정 설정. 값의 근거는 docs/press/eval/README.md(2026-10-09). 바꾸면 설정 지문이 바뀌어 모델 식별자도 바뀐다. */
export const PRESS_MODEL_CONFIG = {
  featureVersion: "title-bigram-v1",
  reviewerWeight: 5,
  ruleWeight: 1,
  /** 복지·비복지 각각 가중치 적용 전 독립 기사 그룹 수. */
  minGroupsPerClass: 30,
  /** 학습 자료에 있던 제목 특징의 최소 개수와 비율. */
  minKnownFeatures: 2,
  minKnownRatio: 0.25,
  /** 전체 로그 승산(사전확률 포함) 절댓값. */
  autoDecideLogOdds: 4,
  /** 제목 근거(사전확률 제외) 로그 승산 절댓값. 클래스 쏠림만으로는 확정하지 않는다. */
  minEvidenceLogOdds: 3,
} as const;
export type PressModelConfig = typeof PRESS_MODEL_CONFIG;

/** 이전 코드와의 호환: 전체 점수 임계값. */
export const AUTO_DECIDE_LOG_ODDS = PRESS_MODEL_CONFIG.autoDecideLogOdds;

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function configId(config: PressModelConfig = PRESS_MODEL_CONFIG): string {
  return "cfg" + fnv1a(JSON.stringify(config));
}

/** 모델 식별자: 사전·특징·설정·학습자료 판본. 행 수가 같아도 학습 내용이 바뀌면 판본이 달라진다. */
export function modelId(trainingRevision: number, config: PressModelConfig = PRESS_MODEL_CONFIG): string {
  return "nb3:" + DICTIONARY_VERSION + ":" + config.featureVersion + ":" + configId(config) + ":r" + trainingRevision;
}

export interface TitleModel {
  readonly counts: { readonly welfare: ReadonlyMap<string, number>; readonly other: ReadonlyMap<string, number> };
  readonly totals: { readonly welfare: number; readonly other: number };
  /** 가중치를 적용한 학습 문서 합(사전확률 계산용). */
  readonly docs: { readonly welfare: number; readonly other: number };
  /** 가중치 적용 전 독립 그룹 수(최소 표본 판단용). */
  readonly groups: { readonly welfare: number; readonly other: number };
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

/** group을 주면 같은 그룹은 한 번만 센다(이미 그룹으로 모은 행을 넘기는 것이 원칙). 없으면 행마다 한 그룹. */
export interface TrainingRow { readonly title: string; readonly welfare: boolean; readonly weight: number; readonly group?: string }

export function trainTitleModel(rows: readonly TrainingRow[], signature: string): TitleModel {
  const welfare = new Map<string, number>();
  const other = new Map<string, number>();
  const totals = { welfare: 0, other: 0 };
  const docs = { welfare: 0, other: 0 };
  const seen = { welfare: new Set<string>(), other: new Set<string>() };
  const vocabulary = new Set<string>();
  rows.forEach((row, index) => {
    const target = row.welfare ? welfare : other;
    for (const feature of titleFeatures(row.title)) {
      target.set(feature, (target.get(feature) ?? 0) + row.weight);
      vocabulary.add(feature);
      if (row.welfare) totals.welfare += row.weight;
      else totals.other += row.weight;
    }
    if (row.welfare) docs.welfare += row.weight;
    else docs.other += row.weight;
    (row.welfare ? seen.welfare : seen.other).add(row.group ?? "row:" + index);
  });
  return { counts: { welfare, other }, totals, docs, groups: { welfare: seen.welfare.size, other: seen.other.size }, vocabulary: vocabulary.size, signature };
}

export interface TitleAssessment {
  /** 복지 쪽 로그 승산(사전확률 포함). */
  readonly score: number;
  readonly prior: number;
  /** 제목 특징에서 온 부분(사전확률 제외). */
  readonly evidence: number;
  readonly features: number;
  readonly known: number;
  readonly knownRatio: number;
  readonly decision: "WELFARE" | "NON_WELFARE" | null;
  /** 확정하지 않은 사유 또는 확정 근거 요약. */
  readonly reason: string;
}

/** 제목 하나의 점수와 확정 여부. 확정 조건을 하나라도 못 채우면 decision은 null이고 사유를 남긴다. */
export function assessTitle(model: TitleModel, title: string, config: PressModelConfig = PRESS_MODEL_CONFIG): TitleAssessment {
  const prior = Math.log((model.docs.welfare + 1) / (model.docs.other + 1));
  const v = model.vocabulary + 1;
  const features = titleFeatures(title);
  let evidence = 0;
  let known = 0;
  for (const feature of features) {
    const w = model.counts.welfare.get(feature) ?? 0;
    const o = model.counts.other.get(feature) ?? 0;
    if (w === 0 && o === 0) continue;
    known += 1;
    evidence += Math.log((w + 1) / (model.totals.welfare + v)) - Math.log((o + 1) / (model.totals.other + v));
  }
  const score = prior + evidence;
  const knownRatio = features.length ? known / features.length : 0;
  const base = { score, prior, evidence, features: features.length, known, knownRatio };
  const hold = (reason: string): TitleAssessment => ({ ...base, decision: null, reason });
  if (model.groups.welfare < config.minGroupsPerClass || model.groups.other < config.minGroupsPerClass) {
    return hold("CLASS_DATA_SHORT: 독립 그룹 복지 " + model.groups.welfare + "·비복지 " + model.groups.other + " (클래스별 최소 " + config.minGroupsPerClass + ")");
  }
  if (known === 0) return hold("KNOWN_FEATURES_ZERO: 제목 특징 " + features.length + "개 중 학습 자료에 있던 특징 0개");
  if (known < config.minKnownFeatures || knownRatio < config.minKnownRatio) {
    return hold("KNOWN_FEATURES_LOW: 알려진 특징 " + known + "/" + features.length + " (최소 " + config.minKnownFeatures + "개·" + Math.round(config.minKnownRatio * 100) + "%)");
  }
  if (Math.abs(score) < config.autoDecideLogOdds) return hold("SCORE_BELOW_THRESHOLD: 점수 " + score.toFixed(2) + " (임계 ±" + config.autoDecideLogOdds + ")");
  if (Math.abs(evidence) < config.minEvidenceLogOdds || Math.sign(evidence) !== Math.sign(score)) {
    return hold("EVIDENCE_WEAK: 제목 근거 " + evidence.toFixed(2) + "·사전확률 " + prior.toFixed(2) + " (근거만으로 ±" + config.minEvidenceLogOdds + " 필요)");
  }
  return { ...base, decision: score > 0 ? "WELFARE" : "NON_WELFARE", reason: "DECIDED: 점수 " + score.toFixed(2) + "·제목 근거 " + evidence.toFixed(2) + "·알려진 특징 " + known + "/" + features.length };
}

/** 복지일 로그 승산(양수면 복지 쪽, 사전확률 포함). 확정 여부는 assessTitle로 판단한다. */
export function welfareLogOdds(model: TitleModel, title: string): number {
  return assessTitle(model, title).score;
}

/**
 * 로그 승산을 0~100으로 바꾼 값. 보정 검증을 하지 않은 점수 변환이라 확률로 표시하지 않는다(D-05).
 * 화면은 방향·추천점수·보류 사유를 보여 준다.
 */
export function recommendationScore(logOdds: number): number {
  return Math.round(100 / (1 + Math.exp(-logOdds)));
}
/** @deprecated 확률이 아니다. recommendationScore를 쓴다. */
export const welfarePercent = recommendationScore;

const TRAINING_WHERE = "classification_status IN ('WELFARE', 'NON_WELFARE') AND classification_basis IN ('reviewer', 'title_rule')";
const GROUP_KEY_SQL = "COALESCE(NULLIF(duplicate_group_id, ''), NULLIF(title_key, ''), 'h:' || title_hash)";

/** 학습자료 판본(트리거가 학습 대상 행의 판정·제목·학습 대상 여부·중복 묶음이 바뀔 때마다 올린다). */
export async function readTrainingRevision(db: SqlDatabase): Promise<number> {
  const row = await db.prepare("SELECT revision FROM press_training_revision WHERE id = 1").first<{ revision: number }>();
  return Number(row?.revision ?? 0);
}

export interface TrainingSet {
  readonly rows: readonly TrainingRow[];
  readonly groups: number;
  /** 같은 그룹 안 판정이 엇갈려 학습에서 뺀 그룹(검토 대상). */
  readonly conflicts: readonly { readonly group: string; readonly itemIds: readonly string[] }[];
}

/** 학습 대상 행을 그룹으로 모은다. 관리자 판정이 있으면 그 판정만 쓰고, 그룹 안에서 판정이 엇갈리면 뺀다. */
export function groupTraining(rows: readonly { readonly item_id: string; readonly title: string; readonly status: string; readonly basis: string; readonly group_key: string }[], config: PressModelConfig = PRESS_MODEL_CONFIG): TrainingSet {
  const byGroup = new Map<string, typeof rows[number][]>();
  for (const row of [...rows].sort((a, b) => (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0))) {
    byGroup.set(row.group_key, [...(byGroup.get(row.group_key) ?? []), row]);
  }
  const out: TrainingRow[] = [];
  const conflicts: { group: string; itemIds: string[] }[] = [];
  for (const [group, members] of byGroup) {
    const reviewer = members.filter((member) => member.basis === "reviewer");
    const deciding = reviewer.length ? reviewer : members;
    const labels = new Set(deciding.map((member) => member.status));
    if (labels.size !== 1) {
      conflicts.push({ group, itemIds: members.map((member) => member.item_id) });
      continue;
    }
    out.push({ title: deciding[0].title, welfare: deciding[0].status === "WELFARE", weight: reviewer.length ? config.reviewerWeight : config.ruleWeight, group });
  }
  return { rows: out, groups: out.length, conflicts };
}

async function loadTraining(db: SqlDatabase): Promise<TrainingSet> {
  const rows = (await db.prepare(
    "SELECT item_id, title, classification_status AS status, classification_basis AS basis, " + GROUP_KEY_SQL + " AS group_key FROM press_item WHERE " + TRAINING_WHERE,
  ).all<{ item_id: string; title: string; status: string; basis: string; group_key: string }>()).results;
  return groupTraining(rows);
}

/** 학습자료를 일관되게 읽는다: 읽기 전후 판본이 같을 때만 모델을 돌려준다(그 사이 바뀌면 null, 다음 차례에 다시). */
export async function loadConsistentModel(db: SqlDatabase): Promise<{ readonly model: TitleModel; readonly training: TrainingSet; readonly revision: number } | null> {
  const before = await readTrainingRevision(db);
  const training = await loadTraining(db);
  const after = await readTrainingRevision(db);
  if (before !== after) return null;
  return { model: trainTitleModel(training.rows, modelId(after)), training, revision: after };
}

export interface AutoClassifyResult {
  readonly reclassified: number;
  readonly modelChecked: number;
  readonly decidedWelfare: number;
  readonly decidedNonWelfare: number;
  readonly stillReview: number;
  readonly modelId?: string;
  readonly holdReasons?: Readonly<Record<string, number>>;
  readonly skippedTrainingChanged?: boolean;
  readonly conflicts?: number;
}

const publicStatusSql = "CASE WHEN public_status = 'WITHDRAWN' THEN public_status WHEN ? = 'WELFARE' THEN 'PUBLIC' ELSE 'HIDDEN' END";
const reasonKey = (reason: string) => reason.split(":")[0];

function categoriesFor(welfare: boolean, json: string): string[] {
  if (!welfare) return [];
  const known = new Set(PRESS_CATEGORIES.map((category) => category.code));
  const ruled = categoriesOf(json).filter((code) => known.has(code));
  return ruled.length ? ruled : ["other_welfare"];
}

/**
 * 배경 작업 한 차례: 사전 버전이 바뀐 규칙 분류 항목을 limit건까지 다시 분류하고,
 * 검토 대기 항목 중 아직 지금 모델로 보지 않은 것을 limit건까지 학습 판정한다.
 */
export async function advanceAutoClassification(db: SqlDatabase, nowSeconds: number, limit = 200): Promise<AutoClassifyResult> {
  const stale = (await db.prepare(
    "SELECT item_id, title, classification_status AS status, categories FROM press_item " +
      "WHERE classification_basis IN ('title_rule', 'auto_model') AND dictionary_version <> ? LIMIT ?",
  ).bind(DICTIONARY_VERSION, limit).all<{ item_id: string; title: string; status: string; categories: string }>()).results;
  const updates = stale.map((row) => {
    const next = classifyTitle(row.title);
    return db.prepare(
      "UPDATE press_item SET classification_status = ?, categories = ?, classification_basis = 'title_rule', dictionary_version = ?, auto_score = NULL, auto_signature = '', auto_reason = '', " +
        "public_status = " + publicStatusSql + " WHERE item_id = ? AND classification_basis IN ('title_rule', 'auto_model')",
    ).bind(next.status, JSON.stringify(next.categories), next.dictionaryVersion, next.status, row.item_id);
  });
  for (let index = 0; index < updates.length; index += 50) await db.batch(updates.slice(index, index + 50));

  const empty = { reclassified: stale.length, modelChecked: 0, decidedWelfare: 0, decidedNonWelfare: 0, stillReview: 0 };
  const loaded = await loadConsistentModel(db);
  if (!loaded) return { ...empty, skippedTrainingChanged: true };
  const { model, training } = loaded;
  const pending = (await db.prepare(
    // 새 사전으로 다시 분류된 항목만 본다(옛 사전 항목은 위 재분류가 먼저 정리한다).
    // 재평가에서 이전·현재 모델 판정이 엇갈려 검토로 보낸 항목(MODEL_DIRECTION_CHANGED)은 사람이 확정할 때까지 자동 판정하지 않는다.
    "SELECT item_id, title, title_hash, categories FROM press_item WHERE classification_status = 'NEEDS_REVIEW' AND classification_basis = 'title_rule' AND dictionary_version = ? AND auto_signature <> ? " +
      "AND auto_reason NOT LIKE 'MODEL_DIRECTION_CHANGED%' LIMIT ?",
  ).bind(DICTIONARY_VERSION, model.signature, limit).all<{ item_id: string; title: string; title_hash: string; categories: string }>()).results;
  if (pending.length === 0) return { ...empty, modelId: model.signature, conflicts: training.conflicts.length };
  let decidedWelfare = 0;
  let decidedNonWelfare = 0;
  const holdReasons: Record<string, number> = {};
  const statements = pending.map((row) => {
    const judged = assessTitle(model, row.title);
    // 읽은 뒤 관리자가 확정했거나 제목이 바뀐 항목은 쓰지 않는다(조건부 갱신).
    const guard = " WHERE item_id = ? AND classification_status = 'NEEDS_REVIEW' AND classification_basis = 'title_rule' AND title_hash = ?";
    if (!judged.decision) {
      holdReasons[reasonKey(judged.reason)] = (holdReasons[reasonKey(judged.reason)] ?? 0) + 1;
      return db.prepare("UPDATE press_item SET auto_score = ?, auto_signature = ?, auto_reason = ?" + guard).bind(judged.score, model.signature, judged.reason, row.item_id, row.title_hash);
    }
    const welfare = judged.decision === "WELFARE";
    if (welfare) decidedWelfare += 1;
    else decidedNonWelfare += 1;
    return db.prepare(
      "UPDATE press_item SET rule_classification_status = CASE WHEN rule_classification_status = '' THEN classification_status ELSE rule_classification_status END, " +
        "rule_categories = CASE WHEN rule_categories = '' THEN categories ELSE rule_categories END, classification_status = ?, categories = ?, classification_basis = 'auto_model', " +
        "auto_score = ?, auto_signature = ?, auto_reason = ?, reviewed_at = ?, public_status = " + publicStatusSql + guard,
    ).bind(judged.decision, JSON.stringify(categoriesFor(welfare, row.categories)), judged.score, model.signature, judged.reason, nowSeconds, judged.decision, row.item_id, row.title_hash);
  });
  for (let index = 0; index < statements.length; index += 50) await db.batch(statements.slice(index, index + 50));
  return {
    reclassified: stale.length, modelChecked: pending.length, decidedWelfare, decidedNonWelfare, stillReview: pending.length - decidedWelfare - decidedNonWelfare,
    modelId: model.signature, holdReasons, conflicts: training.conflicts.length,
  };
}

// ── 기존 자동확정(auto_model) 자료 재평가(D-02 별도 정리) ──────────────────────────────────────
// 대상: 학습 판정으로 확정된 항목 중 지금 모델로 보지 않은 것(관리자 확정·철회는 대상 아님). 처리 순서는 item_id 오름차순, 진행 위치는 app_setting에 둔다.
// 정책: 지금 모델이 같은 방향으로 확정 → 유지(점수·모델 식별자만 갱신) / 근거 부족 → 검토 대기로 되돌림(비공개) /
// 지금 모델이 반대 방향으로 확정 → 자동으로 뒤집지 않고 검토 대기로 보냄(direction_changed, 예상 분류는 사유에 남김).
// 같은 제목에 대해 이전·현재 모델 판정이 엇갈린 것은 그 자체로 불안정 신호여서 사람 확인 전에는 공개 상태를 바꾸지 않는다(2026-10-09 운영 dry-run에서
// 교육 법령 기사가 복지로 뒤집히는 사례를 확인한 뒤 정함).
// 원래 학습자료·모델은 남아 있지 않으므로 이 작업은 "현재 모델로 재평가"이며 과거 판정을 복원한 것이 아니다.

export const REEVAL_KEY = "press_auto_reeval";

export interface ReevalPlanRow {
  readonly item_id: string;
  readonly title: string;
  readonly before: { readonly status: string; readonly public_status: string; readonly score: number | null; readonly signature: string };
  readonly action: "keep" | "direction_changed" | "to_review";
  /** 지금 모델이 내린 판정(검토 대기로 보내는 경우에도 남긴다). */
  readonly modelDecision: "WELFARE" | "NON_WELFARE" | null;
  readonly after: { readonly status: string; readonly public_status: string; readonly score: number };
  readonly reason: string;
}

interface AutoRow {
  readonly item_id: string; readonly title: string; readonly title_hash: string; readonly classification_status: string; readonly public_status: string;
  readonly auto_score: number | null; readonly auto_signature: string; readonly categories: string; readonly rule_classification_status: string; readonly rule_categories: string;
}

function planRow(model: TitleModel, row: AutoRow): ReevalPlanRow {
  const judged = assessTitle(model, row.title);
  const before = { status: row.classification_status, public_status: row.public_status, score: row.auto_score, signature: row.auto_signature };
  const withdrawn = row.public_status === "WITHDRAWN";
  if (judged.decision === row.classification_status) {
    return { item_id: row.item_id, title: row.title, before, action: "keep", modelDecision: judged.decision, after: { status: row.classification_status, public_status: row.public_status, score: judged.score }, reason: judged.reason };
  }
  if (judged.decision) {
    return {
      item_id: row.item_id, title: row.title, before, action: "direction_changed", modelDecision: judged.decision,
      after: { status: "NEEDS_REVIEW", public_status: withdrawn ? "WITHDRAWN" : "HIDDEN", score: judged.score },
      reason: "MODEL_DIRECTION_CHANGED: 이전 " + row.classification_status + " → 현재 모델 " + judged.decision + " (" + judged.reason + ")",
    };
  }
  return { item_id: row.item_id, title: row.title, before, action: "to_review", modelDecision: null, after: { status: "NEEDS_REVIEW", public_status: withdrawn ? "WITHDRAWN" : "HIDDEN", score: judged.score }, reason: judged.reason };
}

const AUTO_ROW_COLUMNS = "item_id, title, title_hash, classification_status, public_status, auto_score, auto_signature, categories, rule_classification_status, rule_categories";

/** 재평가 dry-run: 지금 모델로 대상 전체의 예상 결과를 계산한다(쓰지 않음). */
export async function planAutoModelReevaluation(db: SqlDatabase): Promise<{ readonly modelId: string | null; readonly rows: readonly ReevalPlanRow[]; readonly protectedReviewer: number; readonly protectedWithdrawn: number; readonly counts: Readonly<Record<string, number>> }> {
  const loaded = await loadConsistentModel(db);
  if (!loaded) return { modelId: null, rows: [], protectedReviewer: 0, protectedWithdrawn: 0, counts: {} };
  const rows = (await db.prepare("SELECT " + AUTO_ROW_COLUMNS + " FROM press_item WHERE classification_basis = 'auto_model' AND public_status <> 'WITHDRAWN' AND auto_signature <> ? ORDER BY item_id")
    .bind(loaded.model.signature).all<AutoRow>()).results;
  const protectedRows = await db.prepare("SELECT SUM(CASE WHEN classification_basis = 'reviewer' THEN 1 ELSE 0 END) AS reviewer, SUM(CASE WHEN classification_basis = 'auto_model' AND public_status = 'WITHDRAWN' THEN 1 ELSE 0 END) AS withdrawn FROM press_item")
    .first<{ reviewer: number | null; withdrawn: number | null }>();
  const plan = rows.map((row) => planRow(loaded.model, row));
  const counts: Record<string, number> = {};
  for (const row of plan) counts[row.action] = (counts[row.action] ?? 0) + 1;
  return { modelId: loaded.model.signature, rows: plan, protectedReviewer: Number(protectedRows?.reviewer ?? 0), protectedWithdrawn: Number(protectedRows?.withdrawn ?? 0), counts };
}

export interface ReevalState {
  readonly runId: string;
  readonly modelId: string;
  readonly cursor: string;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly done: boolean;
  readonly counts: { readonly kept: number; readonly directionChanged: number; readonly toReview: number; readonly conflict: number };
}

export async function readReevalState(db: SqlDatabase): Promise<ReevalState | null> {
  const row = await db.prepare("SELECT value FROM app_setting WHERE key = ?").bind(REEVAL_KEY).first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as ReevalState;
  } catch {
    return null;
  }
}

/**
 * 재평가 한 묶음 적용. 처음이면 지금 모델 식별자로 실행을 시작하고, 이어서 부르면 커서 뒤부터 처리한다.
 * 실행 중 모델이 바뀌면(학습자료 변경) 멈추고 MODEL_CHANGED를 돌려준다. 각 항목은 읽을 때의 판정·모델 식별자·제목이 그대로이고 철회되지 않았을 때만 바뀐다.
 */
export async function stepAutoModelReevaluation(db: SqlDatabase, nowSeconds: number, newId: () => string, batch = 100): Promise<{ readonly state: ReevalState | null; readonly status: "STEPPED" | "DONE" | "MODEL_CHANGED" | "TRAINING_CHANGED_RETRY"; readonly processed: number }> {
  const loaded = await loadConsistentModel(db);
  if (!loaded) return { state: await readReevalState(db), status: "TRAINING_CHANGED_RETRY", processed: 0 };
  let state = await readReevalState(db);
  if (!state || state.done) {
    state = { runId: newId(), modelId: loaded.model.signature, cursor: "", startedAt: nowSeconds, updatedAt: nowSeconds, done: false, counts: { kept: 0, directionChanged: 0, toReview: 0, conflict: 0 } };
  } else if (state.modelId !== loaded.model.signature) {
    return { state, status: "MODEL_CHANGED", processed: 0 };
  }
  const rows = (await db.prepare("SELECT " + AUTO_ROW_COLUMNS + " FROM press_item WHERE classification_basis = 'auto_model' AND public_status <> 'WITHDRAWN' AND auto_signature <> ? AND item_id > ? ORDER BY item_id LIMIT ?")
    .bind(state.modelId, state.cursor, batch).all<AutoRow>()).results;
  const counts = { ...state.counts };
  for (const row of rows) {
    const planned = planRow(loaded.model, row);
    const guard = " WHERE item_id = ? AND classification_basis = 'auto_model' AND classification_status = ? AND auto_signature = ? AND title_hash = ? AND public_status <> 'WITHDRAWN'";
    const guardArgs = [row.item_id, row.classification_status, row.auto_signature, row.title_hash];
    const update = planned.action === "keep"
      ? db.prepare("UPDATE press_item SET auto_score = ?, auto_signature = ?, auto_reason = ?" + guard).bind(planned.after.score, state.modelId, planned.reason, ...guardArgs)
      : db.prepare(
          "UPDATE press_item SET classification_status = 'NEEDS_REVIEW', classification_basis = 'title_rule', categories = CASE WHEN rule_categories = '' THEN '[]' ELSE rule_categories END, " +
            "public_status = CASE WHEN public_status = 'WITHDRAWN' THEN public_status ELSE 'HIDDEN' END, auto_score = ?, auto_signature = ?, auto_reason = ?, reviewed_at = NULL" + guard,
        ).bind(planned.after.score, state.modelId, planned.reason, ...guardArgs);
    const results = await db.batch([
      update,
      db.prepare(
        "INSERT INTO press_auto_reeval_log (run_id, item_id, model_id, at, action, outcome, before_status, before_public, before_score, before_signature, before_categories, after_status, after_public, after_score, reason) " +
          "SELECT ?, item_id, ?, ?, ?, 'applied', ?, ?, ?, ?, ?, classification_status, public_status, auto_score, ? FROM press_item WHERE item_id = ? AND auto_signature = ? AND changes() = 1",
      ).bind(state.runId, state.modelId, nowSeconds, planned.action, row.classification_status, row.public_status, row.auto_score, row.auto_signature, row.categories, planned.reason, row.item_id, state.modelId),
    ]);
    const applied = ((results[0] as { meta?: { changes?: number }; changes?: number })?.meta?.changes ?? (results[0] as { changes?: number })?.changes ?? 0) === 1;
    if (!applied) {
      counts.conflict += 1;
      await db.prepare(
        "INSERT INTO press_auto_reeval_log (run_id, item_id, model_id, at, action, outcome, before_status, before_public, before_score, before_signature, before_categories, after_status, after_public, after_score, reason) VALUES (?, ?, ?, ?, ?, 'conflict', ?, ?, ?, ?, ?, '', '', NULL, '읽은 뒤 관리자 확정·철회·제목 변경 등으로 바뀌어 건너뜀')",
      ).bind(state.runId, row.item_id, state.modelId, nowSeconds, planned.action, row.classification_status, row.public_status, row.auto_score, row.auto_signature, row.categories).run();
    } else if (planned.action === "keep") counts.kept += 1;
    else if (planned.action === "direction_changed") counts.directionChanged += 1;
    else counts.toReview += 1;
    // 한 항목마다 커서를 옮겨, 중간에 멈춰도 다음 실행이 같은 항목을 두 번 적용하거나 건너뛰지 않는다.
    state = { ...state, cursor: row.item_id, updatedAt: nowSeconds, counts: { ...counts } };
    await db.prepare("INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(REEVAL_KEY, JSON.stringify(state), nowSeconds).run();
  }
  const done = rows.length < batch;
  state = { ...state, done, updatedAt: nowSeconds };
  await db.prepare("INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(REEVAL_KEY, JSON.stringify(state), nowSeconds).run();
  return { state, status: done ? "DONE" : "STEPPED", processed: rows.length };
}

function categoriesOf(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
/**
 * 재평가 실행 하나를 되돌린다(데이터 복구, T12). 이 실행이 실제로 바꾼 행(outcome=applied)만, 그 뒤 바뀌지 않았을 때만 이전 값으로 돌린다.
 * 그 뒤 관리자 확정·철회·재분류 등이 있으면 덮어쓰지 않고 충돌로 센다. 철회 상태는 언제나 유지한다.
 */
export async function rollbackAutoReevaluation(db: SqlDatabase, runId: string): Promise<{ readonly restored: number; readonly conflicts: readonly string[] }> {
  const logs = (await db.prepare("SELECT log_id, item_id, model_id, before_status, before_public, before_score, before_signature, before_categories, after_status FROM press_auto_reeval_log WHERE run_id = ? AND outcome = 'applied' ORDER BY log_id DESC")
    .bind(runId).all<{ log_id: number; item_id: string; model_id: string; before_status: string; before_public: string; before_score: number | null; before_signature: string; before_categories: string; after_status: string }>()).results;
  let restored = 0;
  const conflicts: string[] = [];
  for (const log of logs) {
    const result = await db.prepare(
      "UPDATE press_item SET classification_status = ?, classification_basis = 'auto_model', categories = ?, auto_score = ?, auto_signature = ?, " +
        "public_status = CASE WHEN public_status = 'WITHDRAWN' THEN public_status ELSE ? END WHERE item_id = ? AND classification_status = ? AND auto_signature = ? AND classification_basis IN ('auto_model', 'title_rule')",
    ).bind(log.before_status, log.before_categories, log.before_score, log.before_signature, log.before_public, log.item_id, log.after_status, log.model_id).run();
    const changes = (result as { meta?: { changes?: number }; changes?: number })?.meta?.changes ?? (result as { changes?: number })?.changes ?? 0;
    if (changes === 1) restored += 1;
    else conflicts.push(log.item_id);
  }
  return { restored, conflicts };
}
