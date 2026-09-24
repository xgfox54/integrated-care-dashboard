import type { ServiceRow } from "./dataset";

export const REGION_DEFINITIONS = [
  {
    id: "seoul",
    shortLabel: "서울",
    fullName: "서울특별시",
    aliases: ["서울특별시"],
  },
  {
    id: "busan",
    shortLabel: "부산",
    fullName: "부산광역시",
    aliases: ["부산광역시"],
  },
  {
    id: "daegu",
    shortLabel: "대구",
    fullName: "대구광역시",
    aliases: ["대구광역시"],
  },
  {
    id: "incheon",
    shortLabel: "인천",
    fullName: "인천광역시",
    aliases: ["인천광역시"],
  },
  {
    id: "daejeon",
    shortLabel: "대전",
    fullName: "대전광역시",
    aliases: ["대전광역시"],
  },
  {
    id: "ulsan",
    shortLabel: "울산",
    fullName: "울산광역시",
    aliases: ["울산광역시"],
  },
  {
    id: "sejong",
    shortLabel: "세종",
    fullName: "세종특별자치시",
    aliases: ["세종특별자치시"],
  },
  {
    id: "gyeonggi",
    shortLabel: "경기",
    fullName: "경기도",
    aliases: ["경기도"],
  },
  {
    id: "gangwon",
    shortLabel: "강원",
    fullName: "강원특별자치도",
    aliases: ["강원특별자치도", "강원도"],
  },
  {
    id: "chungbuk",
    shortLabel: "충북",
    fullName: "충청북도",
    aliases: ["충청북도"],
  },
  {
    id: "chungnam",
    shortLabel: "충남",
    fullName: "충청남도",
    aliases: ["충청남도"],
  },
  {
    id: "jeonbuk",
    shortLabel: "전북",
    fullName: "전북특별자치도",
    aliases: ["전북특별자치도", "전라북도"],
  },
  {
    id: "jeonnam_gwangju",
    shortLabel: "전남·광주",
    fullName: "전남광주통합특별시",
    aliases: ["전남광주통합특별시", "광주광역시", "전라남도"],
  },
  {
    id: "gyeongbuk",
    shortLabel: "경북",
    fullName: "경상북도",
    aliases: ["경상북도"],
  },
  {
    id: "gyeongnam",
    shortLabel: "경남",
    fullName: "경상남도",
    aliases: ["경상남도"],
  },
  {
    id: "jeju",
    shortLabel: "제주",
    fullName: "제주특별자치도",
    aliases: ["제주특별자치도"],
  },
] as const;

export type RegionId = (typeof REGION_DEFINITIONS)[number]["id"];

export interface RegionStatistic {
  readonly id: RegionId;
  readonly shortLabel: string;
  readonly fullName: string;
  readonly dataValue: string;
  readonly count: number;
}

export function getRegionDisplayName(sido: string): string {
  if (!sido) return "전국";
  return (
    REGION_DEFINITIONS.find((region) =>
      region.aliases.some((alias) => alias === sido),
    )?.fullName ?? sido
  );
}

export function buildRegionStatistics(
  rows: readonly Pick<ServiceRow, "sido">[],
): RegionStatistic[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.sido, (counts.get(row.sido) ?? 0) + 1);
  }

  return buildRegionStatisticsFromCounts(Object.fromEntries(counts));
}

export function buildRegionStatisticsFromCounts(
  source: Readonly<Record<string, number>>,
): RegionStatistic[] {
  const counts = new Map(Object.entries(source));

  return REGION_DEFINITIONS.map((region) => {
    let count = 0;
    let dataValue: string = region.fullName;
    for (const alias of region.aliases) {
      const aliasCount = counts.get(alias) ?? 0;
      count += aliasCount;
      if (aliasCount > 0 && counts.get(dataValue) === undefined) {
        dataValue = alias;
      }
    }
    return {
      id: region.id,
      shortLabel: region.shortLabel,
      fullName: region.fullName,
      dataValue,
      count,
    };
  });
}
