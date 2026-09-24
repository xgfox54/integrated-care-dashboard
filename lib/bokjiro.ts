import {
  BokjiroPayloadError,
  BokjiroResponseError,
  parseBokjiroPayload,
  type BokjiroPayload,
  type BokjiroRecord,
} from "./bokjiro-schema.ts";

const BOKJIRO_SEARCH_URL =
  "https://www.bokjiro.go.kr/ssis-tbu/TWAT52005M/twataa/wlfareInfo/selectWlfareInfo.do";
const BOKJIRO_DETAIL_URL =
  "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do";

export interface BokjiroWikiSource {
  readonly tier: "bokjiro";
  readonly label: string;
  readonly title: string;
  readonly summary: string;
  readonly publisher: string;
  readonly url: string;
  readonly matchedTerm: string;
}

const BUNDLED_SOURCES: Array<BokjiroWikiSource & { names: string[] }> = [
  {
    tier: "bokjiro",
    label: "1차 · 복지로 인용",
    title: "노인맞춤돌봄서비스",
    summary:
      "일상생활 영위가 어려운 취약노인에게 적절한 돌봄서비스를 제공하여 안정적인 노후생활 보장, 노인의 기능·건강 유지 및 악화 예방을 지원합니다.",
    publisher: "보건복지부 노인정책과",
    url: `${BOKJIRO_DETAIL_URL}?wlfareInfoId=WLF00003191&wlfareInfoReldBztpCd=01`,
    matchedTerm: "노인맞춤돌봄서비스",
    names: ["노인맞춤돌봄서비스", "노인맞춤돌봄"],
  },
  {
    tier: "bokjiro",
    label: "1차 · 복지로 인용",
    title: "일상돌봄 서비스 사업",
    summary:
      "일상생활에 돌봄이 필요한 중장년과 가족돌봄청년에게 일상생활의 어려움을 해소할 수 있도록 맞춤형 사회서비스를 통합 제공합니다.",
    publisher: "보건복지부 사회서비스사업과",
    url: `${BOKJIRO_DETAIL_URL}?wlfareInfoId=WLF00005411&wlfareInfoReldBztpCd=01`,
    matchedTerm: "일상돌봄서비스",
    names: ["일상돌봄서비스", "일상돌봄서비스사업", "일상돌봄"],
  },
  {
    tier: "bokjiro",
    label: "1차 · 복지로 인용",
    title: "긴급돌봄 지원사업",
    summary:
      "질병, 부상, 주 돌봄자의 갑작스러운 부재(사망, 입원 등), 재난피해 등 돌봄 공백을 신속히 보완해 국민의 돌봄불안을 해소합니다.",
    publisher: "보건복지부 사회서비스사업과",
    url: `${BOKJIRO_DETAIL_URL}?wlfareInfoId=WLF00005442&wlfareInfoReldBztpCd=01`,
    matchedTerm: "긴급돌봄 지원사업",
    names: ["긴급돌봄지원사업", "긴급돌봄서비스", "긴급돌봄"],
  },
  {
    tier: "bokjiro",
    label: "1차 · 복지로 인용",
    title: "가사·간병 방문 지원사업",
    summary:
      "일상생활이 어려운 저소득층 가정에 간병·가사 서비스를 지원하여 취약계층의 생활 안정을 도모하고 가사·간병 방문 제공인력의 사회적 일자리를 창출합니다.",
    publisher: "보건복지부 사회서비스사업과",
    url: `${BOKJIRO_DETAIL_URL}?wlfareInfoId=WLF00001087&wlfareInfoReldBztpCd=01`,
    matchedTerm: "가사간병 방문지원사업",
    names: ["가사간병방문지원사업", "가사간병방문지원"],
  },
  {
    tier: "bokjiro",
    label: "1차 · 복지로 인용",
    title: "독거노인·장애인 응급안전안심서비스",
    summary:
      "안전의 사각지대에 있는 노인과 장애인이 응급상황을 인지하고 응급상황에 대처할 수 있도록 안전대책을 마련하여 지역사회 예방적 돌봄을 지원합니다.",
    publisher: "보건복지부 노인정책과",
    url: `${BOKJIRO_DETAIL_URL}?wlfareInfoId=WLF00001093&wlfareInfoReldBztpCd=01`,
    matchedTerm: "독거노인 장애인 응급안전안심서비스",
    names: ["독거노인장애인응급안전안심서비스", "응급안전안심서비스"],
  },
  {
    tier: "bokjiro",
    label: "1차 · 복지로 인용",
    title: "장애인활동지원",
    summary:
      "혼자서 일상생활과 사회생활을 하기 어려운 장애인에게 활동보조서비스를 제공하여 자립생활을 지원하고 사회참여를 도모합니다.",
    publisher: "보건복지부 장애인서비스과",
    url: `${BOKJIRO_DETAIL_URL}?wlfareInfoId=WLF00003260&wlfareInfoReldBztpCd=01`,
    matchedTerm: "장애인 활동지원",
    names: ["장애인활동지원", "장애인활동지원서비스"],
  },
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBokjiroText(value: string): string {
  return value.replace(/[^0-9a-zA-Z가-힣]/g, "").toLowerCase();
}

function queryFor(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function findBundledBokjiroExplanation(name: string): BokjiroWikiSource | null {
  const normalized = normalizeBokjiroText(name);
  const entry = BUNDLED_SOURCES.find(
    (source) => normalizeBokjiroText(source.title) === normalized,
  );
  if (!entry) return null;
  return {
    tier: entry.tier,
    label: entry.label,
    title: entry.title,
    summary: entry.summary,
    publisher: entry.publisher,
    url: entry.url,
    matchedTerm: entry.title,
  };
}

function rowsFrom(payload: BokjiroPayload): readonly BokjiroRecord[] {
  return [
    ...payload.dsServiceList0,
    ...payload.dsServiceList1,
    ...payload.dsServiceList2,
    ...payload.dsServiceList3,
  ];
}

function scoreRecord(record: BokjiroRecord, requestedName: string, query: string, region: string): number {
  const candidate = normalizeBokjiroText(text(record.WLFARE_INFO_NM));
  const requested = normalizeBokjiroText(requestedName);
  if (!candidate || !text(record.WLFARE_INFO_OUTL_CN)) return -1;
  if (candidate !== requested) return -1;

  let score = 10_000;

  const address = normalizeBokjiroText(text(record.ADDR));
  const normalizedRegion = normalizeBokjiroText(region);
  if (normalizedRegion && address && (normalizedRegion.includes(address) || address.includes(normalizedRegion))) {
    score += 300;
  }
  if (text(record.WLFARE_GDNC_TRGT_KCD) === "01") score += 50;
  return score;
}

export async function findBokjiroExplanation(
  name: string,
  region: string,
): Promise<BokjiroWikiSource | null> {
  const query = queryFor(name);
  const response = await fetch(BOKJIRO_SEARCH_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      referer: "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52005M.do",
    },
    body: JSON.stringify({
      dmSearchParam: {
        page: "1",
        onlineYn: "",
        searchTerm: query,
        tabId: "1",
        orderBy: "date",
        bkjrLftmCycCd: "",
        daesang: "",
        period: "",
        age: "",
        region: "",
        jjim: "",
        subject: "",
        favoriteKeyword: "",
        sidoCd: "",
        sggCd: "",
        endYn: "N",
        exclSearchTerm: "",
      },
      dmScr: {
        curScrId: "tbu/app/twat/twata/twataa/TWAT52005M",
        befScrId: "",
      },
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new BokjiroResponseError(response.status);
  const payload = parseBokjiroPayload(await response.json());
  if (payload.dmMessage?.status === "ERROR") {
    throw new BokjiroPayloadError(
      `복지로 응답 오류 ${payload.dmMessage.code ?? "UNKNOWN"}: ${payload.dmMessage.content ?? "내용 없음"}`,
    );
  }
  const records = rowsFrom(payload);
  const winner = records
    .map((record) => ({ record, score: scoreRecord(record, name, query, region) }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => right.score - left.score)[0]?.record;
  if (!winner) return null;

  const id = text(winner.WLFARE_INFO_ID);
  const kind = text(winner.WLFARE_GDNC_TRGT_KCD);
  const params = new URLSearchParams({ wlfareInfoId: id });
  if (kind) params.set("wlfareInfoReldBztpCd", kind);
  return {
    tier: "bokjiro",
    label: "1차 · 복지로 인용",
    title: text(winner.WLFARE_INFO_NM),
    summary: text(winner.WLFARE_INFO_OUTL_CN),
    publisher: text(winner.BIZ_CHR_INST_NM) || "복지로",
    url: `${BOKJIRO_DETAIL_URL}?${params.toString()}`,
    matchedTerm: query,
  };
}
