export const ROW_EDIT_FIELDS = [
  "description",
  "target",
  "detailTarget",
  "provider",
  "applicationMethod",
] as const;

export const EDIT_FIELDS = [...ROW_EDIT_FIELDS, "content", "sourceTitle", "sourceUrl"] as const;

export type EditField = (typeof EDIT_FIELDS)[number];

export type WikiEditValues = { readonly [K in EditField]: string | null };

export interface PublicWikiEdit extends WikiEditValues {
  readonly updatedAt: number;
}

export interface WikiEdit extends PublicWikiEdit {
  readonly serviceId: string;
  readonly sido: string;
  readonly sigungu: string;
  readonly name: string;
  readonly note: string;
}

export interface WikiEditInput {
  readonly serviceId: string;
  readonly values: WikiEditValues;
  readonly note: string;
}

interface EditableRow {
  readonly serviceId: string;
  readonly description: string;
  readonly target: string;
  readonly detailTarget: string;
  readonly provider: string;
  readonly applicationMethod?: string;
}

const FIELD_LIMITS: Readonly<Record<EditField, number>> = {
  description: 2_000,
  target: 2_000,
  detailTarget: 2_000,
  provider: 1_000,
  applicationMethod: 2_000,
  content: 6_000,
  sourceTitle: 200,
  sourceUrl: 500,
};

const NOTE_LIMIT = 2_000;

export function applyWikiEdit<T extends EditableRow>(row: T, edit: WikiEditValues | undefined): T {
  if (!edit) return row;
  return {
    ...row,
    description: edit.description ?? row.description,
    target: edit.target ?? row.target,
    detailTarget: edit.detailTarget ?? row.detailTarget,
    provider: edit.provider ?? row.provider,
    applicationMethod: edit.applicationMethod ?? row.applicationMethod ?? "",
  };
}

export function applyWikiEdits<T extends EditableRow>(
  rows: readonly T[],
  edits: ReadonlyMap<string, WikiEditValues>,
): T[] {
  if (edits.size === 0) return [...rows];
  return rows.map((row) => applyWikiEdit(row, edits.get(row.serviceId)));
}

export function hasWikiEditValues(values: WikiEditValues): boolean {
  return EDIT_FIELDS.some((field) => values[field] !== null);
}

export function publicWikiEdit(edit: WikiEdit): PublicWikiEdit {
  return {
    description: edit.description,
    target: edit.target,
    detailTarget: edit.detailTarget,
    provider: edit.provider,
    applicationMethod: edit.applicationMethod,
    content: edit.content,
    sourceTitle: edit.sourceTitle,
    sourceUrl: edit.sourceUrl,
    updatedAt: edit.updatedAt,
  };
}

function fieldValue(record: Record<string, unknown>, field: EditField): string | null {
  const value = record[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("편집 값은 문자열이어야 합니다.");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > FIELD_LIMITS[field]) {
    throw new Error("입력한 내용이 너무 깁니다. " + FIELD_LIMITS[field].toLocaleString("ko-KR") + "자 이내로 줄여 주세요.");
  }
  return trimmed;
}

export function parseWikiEditInput(payload: unknown): WikiEditInput {
  if (typeof payload !== "object" || payload === null) throw new Error("편집 내용을 읽지 못했습니다.");
  const record = payload as Record<string, unknown>;
  const serviceId = typeof record.serviceId === "string" ? record.serviceId.trim() : "";
  if (!serviceId || serviceId.length > 120) throw new Error("편집할 사업을 선택하세요.");
  const entries = EDIT_FIELDS.map((field) => [field, fieldValue(record, field)] as const);
  const values = Object.fromEntries(entries) as WikiEditValues;
  if (values.sourceUrl !== null && !/^https?:\/\/\S+$/i.test(values.sourceUrl)) {
    throw new Error("보완 출처 주소는 http:// 또는 https://로 시작해야 합니다.");
  }
  const note = typeof record.note === "string" ? record.note.trim() : "";
  if (note.length > NOTE_LIMIT) throw new Error("관리자 메모는 2,000자 이내로 줄여 주세요.");
  return { serviceId, values, note };
}

