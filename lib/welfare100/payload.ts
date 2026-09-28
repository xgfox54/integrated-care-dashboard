import manualTitles from "@/data/welfare100/manuals.json";
import { versionedDataUrl } from "@/lib/data-versions";
import { searchableText } from "@/lib/search-terms";
import { expandBokjiro } from "./bokjiro";
import type { BokjiroRaw, CatalogRow, PackedCatalogIndex, WelfareOrg } from "./catalog-types";
import { expandRecord, type CuratedExtra, type ProgramMeta, type WelfareInstitution, type WelfareRecord } from "./model";

export const WELFARE_DATA_BASE = "/data/welfare100";

export type WelfareItemPayload =
  | { kind: "auto"; raw: BokjiroRaw }
  | { kind: "curated"; meta: ProgramMeta; record: WelfareRecord; extra: CuratedExtra }
  | { kind: "alias"; slug: string };

/** 목록 화면에서 쓰는 제도 한 줄. */
export interface CatalogEntry {
  slug: string;
  name: string;
  oneLiner: string;
  priority: number;
  org: WelfareOrg;
  curated: boolean;
  sido: string;
  sigungu: string;
  category: string;
  topics: string[];
  lifecycle: string[];
  household: string[];
  type: string;
  provision: string[];
  cycle: string[];
  dept: string;
  processNodeCount: number;
  processLaneCount: number;
  processGatewayCount: number;
  legalBasisCount: number;
  sourceCount: number;
  bottleneckCount: number;
  online: boolean;
  laws: string[];
  /** 검색용 본문(lib/search-terms.ts의 searchableText). matchesSearch로 찾는다. */
  searchText: string;
  /** 담당·법령·구조 지표(index-extra.json)까지 채워졌는지. */
  complete: boolean;
}

type LiteCatalogRow = Pick<CatalogRow, "s" | "n" | "o" | "no" | "g" | "a" | "sd" | "sg" | "c" | "t" | "l" | "h" | "pv" | "p" | "k">;
type ExtraCatalogRow = Pick<CatalogRow, "s" | "d" | "y" | "cy" | "ln" | "gw" | "lw" | "b" | "on" | "laws">;

const EMPTY_EXTRA: Omit<ExtraCatalogRow, "s"> = { d: "", y: "", cy: [], ln: 0, gw: 0, lw: 0, b: 0, on: 0, laws: [] };

export function decodeCatalogRow(row: LiteCatalogRow & Partial<ExtraCatalogRow>): CatalogEntry {
  const full = { ...EMPTY_EXTRA, ...row };
  const org: WelfareOrg = row.g === 0 ? "중앙부처" : "지자체";
  return {
    slug: row.s,
    name: row.n,
    oneLiner: row.o,
    priority: row.no,
    org,
    curated: row.a === 1,
    sido: row.sd,
    sigungu: row.sg,
    category: row.c,
    topics: row.t,
    lifecycle: row.l,
    household: row.h,
    type: full.y,
    provision: row.pv,
    cycle: full.cy,
    dept: full.d,
    processNodeCount: row.p,
    processLaneCount: full.ln,
    processGatewayCount: full.gw,
    legalBasisCount: full.lw,
    sourceCount: row.k,
    bottleneckCount: full.b,
    online: full.on === 1,
    laws: full.laws,
    searchText: searchableText([row.n, row.o, full.d, row.sd, row.sg, full.y, ...row.t, ...row.l, ...row.h, ...row.pv, ...full.laws, org]),
    complete: row.d !== undefined,
  };
}

function unpack<T>(index: PackedCatalogIndex): T[] {
  return index.items.map((values) => Object.fromEntries(index.fields.map((field, position) => [field, values[position]])) as T);
}

async function fetchPacked(path: string, key: "welfare100Lite" | "welfare100Extra"): Promise<PackedCatalogIndex> {
  const response = await fetch(versionedDataUrl(WELFARE_DATA_BASE + path, key), { cache: "force-cache" });
  if (!response.ok) throw new Error("복지제도 목록을 불러오지 못했습니다 (" + response.status + ")");
  return (await response.json()) as PackedCatalogIndex;
}

export interface CatalogData {
  asOf: string;
  entries: CatalogEntry[];
}

let litePromise: Promise<{ asOf: string; rows: LiteCatalogRow[] }> | null = null;
let extraPromise: Promise<Map<string, ExtraCatalogRow>> | null = null;
let fullPromise: Promise<CatalogData> | null = null;

function loadLiteRows() {
  litePromise ??= fetchPacked("/index-lite.json", "welfare100Lite")
    .then((index) => ({ asOf: index.asOf, rows: unpack<LiteCatalogRow>(index) }))
    .catch((error: unknown) => {
      litePromise = null;
      throw error;
    });
  return litePromise;
}

function loadExtraRows() {
  extraPromise ??= fetchPacked("/index-extra.json", "welfare100Extra")
    .then((index) => new Map(unpack<ExtraCatalogRow>(index).map((row) => [row.s, row])))
    .catch((error: unknown) => {
      extraPromise = null;
      throw error;
    });
  return extraPromise;
}

/** 목록·필터·기본 검색용 색인(index-lite.json)을 한 번만 받아 온다. */
export function loadCatalog(): Promise<CatalogData> {
  return loadLiteRows().then(({ asOf, rows }) => ({ asOf, entries: rows.map((row) => decodeCatalogRow(row)) }));
}

/** 담당·법령·구조 지표까지 채운 전체 색인. 가벼운 색인을 먼저 받은 뒤 이어서 받는다. */
export function loadFullCatalog(): Promise<CatalogData> {
  fullPromise ??= Promise.all([loadLiteRows(), loadExtraRows()])
    .then(([{ asOf, rows }, extras]) => ({
      asOf,
      entries: rows.map((row) => decodeCatalogRow({ ...row, ...extras.get(row.s) })),
    }))
    .catch((error: unknown) => {
      fullPromise = null;
      throw error;
    });
  return fullPromise;
}

export function payloadToInstitution(payload: WelfareItemPayload): WelfareInstitution | null {
  if (payload.kind === "auto") return expandBokjiro(payload.raw);
  if (payload.kind === "curated") return expandRecord(payload.meta, payload.record, manualTitles as Record<string, string>, payload.extra);
  return null;
}

async function fetchPayload(slug: string, signal?: AbortSignal): Promise<WelfareItemPayload | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) return null;
  const response = await fetch(versionedDataUrl(WELFARE_DATA_BASE + "/items/" + slug + ".json", "welfare100Items"), { cache: "force-cache", signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("제도 정보를 불러오지 못했습니다 (" + response.status + ")");
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) return null;
  return (await response.json()) as WelfareItemPayload;
}

/** 제도 한 건을 받아 화면 모델로 펼친다. 합쳐진 복지로 번호는 대표 제도로 이어 준다. */
export async function loadInstitution(slug: string, signal?: AbortSignal): Promise<{ institution: WelfareInstitution; canonicalSlug: string } | null> {
  let current = slug;
  for (let hop = 0; hop < 2; hop++) {
    const payload = await fetchPayload(current, signal);
    if (!payload) return null;
    if (payload.kind === "alias") {
      current = payload.slug;
      continue;
    }
    const institution = payloadToInstitution(payload);
    return institution ? { institution, canonicalSlug: current } : null;
  }
  return null;
}
