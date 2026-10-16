"use client";

import { useEffect, useMemo, useState } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ADMIN_CITY_SCOPE_NOTE } from "@/lib/admin-city";
import type { ServiceRow } from "@/lib/dataset";
import { INDICATOR_DEFINITIONS, buildRegionProfile, institutionsForCode, perThousand, type RegionProfile } from "@/lib/regional-indicators";
import { SIGUNGU_ELDERLY_SNAPSHOT } from "@/lib/statistics/sigungu-elderly-verified";

const NUMBER = new Intl.NumberFormat("ko-KR");
const DECIMAL = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TYPE_ORDER = ["전국", "광역", "지역특화", "공통_연계", "미분류"];

interface Institutions { readonly state: string; readonly basis_date: string | null; readonly source?: string; readonly counts: Readonly<Record<string, number>> }

function Unavailable({ reason }: { readonly reason: string }) {
  return <span className="text-(length:--jeju-text-xs) text-muted-foreground">{reason}</span>;
}

export function RegionalIndicatorTable({ rows, keys, dataAsOf }: { readonly rows: readonly ServiceRow[]; readonly keys: readonly string[]; readonly dataAsOf: string }) {
  const [institutions, setInstitutions] = useState<Institutions | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/regional-indicators/institutions", { signal: controller.signal })
      .then(async (response) => (response.ok ? ((await response.json()) as Institutions) : { state: "ERROR", basis_date: null, counts: {} }))
      .then(setInstitutions)
      .catch(() => { if (!controller.signal.aborted) setInstitutions({ state: "ERROR", basis_date: null, counts: {} }); });
    return () => controller.abort();
  }, []);
  const profiles = useMemo<RegionProfile[]>(() => keys.map((key) => buildRegionProfile(rows, key)), [rows, keys]);
  if (profiles.length === 0) return null;
  const institutionReady = institutions?.state === "COLLECTED";
  const institutionCount = (profile: RegionProfile) => (institutionReady && profile.elderly ? institutionsForCode(profile.elderly.code, institutions.counts) : null);
  const hasAdminCity = profiles.some((profile) => profile.scopeCounts);
  const cell = "text-right tabular-nums";

  return (
    <div className="rounded-lg border border-border p-3">
      <h3 className="text-(length:--jeju-text-sm) font-extrabold text-(--jeju-text-strong)">인구 대비 돌봄자원 비교</h3>
      <p className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">
        같은 기준으로 계산할 수 있는 값만 보여 줍니다. 확인되지 않은 값은 0이 아니라 사유를 적습니다. 사업 수는 공급 역량이나 정책 성과를 뜻하지 않습니다.
      </p>
      <div className="mt-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">지표</TableHead>
              {profiles.map((profile) => <TableHead key={profile.key} className="text-right">{profile.label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-bold">수록 사업 수</TableCell>
              {profiles.map((profile) => <TableCell key={profile.key} className={cell}>{NUMBER.format(profile.rows.length)}건</TableCell>)}
            </TableRow>
            {hasAdminCity ? (["행정시 전용", "도 공통", "적용범위 미확인"] as const).map((scope) => (
              <TableRow key={scope}>
                <TableCell className="pl-6 text-muted-foreground">└ {scope}</TableCell>
                {profiles.map((profile) => <TableCell key={profile.key} className={cell}>{profile.scopeCounts ? NUMBER.format(profile.scopeCounts[scope]) + "건" : <Unavailable reason="해당 없음" />}</TableCell>)}
              </TableRow>
            )) : null}
            {TYPE_ORDER.map((type) => (
              <TableRow key={type}>
                <TableCell className="pl-6 text-muted-foreground">사업구분 · {type}</TableCell>
                {profiles.map((profile) => <TableCell key={profile.key} className={cell}>{NUMBER.format(profile.typeCounts.find(([label]) => label === type)?.[1] ?? 0)}건</TableCell>)}
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-bold">65세 이상 인구</TableCell>
              {profiles.map((profile) => <TableCell key={profile.key} className={cell}>{profile.elderly ? NUMBER.format(profile.elderly.value) + "명" : <Unavailable reason="비교 불가: 공식 고령인구 미연결" />}</TableCell>)}
            </TableRow>
            <TableRow>
              <TableCell className="font-bold">고령인구 1천 명당 사업 수</TableCell>
              {profiles.map((profile) => {
                if (profile.scopeCounts) return <TableCell key={profile.key} className={cell}><Unavailable reason="비교 불가: 도 단위 사업이라 행정시 고령인구로 나누지 않음" /></TableCell>;
                const value = perThousand(profile.rows.length, profile.elderly?.value ?? null);
                return <TableCell key={profile.key} className={cell}>{value === null ? <Unavailable reason="비교 불가" /> : DECIMAL.format(value)}</TableCell>;
              })}
            </TableRow>
            <TableRow>
              <TableCell className="font-bold">장기요양기관 수</TableCell>
              {profiles.map((profile) => {
                const count = institutionCount(profile);
                return <TableCell key={profile.key} className={cell}>{count === null ? <Unavailable reason={institutions ? "자료 없음: 기관 수집 미완료" : "불러오는 중"} /> : NUMBER.format(count) + "곳"}</TableCell>;
              })}
            </TableRow>
            <TableRow>
              <TableCell className="font-bold">고령인구 1천 명당 장기요양기관 수</TableCell>
              {profiles.map((profile) => {
                const value = perThousand(institutionCount(profile), profile.elderly?.value ?? null);
                return <TableCell key={profile.key} className={cell}>{value === null ? <Unavailable reason="비교 불가" /> : DECIMAL.format(value)}</TableCell>;
              })}
            </TableRow>
            <TableRow>
              <TableCell className="font-bold">고령인구 1천 명당 서비스 제공인력 수</TableCell>
              {profiles.map((profile) => <TableCell key={profile.key} className={cell}><Unavailable reason="자료 없음: 공식 제공인력 통계 미연결" /></TableCell>)}
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <dl className="mt-3 grid gap-1 text-(length:--jeju-text-xs) leading-relaxed text-muted-foreground">
        <div><dt className="inline font-bold">자료 기준일 · </dt><dd className="inline">사업: 보건복지부 메뉴판 {dataAsOf || "기준월 미표기"} · 인구: {SIGUNGU_ELDERLY_SNAPSHOT.referenceDate} 주민등록인구 · 장기요양기관: {institutions?.basis_date ?? "미확인"} 수집. 기준일이 서로 달라 같은 시점 비교가 아닙니다.</dd></div>
        <div><dt className="inline font-bold">출처 · </dt><dd className="inline">{SIGUNGU_ELDERLY_SNAPSHOT.sourceTitle}({SIGUNGU_ELDERLY_SNAPSHOT.coverage}), {institutions?.source ?? "국민건강보험공단 장기요양기관 검색 서비스"}</dd></div>
        {INDICATOR_DEFINITIONS.map((definition) => <div key={definition.id}><dt className="inline font-bold">{definition.label} · </dt><dd className="inline">{definition.formula}</dd></div>)}
        {hasAdminCity ? <div><dt className="inline font-bold">제주 행정시 · </dt><dd className="inline">{ADMIN_CITY_SCOPE_NOTE} 행정시 사업 수에는 도 공통 사업이 함께 들어가므로 두 행정시를 더하면 도 전체보다 많아집니다.</dd></div> : null}
      </dl>
    </div>
  );
}

