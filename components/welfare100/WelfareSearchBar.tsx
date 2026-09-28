"use client";

import { useMemo, useState, type FormEvent } from "react";

import { SearchIcon } from "@/components/ui/jeju-icons";
import { markUsageInternalNavigation, usageFilter } from "@/lib/usage/track";
import type { CatalogEntry } from "@/lib/welfare100/payload";
import { catalogRegions } from "@/lib/welfare100/regions";
import styles from "./InstitutionDetail.module.css";

/**
 * 제도 상세 화면의 통합검색(광역시·도, 기초시·군·구, 검색어).
 * 전체 복지제도를 대상으로, 고른 조건을 담아 복지제도 대장의 검색 결과로 옮겨 간다.
 */
export default function WelfareSearchBar({ catalog }: { catalog: readonly CatalogEntry[] }) {
  const regions = useMemo(() => catalogRegions(catalog), [catalog]);
  const [sido, setSido] = useState("");
  const [sigungu, setSigungu] = useState("");
  const [query, setQuery] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = new URL("/welfare100", window.location.href);
    const keyword = query.trim();
    if (keyword) url.searchParams.set("q", keyword);
    if (sido) url.searchParams.set("sido", sido);
    if (sido && sigungu) url.searchParams.set("sigungu", sigungu);
    url.hash = "institutions";
    // 이용통계: 직접 고른 조회 대상 지역만 센다. 목록으로 옮겨 가도 복지제도100 탭 열람을 다시 세지 않는다.
    if (sido) usageFilter("welfare_region", sigungu ? sido + "|" + sigungu : sido);
    markUsageInternalNavigation("welfare100");
    window.location.assign(url.href);
  };

  return (
    <form className={styles.search} role="search" aria-label="복지제도 통합검색" action="/welfare100" method="get" onSubmit={submit}>
      <div className={styles.searchRegions}>
        <select
          name="sido"
          aria-label="광역시·도 선택"
          value={sido}
          onChange={(event) => {
            setSido(event.target.value);
            setSigungu("");
          }}
        >
          <option value="">전체 광역시·도</option>
          {regions.sidos.map(([name, count]) => (
            <option key={name} value={name}>
              {name} ({count.toLocaleString("ko-KR")})
            </option>
          ))}
        </select>
        <select
          name="sigungu"
          aria-label="기초시·군·구 선택"
          value={sigungu}
          disabled={!sido}
          onChange={(event) => setSigungu(event.target.value)}
        >
          <option value="">전체 기초시·군·구</option>
          {sido
            ? regions.sigungus(sido).map(([name, count]) => (
                <option key={name} value={name}>
                  {name} ({count.toLocaleString("ko-KR")})
                </option>
              ))
            : null}
        </select>
      </div>
      <div className={styles.searchField}>
        <input
          type="search"
          name="q"
          value={query}
          aria-label="검색어 (제도명·개요·담당기관·법령)"
          placeholder="전체 복지제도 검색"
          enterKeyHint="search"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit">
          <SearchIcon />
          검색
        </button>
      </div>
    </form>
  );
}
